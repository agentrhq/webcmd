import argparse
import asyncio
import json
from pathlib import Path

import pytest

import run_eval
from judge import JudgementResult
from run_controller import ControllerMetrics, ExecutionEvidence, TokenUsage


BASE = ["--controller", "codex", "--model", "gpt-5", "--benchmark", "BU_Bench_V1"]


@pytest.fixture(autouse=True)
def isolated_webcmd_config(tmp_path, monkeypatch):
    config_dir = tmp_path / "webcmd-config"
    config_dir.mkdir()
    (config_dir / "config.json").write_text(
        json.dumps({"mode": "local", "updatedAt": "2026-08-04T00:00:00Z"})
    )
    monkeypatch.setenv("WEBCMD_CONFIG_DIR", str(config_dir))
    monkeypatch.setenv("GOOGLE_API_KEY", "judge-secret")


def controller_metrics():
    return ControllerMetrics(
        duration_seconds=12.5,
        steps=4,
        tool_calls=3,
        tokens=TokenUsage(100, 70, 10, 20, 5, 2, 105, estimated_api_cost_usd=0.123),
        provider_turns=2,
        provider_duration_seconds=12.0,
        provider_api_duration_seconds=10.0,
        agent_turns=2,
    )


def test_cli_requires_exactly_one_explicit_task_selection():
    with pytest.raises(SystemExit):
        run_eval.parse_args(BASE)
    args = run_eval.parse_args(BASE + ["--tasks", "1"])
    assert args.tools == "webcmd"
    assert args.judge_model == "gemini-2.5-flash"
    assert args.judge_provider == "google"
    assert args.task_timeout == 1800
    assert args.reasoning_effort is None
    assert args.parallel == 1


def test_cli_accepts_parallel_limit():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--parallel", "5"])

    run_eval.validate_args(args)

    assert args.parallel == 5


def test_cli_rejects_non_positive_parallel_limit():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--parallel", "0"])

    with pytest.raises(ValueError, match="--parallel must be positive"):
        run_eval.validate_args(args)


def test_cli_accepts_openai_judge_provider():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--judge-provider", "openai"])
    assert args.judge_provider == "openai"
    assert args.judge_model == "gpt-4o-mini"


def test_preflight_requires_openai_key_for_openai_judge(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        run_eval.preflight("codex", ["webcmd"], "openai")


def test_preflight_accepts_openai_judge_without_google_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "judge-secret")

    def fake_run(command, **kwargs):
        stdout = f"{run_eval.WEBCMD_EVAL_VERSION}\n" if command == ["webcmd", "--version"] else "1\n"
        return type("Result", (), {"returncode": 0, "stdout": stdout, "stderr": ""})()

    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    versions = run_eval.preflight("codex", ["webcmd"], "openai")
    assert versions["codex"] == "1"


def test_cli_accepts_stealth_webcmd():
    args = run_eval.parse_args([
        "--controller", "codex",
        "--model", "gpt-5.6-sol",
        "--benchmark", "Stealth_Webcmd",
        "--tasks", "all",
        "--tools", "webcmd",
    ])

    assert args.benchmark == "Stealth_Webcmd"


def test_cli_accepts_optional_reasoning_effort():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--reasoning-effort", "high"])

    assert args.reasoning_effort == "high"


def test_cli_rejects_reasoning_effort_for_claude():
    args = run_eval.parse_args([
        "--controller", "claude",
        "--model", "claude-sonnet-4-5",
        "--benchmark", "BU_Bench_V1",
        "--tasks", "1",
        "--reasoning-effort", "high",
    ])

    with pytest.raises(ValueError, match="Codex or Pi"):
        run_eval.validate_args(args)


def test_cli_accepts_reasoning_effort_for_pi():
    args = run_eval.parse_args([
        "--controller", "pi",
        "--model", "openai/gpt-5.6-sol",
        "--benchmark", "BU_Bench_V1",
        "--tasks", "1",
        "--reasoning-effort", "low",
    ])

    run_eval.validate_args(args)


def test_cli_rejects_unsupported_reasoning_effort_for_pi():
    args = run_eval.parse_args([
        "--controller", "pi",
        "--model", "openai/gpt-5.6-sol",
        "--benchmark", "BU_Bench_V1",
        "--tasks", "1",
        "--reasoning-effort", "ultra",
    ])

    with pytest.raises(ValueError, match="Pi.*ultra"):
        run_eval.validate_args(args)


def test_cli_accepts_chrome_devtools_axi():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--tools", "chrome-devtools-axi"])

    assert args.tools == "chrome-devtools-axi"


def test_cli_accepts_agent_browser():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--tools", "agent-browser"])

    assert args.tools == "agent-browser"


def test_cli_accepts_dev_browser():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--tools", "dev-browser"])

    assert args.tools == "dev-browser"


