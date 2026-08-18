#!/usr/bin/env python3
import asyncio
import base64
import hashlib
import json
import math
import os
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Literal
from urllib.parse import unquote

from agent_browser_runtime import start_agent_browser_runtime
from axi_runtime import start_axi_runtime
from dev_browser_runtime import start_dev_browser_runtime
from libretto_runtime import start_libretto_runtime


Controller = Literal["codex", "claude", "pi"]
Tool = Literal["webcmd", "chrome-devtools-axi", "agent-browser", "dev-browser", "libretto"]
Termination = Literal["completed", "timeout", "controller_error", "missing_final_answer", "tool_policy_violation"]
FINAL_ANSWER_RE = re.compile(r"^FINAL ANSWER:[ \t]*(\S[^\r\n]*)$", re.MULTILINE)
ESSENTIAL_ENV_KEYS = {
    "HOME", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LOGNAME", "NODE_EXTRA_CA_CERTS",
    "PATH", "SHELL", "SSL_CERT_DIR", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "USER",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
}
CONTROLLER_ENV_PREFIXES = {
    "codex": ("CODEX_", "OPENAI_"),
    "claude": ("ANTHROPIC_", "CLAUDE_"),
    "pi": ("OPENAI_", "ANTHROPIC_", "PI_"),
}
CONTROLLER_ENV_KEYS = {
    "codex": set(),
    "claude": {
        "AWS_ACCESS_KEY_ID", "AWS_DEFAULT_REGION", "AWS_PROFILE", "AWS_REGION", "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS",
    },
    "pi": set(),
}
TOOL_ENV_PREFIXES = {
    "webcmd": ("WEBCMD_",),
    "chrome-devtools-axi": ("CHROME_DEVTOOLS_AXI_", "CHROME_DEVTOOLS_MCP_"),
    "agent-browser": (),
    "dev-browser": (),
    "libretto": (),
}
EVALUATION_ENV_KEYS = {
    "DATASET_DECRYPTION_KEY", "DATASET_PATH", "EVIDENCE_PATH", "EXPECTED_ANSWER", "GOOGLE_API_KEY",
    "GROUND_TRUTH", "JUDGE_MODEL", "JUDGE_PROMPT", "PRIOR_VERDICT", "RESULTS_DIR",
}
EVALUATION_ENV_MARKERS = (
    "ANSWER", "ATTEMPT", "DATASET", "DECRYPT", "EVIDENCE", "GROUND_TRUTH", "GROUNDTRUTH",
    "JUDGE", "PROMPT", "RESULT", "VERDICT",
)
CLEANUP_TIMEOUT_SECONDS = 5
WEBCMD_BENCHMARK_PROFILE = "benchmark"
WEBCMD_SESSION_RE = re.compile(
    r"^session_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
PI_CONTROLLER = Path(__file__).resolve().with_name("pi_controller.mjs")
LIBRETTO_MCP = Path(__file__).resolve().with_name("libretto_mcp.mjs")
LIBRETTO_TOOLS = (
    "browser_open",
    "browser_exec",
    "browser_snapshot",
    "browser_status",
    "browser_close",
)
WEBCMD_BROWSER_SKILL = Path.home() / ".codex/skills/webcmd-browser"
WEBCMD_BROWSER_SKILL_FILE = WEBCMD_BROWSER_SKILL / "SKILL.md"
WEBCMD_BROWSER_SKILL_ROOT = WEBCMD_BROWSER_SKILL.resolve()
DEV_BROWSER_SKILL = Path.home() / ".codex/skills/dev-browser"
PI_SETUP_SKILL_FILES = {
    "webcmd": frozenset({WEBCMD_BROWSER_SKILL_FILE.resolve()}),
    "dev-browser": frozenset({(DEV_BROWSER_SKILL / "SKILL.md").resolve()}),
}
GPT_5_6_SOL_PRICES_PER_MILLION = {
    "input": 5.0,
    "cached_input": 0.5,
    "cache_write_input": 6.25,
    "output": 30.0,
}
GPT_5_6_SOL_MODELS = frozenset({"gpt-5.6", "gpt-5.6-sol"})
LONG_CONTEXT_INPUT_THRESHOLD = 272_000


class _CodexTurnCollector:
    def __init__(self) -> None:
        self._payloads: list[dict] = []
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "_CodexTurnCollector":
        collector = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                try:
                    payload = json.loads(self.rfile.read(length))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_error(400)
                    return
                if isinstance(payload, dict):
                    with collector._lock:
                        collector._payloads.append(payload)
                body = b"{}"
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *args: object) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join()

    @property
    def endpoint(self) -> str:
        if self._server is None:
            raise RuntimeError("Codex turn collector is not running")
        host, port = self._server.server_address
        return f"http://{host}:{port}/v1/logs"

    @property
    def agent_turns(self) -> int | None:
        with self._lock:
            payloads = list(self._payloads)
        if not payloads:
            return None
        return sum(
            1
            for payload in payloads
            for resource in payload.get("resourceLogs", [])
            for scope in resource.get("scopeLogs", [])
            for record in scope.get("logRecords", [])
            if self._is_completed_model_response(record)
        )

    @staticmethod
    def _is_completed_model_response(record: object) -> bool:
        if not isinstance(record, dict):
            return False
        attributes = {
            attribute.get("key"): attribute.get("value")
            for attribute in record.get("attributes", [])
            if isinstance(attribute, dict)
        }

        def value(key: str) -> object:
            wrapped = attributes.get(key)
            if not isinstance(wrapped, dict):
                return None
            return next(iter(wrapped.values()), None)

        return (
            value("event.name") == "codex.sse_event"
            and value("event.kind") == "response.completed"
            and "input_token_count" in attributes
            and "error.message" not in attributes
        )


@dataclass
class ExecutionEvidence:
    final_answer: str
    steps: list[str]
    screenshot_paths: list[Path]
    controller_exit_code: int
    termination: Termination
    metrics: "ControllerMetrics | None" = None


@dataclass(frozen=True)
class TokenUsage:
    input: int
    cache_read_input: int
    cache_creation_input: int
    non_cached_input: int
    output: int
    reasoning_output: int | None
    total: int
    estimated_api_cost_usd: float | None = None


@dataclass(frozen=True)
class ControllerMetrics:
    duration_seconds: float
    steps: int
    tool_calls: int
    tokens: TokenUsage | None
    provider_turns: int | None
    provider_duration_seconds: float | None
    provider_api_duration_seconds: float | None
    agent_turns: int | None = None


@dataclass
class ParsedEvents:
    steps: list[str]
    commands: list[str]
    event_types: list[str]
    final_text: str
    steps_count: int
    tool_calls: int
    tokens: TokenUsage | None
    provider_turns: int | None
    provider_duration_seconds: float | None
    provider_api_duration_seconds: float | None
    agent_turns: int | None
    mcp_calls: list[tuple[str, str]]
    screenshot_images: list[bytes]


