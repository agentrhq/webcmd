import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import judge
from judge import JudgementResult, build_judge_input, judge_execution
from run_controller import ExecutionEvidence


def evidence(tmp_path: Path, screenshot_count: int = 12) -> ExecutionEvidence:
    shots = []
    for index in range(screenshot_count):
        path = tmp_path / f"{index:03}.png"
        path.write_bytes(b"same" if index < 2 else str(index).encode())
        shots.append(path)
    return ExecutionEvidence("answer", ["x" * 3000] * 20, shots, 0, "completed")


def test_judge_input_truncates_text_and_selects_last_ten_unique_images(tmp_path):
    system, user, images = build_judge_input("t" * 50000, "truth", evidence(tmp_path))
    assert len(user) < 121000
    assert "[truncated]" in user
    assert "GROUND TRUTH" in system
    assert len(images) == 10
    assert images[-1].name == "011.png"


def test_judge_input_omits_ground_truth_rules_without_answer(tmp_path):
    system, user, _ = build_judge_input("task", None, evidence(tmp_path, 0))
    assert "GROUND TRUTH" not in system
    assert "<ground_truth>" not in user


def test_general_benchmark_uses_task_completion_contract(tmp_path):
    system, _, _ = build_judge_input(
        "task", None, evidence(tmp_path, 0), benchmark="BU_Bench_V1"
    )

    assert "Task Satisfaction (Most Important)" in system
    assert "only whether anti-bot protection blocked" not in system


@pytest.mark.parametrize("benchmark", ["Stealth_Bench_V1", "Stealth_Webcmd"])
def test_stealth_benchmark_uses_blocking_only_contract(tmp_path, benchmark):
    system, _, _ = build_judge_input(
        "task", "stealth criteria", evidence(tmp_path, 0), benchmark=benchmark
    )

    assert "only whether anti-bot protection blocked" in system
    assert "Do not evaluate whether the agent completed the task steps" in system
    assert "Login or authentication requirements are not anti-bot failures" in system
    assert "Task Satisfaction (Most Important)" not in system
    assert "GROUND TRUTH VALIDATION" in system