def test_cli_accepts_libretto_for_codex():
    args = run_eval.parse_args(
        BASE + ["--tasks", "1", "--tools", "libretto"]
    )

    run_eval.validate_args(args)
    assert args.tools == "libretto"


def test_cli_accepts_libretto_for_pi():
    args = run_eval.parse_args(
        [
            "--controller",
            "pi",
            "--model",
            "openai/gpt-5.6-sol",
            "--benchmark",
            "BU_Bench_V1",
            "--tasks",
            "1",
            "--tools",
            "libretto",
        ]
    )

    run_eval.validate_args(args)


@pytest.mark.parametrize("tool", ["chrome-devtools-axi", "agent-browser"])
def test_cli_rejects_pi_tools_without_pi_integration(tool):
    args = run_eval.parse_args(
        [
            "--controller",
            "pi",
            "--model",
            "openai/gpt-5.6-sol",
            "--benchmark",
            "BU_Bench_V1",
            "--tasks",
            "1",
            "--tools",
            tool,
        ]
    )

    with pytest.raises(ValueError, match="Pi.*Webcmd, dev-browser, or Libretto"):
        run_eval.validate_args(args)


def test_cli_rejects_libretto_for_claude():
    args = run_eval.parse_args(
        [
            "--controller",
            "claude",
            "--model",
            "model",
            "--benchmark",
            "BU_Bench_V1",
            "--tasks",
            "1",
            "--tools",
            "libretto",
        ]
    )

    with pytest.raises(ValueError, match="Libretto.*Codex or Pi"):
        run_eval.validate_args(args)


def test_cli_rejects_unknown_tools():
    with pytest.raises(SystemExit):
        run_eval.parse_args(BASE + ["--tasks", "1", "--tools", "other-tool"])


def test_official_stealth_view_is_rejected_for_bu():
    args = run_eval.parse_args(BASE + ["--tasks", "1", "--stealth-view", "official"])
    with pytest.raises(ValueError, match="Stealth"):
        run_eval.validate_args(args)


def test_official_stealth_view_is_rejected_for_stealth_webcmd():
    args = run_eval.parse_args([
        "--controller", "codex",
        "--model", "gpt-5.6-sol",
        "--benchmark", "Stealth_Webcmd",
        "--tasks", "all",
        "--stealth-view", "official",
    ])

    with pytest.raises(ValueError, match="Stealth_Bench_V1"):
        run_eval.validate_args(args)


def test_output_destination_allows_default_nested_results_and_external_paths(tmp_path):
    assert run_eval._validate_output_dir(run_eval.PROJECT_DIR / "results") == (run_eval.PROJECT_DIR / "results").resolve()
    assert run_eval._validate_output_dir(run_eval.PROJECT_DIR / "results" / "nested") == (run_eval.PROJECT_DIR / "results" / "nested").resolve()
    assert run_eval._validate_output_dir(tmp_path) == tmp_path.resolve()


def test_output_destination_rejects_unignored_repository_path_before_preflight(monkeypatch):
    called = False

    def fake_preflight(*args):
        nonlocal called
        called = True
        return {}

    unsafe = run_eval.PROJECT_DIR / "unsafe-eval-output"
    monkeypatch.setattr(run_eval, "preflight", fake_preflight)
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="BU_Bench_V1", tasks="1", task_indices=None, tools="webcmd", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=unsafe, reasoning_effort=None)

    with pytest.raises(ValueError, match="results"):
        asyncio.run(run_eval.run_benchmark(args))

    assert called is False
    assert not unsafe.exists()


def test_preflight_captures_selected_versions(monkeypatch):
    class Completed:
        returncode = 0
        stderr = ""

        def __init__(self, stdout):
            self.stdout = stdout

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        stdout = f"{run_eval.WEBCMD_EVAL_VERSION}\n" if command == ["webcmd", "--version"] else "1.2.3\n"
        return Completed(stdout)

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    versions = run_eval.preflight("codex", ["webcmd"])

    assert versions == {"codex": "1.2.3", "webcmd": run_eval.WEBCMD_EVAL_VERSION, "webcmd_mode": "local"}
    assert ["webcmd", "doctor"] in calls


def test_preflight_rejects_unpinned_webcmd_version(monkeypatch):
    class Completed:
        returncode = 0
        stderr = ""

        def __init__(self, stdout):
            self.stdout = stdout

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        version = "0.7.0\n" if command == ["webcmd", "--version"] else "1.2.3\n"
        return Completed(version)

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="Webcmd 0.7.1 is required, found 0.7.0"):
        run_eval.preflight("codex", ["webcmd"])

    assert ["webcmd", "doctor"] not in calls