def _build_prompt(tool: Tool, session: str, shots_dir: Path, task: str) -> str:
    first_shot = shots_dir / "step_001.png"
    if tool == "chrome-devtools-axi":
        tool_rules = """- Use only `npx -y chrome-devtools-axi` for browser interaction.
- Every shell command must begin with exactly `npx -y chrome-devtools-axi`; use no substitutions, redirections, pipes, or other executables.
- Do not use Web search, browser MCPs, Playwright, Puppeteer, curl, wget, raw HTTP, or any non-AXI automation tool.
- Use the `$chrome-devtools-axi` skill for AXI usage guidance.
- The AXI session and its dedicated legacy benchmark CloakBrowser connection are already configured in the environment; do not start another browser."""
    elif tool == "agent-browser":
        tool_rules = """- Use only `agent-browser` for browser interaction.
- Use one `agent-browser` command per shell invocation; use no substitutions, redirections, pipes, or other executables.
- Do not use `batch`, `close`, connection/profile flags, or multiple agent-browser commands in one shell invocation.
- Never pass a URL to `agent-browser read`; use `agent-browser open URL` and then `agent-browser read` so all page traffic stays inside the legacy benchmark CloakBrowser.
- Do not use Web search, browser MCPs, Playwright, Puppeteer, curl, wget, raw HTTP, or any non-agent-browser automation tool.
- Use the `$agent-browser` skill for agent-browser usage guidance.
- The agent-browser session and its dedicated legacy benchmark CloakBrowser connection are already configured in the environment; do not start, connect, configure, or close another browser."""
    elif tool == "dev-browser":
        tool_rules = f"""- Use only `dev-browser` for browser interaction.
- Invoke `dev-browser` with one quoted heredoc per shell command. The heredoc body must contain only the sandboxed JavaScript described by the `$dev-browser` skill.
- You may add only `--timeout SECONDS`; do not use `--browser`, `--connect`, `--headless`, `run`, `stop`, or any other subcommand or connection option.
- Use no substitutions, pipes, extra redirections, or other executables.
- Do not use Web search, browser MCPs, external Playwright, Puppeteer, curl, wget, raw HTTP, or any non-dev-browser automation tool.
- Use the `$dev-browser` skill for dev-browser usage guidance.
- The dev-browser command is already pinned to this task's dedicated legacy benchmark CloakBrowser connection; do not start, connect, configure, or close another browser.
- Save screenshots with `await saveScreenshot(await page.screenshot(), "{session}-step_001.png")`, then `{session}-step_002.png`, and so on."""
    elif tool == "libretto":
        tool_rules = """- Use only the Libretto MCP tools `browser_open`, `browser_exec`, `browser_snapshot`, `browser_status`, and `browser_close` for browser interaction.
- Do not use shell commands, Web Search, other MCP servers or tools, Playwright outside `browser_exec`, Puppeteer, curl, wget, or raw HTTP.
- The Libretto provider is already pinned to this task's dedicated legacy benchmark CloakBrowser; open it with `browser_open` and do not configure another browser.
- Reuse the session ID returned by `browser_open` and close it with `browser_close` when the task is complete."""
    else:
        tool_rules = f"""- Use only `webcmd` raw-browser commands for task execution. Do not use Web Search, browser MCPs, external Playwright, Puppeteer, curl, wget, raw HTTP, adapters, fetch commands, plugins, or any non-Webcmd automation tool.
- Use the `$webcmd-browser` skill for browser guidance. Do not load any other Webcmd skill. This benchmark's raw-browser route is already selected. Skip adapter and plugin discovery, the top-level Webcmd router, `webcmd doctor`, and the skill's Session lifecycle steps.
- The harness already created the dedicated Profile and Session. Use `--profile {WEBCMD_BENCHMARK_PROFILE}` and `--session {session}` on every browser command.
- Do not create, close, or force-close Sessions, manage the daemon, or change Profiles. The harness owns Session cleanup after the controller exits.
- Use `browser run --stdin`, not `run --file`. Other than reading the Webcmd browser skill and its references, every shell command must execute only `webcmd`; do not use shell helpers, substitutions, pipes, or other executables."""
    if tool == "dev-browser":
        screenshot_rules = f"""- Save screenshots after meaningful page transitions and at the final state with `saveScreenshot`.
- Name screenshots `{session}-step_001.png`, then `{session}-step_002.png`, `{session}-step_003.png`, and so on without overwriting. The harness collects them automatically."""
    elif tool == "libretto":
        screenshot_rules = """- Call `browser_snapshot` with `screenshot: true` after meaningful page transitions and at the final state.
- The harness collects those native Libretto screenshot results automatically."""
    elif tool == "webcmd":
        screenshot_rules = """- Save screenshots after meaningful page transitions and at the final state.
- In Webcmd run programs, screenshot paths must be relative logical filenames such as `shots/step_001.png`, then `shots/step_002.png`, without `..` or absolute paths."""
    else:
        screenshot_rules = f"""- Save screenshots after meaningful page transitions and at the final state.
- Name screenshots `{first_shot}`, then step_002.png, step_003.png, and so on without overwriting."""
    return f"""You are executing a browser benchmark task.

Hard rules:
{tool_rules}
- Quote URLs that contain `?`, `&`, `#`, `(`, `)`, or other shell punctuation.
- Do not change filters, sort modes, chart variants, regions, or page views unless the task explicitly asks.
{screenshot_rules}
- If a CAPTCHA, human-verification control, or anti-bot challenge is interactable, make a reasonable in-browser attempt to complete it and continue. If a login or authentication page blocks further progress, report that as the outcome. Otherwise, only report failure when anti-bot protection remains blocking.
- Work autonomously and do not ask clarifying questions.
- End with exactly one line `FINAL ANSWER: answer` and nothing after it. Use `FINAL ANSWER: done` for action-only tasks.

Task:
{task}
"""


