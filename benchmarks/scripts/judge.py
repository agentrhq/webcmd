#!/usr/bin/env python3
import asyncio
import base64
import hashlib
import os
from pathlib import Path
from typing import Literal

from google import genai
from google.genai import types
from openai import AsyncOpenAI
from pydantic import BaseModel, StrictBool

from run_controller import ExecutionEvidence


JudgeProvider = Literal["google", "openai"]

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "references" / "judge-contract.md"
GROUND_TRUTH_RULES = """**GROUND TRUTH VALIDATION (HIGHEST PRIORITY):**
The <ground_truth> section contains verified correct information for this task. This can be:
- **Evaluation criteria**: Specific conditions that must be met (e.g., "The success popup should show up", "Must extract exactly 5 items")
- **Factual answers**: The correct answer to a question or information retrieval task (e.g. "10/11/24", "Paris")
- **Expected outcomes**: What should happen after task completion (e.g., "Google Doc must be created", "File should be downloaded")

The ground truth takes ABSOLUTE precedence over all other evaluation criteria. If the ground truth is not satisfied by the agent's execution and final response, the verdict MUST be false.

"""


class JudgementResult(BaseModel):
    reasoning: str | None = None
    verdict: StrictBool
    failure_reason: str | None = None
    impossible_task: StrictBool = False
    reached_captcha: StrictBool = False


def _truncate(text: str, limit: int = 80000) -> str:
    return text if len(text) <= limit else text[: limit - 15] + "...[truncated]"


def _last_unique(paths: list[Path], limit: int = 10) -> list[Path]:
    selected = []
    seen = set()
    for path in reversed(paths):
        digest = hashlib.sha256(path.read_bytes()).digest()
        if digest not in seen:
            seen.add(digest)
            selected.append(path)
        if len(selected) == limit:
            break
    return list(reversed(selected))


def build_judge_input(task: str, ground_truth: str | None, evidence: ExecutionEvidence) -> tuple[str, str, list[Path]]:
    contract = CONTRACT_PATH.read_text(encoding="utf-8")
    system = (GROUND_TRUTH_RULES if ground_truth else "") + contract
    truth = f"\n<ground_truth>\n{ground_truth}\n</ground_truth>" if ground_truth else ""
    images = _last_unique(evidence.screenshot_paths)
    user = f"""<task>
{_truncate(task)}
</task>{truth}
<agent_trajectory>
{_truncate(chr(10).join(evidence.steps))}
</agent_trajectory>
<final_result>
{_truncate(evidence.final_answer)}
</final_result>
{len(images)} screenshots from execution are attached.
Evaluate the execution and return the required structured judgement."""
    return system, user, images


async def _generate_google(model: str, system: str, user: str, images: list[Path]) -> JudgementResult:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is required")
    parts = [types.Part.from_text(text=user)]
    parts.extend(types.Part.from_bytes(data=path.read_bytes(), mime_type="image/png") for path in images)
    async with genai.Client(api_key=api_key).aio as client:
        response = await client.models.generate_content(
            model=model,
            contents=types.Content(role="user", parts=parts),
            config=types.GenerateContentConfig(system_instruction=system, response_mime_type="application/json", response_schema=JudgementResult),
        )
    if isinstance(response.parsed, JudgementResult):
        return response.parsed
    if response.parsed is not None:
        return JudgementResult.model_validate(response.parsed)
    return JudgementResult.model_validate_json(response.text or "")


async def _generate_openai(model: str, system: str, user: str, images: list[Path]) -> JudgementResult:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")
    content: list[dict[str, object]] = [{"type": "text", "text": user}]
    for path in images:
        encoded = base64.standard_b64encode(path.read_bytes()).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}})
    async with AsyncOpenAI(api_key=api_key) as client:
        response = await client.beta.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            response_format=JudgementResult,
        )
    parsed = response.choices[0].message.parsed
    if parsed is None:
        raise ValueError("invalid structured output")
    return parsed


async def _generate(provider: JudgeProvider, model: str, system: str, user: str, images: list[Path]) -> JudgementResult:
    if provider == "openai":
        return await _generate_openai(model, system, user, images)
    return await _generate_google(model, system, user, images)


async def judge_execution(
    task: str,
    ground_truth: str | None,
    evidence: ExecutionEvidence,
    model: str = "gemini-2.5-flash",
    provider: JudgeProvider = "google",
) -> JudgementResult:
    system, user, images = build_judge_input(task, ground_truth, evidence)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            return await _generate(provider, model, system, user, images)
        except Exception as error:
            last_error = error
            if attempt < 2:
                await asyncio.sleep(2**attempt)
    raise RuntimeError(f"judge failed after 3 attempts: {last_error}") from last_error