def test_preflight_checks_cloud_connection_without_local_doctor(tmp_path, monkeypatch):
    class Completed:
        returncode = 0
        stderr = ""

        def __init__(self, stdout):
            self.stdout = stdout

    config_dir = tmp_path / "hosted-webcmd-config"
    config_dir.mkdir()
    (config_dir / "config.json").write_text(json.dumps({
        "mode": "hosted",
        "updatedAt": "2026-08-04T00:00:00Z",
        "hosted": {
            "apiBaseUrl": "https://api.webcmd.dev",
            "apiKey": "test-key",
        },
    }))
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        stdout = f"{run_eval.WEBCMD_EVAL_VERSION}\n" if command == ["webcmd", "--version"] else "1.2.3\n"
        return Completed(stdout)

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setenv("WEBCMD_CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)

    versions = run_eval.preflight("codex", ["webcmd"])

    assert versions == {"codex": "1.2.3", "webcmd": run_eval.WEBCMD_EVAL_VERSION, "webcmd_mode": "hosted"}
    assert ["webcmd", "profile", "list", "-f", "json"] in calls
    assert ["webcmd", "doctor"] not in calls


def test_preflight_checks_pi_through_the_pinned_sidecar(monkeypatch):
    class Completed:
        returncode = 0
        stderr = ""

        def __init__(self, stdout):
            self.stdout = stdout

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        stdout = f"{run_eval.WEBCMD_EVAL_VERSION}\n" if command == ["webcmd", "--version"] else "1.2.3\n"
        return Completed(stdout)

    monkeypatch.setenv("GOOGLE_API_KEY", "judge-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "controller-secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)

    versions = run_eval.preflight("pi", ["webcmd"])

    assert versions == {"pi": "1.2.3", "webcmd": run_eval.WEBCMD_EVAL_VERSION, "webcmd_mode": "local"}
    assert calls[0] == [
        "node",
        str(run_eval.PI_CONTROLLER),
        "--version",
    ]
    assert ["webcmd", "doctor"] in calls


def test_preflight_checks_axi_through_npx_without_webcmd_doctor(monkeypatch):
    class Completed:
        returncode = 0
        stdout = "0.1.26\n"
        stderr = ""

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return Completed()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    monkeypatch.setattr(run_eval, "cloakbrowser_version", lambda: "0.4.5")

    versions = run_eval.preflight("codex", ["chrome-devtools-axi"])

    assert versions == {"codex": "0.1.26", "chrome-devtools-axi": "0.1.26", "cloakbrowser": "0.4.5"}
    assert ["npx", "-y", "chrome-devtools-axi", "--version"] in calls
    assert all("doctor" not in command for command in calls)


def test_preflight_checks_agent_browser_and_cloak_without_downloading_chrome(monkeypatch):
    class Completed:
        returncode = 0
        stdout = "0.32.3\n"
        stderr = ""

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return Completed()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    monkeypatch.setattr(run_eval, "cloakbrowser_version", lambda: "0.4.5")

    versions = run_eval.preflight("codex", ["agent-browser"])

    assert versions == {"codex": "0.32.3", "agent-browser": "0.32.3", "cloakbrowser": "0.4.5"}
    assert ["agent-browser", "--version"] in calls
    assert all("install" not in command and "doctor" not in command for command in calls)


def test_preflight_checks_dev_browser_and_cloak_without_downloading_chromium(
    monkeypatch,
):
    class Completed:
        returncode = 0
        stdout = "0.2.9\n"
        stderr = ""

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return Completed()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    monkeypatch.setattr(run_eval, "cloakbrowser_version", lambda: "0.4.5")
    monkeypatch.setattr(
        run_eval, "dev_browser_version", lambda env: "0.2.9"
    )

    versions = run_eval.preflight("codex", ["dev-browser"])

    assert versions == {
        "codex": "0.2.9",
        "dev-browser": "0.2.9",
        "cloakbrowser": "0.4.5",
    }
    assert ["dev-browser", "--version"] not in calls
    assert all("install" not in command and "doctor" not in command for command in calls)


def test_preflight_checks_pinned_libretto_sidecar_and_cloak(monkeypatch):
    class Completed:
        returncode = 0
        stdout = "0.1.2\n"
        stderr = ""

    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return Completed()

    monkeypatch.setenv("GOOGLE_API_KEY", "secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    monkeypatch.setattr(run_eval, "cloakbrowser_version", lambda: "0.4.5")

    versions = run_eval.preflight("codex", ["libretto"])

    assert versions == {
        "codex": "0.1.2",
        "libretto": "0.1.2",
        "cloakbrowser": "0.4.5",
    }
    assert [
        "node",
        str(run_eval.LIBRETTO_MCP),
        "--version",
    ] in calls
    assert all("install" not in command and "doctor" not in command for command in calls)


def test_preflight_uses_controller_only_and_selected_tool_only_environments(monkeypatch):
    class Completed:
        returncode = 0
        stderr = ""

        def __init__(self, stdout):
            self.stdout = stdout

    environments = {}

    def fake_run(command, **kwargs):
        environments.setdefault(command[0], []).append(kwargs["env"])
        stdout = f"{run_eval.WEBCMD_EVAL_VERSION}\n" if command == ["webcmd", "--version"] else "1.2.3\n"
        return Completed(stdout)

    monkeypatch.setenv("PATH", "/bin")
    monkeypatch.setenv("GOOGLE_API_KEY", "judge-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "controller-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "competing-controller-secret")
    monkeypatch.setenv("WEBCMD_API_KEY", "selected-tool-secret")
    monkeypatch.setenv("BROWSER_USE_API_KEY", "competing-tool-secret")
    monkeypatch.setenv("DATABASE_URL", "unrelated-secret")
    monkeypatch.setenv("OPENAI_GROUND_TRUTH", "evaluation-secret")
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)

    run_eval.preflight("codex", ["webcmd"])

    controller_env = environments["codex"][0]
    tool_envs = environments["webcmd"]
    assert controller_env["OPENAI_API_KEY"] == "controller-secret"
    assert all(env["WEBCMD_API_KEY"] == "selected-tool-secret" for env in tool_envs)
    assert len(tool_envs) == 2
    assert {"GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "WEBCMD_API_KEY", "BROWSER_USE_API_KEY", "DATABASE_URL", "OPENAI_GROUND_TRUTH"}.isdisjoint(controller_env)
    for env in tool_envs:
        assert {"GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "BROWSER_USE_API_KEY", "DATABASE_URL", "OPENAI_GROUND_TRUTH"}.isdisjoint(env)


def test_manifest_records_only_reproducibility_fields(tmp_path):
    tasks = [
        {"_effective_index": 0, "_raw_index": 0},
        {"_effective_index": 1, "_raw_index": 20},
    ]
    manifest = run_eval.build_manifest(
        run_id="20260717T120000Z-codex-stealth-bench-v1",
        benchmark="Stealth_Bench_V1",
        tasks=tasks,
        controller="codex",
        model="gpt-5",
        judge_provider="google", judge_model="gemini-2.5-flash",
        versions={"codex": "1", "webcmd": "2"},
        tools=["webcmd"],
        timeout=1800,
        created_at="2026-07-17T12:00:00Z",
        reasoning_effort="high",
        parallel=5,
    )
    assert manifest["task_selection"]["raw_indices"] == [0, 20]
    assert manifest["dataset_sha256"] == run_eval.dataset_sha256("Stealth_Bench_V1")
    assert manifest["controller"]["reasoning_effort"] == "high"
    assert manifest["parallel"] == 5
    assert "duration" not in json.dumps(manifest)
    assert "cost" not in json.dumps(manifest)


def test_manifest_records_webcmd_cloud_mode():
    tasks = run_eval.effective_tasks(
        "BU_Bench_V1", run_eval.load_tasks("BU_Bench_V1"), "raw"
    )[:1]

    manifest = run_eval.build_manifest(
        run_id="run",
        benchmark="BU_Bench_V1",
        tasks=tasks,
        controller="codex",
        model="gpt-5",
        judge_provider="google", judge_model="gemini-2.5-flash",
        versions={"codex": "1", "webcmd": "2", "webcmd_mode": "hosted"},
        tools=["webcmd"],
        timeout=1800,
        created_at="2026-08-04T00:00:00Z",
    )

    assert manifest["tools"]["webcmd"] == {"version": "2", "mode": "hosted"}


def test_manifest_records_libretto_with_cloakbrowser():
    tasks = run_eval.effective_tasks(
        "BU_Bench_V1", run_eval.load_tasks("BU_Bench_V1"), "raw"
    )[:1]

    manifest = run_eval.build_manifest(
        run_id="run",
        benchmark="BU_Bench_V1",
        tasks=tasks,
        controller="codex",
        model="gpt-5",
        judge_provider="google", judge_model="gemini-2.5-flash",
        versions={
            "codex": "1",
            "libretto": "0.1.2",
            "cloakbrowser": "0.4.5",
        },
        tools=["libretto"],
        timeout=1800,
        created_at="2026-07-27T12:00:00Z",
    )

    assert manifest["tools"]["libretto"] == {
        "version": "0.1.2",
        "browser": {
            "name": "cloakbrowser",
            "version": "0.4.5",
        },
    }


def test_summary_aggregates_available_metrics_and_marks_missing_tokens():
    results = [
        {"task_id": "a", "tool": "webcmd", "category": "A", "status": "completed", "score": 1, "metrics": {"steps": 4, "tool_calls": 3, "total_duration": 10.0, "tokens": 25, "agent_turns": 2, "controller_token_usage": {"non_cached_input_tokens": 15, "cached_read_input_tokens": 70, "cached_write_input_tokens": 5, "output_tokens": 10, "reasoning_output_tokens": 2}, "estimated_api_cost_usd": 0.4}},
        {"task_id": "b", "tool": "webcmd", "category": "B", "status": "judge_error", "score": None, "metrics": {"steps": 2, "tool_calls": 1, "total_duration": 5.0, "tokens": 10, "agent_turns": 3, "controller_token_usage": {"non_cached_input_tokens": 6, "cached_read_input_tokens": 30, "cached_write_input_tokens": 1, "output_tokens": 4, "reasoning_output_tokens": 1}, "estimated_api_cost_usd": 0.2}},
    ]
    summary = run_eval.build_summary(results, ["webcmd"])

    assert summary["complete"] is False
    assert summary["schema_version"] == 2
    assert summary["metrics"]["total_steps"] == 6
    assert summary["metrics"]["total_tool_calls"] == 4
    assert summary["metrics"]["total_duration"] == 15.0
    assert summary["metrics"]["total_tokens"] == 35
    assert summary["metrics"]["total_agent_turns"] == 5
    assert summary["metrics"]["controller_token_usage"] == {
        "non_cached_input_tokens": 21,
        "cached_read_input_tokens": 100,
        "cached_write_input_tokens": 6,
        "output_tokens": 14,
        "reasoning_output_tokens": 3,
    }
    assert summary["metrics"]["estimated_api_cost_usd"] == pytest.approx(0.6)


def test_task_metrics_add_cost_breakdown_without_changing_legacy_counts():
    metrics = run_eval._task_metrics(type("Evidence", (), {"metrics": controller_metrics()})())

    assert metrics["tokens"] == 25
    assert metrics["steps"] == 4
    assert metrics["tool_calls"] == 3
    assert metrics["agent_turns"] == 2
    assert metrics["controller_token_usage"] == {
        "non_cached_input_tokens": 20,
        "cached_read_input_tokens": 70,
        "cached_write_input_tokens": 10,
        "output_tokens": 5,
        "reasoning_output_tokens": 2,
    }
    assert metrics["estimated_api_cost_usd"] == 0.123


def test_summary_marks_agent_turns_unavailable_when_any_attempt_is_missing_them():
    results = [
        {"task_id": "a", "tool": "webcmd", "category": "A", "status": "completed", "score": 1, "metrics": {"steps": 1, "tool_calls": 0, "total_duration": 1.0, "tokens": 5, "agent_turns": 2}},
        {"task_id": "b", "tool": "webcmd", "category": "A", "status": "controller_error", "score": 0, "metrics": {"steps": 0, "tool_calls": 0, "total_duration": 1.0, "tokens": None, "agent_turns": None}},
    ]

    summary = run_eval.build_summary(results, ["webcmd"])

    assert summary["metrics"]["total_agent_turns"] is None


def test_run_attempt_does_not_persist_task_or_ground_truth(tmp_path, monkeypatch):
    controller_kwargs = {}
    judge_kwargs = {}

    async def fake_controller(*args, **kwargs):
        controller_kwargs.update(kwargs)
        work_dir = args[4]
        shot = work_dir / "shots" / "step_001.png"
        shot.parent.mkdir(parents=True, exist_ok=True)
        shot.write_bytes(b"png")
        return ExecutionEvidence("safe final", ["command: safe"], [shot], 0, "completed")

    async def fake_judge(*args, **kwargs):
        judge_kwargs.update(kwargs)
        execution = args[2]
        assert len(execution.screenshot_paths) == 1
        assert execution.screenshot_paths[0].read_bytes() == b"png"
        return JudgementResult(reasoning="correct", verdict=True)

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {"task_id": "secret-id", "confirmed_task": "protected prompt", "answer": "protected truth", "category": "A", "_raw_index": 7}
    result = asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash", reasoning_effort="high"))

    persisted = (tmp_path / "attempt" / "result.json").read_text()
    assert result["score"] == 1
    assert result["reasoning_effort"] == "high"
    assert controller_kwargs["reasoning_effort"] == "high"
    assert judge_kwargs["benchmark"] == "BU_Bench_V1"
    assert "protected prompt" not in persisted
    assert "protected truth" not in persisted
    assert (tmp_path / "attempt" / "transcript.jsonl").exists()
    assert (tmp_path / "attempt" / "screenshots" / "001.png").exists()
    assert result["evidence"]["screenshots"] == ["screenshots/001.png"]


def test_run_attempt_checkpoints_and_finalizes_controller_metrics(tmp_path, monkeypatch):
    async def fake_controller(*args, **kwargs):
        return ExecutionEvidence("answer", ["text: answer"], [], 0, "completed", controller_metrics())

    async def fake_judge(*args, **kwargs):
        checkpoint = json.loads((tmp_path / "attempt" / "result.json").read_text())
        assert checkpoint["schema_version"] == 2
        assert checkpoint["status"] == "judge_pending"
        assert checkpoint["score"] is None
        assert checkpoint["metrics"]["total_duration"] == 12.5
        assert checkpoint["metrics"]["steps"] == 4
        assert checkpoint["metrics"]["tool_calls"] == 3
        assert checkpoint["metrics"]["tokens"] == 25
        assert checkpoint["metrics"]["agent_turns"] == 2
        assert checkpoint["metrics"]["controller_token_usage"] == {
            "non_cached_input_tokens": 20,
            "cached_read_input_tokens": 70,
            "cached_write_input_tokens": 10,
            "output_tokens": 5,
            "reasoning_output_tokens": 2,
        }
        assert checkpoint["metrics"]["estimated_api_cost_usd"] == 0.123
        return JudgementResult(reasoning="correct", verdict=True)

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {"task_id": "x", "confirmed_task": "task", "category": "A", "_raw_index": 0}

    result = asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash"))

    assert result["status"] == "completed"
    assert result["metrics"]["steps"] == 4
    assert result["metrics"]["tool_calls"] == 3
    assert result["metrics"]["total_duration"] == 12.5
    assert result["metrics"]["tokens"] == 25
    assert result["metrics"]["agent_turns"] == 2


def test_run_attempt_keeps_agent_turns_when_judge_marks_answer_incorrect(
    tmp_path, monkeypatch
):
    async def fake_controller(*args, **kwargs):
        return ExecutionEvidence(
            "wrong answer",
            ["text: wrong answer"],
            [],
            0,
            "completed",
            controller_metrics(),
        )

    async def fake_judge(*args, **kwargs):
        return JudgementResult(reasoning="incorrect", verdict=False)

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {
        "task_id": "x",
        "confirmed_task": "task",
        "category": "A",
        "_raw_index": 0,
    }

    result = asyncio.run(
        run_eval.run_attempt(
            run_id="run",
            benchmark="BU_Bench_V1",
            task=task,
            effective_index=0,
            controller="codex",
            model="gpt-5.6-sol",
            tool="webcmd",
            timeout=10,
            attempt_dir=tmp_path / "attempt",
            judge_provider="google", judge_model="gemini-2.5-flash",
        )
    )

    assert result["score"] == 0
    assert result["metrics"]["agent_turns"] == 2


def test_run_attempt_leaves_judge_failure_unscored(tmp_path, monkeypatch):
    async def fake_controller(*args, **kwargs):
        return ExecutionEvidence("answer", [], [], 0, "completed")

    async def broken_judge(*args, **kwargs):
        raise RuntimeError("judge unavailable")

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", broken_judge)
    task = {"task_id": "x", "confirmed_task": "task", "category": "A", "_raw_index": 0}
    result = asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash"))
    assert result["status"] == "judge_error"
    assert result["score"] is None


def test_run_attempt_redacts_protected_values_from_durable_copies(tmp_path, monkeypatch):
    prompt = "protected full prompt"
    truth = "protected hidden truth"
    evidence = ExecutionEvidence("safe final", [f"controller echoed {prompt}"], [], 0, "completed")

    class EchoingJudgement:
        verdict = False

        def model_dump(self):
            return {
                "reasoning": f"reasoning echoed {prompt}",
                "verdict": False,
                "failure_reason": {"nested": [truth, {"detail": f"{prompt} / {truth}"}]},
            }

    async def fake_controller(*args, **kwargs):
        return evidence

    async def fake_judge(*args, **kwargs):
        assert args[2].steps == [f"controller echoed {prompt}"]
        return EchoingJudgement()

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {"task_id": "x", "confirmed_task": prompt, "answer": truth, "category": "A", "_raw_index": 0}

    asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash"))

    durable = (tmp_path / "attempt" / "result.json").read_text() + (tmp_path / "attempt" / "transcript.jsonl").read_text()
    assert prompt not in durable
    assert truth not in durable
    assert evidence.steps == [f"controller echoed {prompt}"]


def test_run_attempt_preserves_final_answer_even_when_it_equals_truth(tmp_path, monkeypatch):
    truth = "approved contestant evidence"

    async def fake_controller(*args, **kwargs):
        return ExecutionEvidence(truth, ["safe step"], [], 0, "completed")

    async def fake_judge(*args, **kwargs):
        return JudgementResult(reasoning="safe", verdict=True)

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {"task_id": "x", "confirmed_task": "prompt", "answer": truth, "category": "A", "_raw_index": 0}

    asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash"))

    assert json.loads((tmp_path / "attempt" / "result.json").read_text())["final_answer"] == truth


@pytest.mark.parametrize(
    ("truth", "reasoning", "expected"),
    [
        ("A", "A valid answer mentions CAT, but hidden answer is A.", "A valid answer mentions CAT, but hidden answer is [REDACTED]."),
        ("7", "There are 17 results; hidden answer is 7.", "There are 17 results; hidden answer is [REDACTED]."),
    ],
)
def test_run_attempt_redacts_short_hidden_answers_only_at_boundaries(tmp_path, monkeypatch, truth, reasoning, expected):
    async def fake_controller(*args, **kwargs):
        return ExecutionEvidence("safe final", ["safe step"], [], 0, "completed")

    async def fake_judge(*args, **kwargs):
        return JudgementResult(reasoning=reasoning, verdict=False, failure_reason=truth)

    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    task = {"task_id": "x", "confirmed_task": "prompt", "answer": truth, "category": "A", "_raw_index": 0}

    asyncio.run(run_eval.run_attempt(run_id="run", benchmark="BU_Bench_V1", task=task, effective_index=0, controller="codex", model="gpt-5", tool="webcmd", timeout=10, attempt_dir=tmp_path / "attempt", judge_provider="google", judge_model="gemini-2.5-flash"))

    result = json.loads((tmp_path / "attempt" / "result.json").read_text())
    assert result["judgement"]["reasoning"] == expected
    assert result["judgement"]["failure_reason"] == "[REDACTED]"


@pytest.mark.parametrize("indices", ["", ",", " , , "])
def test_select_tasks_rejects_empty_explicit_indices(indices):
    with pytest.raises(ValueError, match="at least one"):
        run_eval.select_tasks([{"task_id": "x"}], None, indices)


def test_select_tasks_rejects_duplicate_explicit_indices():
    with pytest.raises(ValueError, match="duplicate"):
        run_eval.select_tasks([{"task_id": "x"}, {"task_id": "y"}], None, "0,1,0")


def test_run_benchmark_writes_manifest_before_sequential_attempts(tmp_path, monkeypatch):
    prompt_a, truth_a = "protected prompt a", "protected truth a"
    prompt_b, truth_b = "protected prompt b", "protected truth b"
    tasks = [
        {"task_id": "a", "confirmed_task": prompt_a, "answer": truth_a, "category": "A", "_raw_index": 2},
        {"task_id": "b", "confirmed_task": prompt_b, "answer": truth_b, "category": "B", "_raw_index": 3},
    ]
    calls = []

    async def fake_controller(*args, **kwargs):
        assert list(tmp_path.glob("*/manifest.json"))
        calls.append((args[3], args[2]))
        return ExecutionEvidence("safe final", ["safe step"], [], 0, "completed")

    async def fake_judge(*args, **kwargs):
        return JudgementResult(reasoning="safe", verdict=True)

    monkeypatch.setattr(run_eval, "preflight", lambda *args: {"codex": "1", "webcmd": "2"})
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: tasks)
    monkeypatch.setattr(run_eval, "run_controller", fake_controller)
    monkeypatch.setattr(run_eval, "judge_execution", fake_judge)
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="Stealth_Bench_V1", tasks="all", task_indices=None, tools="webcmd", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=tmp_path, reasoning_effort=None)

    run_dir = asyncio.run(run_eval.run_benchmark(args))

    assert calls == [(prompt_a, "webcmd"), (prompt_b, "webcmd")]
    assert run_dir.parent == tmp_path
    assert (run_dir / "manifest.json").exists()
    assert (run_dir / "summary.json").exists()
    durable = (run_dir / "manifest.json").read_text() + (run_dir / "summary.json").read_text()
    assert all(value not in durable for value in (prompt_a, truth_a, prompt_b, truth_b))


def test_run_benchmark_limits_parallel_attempts(tmp_path, monkeypatch):
    tasks = [
        {"task_id": str(index), "confirmed_task": "prompt", "category": "A", "_raw_index": index}
        for index in range(5)
    ]
    active = 0
    max_active = 0

    async def fake_attempt(**kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {
            "task_id": kwargs["task"]["task_id"],
            "tool": kwargs["tool"],
            "category": "A",
            "status": "completed",
            "score": 1,
            "metrics": {},
        }

    monkeypatch.setattr(run_eval, "preflight", lambda *args: {"codex": "1", "webcmd": "2"})
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: tasks)
    monkeypatch.setattr(run_eval, "run_attempt", fake_attempt)
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="Stealth_Bench_V1", tasks="all", task_indices=None, tools="webcmd", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=tmp_path, reasoning_effort=None, parallel=2)

    asyncio.run(run_eval.run_benchmark(args))

    assert max_active == 2