def _controller_command(
    controller: Controller,
    model: str,
    prompt: str,
    reasoning_effort: str | None = None,
    tool: Tool | None = None,
    runtime_env: dict[str, str] | None = None,
    otel_endpoint: str | None = None,
) -> tuple[list[str], bytes | None]:
    if controller == "codex":
        command = ["codex", "exec", "--json", "--model", model]
        if reasoning_effort is not None:
            command.extend(["-c", f'model_reasoning_effort="{reasoning_effort}"'])
        if otel_endpoint is not None:
            command.extend(
                [
                    "-c",
                    "otel.exporter={otlp-http={"
                    f"endpoint={json.dumps(otel_endpoint)},protocol=\"json\"}}}}",
                ]
            )
        if tool == "libretto":
            cdp_url = (runtime_env or {}).get("LIBRETTO_CDP_URL")
            if not cdp_url:
                raise ValueError(
                    "Libretto requires a task-private LIBRETTO_CDP_URL"
                )
            enabled_tools = ",".join(json.dumps(name) for name in LIBRETTO_TOOLS)
            command.extend(
                [
                    "-c",
                    'mcp_servers.libretto.command="node"',
                    "-c",
                    f"mcp_servers.libretto.args=[{json.dumps(str(LIBRETTO_MCP))}]",
                    "-c",
                    "mcp_servers.libretto.required=true",
                    "-c",
                    f"mcp_servers.libretto.enabled_tools=[{enabled_tools}]",
                    "-c",
                    "mcp_servers.libretto.env="
                    f'{{LIBRETTO_CDP_URL={json.dumps(cdp_url)}}}',
                ]
            )
        command.extend(["--sandbox", "danger-full-access", "--skip-git-repo-check", "--ignore-user-config", "-"])
        return command, prompt.encode()
    if controller == "claude":
        return (["claude", "-p", prompt, "--model", model, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--bare"], None)
    if controller == "pi":
        command = [
            "node",
            str(PI_CONTROLLER),
            "--model",
            model,
        ]
        pi_tool = tool or "webcmd"
        if pi_tool == "webcmd":
            command.extend(["--skill-path", str(WEBCMD_BROWSER_SKILL)])
        elif pi_tool == "dev-browser":
            command.extend(
                ["--tool", pi_tool, "--skill-path", str(DEV_BROWSER_SKILL)]
            )
        elif pi_tool == "libretto":
            if not (runtime_env or {}).get("LIBRETTO_CDP_URL"):
                raise ValueError(
                    "Pi Libretto requires a task-private LIBRETTO_CDP_URL"
                )
            command.extend(["--tool", pi_tool])
        else:
            raise ValueError(f"Pi support is not configured for {pi_tool}")
        if reasoning_effort is not None:
            command.extend(["--thinking", reasoning_effort])
        return command, prompt.encode()
    raise ValueError(f"unknown controller: {controller}")


def _subprocess_env(controller: Controller | None = None, tool: Tool | None = None) -> dict[str, str]:
    allowed_keys = ESSENTIAL_ENV_KEYS | (CONTROLLER_ENV_KEYS[controller] if controller else set())
    allowed_prefixes = (CONTROLLER_ENV_PREFIXES[controller] if controller else ()) + (TOOL_ENV_PREFIXES[tool] if tool else ())
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in EVALUATION_ENV_KEYS
        and not any(marker in key.upper() for marker in EVALUATION_ENV_MARKERS)
        and (key in allowed_keys or key.startswith(allowed_prefixes))
    }
    if tool == "webcmd":
        node_bin = Path(__file__).resolve().parent.parent / "node_modules" / ".bin"
        env["PATH"] = f"{node_bin}{os.pathsep}{env.get('PATH', '')}"
    return env


def _child_env(controller: Controller, tool: Tool, overrides: dict[str, str] | None = None) -> dict[str, str]:
    return {**_subprocess_env(controller, tool), **(overrides or {})}


def _verify_pinned_webcmd(env: dict[str, str], expected: Path) -> None:
    shell = env.get("SHELL") or ("/bin/zsh" if Path("/bin/zsh").is_file() else "/bin/sh")
    result = subprocess.run(
        [shell, "-lc", "command -v webcmd"],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    actual = result.stdout.strip()
    if result.returncode or not actual or Path(actual).resolve() != expected.resolve():
        raise RuntimeError(
            f"Webcmd login shell resolved {actual or 'nothing'}, expected {expected}"
        )


def _pin_webcmd_env(base_env: dict[str, str], work_dir: Path) -> dict[str, str]:
    executable = shutil.which("webcmd", path=base_env.get("PATH"))
    if not executable:
        raise RuntimeError("webcmd was not found in PATH")
    bin_dir = work_dir / "webcmd-bin"
    bin_dir.mkdir()
    shim = bin_dir / "webcmd"
    shim.write_text(
        f"#!/bin/sh\nexec {shlex.quote(str(Path(executable).resolve()))} \"$@\"\n",
        encoding="utf-8",
    )
    shim.chmod(0o700)
    zsh_config = work_dir / "zsh-config"
    zsh_config.mkdir()
    pinned_path = f"{bin_dir}{os.pathsep}{base_env.get('PATH', '')}"
    (zsh_config / ".zprofile").write_text(
        f"export PATH={shlex.quote(pinned_path)}\n", encoding="utf-8"
    )
    env = {
        **base_env,
        "PATH": pinned_path,
        "ZDOTDIR": str(zsh_config),
    }
    _verify_pinned_webcmd(env, shim)
    return env


def _session_name(work_dir: Path) -> str:
    readable = re.sub(r"[^a-z0-9-]", "-", work_dir.name.lower()).strip("-") or "attempt"
    digest = hashlib.sha256(str(work_dir.resolve()).encode()).hexdigest()[:10]
    return f"{readable[:37]}-{digest}"


def _short(value: object, limit: int = 2000) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, default=str, separators=(",", ":"))
    return text.strip()[:limit]


def _evidence_excerpt(value: object, limit: int) -> str:
    marker = "[truncated]"
    text = value if isinstance(value, str) else json.dumps(value, default=str, separators=(",", ":"))
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - len(marker)] + marker


def _command_step(command: str, output: object) -> str:
    return (
        f"command: {_evidence_excerpt(command, 2000)}\n"
        f"output: {_evidence_excerpt(output, 8000)}"
    )


def _mcp_content(result: object) -> list[dict]:
    if not isinstance(result, dict):
        return []
    content = result.get("content")
    if isinstance(content, list):
        return [item for item in content if isinstance(item, dict)]
    ok = result.get("Ok")
    if isinstance(ok, dict) and isinstance(ok.get("content"), list):
        return [item for item in ok["content"] if isinstance(item, dict)]
    return []


