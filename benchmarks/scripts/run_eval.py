#!/usr/bin/env python3
import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet

from agent_browser_runtime import AGENT_BROWSER_COMMAND
from axi_runtime import AXI_COMMAND, cloakbrowser_version
from dev_browser_runtime import dev_browser_version
from judge import judge_execution
from run_controller import (
    LIBRETTO_MCP,
    PI_CONTROLLER,
    _subprocess_env,
    run_controller,
)


SKILL_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = SKILL_DIR  # benchmarks/ is the project root; results/ live here
DATASET_DIR = SKILL_DIR / "datasets"
DATASET_HASHES = {
    "BU_Bench_V1": "a93f3e5c019cb7853b4b497fcf05f3836a6dd2a7e0f53f038ae8558300bc096e",
    "Stealth_Bench_V1": "d9a842e6cf924929b25b39d1d96b6aa9eb89e05fe942598dfda85bf468d7cfda",
}
EDITABLE_BENCHMARKS = frozenset({"BU_Bench_V1", "Stealth_Webcmd"})
BENCHMARKS = (*DATASET_HASHES, "Stealth_Webcmd")
STEALTH_EXCLUDED_CATEGORIES = {"hCaptcha", "GeeTest", "Temu Slider"}
REASONING_EFFORTS = ("low", "medium", "high", "xhigh", "max", "ultra")
PI_THINKING_LEVELS = frozenset(REASONING_EFFORTS) - {"ultra"}
WEBCMD_EVAL_VERSION = "0.7.3"
STEALTH_CATEGORY_BY_TASK_ID = {
    "76": "Akamai",
    "77": "Cloudflare",
    "78": "Akamai",
    "79": "Others",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run browser tools on browser benchmarks")
    parser.add_argument("--controller", required=True, choices=("codex", "claude", "pi"))
    parser.add_argument("--model", required=True)
    parser.add_argument("--reasoning-effort", choices=REASONING_EFFORTS)
    parser.add_argument("--benchmark", required=True, choices=BENCHMARKS)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--tasks")
    selection.add_argument("--task-indices")
    parser.add_argument(
        "--tools",
        choices=(
            "webcmd",
            "chrome-devtools-axi",
            "agent-browser",
            "dev-browser",
            "libretto",
            "browser-use",
        ),
        default="webcmd",
    )
    parser.add_argument("--judge-provider", choices=("google", "openai", "codex"), default="google")
    parser.add_argument("--judge-model")
    parser.add_argument("--task-timeout", type=int, default=1800)
    parser.add_argument("--stealth-view", choices=("raw", "official"), default="raw")
    parser.add_argument("--output-dir", type=Path, default=PROJECT_DIR / "results")
    args = parser.parse_args(argv)
    if args.judge_model is None:
        args.judge_model = {
            "google": "gemini-2.5-flash",
            "openai": "gpt-4o-mini",
            "codex": "gpt-5.4",
        }[args.judge_provider]
    return args


def validate_args(args: argparse.Namespace) -> None:
    if args.task_timeout < 1:
        raise ValueError("--task-timeout must be positive")
    if args.benchmark != "Stealth_Bench_V1" and args.stealth_view != "raw":
        raise ValueError("--stealth-view official is valid only for Stealth_Bench_V1")
    if args.reasoning_effort is not None and args.controller not in {"codex", "pi"}:
        raise ValueError("--reasoning-effort is supported only for Codex or Pi")
    if args.controller == "pi" and args.reasoning_effort not in PI_THINKING_LEVELS | {None}:
        raise ValueError(f"Pi does not support --reasoning-effort {args.reasoning_effort}")
    if args.controller == "pi" and args.tools not in {
        "webcmd",
        "dev-browser",
        "libretto",
        "browser-use",
    }:
        raise ValueError(
            "Pi currently supports only Webcmd, dev-browser, Libretto, or browser-use"
        )
    if args.tools == "libretto" and args.controller not in {"codex", "pi"}:
        raise ValueError(
            "Libretto is currently supported only with the Codex or Pi controller"
        )


def _validate_output_dir(output_dir: Path) -> Path:
    resolved = output_dir.expanduser().resolve()
    project = PROJECT_DIR.resolve()
    results = (PROJECT_DIR / "results").resolve()
    if resolved.is_relative_to(project) and not resolved.is_relative_to(results):
        raise ValueError("repository-local --output-dir must be under the ignored results directory")
    return resolved


def selected_tools(value: str) -> list[str]:
    return [value]


def _check(command: list[str], env: dict[str, str]) -> str:
    result = subprocess.run(command, text=True, capture_output=True, timeout=60, env=env)
    if result.returncode:
        raise RuntimeError(f"preflight failed: {' '.join(command)}\n{result.stderr.strip()}")
    output = (result.stdout or result.stderr).strip()
    return output.splitlines()[0] if output else "ok"


def _webcmd_mode(env: dict[str, str]) -> str:
    home = Path(env.get("HOME", str(Path.home())))
    config_dir = Path(env.get("WEBCMD_CONFIG_DIR", str(home / ".webcmd")))
    try:
        config = json.loads((config_dir / "config.json").read_text(encoding="utf-8"))
        hosted = config.get("hosted")
        if (
            config.get("mode") == "hosted"
            and isinstance(hosted, dict)
            and isinstance(hosted.get("apiBaseUrl"), str)
            and isinstance(hosted.get("apiKey") or hosted.get("apiKeyRef"), str)
        ):
            return "hosted"
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    return "local"


def preflight(controller: str, tools: list[str], judge_provider: str = "google", model: str | None = None) -> dict[str, str]:
    if judge_provider == "google" and not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError("GOOGLE_API_KEY is required when --judge-provider google")
    if judge_provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required when --judge-provider openai")
    if judge_provider == "codex":
        judge_env = _subprocess_env(controller="codex")
        judge_env.pop("OPENAI_API_KEY", None)
        login = _check(["codex", "login", "status"], judge_env)
        if "ChatGPT" not in login:
            raise RuntimeError("--judge-provider codex requires `codex login` with ChatGPT")
    controller_command = ["node", str(PI_CONTROLLER), "--version"] if controller == "pi" else [controller, "--version"]
    controller_env = _subprocess_env(controller=controller)
    versions = {controller: _check(controller_command, controller_env)}
    if controller == "pi" and model is not None:
        _check(
            ["node", str(PI_CONTROLLER), "--check-auth", "--model", model],
            controller_env,
        )
    for tool in tools:
        tool_env = _subprocess_env(tool=tool)
        if tool == "chrome-devtools-axi":
            versions[tool] = _check([*AXI_COMMAND, "--version"], tool_env)
            versions["cloakbrowser"] = cloakbrowser_version()
        elif tool == "agent-browser":
            versions[tool] = _check([*AGENT_BROWSER_COMMAND, "--version"], tool_env)
            versions["cloakbrowser"] = cloakbrowser_version()
        elif tool == "dev-browser":
            versions[tool] = dev_browser_version(tool_env)
            versions["cloakbrowser"] = cloakbrowser_version()
        elif tool == "libretto":
            versions[tool] = _check(
                ["node", str(LIBRETTO_MCP), "--version"], tool_env
            )
            versions["cloakbrowser"] = cloakbrowser_version()
        elif tool == "browser-use":
            versions[tool] = _check([tool, "--version"], tool_env)
            versions["cloakbrowser"] = cloakbrowser_version()
        elif tool == "webcmd":
            version = _check([tool, "--version"], tool_env)
            if version != WEBCMD_EVAL_VERSION:
                raise RuntimeError(
                    f"Webcmd {WEBCMD_EVAL_VERSION} is required, found {version}"
                )
            versions[tool] = version
            mode = _webcmd_mode(tool_env)
            versions["webcmd_mode"] = mode
            if mode == "hosted":
                _check([tool, "profile", "list", "-f", "json"], tool_env)
            else:
                _check([tool, "doctor"], tool_env)
    return versions


def build_manifest(*, run_id: str, benchmark: str, tasks: list[dict], controller: str, model: str, judge_provider: str, judge_model: str, versions: dict[str, str], tools: list[str], timeout: int, created_at: str, reasoning_effort: str | None = None) -> dict:
    tool_manifest = {}
    for tool in tools:
        tool_manifest[tool] = {"version": versions[tool]}
        if tool == "webcmd":
            tool_manifest[tool]["mode"] = versions.get("webcmd_mode", "local")
        if tool in {
            "chrome-devtools-axi",
            "agent-browser",
            "dev-browser",
            "libretto",
            "browser-use",
        }:
            tool_manifest[tool]["browser"] = {"name": "cloakbrowser", "version": versions["cloakbrowser"]}
    return {
        "schema_version": 2,
        "run_id": run_id,
        "benchmark": benchmark,
        "dataset_sha256": dataset_sha256(benchmark),
        "task_selection": {
            "effective_indices": [task["_effective_index"] for task in tasks],
            "raw_indices": [task["_raw_index"] for task in tasks],
        },
        "controller": {
            "name": controller,
            "model": model,
            "version": versions[controller],
            "reasoning_effort": reasoning_effort,
            **(
                {"billing_mode": "chatgpt_subscription"}
                if controller == "pi" and model.startswith("openai-codex/")
                else {}
            ),
        },
        "judge": {"provider": judge_provider, "model": judge_model, "prompt_version": "upstream-dff86d1"},
        "tools": tool_manifest,
        "task_timeout_seconds": timeout,
        "tool_order": "single",
        "created_at": created_at,
    }


def dataset_sha256(benchmark: str) -> str:
    if benchmark not in BENCHMARKS:
        raise ValueError(f"unknown benchmark: {benchmark}")
    suffix = ".json" if benchmark in EDITABLE_BENCHMARKS else ".enc"
    path = DATASET_DIR / f"{benchmark}{suffix}"
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest()


def load_tasks(benchmark: str) -> list[dict]:
    if benchmark not in BENCHMARKS:
        raise ValueError(f"unknown benchmark: {benchmark}")
    if benchmark in EDITABLE_BENCHMARKS:
        loaded = json.loads((DATASET_DIR / f"{benchmark}.json").read_text(encoding="utf-8"))
    else:
        path = DATASET_DIR / f"{benchmark}.enc"
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != DATASET_HASHES[benchmark]:
            raise ValueError(f"dataset hash mismatch for {benchmark}: {digest}")
        key = base64.urlsafe_b64encode(hashlib.sha256(benchmark.encode()).digest())
        plaintext = Fernet(key).decrypt(base64.b64decode(raw))
        loaded = json.loads(plaintext)
    if not isinstance(loaded, list):
        raise ValueError(f"dataset must be a JSON array: {benchmark}")
    return [{**task, "_raw_index": index} for index, task in enumerate(loaded)]


def effective_tasks(benchmark: str, tasks: list[dict], stealth_view: str) -> list[dict]:
    if benchmark == "BU_Bench_V1":
        if stealth_view != "raw":
            raise ValueError("--stealth-view official is valid only for Stealth_Bench_V1")
        if len(tasks) != 100:
            raise ValueError(f"BU_Bench_V1 must contain 100 tasks, got {len(tasks)}")
        ordered = [tasks[section * 20 + offset] for offset in range(20) for section in range(5)]
        ordered = [task for task in ordered if task.get("enabled", True)]
        return [{**task, "_effective_index": index} for index, task in enumerate(ordered)]

    if stealth_view == "raw":
        return [{**task, "_effective_index": index} for index, task in enumerate(tasks)]
    if stealth_view != "official":
        raise ValueError(f"unknown Stealth view: {stealth_view}")

    selected = []
    for task in tasks:
        task_id = str(task["task_id"])
        if task["category"] in STEALTH_EXCLUDED_CATEGORIES or task_id == "80":
            continue
        selected.append({**task, "category": STEALTH_CATEGORY_BY_TASK_ID.get(task_id, "Others" if task["category"] in {"Shape", "Kasada", "Custom Antibot"} else task["category"])})
    if len(selected) != 71:
        raise ValueError(f"official Stealth view must contain 71 tasks, got {len(selected)}")
    return [{**task, "_effective_index": index} for index, task in enumerate(selected)]


def select_tasks(tasks: list[dict], count: str | None, indices: str | None) -> list[dict]:
    if (count is None) == (indices is None):
        raise ValueError("select exactly one of --tasks or --task-indices")
    if indices is not None:
        parsed = [int(value.strip()) for value in indices.split(",") if value.strip()]
        if not parsed:
            raise ValueError("--task-indices must contain at least one index")
        if len(parsed) != len(set(parsed)):
            raise ValueError("--task-indices must not contain duplicate indices")
        bad = [index for index in parsed if index < 0 or index >= len(tasks)]
        if bad:
            raise ValueError(f"task index out of range: {bad}")
        return [tasks[index] for index in parsed]
    if count == "all":
        return tasks
    amount = int(count or "0")
    if amount < 1 or amount > len(tasks):
        raise ValueError(f"--tasks must be between 1 and {len(tasks)}, or all")
    return tasks[:amount]


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _task_metrics(evidence) -> dict:
    metrics = evidence.metrics
    tokens = metrics.tokens if metrics is not None else None
    result = {
        "steps": metrics.steps if metrics is not None else None,
        "tool_calls": metrics.tool_calls if metrics is not None else None,
        "total_duration": metrics.duration_seconds if metrics is not None else None,
        "tokens": tokens.non_cached_input + tokens.output if tokens is not None else None,
        "agent_turns": metrics.agent_turns if metrics is not None else None,
    }
    if tokens is not None:
        result["controller_token_usage"] = {
            "non_cached_input_tokens": tokens.non_cached_input,
            "cached_read_input_tokens": tokens.cache_read_input,
            "cached_write_input_tokens": tokens.cache_creation_input,
            "output_tokens": tokens.output,
            "reasoning_output_tokens": tokens.reasoning_output,
        }
        if tokens.estimated_api_cost_usd is not None:
            result["estimated_api_cost_usd"] = tokens.estimated_api_cost_usd
    return result


def _safe(value: object) -> str:
    return "".join(character if str(character).isalnum() or character in "-_" else "-" for character in str(value)).strip("-") or "unknown"


def _redact(value: object, protected_values: tuple[object, ...]) -> object:
    if isinstance(value, str):
        for protected in (str(item) for item in protected_values if item is not None and str(item)):
            value = value.replace(protected, "[REDACTED]")
        return value
    if isinstance(value, dict):
        return {key: _redact(item, protected_values) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item, protected_values) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact(item, protected_values) for item in value)
    return value