def test_run_benchmark_passes_axi_selection_and_records_cloakbrowser(tmp_path, monkeypatch):
    task = {"task_id": "a", "confirmed_task": "prompt", "category": "A", "_raw_index": 0}
    calls = []

    async def fake_attempt(**kwargs):
        calls.append(kwargs)
        return {
            "task_id": "a",
            "tool": kwargs["tool"],
            "category": "A",
            "status": "completed",
            "score": 1,
            "metrics": {"steps": 1, "tool_calls": 1, "total_duration": 1.0, "tokens": 1},
        }

    monkeypatch.setattr(run_eval, "preflight", lambda *args: {"codex": "1", "chrome-devtools-axi": "0.1.26", "cloakbrowser": "0.4.5"})
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: [task])
    monkeypatch.setattr(run_eval, "run_attempt", fake_attempt)
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="Stealth_Bench_V1", tasks="all", task_indices=None, tools="chrome-devtools-axi", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=tmp_path, reasoning_effort=None)

    run_dir = asyncio.run(run_eval.run_benchmark(args))

    assert calls[0]["tool"] == "chrome-devtools-axi"
    manifest = json.loads((run_dir / "manifest.json").read_text())
    assert manifest["tools"]["chrome-devtools-axi"]["browser"] == {"name": "cloakbrowser", "version": "0.4.5"}