def _parse_events(
    controller: Controller,
    lines: list[str],
    *,
    tool: Tool | None = None,
    model: str | None = None,
) -> ParsedEvents:
    steps: list[str] = []
    commands: list[str] = []
    event_types: list[str] = []
    final_fragments: list[str] = []
    steps_count = 0
    tool_calls = 0
    ordinary_input = 0
    cache_read_input = 0
    cache_creation_input = 0
    output_tokens = 0
    reasoning_output = 0
    usage_seen = False
    estimated_api_cost_usd = 0.0
    cost_complete = controller == "pi" or (
        controller == "codex" and model in GPT_5_6_SOL_MODELS
    )
    provider_turns = None
    provider_duration_seconds = None
    provider_api_duration_seconds = None
    agent_turns = 0 if controller == "pi" else None
    mcp_calls: list[tuple[str, str]] = []
    screenshot_images: list[bytes] = []
    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            steps.append(_short(f"raw: {line}"))
            continue
        event_type = str(event.get("type", "unknown"))
        event_types.append(event_type)
        if controller == "codex" and event_type == "item.completed":
            item = event.get("item") or {}
            item_type = item.get("type")
            if item_type == "agent_message":
                text = str(item.get("text") or "")
                final_fragments.append(text)
                steps.append(_short(f"text: {text}"))
                if text:
                    steps_count += 1
            elif item_type == "command_execution":
                command = item.get("command") or ""
                command = " ".join(map(str, command)) if isinstance(command, list) else str(command)
                commands.append(command)
                tool_calls += 1
                steps_count += 1
                command_output = item.get("aggregated_output") or item.get("output") or ""
                steps.append(_command_step(command, command_output))
            elif item_type in {"mcp_tool_call", "web_search"}:
                event_types.append(str(item_type))
                steps.append(_short(f"{item_type}: {_short(item)}"))
                steps_count += 1
                if item_type == "mcp_tool_call":
                    server = str(item.get("server") or "")
                    tool_name = str(item.get("tool") or "")
                    mcp_calls.append((server, tool_name))
                    if tool == "libretto":
                        tool_calls += 1
                        if (
                            server == "libretto"
                            and tool_name == "browser_snapshot"
                        ):
                            for content in _mcp_content(item.get("result")):
                                if (
                                    content.get("type") == "image"
                                    and content.get("mimeType") == "image/png"
                                    and isinstance(content.get("data"), str)
                                ):
                                    try:
                                        screenshot_images.append(
                                            base64.b64decode(
                                                content["data"], validate=True
                                            )
                                        )
                                    except ValueError:
                                        pass
            elif item_type == "reasoning":
                text = item.get("text") or item.get("summary") or ""
                steps.append(_short(f"reasoning: {text}"))
                steps_count += 1
        elif controller == "codex" and event_type == "turn.completed":
            usage = event.get("usage") or {}
            turn_input = int(usage.get("input_tokens") or 0)
            turn_cached = int(usage.get("cached_input_tokens") or 0)
            turn_cache_write = int(usage.get("cache_write_input_tokens") or 0)
            turn_output = int(usage.get("output_tokens") or 0)
            ordinary_input += turn_input - turn_cached - turn_cache_write
            cache_read_input += turn_cached
            cache_creation_input += turn_cache_write
            output_tokens += turn_output
            reasoning_output += int(usage.get("reasoning_output_tokens") or 0)
            usage_seen = usage_seen or bool(usage)
            if cost_complete:
                if "cache_write_input_tokens" not in usage:
                    cost_complete = False
                else:
                    input_multiplier = 2.0 if turn_input > LONG_CONTEXT_INPUT_THRESHOLD else 1.0
                    output_multiplier = 1.5 if turn_input > LONG_CONTEXT_INPUT_THRESHOLD else 1.0
                    turn_ordinary = turn_input - turn_cached - turn_cache_write
                    estimated_api_cost_usd += (
                        input_multiplier
                        * (
                            turn_ordinary * GPT_5_6_SOL_PRICES_PER_MILLION["input"]
                            + turn_cached * GPT_5_6_SOL_PRICES_PER_MILLION["cached_input"]
                            + turn_cache_write * GPT_5_6_SOL_PRICES_PER_MILLION["cache_write_input"]
                        )
                        + output_multiplier
                        * turn_output
                        * GPT_5_6_SOL_PRICES_PER_MILLION["output"]
                    ) / 1_000_000
        elif controller == "pi" and event_type == "message_end":
            message = event.get("message") or {}
            if message.get("role") != "assistant":
                continue
            agent_turns += 1
            usage = message.get("usage") or {}
            if usage:
                ordinary_input += int(usage.get("input") or 0)
                cache_read_input += int(usage.get("cacheRead") or 0)
                cache_creation_input += int(usage.get("cacheWrite") or 0)
                output_tokens += int(usage.get("output") or 0)
                usage_seen = True
                turn_cost = (usage.get("cost") or {}).get("total")
                if (
                    isinstance(turn_cost, (int, float))
                    and not isinstance(turn_cost, bool)
                    and math.isfinite(turn_cost)
                ):
                    estimated_api_cost_usd += float(turn_cost)
                else:
                    cost_complete = False
            else:
                cost_complete = False
            for block in message.get("content", []) or []:
                block_type = block.get("type")
                if block_type == "text":
                    text = str(block.get("text") or "")
                    final_fragments.append(text)
                    steps.append(_short(f"text: {text}"))
                    if text:
                        steps_count += 1
                elif block_type == "thinking":
                    text = str(block.get("thinking") or "")
                    if text:
                        steps.append(_short(f"thinking: {text}"))
                        steps_count += 1
        elif controller == "pi" and event_type == "tool_execution_start":
            name = str(event.get("toolName") or "")
            arguments = event.get("args") or {}
            if name == "bash":
                command = str(arguments.get("command") or "")
                if command:
                    commands.append(command)
                tool_calls += 1
                steps_count += 1
                steps.append(_short(f"tool: {name} {_short(arguments)}"))
            elif (
                name == "read"
                and Path(str(arguments.get("path") or "")).expanduser().resolve()
                in PI_SETUP_SKILL_FILES.get(tool or "webcmd", frozenset())
            ):
                steps.append(_short(f"setup_tool: {name} {_short(arguments)}"))
            elif tool == "libretto":
                event_types.append("mcp_tool_call")
                mcp_calls.append(("libretto", name))
                tool_calls += 1
                steps_count += 1
                steps.append(_short(f"tool: {name} {_short(arguments)}"))
            else:
                event_types.append("mcp_tool_call")
                steps_count += 1
                steps.append(_short(f"tool: {name} {_short(arguments)}"))
        elif controller == "pi" and event_type == "tool_execution_end":
            result = event.get("result") or {}
            content = result.get("content") if isinstance(result, dict) else result
            steps.append(_short(f"tool_result: {_short(content or '')}"))
            if tool == "libretto" and event.get("toolName") == "browser_snapshot":
                encoded = None
                for item in content if isinstance(content, list) else []:
                    if (
                        isinstance(item, dict)
                        and item.get("type") == "image"
                        and item.get("mimeType") == "image/png"
                        and isinstance(item.get("data"), str)
                        and not item["data"].startswith("[omitted ")
                    ):
                        encoded = item["data"]
                        break
                details = result.get("details") if isinstance(result, dict) else None
                screenshot = details.get("screenshot") if isinstance(details, dict) else None
                if encoded is None and isinstance(screenshot, dict):
                    if screenshot.get("mimeType") == "image/png":
                        encoded = screenshot.get("base64")
                if isinstance(encoded, str):
                    try:
                        screenshot_images.append(
                            base64.b64decode(encoded, validate=True)
                        )
                    except ValueError:
                        pass
        elif controller == "pi" and event_type == "result":
            text = str(event.get("result") or "")
            if text:
                final_fragments.append(text)
            steps.append(_short(f"result: {text}"))
            if event.get("duration_ms") is not None:
                provider_duration_seconds = float(event["duration_ms"]) / 1000
        elif controller == "claude" and event_type in {"assistant", "user"}:
            message = event.get("message") or {}
            usage = message.get("usage") or {}
            if usage:
                ordinary_input += int(usage.get("input_tokens") or 0)
                cache_read_input += int(usage.get("cache_read_input_tokens") or 0)
                cache_creation_input += int(usage.get("cache_creation_input_tokens") or 0)
                output_tokens += int(usage.get("output_tokens") or 0)
                usage_seen = True
            for block in message.get("content", []) or []:
                block_type = block.get("type")
                if block_type == "tool_use":
                    name = block.get("name")
                    command = str((block.get("input") or {}).get("command") or "")
                    if name == "Bash" and command:
                        commands.append(command)
                        tool_calls += 1
                    else:
                        event_types.append("mcp_tool_call")
                    steps.append(_short(f"tool: {_short(block)}"))
                    steps_count += 1
                elif block_type == "tool_result":
                    steps.append(_short(f"tool_result: {_short(block.get('content') or '')}"))
                    steps_count += 1
                elif block_type == "text":
                    text = str(block.get("text") or "")
                    final_fragments.append(text)
                    steps.append(_short(f"text: {text}"))
                    if text:
                        steps_count += 1
                elif block_type == "thinking":
                    text = str(block.get("thinking") or "")
                    if text:
                        steps.append(_short(f"thinking: {text}"))
                        steps_count += 1
        elif controller == "claude" and event_type == "result":
            text = str(event.get("result") or "")
            if text:
                final_fragments.append(text)
            steps.append(_short(f"result: {text}"))
            usage = event.get("usage") or {}
            if usage and not usage_seen:
                ordinary_input += int(usage.get("input_tokens") or 0)
                cache_read_input += int(usage.get("cache_read_input_tokens") or 0)
                cache_creation_input += int(usage.get("cache_creation_input_tokens") or 0)
                output_tokens += int(usage.get("output_tokens") or 0)
                usage_seen = True
            if event.get("num_turns") is not None:
                provider_turns = int(event["num_turns"])
            if event.get("duration_ms") is not None:
                provider_duration_seconds = float(event["duration_ms"]) / 1000
            if event.get("duration_api_ms") is not None:
                provider_api_duration_seconds = float(event["duration_api_ms"]) / 1000
        elif event_type not in {"thread.started", "turn.started", "turn.completed", "system"}:
            steps.append(_short(f"{event_type}: {_short(event)}"))
    tokens = None
    if usage_seen:
        input_tokens = ordinary_input + cache_read_input + cache_creation_input
        tokens = TokenUsage(
            input=input_tokens,
            cache_read_input=cache_read_input,
            cache_creation_input=cache_creation_input,
            non_cached_input=ordinary_input,
            output=output_tokens,
            reasoning_output=reasoning_output if controller == "codex" else None,
            total=input_tokens + output_tokens,
            estimated_api_cost_usd=(
                estimated_api_cost_usd if cost_complete else None
            ),
        )
    return ParsedEvents(
        steps=steps,
        commands=commands,
        event_types=event_types,
        final_text="\n".join(final_fragments),
        steps_count=steps_count,
        tool_calls=tool_calls,
        tokens=tokens,
        provider_turns=provider_turns,
        provider_duration_seconds=provider_duration_seconds,
        provider_api_duration_seconds=provider_api_duration_seconds,
        agent_turns=agent_turns,
        mcp_calls=mcp_calls,
        screenshot_images=screenshot_images,
    )


