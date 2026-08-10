import asyncio
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

    result = asyncio.run(judge._generate("gemini-2.5-flash", "policy", "evidence", [image]))

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
        asyncio.run(judge._generate("gemini-2.5-flash", "policy", "evidence", []))


def test_judge_default_model_is_gemini_2_5_flash(tmp_path, monkeypatch):
    captured = {}

    async def fake_generate(model, *args):
        captured["model"] = model
        return JudgementResult(verdict=True)

    monkeypatch.setattr(judge, "_generate", fake_generate)

    asyncio.run(judge_execution("task", None, evidence(tmp_path, 0)))

    assert captured["model"] == "gemini-2.5-flash"