def test_judge_retries_twice_then_returns_structured_result(tmp_path, monkeypatch):
    calls = 0

    async def fake_generate(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError("transient")
        return JudgementResult(reasoning="complete", verdict=True)

    async def no_sleep(delay):
        return None

    monkeypatch.setattr(judge, "_generate", fake_generate)
    monkeypatch.setattr(judge.asyncio, "sleep", no_sleep)
    result = asyncio.run(judge_execution("task", "answer", evidence(tmp_path), "gemini-2.5-flash"))

    assert calls == 3
    assert result.verdict is True


def test_judge_raises_after_three_invalid_attempts(tmp_path, monkeypatch):
    calls = 0

    async def always_fail(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise ValueError("invalid structured output")

    async def no_sleep(delay):
        return None

    monkeypatch.setattr(judge, "_generate", always_fail)
    monkeypatch.setattr(judge.asyncio, "sleep", no_sleep)

    with pytest.raises(RuntimeError, match="judge failed after 3 attempts"):
        asyncio.run(judge_execution("task", None, evidence(tmp_path, 0)))
    assert calls == 3


def _section(user: str, tag: str) -> str:
    return user.split(f"<{tag}>\n", 1)[1].split(f"\n</{tag}>", 1)[0]


def test_judge_input_limits_each_evidence_text_field(tmp_path):
    execution = ExecutionEvidence(
        final_answer="f" * 50000,
        steps=["a" * 25000, "b" * 25000],
        screenshot_paths=[],
        controller_exit_code=0,
        termination="completed",
    )

    _, user, _ = build_judge_input("t" * 50000, None, execution)

    assert all(
        len(_section(user, tag)) <= 40000
        for tag in ("task", "agent_trajectory", "final_result")
    )
    assert all(
        _section(user, tag).endswith("...[truncated]")
        for tag in ("task", "agent_trajectory", "final_result")
    )


def test_judgement_result_preserves_upstream_defaults():
    assert JudgementResult(verdict=True).model_dump() == {
        "reasoning": None,
        "verdict": True,
        "failure_reason": None,
        "impossible_task": False,
        "reached_captcha": False,
    }


@pytest.mark.parametrize("field", ["verdict", "impossible_task", "reached_captcha"])
@pytest.mark.parametrize("value", [0, 1, "false", "true"])
def test_judgement_result_rejects_non_boolean_values(field, value):
    payload = {"verdict": True, field: value}
    with pytest.raises(ValidationError):
        JudgementResult.model_validate(payload)


def test_invalid_boolean_structured_output_retries_then_raises(tmp_path, monkeypatch):
    calls = 0

    async def invalid_generate(*args, **kwargs):
        nonlocal calls
        calls += 1
        return JudgementResult.model_validate({"verdict": "false"})

    async def no_sleep(delay):
        return None

    monkeypatch.setattr(judge, "_generate", invalid_generate)
    monkeypatch.setattr(judge.asyncio, "sleep", no_sleep)

    with pytest.raises(RuntimeError, match="judge failed after 3 attempts"):
        asyncio.run(judge_execution("task", None, evidence(tmp_path, 0)))
    assert calls == 3


def test_generate_sends_multimodal_structured_request_and_validates_result(tmp_path, monkeypatch):
    image = tmp_path / "state.png"
    image.write_bytes(b"png bytes")
    captured = {}

    class FakeModels:
        async def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                parsed={
                    "reasoning": "done",
                    "verdict": True,
                    "failure_reason": "",
                    "impossible_task": False,
                    "reached_captcha": False,
                },
                text=None,
            )

    class FakeAsyncClient:
        models = FakeModels()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    class FakeClient:
        def __init__(self, *, api_key):
            captured["api_key"] = api_key
            self.aio = FakeAsyncClient()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(judge.genai, "Client", FakeClient)

    result = asyncio.run(judge._generate("google", "gemini-2.5-flash", "policy", "evidence", [image]))

    assert result == JudgementResult(
        reasoning="done", verdict=True, failure_reason="", impossible_task=False, reached_captcha=False
    )
    assert captured["api_key"] == "secret"
    assert captured["model"] == "gemini-2.5-flash"
    content = captured["contents"]
    assert content.role == "user"
    assert content.parts[0].text == "evidence"
    assert content.parts[1].inline_data.data == b"png bytes"
    assert content.parts[1].inline_data.mime_type == "image/png"
    config = captured["config"]
    assert config.system_instruction == "policy"
    assert config.response_mime_type == "application/json"
    assert config.response_schema is JudgementResult


def test_generate_rejects_malformed_structured_output(monkeypatch):
    class FakeModels:
        async def generate_content(self, **kwargs):
            return SimpleNamespace(parsed=None, text="{}")

    class FakeAsyncClient:
        models = FakeModels()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    class FakeClient:
        def __init__(self, *, api_key):
            self.aio = FakeAsyncClient()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(judge.genai, "Client", FakeClient)

    with pytest.raises(ValidationError):
        asyncio.run(judge._generate("google", "gemini-2.5-flash", "policy", "evidence", []))


def test_judge_default_model_is_gemini_2_5_flash(tmp_path, monkeypatch):
    captured = {}

    async def fake_generate(provider, model, *args):
        captured["provider"] = provider
        captured["model"] = model
        return JudgementResult(verdict=True)

    monkeypatch.setattr(judge, "_generate", fake_generate)

    asyncio.run(judge_execution("task", None, evidence(tmp_path, 0)))

    assert captured["provider"] == "google"
    assert captured["model"] == "gemini-2.5-flash"


def test_generate_openai_sends_multimodal_structured_request_and_validates_result(tmp_path, monkeypatch):
    image = tmp_path / "state.png"
    image.write_bytes(b"png bytes")
    captured = {}

    class FakeCompletions:
        async def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            parsed=JudgementResult(
                                reasoning="done",
                                verdict=True,
                                failure_reason="",
                                impossible_task=False,
                                reached_captcha=False,
                            )
                        )
                    )
                ]
            )

    class FakeClient:
        beta = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            captured["client_closed"] = True

    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setattr(
        judge,
        "AsyncOpenAI",
        lambda **kwargs: (captured.setdefault("api_key", kwargs.get("api_key")), FakeClient())[1],
    )

    result = asyncio.run(judge._generate("openai", "gpt-4o-mini", "policy", "evidence", [image]))

    assert result.verdict is True
    assert captured["api_key"] == "secret"
    assert captured["client_closed"] is True
    assert captured["model"] == "gpt-4o-mini"
    messages = captured["messages"]
    assert messages[0]["content"] == "policy"
    user_content = messages[1]["content"]
    assert user_content[0]["text"] == "evidence"
    assert user_content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert captured["response_format"] is JudgementResult


def test_generate_codex_uses_isolated_ephemeral_structured_run(tmp_path, monkeypatch):
    image = tmp_path / "state.png"
    image.write_bytes(b"png bytes")
    captured = {}

    class FakeProcess:
        returncode = 0

        async def communicate(self, prompt):
            captured["prompt"] = prompt.decode()
            output_path = Path(captured["command"][captured["command"].index("--output-last-message") + 1])
            output_path.write_text(json.dumps({"verdict": True}), encoding="utf-8")
            return b"", b""

    async def fake_create_subprocess_exec(*command, **kwargs):
        captured["command"] = list(command)
        captured["kwargs"] = kwargs
        schema_path = Path(command[command.index("--output-schema") + 1])
        captured["schema"] = json.loads(schema_path.read_text(encoding="utf-8"))
        return FakeProcess()

    monkeypatch.setattr(judge.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(judge._generate("codex", "gpt-5.4", "policy", "evidence", [image]))

    assert result.verdict is True
    command = captured["command"]
    assert command[:2] == ["codex", "exec"]
    assert "--ephemeral" in command
    assert "--ignore-user-config" in command
    assert "--ignore-rules" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert command[command.index("--model") + 1] == "gpt-5.4"
    assert command[command.index("--image") + 1] == str(image)
    assert command[-1] == "-"
    assert captured["kwargs"]["stdin"] is asyncio.subprocess.PIPE
    assert "<judge_instructions>\npolicy\n</judge_instructions>" in captured["prompt"]
    assert captured["prompt"].endswith("evidence")
    assert set(captured["schema"]["required"]) == set(captured["schema"]["properties"])
    assert captured["schema"]["additionalProperties"] is False


def test_generate_codex_reports_cli_failure(monkeypatch):
    class FakeProcess:
        returncode = 1

        async def communicate(self, prompt):
            return b"", b"subscription exhausted"

    async def fake_create_subprocess_exec(*command, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(judge.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(RuntimeError, match="subscription exhausted"):
        asyncio.run(judge._generate("codex", "gpt-5.4", "policy", "evidence", []))