def _extract_final_answer(text: str) -> str:
    matches = FINAL_ANSWER_RE.findall(text)
    return matches[-1].strip() if matches else ""


def _has_unescaped_dollar(command: str) -> bool:
    def starts_expansion(position: int) -> bool:
        if position + 1 >= len(command):
            return False
        following = command[position + 1]
        return following.isalnum() or following == "_" or following in "{(?$#*@!-"

    quote: str | None = None
    index = 0
    while index < len(command):
        character = command[index]
        if quote == "'":
            if character == "'":
                quote = None
            index += 1
        elif quote == '"':
            if character == '"':
                quote = None
                index += 1
            elif character == "\\" and index + 1 < len(command) and command[index + 1] in '$`"\\\n':
                index += 2
            elif character == "$" and starts_expansion(index):
                return True
            else:
                index += 1
        elif character in "'\"":
            quote = character
            index += 1
        elif character == "\\":
            index += 2
        elif character == "$" and starts_expansion(index):
            return True
        else:
            index += 1
    return False


def _shell_segments(command: str) -> list[list[str]] | None:
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>\n`")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return None
    controls = {";", "&&", "||", "|", "&", "\n"}
    punctuation = set(";&|()<>\n`")
    segments: list[list[str]] = []
    segment: list[str] = []
    for token in tokens:
        if token in controls:
            if not segment:
                return None
            segments.append(segment)
            segment = []
        elif token and set(token) <= punctuation:
            return None
        else:
            segment.append(token)
    if not segment and segments:
        return None
    if segment:
        segments.append(segment)
    return segments


def _strip_shell_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _is_unterminated_allowed_command(tool: Tool, command: str) -> bool:
    try:
        shlex.split(command, posix=True)
    except ValueError:
        words = command.lstrip().split()
        if not words:
            return False
        executable = Path(words[0].strip("'\"")).name
        if tool in {"webcmd", "agent-browser"}:
            return executable == tool
        if tool == "chrome-devtools-axi":
            return (
                executable == "npx"
                and len(words) >= 3
                and words[1:3] == ["-y", "chrome-devtools-axi"]
            )
    return False


def _dev_browser_segment_allowed(segment: list[str]) -> bool:
    if not segment or segment[0] != "dev-browser":
        return False
    arguments = segment[1:]
    if not arguments:
        return True
    if len(arguments) == 2 and arguments[0] == "--timeout":
        return arguments[1].isdigit() and int(arguments[1]) > 0
    if len(arguments) == 1 and arguments[0].startswith("--timeout="):
        value = arguments[0].partition("=")[2]
        return value.isdigit() and int(value) > 0
    return False


def _dev_browser_skill_read_allowed(command: str) -> bool:
    segments = _shell_segments(command)
    if segments is None or len(segments) != 1:
        return False
    segment = segments[0]
    skill = (Path.home() / ".codex/skills/dev-browser/SKILL.md").resolve()
    try:
        target = Path(segment[-1]).expanduser().resolve()
    except (IndexError, OSError):
        return False
    return target == skill and segment[:-1] in (
        ["cat"],
        ["sed", "-n", "1,240p"],
    )