def _redact_hidden_answer(value: object, answer: object | None) -> object:
    protected = "" if answer is None else str(answer)
    if not protected:
        return value
    if isinstance(value, str):
        if len(protected) == 1 and protected.isalpha():
            if value == protected:
                return "[REDACTED]"
            label = rf"((?:hidden\s+)?(?:answer|truth)(?:\s+is)?\s*[:=]?\s*){re.escape(protected)}(?!\w)"
            return re.sub(label, r"\1[REDACTED]", value)
        if len(protected) <= 3:
            return re.sub(rf"(?<!\w){re.escape(protected)}(?!\w)", "[REDACTED]", value)
        return value.replace(protected, "[REDACTED]")
    if isinstance(value, dict):
        return {key: _redact_hidden_answer(item, protected) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_hidden_answer(item, protected) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_hidden_answer(item, protected) for item in value)
    return value


async def run_attempt(*, run_id: str, benchmark: str, task: dict, effective_index: int, controller: str, model: str, tool: str, timeout: int, attempt_dir: Path, judge_provider: str, judge_model: str, reasoning_effort: str | None = None) -> dict:
    attempt_dir.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix=f"bbe-{effective_index}-{tool}-") as temporary:
        work_dir = Path(temporary) / "contestant"
        evidence = await run_controller(controller, model, tool, task["confirmed_task"], work_dir, timeout, reasoning_effort=reasoning_effort)
        transcript_path = attempt_dir / "transcript.jsonl"
        durable_steps = _redact(evidence.steps, (task["confirmed_task"],))
        transcript_path.write_text("".join(json.dumps({"step": step}) + "\n" for step in durable_steps), encoding="utf-8")
        screenshot_dir = attempt_dir / "screenshots"
        screenshot_dir.mkdir()
        screenshot_names = []
        for index, source in enumerate(evidence.screenshot_paths, start=1):
            name = f"{index:03}.png"
            shutil.copy2(source, screenshot_dir / name)
            screenshot_names.append(f"screenshots/{name}")

        base_result = {
            "schema_version": 2,
            "run_id": run_id,
            "benchmark": benchmark,
            "task_id": str(task["task_id"]),
            "effective_index": effective_index,
            "raw_index": task["_raw_index"],
            "category": task["category"],
            "controller": controller,
            "model": model,
            "reasoning_effort": reasoning_effort,
            "tool": tool,
            "final_answer": evidence.final_answer,
            "judgement": None,
            "evidence": {"transcript": "transcript.jsonl", "screenshots": screenshot_names},
        }
        checkpoint_status = "judge_pending" if evidence.termination == "completed" else evidence.termination
        checkpoint = {
            **base_result,
            "status": checkpoint_status,
            "score": None if checkpoint_status == "judge_pending" else 0,
            "metrics": _task_metrics(evidence),
        }
        _write_json(attempt_dir / "result.json", checkpoint)

        judgement = None
        if evidence.termination == "completed":
            try:
                judgement_model = await judge_execution(
                    task["confirmed_task"],
                    task.get("answer"),
                    evidence,
                    judge_model,
                    provider=judge_provider,
                    benchmark=benchmark,
                )
                judgement = _redact(judgement_model.model_dump(), (task["confirmed_task"],))
                judgement = _redact_hidden_answer(judgement, task.get("answer"))
                status = "completed"
                score: int | None = 1 if judgement_model.verdict else 0
            except Exception:
                status = "judge_error"
                score = None
        else:
            status = evidence.termination
            score = 0

        result = {
            **base_result,
            "status": status,
            "score": score,
            "judgement": judgement,
            "metrics": _task_metrics(evidence),
        }
        _write_json(attempt_dir / "result.json", result)
        return result