def test_run_benchmark_passes_agent_browser_selection_and_records_cloakbrowser(tmp_path, monkeypatch):
    task = {"task_id": "a", "confirmed_task": "prompt", "category": "A", "_raw_index": 0}
    calls = []

    async def fake_attempt(**kwargs):
        calls.append(kwargs)
        return {
            "task_id": "a",
            "tool": kwargs["tool"],
            "category": "A",
            "status": "completed",
            "score": 1,
            "metrics": {"steps": 1, "tool_calls": 1, "total_duration": 1.0, "tokens": 1},
        }

    monkeypatch.setattr(run_eval, "preflight", lambda *args: {"codex": "1", "agent-browser": "0.32.3", "cloakbrowser": "0.4.5"})
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: [task])
    monkeypatch.setattr(run_eval, "run_attempt", fake_attempt)
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="Stealth_Bench_V1", tasks="all", task_indices=None, tools="agent-browser", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=tmp_path, reasoning_effort=None)

    run_dir = asyncio.run(run_eval.run_benchmark(args))

    assert calls[0]["tool"] == "agent-browser"
    manifest = json.loads((run_dir / "manifest.json").read_text())
    assert manifest["tools"]["agent-browser"] == {
        "version": "0.32.3",
        "browser": {"name": "cloakbrowser", "version": "0.4.5"},
    }