def _unwrap_single_shell_command(command: str) -> str | None:
    stripped = command.lstrip()
    first = stripped.split(None, 1)[0] if stripped else ""
    if Path(first.strip("'\"")).name not in {"sh", "bash", "zsh"}:
        return command
    if _has_unescaped_dollar(command):
        return None
    try:
        words = shlex.split(command, posix=True)
    except ValueError:
        return None
    if (
        len(words) != 3
        or Path(words[0]).name not in {"sh", "bash", "zsh"}
        or words[1] not in {"-c", "-lc"}
    ):
        return None
    return words[2]


def _webcmd_skill_read_allowed(command: str) -> bool:
    inner = _unwrap_single_shell_command(command)
    if inner is None:
        return False
    segments = _shell_segments(inner)
    if segments is None or len(segments) != 1:
        return False
    segment = segments[0]
    if len(segment) == 2 and segment[0] == "cat":
        target_value = segment[1]
    elif (
        len(segment) == 4
        and segment[:2] == ["sed", "-n"]
        and re.fullmatch(r"[1-9][0-9]*,[1-9][0-9]*p", segment[2]) is not None
    ):
        target_value = segment[3]
    else:
        return False
    try:
        target = Path(target_value).expanduser().resolve()
        target.relative_to(WEBCMD_BROWSER_SKILL_ROOT)
    except (OSError, ValueError):
        return False
    return target.is_file()


def _dev_browser_command_allowed(command: str) -> bool:
    inner = _unwrap_single_shell_command(command)
    if inner is None:
        return False
    if _dev_browser_skill_read_allowed(inner):
        return True
    lines = inner.splitlines()
    if len(lines) < 3:
        segments = _shell_segments(inner)
        return (
            segments is not None
            and len(segments) == 1
            and _dev_browser_segment_allowed(segments[0])
        )
    match = re.fullmatch(
        r"[ \t]*(?P<header>dev-browser(?:[ \t]+.*?)?)[ \t]+"
        r"<<[ \t]*(?P<quote>['\"])(?P<label>[A-Za-z_][A-Za-z0-9_]*)"
        r"(?P=quote)[ \t]*",
        lines[0],
    )
    if match is None or lines[-1].rstrip("\r") != match.group("label"):
        return False
    header = match.group("header")
    if _has_unescaped_dollar(header):
        return False
    try:
        segment = shlex.split(header, posix=True)
    except ValueError:
        return False
    return _dev_browser_segment_allowed(segment)


def _webcmd_run_heredoc_allowed(command: str) -> bool:
    inner = _unwrap_single_shell_command(command)
    if inner is None:
        return False
    lines = inner.splitlines()
    if len(lines) < 3:
        return False
    match = re.fullmatch(
        r"[ \t]*(?P<header>webcmd[ \t]+[^<\r\n]+)[ \t]+"
        r"<<[ \t]*"
        r"(?P<quote>['\"])(?P<label>[A-Za-z_][A-Za-z0-9_]*)"
        r"(?P=quote)[ \t]*",
        lines[0],
    )
    if match is None or lines[-1].rstrip("\r") != match.group("label"):
        return False
    if any(
        line.rstrip("\r") == match.group("label")
        for line in lines[1:-1]
    ):
        return False
    header = match.group("header")
    if _has_unescaped_dollar(header):
        return False
    try:
        segment = shlex.split(header, posix=True)
    except ValueError:
        return False
    browser = _webcmd_browser_tail(segment)
    if browser is None or len(browser) < 2 or browser[:2] != ["browser", "run"]:
        return False

    seen: set[str] = set()
    arguments = browser[2:]
    index = 0
    while index < len(arguments):
        option = arguments[index]
        if option in seen:
            return False
        seen.add(option)
        if option == "--stdin":
            index += 1
            continue
        if option == "--no-snapshot-diff":
            index += 1
            continue
        if option not in {"--timeout", "--max-output", "--snapshot-mode"}:
            return False
        if index + 1 >= len(arguments):
            return False
        value = arguments[index + 1]
        if option in {"--timeout", "--max-output"}:
            if not value.isdigit() or int(value) <= 0:
                return False
        elif value not in {"act", "tree"}:
            return False
        index += 2
    return "--stdin" in seen


def _webcmd_browser_tail(segment: list[str]) -> list[str] | None:
    if (
        len(segment) < 7
        or segment[:3] != ["webcmd", "--profile", WEBCMD_BENCHMARK_PROFILE]
        or segment[3] != "--session"
        or WEBCMD_SESSION_RE.fullmatch(segment[4]) is None
        or segment[5] != "browser"
    ):
        return None
    return segment[5:]


def _webcmd_snapshot_segment_allowed(segment: list[str]) -> bool:
    browser = _webcmd_browser_tail(segment)
    if browser is None or len(browser) < 2 or browser[:2] != ["browser", "snapshot"]:
        return False
    arguments = browser[2:]
    seen: set[str] = set()
    index = 0
    while index < len(arguments):
        option = arguments[index]
        if option in seen:
            return False
        seen.add(option)
        if option not in {"--snapshot-mode", "--max-output", "--ref"}:
            return False
        if index + 1 >= len(arguments):
            return False
        value = arguments[index + 1]
        if option == "--snapshot-mode" and value not in {"act", "tree", "read"}:
            return False
        if option == "--max-output" and (not value.isdigit() or int(value) <= 0):
            return False
        if option == "--ref" and re.fullmatch(r"[A-Za-z0-9._:-]+", value) is None:
            return False
        index += 2
    return True


def _webcmd_segment_allowed(segment: list[str]) -> bool:
    browser = _webcmd_browser_tail(segment)
    if browser is None:
        return False
    if browser == ["browser", "tabs"]:
        return True
    if _webcmd_snapshot_segment_allowed(segment):
        return True
    return (
        len(browser) == 4
        and browser[1:3] == ["bind", "--page"]
        and re.fullmatch(r"[A-Za-z0-9._:-]+", browser[3]) is not None
    )


def _segment_allowed(tool: Tool, segment: list[str]) -> bool:
    executable = Path(segment[0].strip("'\"")).name
    if executable in {"sh", "bash", "zsh"} and len(segment) == 3 and segment[1] in {"-c", "-lc"}:
        inner = _strip_shell_quotes(segment[2])
        return not _policy_violation(tool, [inner], [])
    if tool == "agent-browser":
        if executable != "agent-browser" or len(segment) < 2:
            return False
        arguments = segment[1:]
        forbidden_options = {
            "--args", "--auto-connect", "--cdp", "--config", "--engine",
            "--executable-path", "--namespace", "--profile", "--provider",
            "--restore", "--session", "--state",
        }
        if any(
            argument in forbidden_options
            or any(argument.startswith(f"{option}=") for option in forbidden_options)
            for argument in arguments
        ):
            return False
        if arguments[0] == "read" and any(
            argument.startswith(("http://", "https://"))
            for argument in arguments[1:]
        ):
            return False
        return arguments[0] not in {
            "batch", "close", "connect", "doctor", "install", "mcp", "plugin",
            "upgrade",
        }
    if tool == "dev-browser":
        return _dev_browser_segment_allowed(segment)
    if tool == "webcmd":
        return _webcmd_segment_allowed(segment)
    if executable == tool:
        return False
    if tool == "chrome-devtools-axi" and executable == "npx":
        return len(segment) >= 3 and segment[1:3] == ["-y", "chrome-devtools-axi"]
    return False