def build_summary(results: list[dict], tools: list[str]) -> dict:
    accuracy = {}
    categories = {}
    for tool in tools:
        tool_results = [result for result in results if result["tool"] == tool and result["score"] is not None]
        passed = sum(result["score"] for result in tool_results)
        accuracy[tool] = {"passed": passed, "judged": len(tool_results), "accuracy": passed / len(tool_results) if tool_results else None}
        grouped: dict[str, list[dict]] = defaultdict(list)
        for result in tool_results:
            grouped[result["category"]].append(result)
        categories[tool] = {
            category: {"passed": sum(item["score"] for item in items), "judged": len(items), "accuracy": sum(item["score"] for item in items) / len(items)}
            for category, items in sorted(grouped.items())
        }

    task_metrics = [result.get("metrics") or {} for result in results]
    total_steps = sum(item.get("steps") or 0 for item in task_metrics)
    total_tool_calls = sum(item.get("tool_calls") or 0 for item in task_metrics)
    total_duration = sum(item.get("total_duration") or 0 for item in task_metrics)
    token_values = [item.get("tokens") for item in task_metrics]
    agent_turn_values = [item.get("agent_turns") for item in task_metrics]
    controller_usages = [item.get("controller_token_usage") for item in task_metrics]
    estimated_costs = [item.get("estimated_api_cost_usd") for item in task_metrics]
    summary = {
        "schema_version": 2,
        "complete": all(result["score"] is not None for result in results),
        "accuracy": accuracy,
        "category_accuracy": categories,
        "statuses": dict(sorted(Counter(result["status"] for result in results).items())),
        "metrics": {
            "total_steps": total_steps,
            "total_tool_calls": total_tool_calls,
            "total_duration": total_duration,
            "total_tokens": sum(token_values) if all(value is not None for value in token_values) else None,
            "total_agent_turns": sum(agent_turn_values) if all(value is not None for value in agent_turn_values) else None,
        },
    }
    if all(usage is not None for usage in controller_usages):
        usage_keys = (
            "non_cached_input_tokens",
            "cached_read_input_tokens",
            "cached_write_input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
        )
        summary["metrics"]["controller_token_usage"] = {
            key: (
                sum(usage[key] for usage in controller_usages)
                if all(usage[key] is not None for usage in controller_usages)
                else None
            )
            for key in usage_keys
        }
    if all(cost is not None for cost in estimated_costs):
        summary["metrics"]["estimated_api_cost_usd"] = sum(estimated_costs)
    return summary