def test_run_benchmark_passes_dev_browser_selection_and_records_cloakbrowser(
    tmp_path, monkeypatch
):
    task = {
        "task_id": "a",
        "confirmed_task": "prompt",
        "category": "A",
        "_raw_index": 0,
    }
    calls = []

    async def fake_attempt(**kwargs):
        calls.append(kwargs)
        return {
            "task_id": "a",
            "tool": kwargs["tool"],
            "category": "A",
            "status": "completed",
            "score": 1,
            "metrics": {
                "steps": 1,
                "tool_calls": 1,
                "total_duration": 1.0,
                "tokens": 1,
            },
        }

    monkeypatch.setattr(
        run_eval,
        "preflight",
        lambda *args: {
            "codex": "1",
            "dev-browser": "0.2.9",
            "cloakbrowser": "0.4.5",
        },
    )
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: [task])
    monkeypatch.setattr(run_eval, "run_attempt", fake_attempt)
    args = argparse.Namespace(
        controller="codex",
        model="gpt-5",
        benchmark="Stealth_Bench_V1",
        tasks="all",
        task_indices=None,
        tools="dev-browser",
        judge_provider="google", judge_model="gemini-2.5-flash",
        task_timeout=10,
        stealth_view="raw",
        output_dir=tmp_path,
        reasoning_effort=None,
    )

    run_dir = asyncio.run(run_eval.run_benchmark(args))

    assert calls[0]["tool"] == "dev-browser"
    manifest = json.loads((run_dir / "manifest.json").read_text())
    assert manifest["tools"]["dev-browser"] == {
        "version": "0.2.9",
        "browser": {"name": "cloakbrowser", "version": "0.4.5"},
    }


def test_run_benchmark_stops_when_manifest_write_fails(tmp_path, monkeypatch):
    attempts = []
    tasks = [{"task_id": "a", "confirmed_task": "prompt", "answer": "truth", "category": "A", "_raw_index": 0}]

    async def fake_attempt(**kwargs):
        attempts.append(kwargs)

    monkeypatch.setattr(run_eval, "preflight", lambda *args: {"codex": "1", "webcmd": "2"})
    monkeypatch.setattr(run_eval, "load_tasks", lambda benchmark: tasks)
    monkeypatch.setattr(run_eval, "run_attempt", fake_attempt)
    monkeypatch.setattr(run_eval, "_write_json", lambda *args: (_ for _ in ()).throw(OSError("disk full")))
    args = argparse.Namespace(controller="codex", model="gpt-5", benchmark="Stealth_Bench_V1", tasks="all", task_indices=None, tools="webcmd", judge_provider="google", judge_model="gemini-2.5-flash", task_timeout=10, stealth_view="raw", output_dir=tmp_path, reasoning_effort=None)

    with pytest.raises(OSError, match="disk full"):
        asyncio.run(run_eval.run_benchmark(args))
    assert attempts == []