def _policy_violation(
    tool: Tool,
    commands: list[str],
    event_types: list[str],
    mcp_calls: list[tuple[str, str]] | None = None,
) -> bool:
    if tool == "libretto":
        calls = mcp_calls or []
        return (
            bool(commands)
            or "web_search" in event_types
            or event_types.count("mcp_tool_call") != len(calls)
            or any(
                server != "libretto" or name not in LIBRETTO_TOOLS
                for server, name in calls
            )
        )
    if any(event in {"web_search", "mcp_tool_call"} for event in event_types):
        return True
    for command in commands:
        if tool == "dev-browser":
            if not _dev_browser_command_allowed(command):
                return True
            continue
        if tool == "webcmd" and _webcmd_run_heredoc_allowed(command):
            continue
        if tool == "webcmd" and _webcmd_skill_read_allowed(command):
            continue
        if _has_unescaped_dollar(command):
            return True
        segments = _shell_segments(command)
        if segments is None and _is_unterminated_allowed_command(tool, command):
            continue
        if (
            segments is None
            or (tool == "agent-browser" and len(segments) != 1)
            or any(not _segment_allowed(tool, segment) for segment in segments)
        ):
            return True
    return False


def _kill_process_group(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (AttributeError, ProcessLookupError, PermissionError):
        try:
            process.kill()
        except ProcessLookupError:
            pass


async def _bounded_drain_and_reap(process: asyncio.subprocess.Process) -> tuple[bytes, bytes]:
    try:
        return await asyncio.wait_for(process.communicate(), timeout=CLEANUP_TIMEOUT_SECONDS)
    except BaseException:
        try:
            await asyncio.wait_for(process.wait(), timeout=CLEANUP_TIMEOUT_SECONDS)
        except BaseException:
            pass
        return b"", b""


async def _terminate_controller(process: asyncio.subprocess.Process) -> tuple[bytes, bytes]:
    _kill_process_group(process)
    cleanup = asyncio.create_task(_bounded_drain_and_reap(process))
    while True:
        try:
            return await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            if cleanup.done():
                return cleanup.result()


async def _close_session_cancellation_resistant(tool: Tool, session: str, tool_env: dict[str, str] | None = None) -> asyncio.CancelledError | None:
    close = asyncio.create_task(_close_session(tool, session, tool_env))
    cancellation: asyncio.CancelledError | None = None
    while True:
        try:
            await asyncio.shield(close)
            return cancellation
        except asyncio.CancelledError as error:
            if cancellation is None:
                cancellation = error
            if close.cancelled():
                return cancellation
        except Exception as cleanup_error:
            if cancellation is None:
                raise
            cancellation.add_note(f"Webcmd cleanup also failed: {cleanup_error}")
            return cancellation


async def _create_webcmd_session(tool_env: dict[str, str] | None = None) -> str:
    command = [
        "webcmd",
        "--profile",
        WEBCMD_BENCHMARK_PROFILE,
        "session",
        "create",
        "-f",
        "json",
    ]
    env = {**_subprocess_env(tool="webcmd"), **(tool_env or {})}
    process = await asyncio.create_subprocess_exec(
        *command,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=60
        )
    except asyncio.TimeoutError:
        _kill_process_group(process)
        await process.wait()
        raise RuntimeError("Webcmd Session creation timed out")
    if process.returncode:
        message = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"Webcmd Session creation failed: {message}")
    try:
        payload = json.loads(stdout)
        session = payload["id"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("Webcmd Session creation returned invalid JSON") from error
    if not isinstance(session, str) or WEBCMD_SESSION_RE.fullmatch(session) is None:
        raise RuntimeError("Webcmd Session creation returned an invalid Session ID")
    return session


async def _close_runtime_cancellation_resistant(runtime) -> asyncio.CancelledError | None:
    close = asyncio.create_task(runtime.close())
    cancellation: asyncio.CancelledError | None = None
    while True:
        try:
            await asyncio.shield(close)
            return cancellation
        except asyncio.CancelledError as error:
            if cancellation is None:
                cancellation = error
            if close.cancelled():
                return cancellation


async def _close_session(tool: Tool, session: str, tool_env: dict[str, str] | None = None) -> None:
    if tool != "webcmd":
        return
    command = [
        "webcmd",
        "--profile",
        WEBCMD_BENCHMARK_PROFILE,
        "session",
        "close",
        session,
        "--force",
        "-f",
        "json",
    ]
    try:
        process = await asyncio.create_subprocess_exec(*command, env={**_subprocess_env(tool=tool), **(tool_env or {})}, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
    except Exception as error:
        raise RuntimeError("Webcmd Session cleanup failed to start") from error
    try:
        await asyncio.wait_for(process.wait(), timeout=15)
    except asyncio.TimeoutError:
        _kill_process_group(process)
        try:
            await asyncio.wait_for(process.wait(), timeout=CLEANUP_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            raise RuntimeError("Webcmd Session cleanup timed out and could not be reaped")
        raise RuntimeError("Webcmd Session cleanup timed out")
    if process.returncode:
        raise RuntimeError(f"Webcmd Session cleanup failed with exit code {process.returncode}")


WEBCMD_ARTIFACT_LOCATOR_RE = re.compile(
    r"browser-run://(artifact_[0-9a-f]{24})/([^\"'\\\s]+)"
)


def _webcmd_result_payloads(controller: Controller, lines: list[str]) -> list[object]:
    payloads: list[object] = []
    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        event_type = event.get("type")
        if controller == "codex" and event_type == "item.completed":
            item = event.get("item") or {}
            command = str(item.get("command") or "")
            if (
                item.get("type") == "command_execution"
                and _webcmd_run_heredoc_allowed(command)
            ):
                payloads.append(item.get("aggregated_output") or item.get("output") or "")
        elif controller == "pi" and event_type == "tool_execution_end":
            payloads.append(event.get("result") or "")
        elif controller == "claude" and event_type in {"assistant", "user"}:
            for block in (event.get("message") or {}).get("content", []) or []:
                if block.get("type") == "tool_result":
                    payloads.append(block.get("content") or "")
    return payloads


def _collect_webcmd_screenshots(
    controller: Controller,
    lines: list[str],
    shots_dir: Path,
) -> None:
    locators: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for payload in _webcmd_result_payloads(controller, lines):
        text = payload if isinstance(payload, str) else json.dumps(payload, default=str)
        for match in WEBCMD_ARTIFACT_LOCATOR_RE.finditer(text):
            locator = (match.group(1), unquote(match.group(2)))
            if locator not in seen:
                seen.add(locator)
                locators.append(locator)

    cache_dir = Path.home() / ".webcmd" / "cache" / "browser-run"
    next_index = 1
    for artifact_id, filename in locators:
        logical_path = Path(filename)
        if (
            not filename
            or logical_path.is_absolute()
            or "\\" in filename
            or ".." in logical_path.parts
        ):
            raise ValueError(f"Unsafe Webcmd artifact path: {filename}")
        if logical_path.suffix.lower() != ".png":
            continue
        artifact_dir = (cache_dir / artifact_id).resolve()
        source = (artifact_dir / logical_path).resolve()
        if not source.is_relative_to(artifact_dir):
            raise ValueError(f"Unsafe Webcmd artifact path: {filename}")
        if not source.is_file():
            raise FileNotFoundError(f"Missing Webcmd screenshot artifact: {source}")
        destination = shots_dir / f"step_{next_index:03}.png"
        while destination.exists():
            next_index += 1
            destination = shots_dir / f"step_{next_index:03}.png"
        shutil.copy2(source, destination)
        next_index += 1


async def run_controller(controller: Controller, model: str, tool: Tool, task: str, work_dir: Path, timeout_seconds: int, reasoning_effort: str | None = None, tool_env: dict[str, str] | None = None) -> ExecutionEvidence:
    work_dir.mkdir(parents=True, exist_ok=False)
    shots_dir = work_dir / "shots"
    shots_dir.mkdir()
    session = _session_name(work_dir)
    browser_runtime = None
    if tool == "chrome-devtools-axi":
        browser_runtime = await start_axi_runtime(session, work_dir, _subprocess_env(tool=tool))
    elif tool == "agent-browser":
        browser_runtime = await start_agent_browser_runtime(session, work_dir, _subprocess_env(tool=tool))
    elif tool == "dev-browser":
        browser_runtime = await start_dev_browser_runtime(session, work_dir, _subprocess_env(tool=tool))
    elif tool == "libretto":
        browser_runtime = await start_libretto_runtime(session, work_dir, _subprocess_env(tool=tool))
    merged_tool_env = {**(browser_runtime.env if browser_runtime else {}), **(tool_env or {})}
    if tool == "webcmd":
        merged_tool_env = await asyncio.to_thread(
            _pin_webcmd_env,
            {**_subprocess_env(tool=tool), **merged_tool_env},
            work_dir,
        )
        session = await _create_webcmd_session(merged_tool_env)
    prompt = _build_prompt(tool, session, shots_dir, task)
    turn_collector = _CodexTurnCollector() if controller == "codex" else None
    if turn_collector is not None:
        turn_collector.__enter__()
    try:
        command, stdin = _controller_command(
            controller,
            model,
            prompt,
            reasoning_effort,
            tool,
            browser_runtime.env if browser_runtime else None,
            otel_endpoint=(
                turn_collector.endpoint if turn_collector is not None else None
            ),
        )
    except BaseException as setup_error:
        if turn_collector is not None:
            turn_collector.__exit__()
        if tool == "webcmd":
            try:
                close_cancellation = await _close_session_cancellation_resistant(
                    tool, session, merged_tool_env
                )
            except Exception as cleanup_error:
                setup_error.add_note(f"Webcmd cleanup also failed: {cleanup_error}")
                close_cancellation = None
            if close_cancellation is not None:
                raise close_cancellation
        raise
    timed_out = False
    started = time.monotonic()
    process = None
    pending_error: BaseException | None = None
    pending_traceback = None
    cleanup_error: Exception | None = None
    close_cancellation: asyncio.CancelledError | None = None
    try:
        process = await asyncio.create_subprocess_exec(*command, cwd=work_dir, env=_child_env(controller, tool, merged_tool_env), stdin=asyncio.subprocess.PIPE if stdin is not None else None, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True)
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(stdin), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            timed_out = True
            stdout, stderr = await _terminate_controller(process)
    except BaseException as error:
        pending_error = error
        pending_traceback = error.__traceback__
        if process is not None:
            await _terminate_controller(process)
    finally:
        controller_duration = time.monotonic() - started
        try:
            if browser_runtime is None:
                close_cancellation = await _close_session_cancellation_resistant(tool, session, merged_tool_env)
            else:
                close_cancellation = await _close_runtime_cancellation_resistant(browser_runtime)
        except Exception as error:
            cleanup_error = error
        if turn_collector is not None:
            turn_collector.__exit__()

    if pending_error is not None:
        if cleanup_error is not None:
            pending_error.add_note(f"Browser cleanup also failed: {cleanup_error}")
        raise pending_error.with_traceback(pending_traceback)
    if cleanup_error is not None:
        raise cleanup_error
    if close_cancellation is not None:
        raise close_cancellation

    lines = stdout.decode(errors="replace").splitlines()
    (work_dir / "controller.jsonl").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    if stderr:
        lines.append(json.dumps({"type": "stderr", "text": stderr.decode(errors="replace")[:2000]}))
    parsed = _parse_events(controller, lines, tool=tool, model=model)
    if tool == "webcmd":
        _collect_webcmd_screenshots(controller, lines, shots_dir)
    for index, image in enumerate(parsed.screenshot_images, start=1):
        (shots_dir / f"step_{index:03}.png").write_bytes(image)
    final_answer = _extract_final_answer(parsed.final_text)
    if timed_out:
        termination: Termination = "timeout"
    elif process.returncode != 0:
        termination = "controller_error"
    elif _policy_violation(
        tool, parsed.commands, parsed.event_types, parsed.mcp_calls
    ):
        termination = "tool_policy_violation"
    elif not final_answer:
        termination = "missing_final_answer"
    else:
        termination = "completed"
    metrics = ControllerMetrics(
        duration_seconds=controller_duration,
        steps=parsed.steps_count,
        tool_calls=parsed.tool_calls,
        tokens=parsed.tokens,
        provider_turns=parsed.provider_turns,
        provider_duration_seconds=parsed.provider_duration_seconds,
        provider_api_duration_seconds=parsed.provider_api_duration_seconds,
        agent_turns=(
            turn_collector.agent_turns
            if turn_collector is not None
            else parsed.agent_turns
        ),
    )
    return ExecutionEvidence(final_answer=final_answer, steps=parsed.steps, screenshot_paths=sorted(shots_dir.glob("*.png")), controller_exit_code=process.returncode if process.returncode is not None else -9, termination=termination, metrics=metrics)