async def run_benchmark(args: argparse.Namespace) -> Path:
    validate_args(args)
    output_dir = _validate_output_dir(args.output_dir)
    tools = selected_tools(args.tools)
    versions = preflight(args.controller, tools, args.judge_provider, args.model)
    tasks = effective_tasks(args.benchmark, load_tasks(args.benchmark), args.stealth_view)
    tasks = select_tasks(tasks, args.tasks, args.task_indices)
    now = datetime.now(timezone.utc)
    created_at = now.isoformat().replace("+00:00", "Z")
    run_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{args.controller}-{args.benchmark.lower().replace('_', '-')}"
    run_dir = output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    manifest = build_manifest(run_id=run_id, benchmark=args.benchmark, tasks=tasks, controller=args.controller, model=args.model, judge_provider=args.judge_provider, judge_model=args.judge_model, versions=versions, tools=tools, timeout=args.task_timeout, created_at=created_at, reasoning_effort=args.reasoning_effort)
    _write_json(run_dir / "manifest.json", manifest)

    results = []
    for task in tasks:
        tool = args.tools
        attempt_dir = run_dir / "tasks" / _safe(task["task_id"]) / tool
        result = await run_attempt(run_id=run_id, benchmark=args.benchmark, task=task, effective_index=task["_effective_index"], controller=args.controller, model=args.model, tool=tool, timeout=args.task_timeout, attempt_dir=attempt_dir, judge_provider=args.judge_provider, judge_model=args.judge_model, reasoning_effort=args.reasoning_effort)
        results.append(result)
    summary = build_summary(results, tools)
    _write_json(run_dir / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    print(f"Results: {run_dir}")
    return run_dir


def main() -> None:
    args = parse_args()
    asyncio.run(run_benchmark(args))


if __name__ == "__main__":
    main()
