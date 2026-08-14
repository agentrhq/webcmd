import asyncio
import base64
import json
import os
import signal
import sys
import time
import urllib.request
from pathlib import Path

import pytest

import run_controller
from run_controller import (
    ExecutionEvidence,
    WEBCMD_BROWSER_SKILL,
    _build_prompt,
    _child_env,
    _controller_command,
    _extract_final_answer,
    _parse_events,
    _policy_violation,
    run_controller as execute_controller,
)

WEBCMD_SESSION = "session_12345678-1234-4234-8234-123456789abc"
WEBCMD_BROWSER = f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser"
_REAL_CREATE_WEBCMD_SESSION = run_controller._create_webcmd_session


@pytest.fixture(autouse=True)
def _stub_webcmd_session_creation(monkeypatch):
    async def create_session(tool_env=None):
        return WEBCMD_SESSION

    monkeypatch.setattr(run_controller, "_create_webcmd_session", create_session)


async def _no_close(*args):
    return None


def _fake_controller(monkeypatch, script):
    monkeypatch.setattr(
        run_controller,
        "_controller_command",
        lambda *args, **kwargs: ([sys.executable, "-c", script], None),
    )


def test_webcmd_prompt_loads_only_raw_browser_skill(tmp_path):
    prompt = _build_prompt("webcmd", "session-1", tmp_path / "shots", "Find the answer")

    assert "`$webcmd-browser`" in prompt
    assert "`$webcmd-usage`" not in prompt
    assert "raw-browser route is already selected" in prompt
    assert "Skip adapter and plugin discovery" in prompt
    assert "Do not load any other Webcmd skill" in prompt
    assert "`webcmd doctor`" in prompt
    assert prompt.endswith("\nTask:\nFind the answer\n")


def test_prompt_warns_against_shell_punctuation_and_unspecified_view_changes(tmp_path):
    prompt = _build_prompt("webcmd", "session-1", tmp_path / "shots", "Find the answer")

    assert "Quote URLs that contain" in prompt
    assert "Do not change filters, sort modes, chart variants, regions, or page views" in prompt


def test_prompt_handles_stealth_challenges_and_login_pages(tmp_path):
    prompt = _build_prompt("webcmd", "session-1", tmp_path / "shots", "Find the answer")

    assert "make a reasonable in-browser attempt" in prompt
    assert "If a login or authentication page blocks further progress" in prompt
    assert "only report failure when anti-bot protection remains blocking" in prompt


def test_webcmd_prompt_reuses_harness_owned_browser_session(tmp_path):
    prompt = _build_prompt(
        "webcmd", WEBCMD_SESSION, tmp_path / "shots", "Find the answer"
    )

    assert f"`--profile benchmark`" in prompt
    assert f"`--session {WEBCMD_SESSION}`" in prompt
    assert "on every browser command" in prompt
    assert "session create" not in prompt
    assert "session close" not in prompt
    assert "The harness owns Session cleanup" in prompt
    assert "shots/step_001.png" in prompt
    assert "Save screenshots after meaningful page transitions" in prompt


def test_create_webcmd_session_uses_dedicated_profile_and_parses_opaque_id(monkeypatch):
    captured = {}

    class Process:
        returncode = 0

        async def communicate(self):
            return json.dumps({"id": WEBCMD_SESSION, "kind": "explicit"}).encode(), b""

    async def create_process(*args, **kwargs):
        captured["args"] = args
        captured.update(kwargs)
        return Process()

    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)

    session = asyncio.run(
        _REAL_CREATE_WEBCMD_SESSION({"PATH": "/verified/bin"})
    )

    assert session == WEBCMD_SESSION
    assert captured["args"] == (
        "webcmd",
        "--profile",
        "benchmark",
        "session",
        "create",
        "-f",
        "json",
    )
    assert captured["env"]["PATH"] == "/verified/bin"
    assert captured["start_new_session"] is True


def test_webcmd_controller_uses_created_session_and_harness_closes_after_exit(
    tmp_path, monkeypatch
):
    events = []
    answer_event = json.dumps(
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"},
        }
    )

    async def create_session(tool_env):
        events.append(("create", tool_env))
        return WEBCMD_SESSION

    async def close_session(tool, session, tool_env=None):
        events.append(("close", tool, session, tool_env))

    def controller_command(controller, model, prompt, *args, **kwargs):
        assert f"--session {WEBCMD_SESSION}" in prompt
        events.append(("controller",))
        return [sys.executable, "-c", f"print({answer_event!r})"], None

    monkeypatch.setattr(run_controller, "_create_webcmd_session", create_session)
    monkeypatch.setattr(run_controller, "_close_session", close_session)
    monkeypatch.setattr(run_controller, "_controller_command", controller_command)

    evidence = asyncio.run(
        execute_controller(
            "codex",
            "gpt-5",
            "webcmd",
            "task",
            tmp_path / "attempt",
            5,
            tool_env={"PATH": "/verified/bin"},
        )
    )

    assert evidence.final_answer == "42"
    assert events == [
        ("create", {"PATH": "/verified/bin"}),
        ("controller",),
        ("close", "webcmd", WEBCMD_SESSION, {"PATH": "/verified/bin"}),
    ]


def test_webcmd_session_closes_when_controller_setup_fails(tmp_path, monkeypatch):
    closed = []

    async def close_session(tool, session, tool_env=None):
        closed.append((tool, session, tool_env))

    def fail_controller_setup(*args, **kwargs):
        raise RuntimeError("controller setup failed")

    monkeypatch.setattr(run_controller, "_close_session", close_session)
    monkeypatch.setattr(run_controller, "_controller_command", fail_controller_setup)

    with pytest.raises(RuntimeError, match="controller setup failed"):
        asyncio.run(
            execute_controller(
                "codex",
                "gpt-5",
                "webcmd",
                "task",
                tmp_path / "attempt",
                5,
                tool_env={"PATH": "/verified/bin"},
            )
        )

    assert closed == [
        ("webcmd", WEBCMD_SESSION, {"PATH": "/verified/bin"})
    ]


def test_axi_prompt_uses_installed_skill_and_only_axi_commands(tmp_path):
    prompt = _build_prompt("chrome-devtools-axi", "session-1", tmp_path / "shots", "Find the answer")

    assert "`$chrome-devtools-axi` skill" in prompt
    assert "`npx -y chrome-devtools-axi`" in prompt
    assert "Webcmd" not in prompt
    assert str(tmp_path / "shots" / "step_001.png") in prompt


def test_agent_browser_prompt_uses_installed_skill_and_dedicated_cloak(tmp_path):
    prompt = _build_prompt("agent-browser", "session-1", tmp_path / "shots", "Find the answer")

    assert "`$agent-browser` skill" in prompt
    assert "only `agent-browser`" in prompt
    assert "dedicated CloakBrowser" in prompt
    assert "Do not use `batch`" in prompt
    assert "one `agent-browser` command per shell invocation" in prompt
    assert "Never pass a URL to `agent-browser read`" in prompt
    assert "Webcmd" not in prompt
    assert "chrome-devtools-axi" not in prompt
    assert str(tmp_path / "shots" / "step_001.png") in prompt


def test_dev_browser_prompt_uses_installed_skill_quoted_heredoc_and_task_screenshots(
    tmp_path,
):
    prompt = _build_prompt(
        "dev-browser", "session-1", tmp_path / "shots", "Find the answer"
    )

    assert "`$dev-browser` skill" in prompt
    assert "only `dev-browser`" in prompt
    assert "quoted heredoc" in prompt
    assert "dedicated CloakBrowser" in prompt
    assert "saveScreenshot" in prompt
    assert "session-1-step_001.png" in prompt
    assert "Webcmd" not in prompt
    assert "agent-browser" not in prompt


def test_libretto_prompt_uses_only_native_tools_on_dedicated_cloak(tmp_path):
    prompt = _build_prompt(
        "libretto", "session-1", tmp_path / "shots", "Find the answer"
    )

    for tool in (
        "browser_open",
        "browser_exec",
        "browser_snapshot",
        "browser_status",
        "browser_close",
    ):
        assert f"`{tool}`" in prompt
    assert "browser_connect" not in prompt
    assert "dedicated CloakBrowser" in prompt
    assert "screenshot: true" in prompt
    assert "shell commands" in prompt
    assert "$libretto" not in prompt
    assert str(tmp_path / "shots") not in prompt


def test_codex_and_claude_events_normalize_to_steps_and_final_text():
    codex = [
        {"type": "item.completed", "item": {"type": "command_execution", "command": "webcmd browser s state", "aggregated_output": "page"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}},
    ]
    claude = [
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "webcmd browser s state"}}]}},
        {"type": "result", "subtype": "success", "result": "FINAL ANSWER: 42"},
    ]

    codex_parsed = _parse_events("codex", [json.dumps(event) for event in codex])
    claude_parsed = _parse_events("claude", [json.dumps(event) for event in claude])

    assert _extract_final_answer(codex_parsed.final_text) == "42"
    assert _extract_final_answer(claude_parsed.final_text) == "42"
    assert codex_parsed.commands == claude_parsed.commands == ["webcmd browser s state"]


def test_codex_events_sum_usage_and_count_only_meaningful_completed_items():
    events = [
        {"type": "turn.started"},
        {"type": "item.started", "item": {"type": "command_execution"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "working"}},
        {"type": "item.completed", "item": {"type": "command_execution", "command": "webcmd browser s state", "aggregated_output": "page"}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 80, "output_tokens": 10, "reasoning_output_tokens": 2}},
        {"type": "turn.completed", "usage": {"input_tokens": 50, "cached_input_tokens": 40, "output_tokens": 5, "reasoning_output_tokens": 1}},
    ]

    parsed = _parse_events("codex", [json.dumps(event) for event in events])

    assert parsed.steps_count == 2
    assert parsed.tool_calls == 1
    assert parsed.tokens.input == 150
    assert parsed.tokens.cache_read_input == 120
    assert parsed.tokens.non_cached_input == 30
    assert parsed.tokens.output == 15
    assert parsed.tokens.reasoning_output == 3
    assert parsed.tokens.total == 165


def test_codex_cost_separates_cache_writes_and_applies_long_context_pricing():
    events = [
        {
            "type": "turn.completed",
            "usage": {
                "input_tokens": 100,
                "cached_input_tokens": 60,
                "cache_write_input_tokens": 20,
                "output_tokens": 10,
                "reasoning_output_tokens": 2,
            },
        },
        {
            "type": "turn.completed",
            "usage": {
                "input_tokens": 300_000,
                "cached_input_tokens": 100_000,
                "cache_write_input_tokens": 50_000,
                "output_tokens": 1_000,
                "reasoning_output_tokens": 100,
            },
        },
    ]

    parsed = _parse_events(
        "codex", [json.dumps(event) for event in events], model="gpt-5.6-sol"
    )

    assert parsed.tokens.input == 300_100
    assert parsed.tokens.cache_read_input == 100_060
    assert parsed.tokens.cache_creation_input == 50_020
    assert parsed.tokens.non_cached_input == 150_020
    assert parsed.tokens.output == 1_010
    assert parsed.tokens.total == 301_110
    assert parsed.tokens.estimated_api_cost_usd == pytest.approx(2.270555)


def _otel_log_record(*attributes):
    return {
        "body": {"stringValue": "Codex telemetry event"},
        "attributes": [
            {"key": key, "value": {"stringValue": value}}
            for key, value in attributes
        ],
    }


def _otel_payload(*records):
    return {
        "resourceLogs": [
            {"scopeLogs": [{"logRecords": list(records)}]}
        ]
    }


def test_codex_turn_collector_counts_only_token_bearing_completed_responses():
    payload = _otel_payload(
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.completed"),
        ),
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.completed"),
            ("input_token_count", "100"),
        ),
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.completed"),
            ("error.message", "failed to parse ResponseCompleted"),
        ),
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.output_item.done"),
            ("input_token_count", "100"),
        ),
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.completed"),
            ("input_token_count", "200"),
        ),
    )

    with run_controller._CodexTurnCollector() as collector:
        request = urllib.request.Request(
            collector.endpoint,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 200

    assert collector.agent_turns == 2


def test_codex_turn_collector_reports_unavailable_without_valid_telemetry():
    with run_controller._CodexTurnCollector() as collector:
        pass

    assert collector.agent_turns is None


def test_codex_libretto_mcp_call_counts_once_and_collects_snapshot_image():
    png = b"\x89PNG\r\nlibretto"
    event = {
        "type": "item.completed",
        "item": {
            "type": "mcp_tool_call",
            "server": "libretto",
            "tool": "browser_snapshot",
            "arguments": {"sessionId": "ses-1", "screenshot": True},
            "result": {
                "content": [
                    {"type": "text", "text": '{"ok":true}'},
                    {
                        "type": "image",
                        "data": base64.b64encode(png).decode(),
                        "mimeType": "image/png",
                    },
                ]
            },
        },
    }

    parsed = _parse_events(
        "codex", [json.dumps(event)], tool="libretto"
    )

    assert parsed.steps_count == 1
    assert parsed.tool_calls == 1
    assert parsed.mcp_calls == [("libretto", "browser_snapshot")]
    assert parsed.screenshot_images == [png]
    assert not _policy_violation(
        "libretto",
        parsed.commands,
        parsed.event_types,
        parsed.mcp_calls,
    )


def test_codex_libretto_collects_snapshot_from_wrapped_mcp_result():
    png = b"\x89PNG\r\nwrapped"
    event = {
        "type": "item.completed",
        "item": {
            "type": "mcp_tool_call",
            "server": "libretto",
            "tool": "browser_snapshot",
            "result": {
                "Ok": {
                    "content": [
                        {
                            "type": "image",
                            "data": base64.b64encode(png).decode(),
                            "mimeType": "image/png",
                        }
                    ]
                }
            },
        },
    }

    parsed = _parse_events(
        "codex", [json.dumps(event)], tool="libretto"
    )

    assert parsed.screenshot_images == [png]


def test_pi_libretto_custom_tool_counts_once_and_collects_snapshot_image():
    png = b"\x89PNG\r\npi-libretto"
    events = [
        {
            "type": "tool_execution_start",
            "toolName": "browser_snapshot",
            "args": {"sessionId": "ses-1", "screenshot": True},
        },
        {
            "type": "tool_execution_end",
            "toolName": "browser_snapshot",
            "result": {
                "content": [
                    {
                        "type": "image",
                        "data": "[omitted 12000 characters]",
                        "mimeType": "image/png",
                    }
                ],
                "details": {
                    "ok": True,
                    "screenshot": {
                        "base64": base64.b64encode(png).decode(),
                        "mimeType": "image/png",
                    },
                },
            },
            "isError": False,
        },
    ]

    parsed = _parse_events(
        "pi", [json.dumps(event) for event in events], tool="libretto"
    )

    assert parsed.tool_calls == 1
    assert parsed.mcp_calls == [("libretto", "browser_snapshot")]
    assert parsed.screenshot_images == [png]
    assert not _policy_violation(
        "libretto", parsed.commands, parsed.event_types, parsed.mcp_calls
    )


@pytest.mark.parametrize(
    ("server", "tool"),
    [
        ("other", "browser_snapshot"),
        ("libretto", "browser_connect"),
        ("libretto", "unknown_tool"),
    ],
)
def test_libretto_policy_rejects_foreign_or_disabled_mcp_tools(server, tool):
    assert _policy_violation(
        "libretto",
        [],
        ["mcp_tool_call"],
        [(server, tool)],
    )


def test_libretto_policy_rejects_shell_and_web_search():
    assert _policy_violation(
        "libretto", ["echo bypass"], [], []
    )
    assert _policy_violation(
        "libretto", [], ["web_search"], []
    )


def test_claude_events_normalize_usage_turns_and_steps():
    events = [
        {
            "type": "assistant",
            "message": {
                "usage": {"input_tokens": 20, "cache_read_input_tokens": 70, "cache_creation_input_tokens": 10, "output_tokens": 5},
                "content": [
                    {"type": "text", "text": "working"},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "webcmd browser s state"}},
                ],
            },
        },
        {"type": "user", "message": {"content": [{"type": "tool_result", "content": "page"}]}},
        {"type": "result", "subtype": "success", "result": "FINAL ANSWER: 42", "duration_ms": 1000, "duration_api_ms": 800, "num_turns": 2},
    ]

    parsed = _parse_events("claude", [json.dumps(event) for event in events])

    assert parsed.steps_count == 3
    assert parsed.tool_calls == 1
    assert parsed.tokens.input == 100
    assert parsed.tokens.cache_read_input == 70
    assert parsed.tokens.cache_creation_input == 10
    assert parsed.tokens.non_cached_input == 20
    assert parsed.tokens.output == 5
    assert parsed.tokens.reasoning_output is None
    assert parsed.tokens.total == 105
    assert parsed.provider_turns == 2
    assert parsed.provider_duration_seconds == 1.0
    assert parsed.provider_api_duration_seconds == 0.8


def test_pi_events_normalize_commands_results_usage_and_final_text():
    events = [
        {
            "type": "message_end",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "benchmark prompt"}],
            },
        },
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 20,
                    "cacheRead": 70,
                    "cacheWrite": 10,
                    "output": 5,
                    "totalTokens": 105,
                    "cost": {
                        "input": 0.01,
                        "output": 0.02,
                        "cacheRead": 0.003,
                        "cacheWrite": 0.004,
                        "total": 0.037,
                    },
                },
                "content": [{"type": "text", "text": "working"}],
            },
        },
        {
            "type": "tool_execution_start",
            "toolName": "bash",
                "args": {"command": f"{WEBCMD_BROWSER} tabs"},
        },
        {
            "type": "tool_execution_end",
            "toolName": "bash",
            "result": {"content": [{"type": "text", "text": "page"}]},
            "isError": False,
        },
        {
            "type": "message_end",
            "message": {
                "role": "toolResult",
                "content": [{"type": "text", "text": "page"}],
            },
        },
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 10,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "output": 2,
                    "totalTokens": 12,
                    "cost": {
                        "input": 0.005,
                        "output": 0.006,
                        "cacheRead": 0.0,
                        "cacheWrite": 0.0,
                        "total": 0.011,
                    },
                },
                "content": [{"type": "text", "text": "FINAL ANSWER: 42"}],
            },
        },
        {
            "type": "result",
            "result": "FINAL ANSWER: 42",
            "duration_ms": 1000,
        },
    ]

    parsed = _parse_events("pi", [json.dumps(event) for event in events])

    assert parsed.commands == [f"{WEBCMD_BROWSER} tabs"]
    assert parsed.tool_calls == 1
    assert parsed.steps_count == 3
    assert any("page" in step for step in parsed.steps)
    assert not any("benchmark prompt" in step for step in parsed.steps)
    assert parsed.tokens.input == 110
    assert parsed.tokens.cache_read_input == 70
    assert parsed.tokens.cache_creation_input == 10
    assert parsed.tokens.non_cached_input == 30
    assert parsed.tokens.output == 7
    assert parsed.tokens.total == 117
    assert parsed.tokens.estimated_api_cost_usd == pytest.approx(0.048)
    assert parsed.agent_turns == 2
    assert parsed.provider_duration_seconds == 1.0
    assert _extract_final_answer(parsed.final_text) == "42"
    assert not _policy_violation("webcmd", parsed.commands, parsed.event_types)


def test_pi_cost_is_unavailable_when_any_usage_turn_lacks_cost():
    events = [
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 10,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "output": 2,
                    "totalTokens": 12,
                    "cost": {
                        "input": 0.005,
                        "output": 0.006,
                        "cacheRead": 0.0,
                        "cacheWrite": 0.0,
                        "total": 0.011,
                    },
                },
                "content": [{"type": "text", "text": "working"}],
            },
        },
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 5,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "output": 1,
                    "totalTokens": 6,
                },
                "content": [{"type": "text", "text": "done"}],
            },
        },
    ]

    parsed = _parse_events("pi", [json.dumps(event) for event in events])

    assert parsed.agent_turns == 2
    assert parsed.tokens.estimated_api_cost_usd is None


def test_pi_non_bash_tool_is_a_policy_violation():
    event = {
        "type": "tool_execution_start",
        "toolName": "write",
        "args": {"path": "answer.txt", "content": "bypass"},
    }

    parsed = _parse_events("pi", [json.dumps(event)])

    assert parsed.tool_calls == 0
    assert parsed.steps_count == 1
    assert _policy_violation("webcmd", parsed.commands, parsed.event_types)


def test_pi_may_read_only_the_registered_webcmd_browser_skill():
    usage_skill = {
        "type": "tool_execution_start",
        "toolName": "read",
        "args": {
            "path": str(Path.home() / ".codex/skills/webcmd-usage/SKILL.md")
        },
    }
    browser_skill = {
        "type": "tool_execution_start",
        "toolName": "read",
        "args": {
            "path": str(
                Path.home() / ".codex/skills/webcmd-browser/SKILL.md"
            )
        },
    }
    forbidden = {
        "type": "tool_execution_start",
        "toolName": "read",
        "args": {"path": "/etc/passwd"},
    }

    usage_parsed = _parse_events("pi", [json.dumps(usage_skill)])
    browser_parsed = _parse_events("pi", [json.dumps(browser_skill)])
    forbidden_parsed = _parse_events("pi", [json.dumps(forbidden)])

    assert browser_parsed.tool_calls == 0
    assert browser_parsed.steps_count == 0
    assert not _policy_violation(
        "webcmd", browser_parsed.commands, browser_parsed.event_types
    )
    for parsed in (usage_parsed, forbidden_parsed):
        assert parsed.tool_calls == 0
        assert parsed.steps_count == 1
        assert _policy_violation(
            "webcmd", parsed.commands, parsed.event_types
        )


def test_pi_dev_browser_skill_read_is_setup_not_a_foreign_tool():
    event = {
        "type": "tool_execution_start",
        "toolName": "read",
        "args": {
            "path": str(Path.home() / ".codex/skills/dev-browser/SKILL.md")
        },
    }

    parsed = _parse_events(
        "pi", [json.dumps(event)], tool="dev-browser"
    )

    assert parsed.tool_calls == 0
    assert parsed.steps_count == 0
    assert not _policy_violation(
        "dev-browser", parsed.commands, parsed.event_types
    )


def test_claude_result_usage_is_used_when_messages_have_no_usage():
    event = {
        "type": "result",
        "subtype": "success",
        "result": "FINAL ANSWER: 42",
        "usage": {"input_tokens": 20, "cache_read_input_tokens": 70, "cache_creation_input_tokens": 10, "output_tokens": 5},
    }

    parsed = _parse_events("claude", [json.dumps(event)])

    assert parsed.tokens.input == 100
    assert parsed.tokens.total == 105


def test_codex_events_keep_valid_answer_across_later_fragments_and_last_marker_wins():
    events = [
        {"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "postscript without a marker"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 43"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "trailing note"}},
    ]

    parsed = _parse_events("codex", [json.dumps(event) for event in events])

    assert _extract_final_answer(parsed.final_text) == "43"
    assert parsed.final_text.splitlines() == ["FINAL ANSWER: 42", "postscript without a marker", "FINAL ANSWER: 43", "trailing note"]


def test_claude_events_keep_valid_answer_across_later_fragments_and_last_marker_wins():
    events = [
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "FINAL ANSWER: 42"}]}},
        {"type": "result", "result": "postscript without a marker"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "FINAL ANSWER: 43"}]}},
        {"type": "result", "result": "trailing note"},
    ]

    parsed = _parse_events("claude", [json.dumps(event) for event in events])

    assert _extract_final_answer(parsed.final_text) == "43"
    assert parsed.final_text.splitlines() == ["FINAL ANSWER: 42", "postscript without a marker", "FINAL ANSWER: 43", "trailing note"]


def test_environment_is_minimal_and_preserves_selected_controller_and_tool(monkeypatch):
    monkeypatch.setenv("PATH", "/bin")
    monkeypatch.setenv("CODEX_API_KEY", "codex-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "claude-secret")
    monkeypatch.setenv("WEBCMD_CDP_ENDPOINT", "ws://selected")
    monkeypatch.setenv("OTHER_TOOL_API_KEY", "other-tool-secret")
    monkeypatch.setenv("DATABASE_URL", "unrelated-secret")
    monkeypatch.setenv("PLAYWRIGHT_API_KEY", "competing-secret")
    monkeypatch.setenv("BROWSER_AUTOMATION_TOKEN", "unknown-competing-secret")

    codex_webcmd_env = _child_env("codex", "webcmd")

    assert codex_webcmd_env["PATH"] == "/bin"
    assert codex_webcmd_env["CODEX_API_KEY"] == "codex-secret"
    assert codex_webcmd_env["OPENAI_API_KEY"] == "openai-secret"
    assert codex_webcmd_env["WEBCMD_CDP_ENDPOINT"] == "ws://selected"
    assert "DATABASE_URL" not in codex_webcmd_env
    assert "PLAYWRIGHT_API_KEY" not in codex_webcmd_env
    assert "BROWSER_AUTOMATION_TOKEN" not in codex_webcmd_env
    assert "ANTHROPIC_API_KEY" not in codex_webcmd_env
    assert "OTHER_TOOL_API_KEY" not in codex_webcmd_env


def test_axi_environment_preserves_only_axi_runtime_configuration(monkeypatch):
    monkeypatch.setenv("PATH", "/bin")
    monkeypatch.setenv("OPENAI_API_KEY", "controller-secret")
    monkeypatch.setenv("CHROME_DEVTOOLS_AXI_BROWSER_URL", "http://127.0.0.1:1234")
    monkeypatch.setenv("CHROME_DEVTOOLS_AXI_SESSION", "task-session")
    monkeypatch.setenv("WEBCMD_API_KEY", "competing-tool-secret")

    env = _child_env("codex", "chrome-devtools-axi")

    assert env["CHROME_DEVTOOLS_AXI_BROWSER_URL"] == "http://127.0.0.1:1234"
    assert env["CHROME_DEVTOOLS_AXI_SESSION"] == "task-session"
    assert "WEBCMD_API_KEY" not in env


def test_agent_browser_environment_preserves_only_private_runtime_configuration(monkeypatch):
    monkeypatch.setenv("PATH", "/bin")
    monkeypatch.setenv("OPENAI_API_KEY", "controller-secret")
    monkeypatch.setenv("AGENT_BROWSER_CDP", "http://127.0.0.1:9999")
    monkeypatch.setenv("AGENT_BROWSER_PROFILE", "/tmp/shared-profile")
    monkeypatch.setenv("AGENT_BROWSER_AUTO_CONNECT", "1")
    monkeypatch.setenv("WEBCMD_API_KEY", "competing-tool-secret")

    env = _child_env("codex", "agent-browser", {
        "AGENT_BROWSER_CDP": "http://127.0.0.1:1234",
        "AGENT_BROWSER_SESSION": "task-session",
        "AGENT_BROWSER_NAMESPACE": "task-session",
    })

    assert env["AGENT_BROWSER_CDP"] == "http://127.0.0.1:1234"
    assert env["AGENT_BROWSER_SESSION"] == "task-session"
    assert env["AGENT_BROWSER_NAMESPACE"] == "task-session"
    assert "AGENT_BROWSER_PROFILE" not in env
    assert "AGENT_BROWSER_AUTO_CONNECT" not in env
    assert "WEBCMD_API_KEY" not in env


def test_environment_excludes_evaluation_metadata_even_under_allowed_prefixes(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "judge-secret")
    monkeypatch.setenv("JUDGE_MODEL", "judge-model")
    monkeypatch.setenv("DATASET_DECRYPTION_KEY", "dataset-secret")
    monkeypatch.setenv("RESULTS_DIR", "/other-attempts")
    monkeypatch.setenv("OPENAI_JUDGE_PROMPT", "judge-instructions")
    monkeypatch.setenv("CODEX_GROUND_TRUTH", "hidden-answer")
    monkeypatch.setenv("ANTHROPIC_PRIOR_VERDICT", "true")
    monkeypatch.setenv("WEBCMD_EVIDENCE_PATH", "/evidence")
    monkeypatch.setenv("OTHER_TOOL_EXPECTED_ANSWER", "answer")

    codex_webcmd_env = _child_env("codex", "webcmd")

    forbidden = {
        "GOOGLE_API_KEY",
        "JUDGE_MODEL",
        "DATASET_DECRYPTION_KEY",
        "RESULTS_DIR",
        "OPENAI_JUDGE_PROMPT",
        "CODEX_GROUND_TRUTH",
        "ANTHROPIC_PRIOR_VERDICT",
        "WEBCMD_EVIDENCE_PATH",
        "OTHER_TOOL_EXPECTED_ANSWER",
    }
    assert forbidden.isdisjoint(codex_webcmd_env)


def test_policy_allows_only_raw_webcmd_browser_commands():
    assert _policy_violation("webcmd", ["other-browser --session x state"], [])
    assert _policy_violation("webcmd", [], ["web_search"])
    assert not _policy_violation("webcmd", [f"{WEBCMD_BROWSER} tabs"], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd --version",
        "webcmd doctor",
        "webcmd list -f json",
        "webcmd plugin search stackexchange -f json",
        "webcmd web fetch --url https://example.com",
        "webcmd stackexchange search query",
        "webcmd --profile benchmark session list",
        "webcmd browser --help",
    ],
)
def test_policy_rejects_non_browser_webcmd_routes(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd plugin install github:example/plugin",
        "webcmd plugin update --all",
        "webcmd plugin uninstall example",
        "webcmd plugin create example",
        "webcmd external install gh",
        "webcmd external register arbitrary --binary arbitrary",
        "webcmd skills add --provider codex --scope user",
        "webcmd skills remove --provider codex --scope user",
        "webcmd skills update --provider codex --scope user",
        "webcmd adapter override youtube search ./replacement.js",
        "webcmd adapter reset youtube search",
        "webcmd browser init example/search",
    ],
)
def test_policy_rejects_shared_webcmd_installation_mutations(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "skill_file",
    [
        Path.home() / ".codex/skills/webcmd-browser/SKILL.md",
        Path.home() / ".codex/skills/webcmd-browser/references/browser-run-playwright.md",
        Path(
            "/opt/homebrew/lib/node_modules/@agentrhq/webcmd/skills/"
            "webcmd-browser/SKILL.md"
        ),
    ],
)
def test_policy_allows_codex_to_read_webcmd_browser_skill_and_references(skill_file):
    assert not _policy_violation(
        "webcmd", [f"sed -n '1,240p' {skill_file}"], []
    )


@pytest.mark.parametrize(
    "command",
    [
        "cat /etc/passwd",
        f"cat {Path.home()}/.codex/skills/agent-browser/SKILL.md",
        f"cat {Path.home()}/.codex/skills/webcmd-usage/SKILL.md",
        f"cat {Path.home()}/.codex/skills/smart-search/SKILL.md",
        f"cat {Path.home()}/.codex/skills/webcmd-browser-sitemap/SKILL.md",
        f"cat {Path.home()}/.codex/skills/webcmd-usage/SKILL.md /etc/passwd",
        f"sed -n '1,240p' {Path.home()}/.codex/skills/webcmd-usage/SKILL.md; curl https://example.com",
    ],
)
def test_policy_rejects_reads_outside_webcmd_skill_roots(command):
    assert _policy_violation("webcmd", [command], [])


def test_policy_allows_only_axi_invoked_through_npx():
    assert not _policy_violation("chrome-devtools-axi", ["npx -y chrome-devtools-axi open https://example.com"], [])
    assert not _policy_violation("chrome-devtools-axi", ["npx -y chrome-devtools-axi snapshot -i"], [])
    assert _policy_violation("chrome-devtools-axi", ["chrome-devtools-axi snapshot -i"], [])
    assert _policy_violation("chrome-devtools-axi", ["npx -y playwright open https://example.com"], [])


@pytest.mark.parametrize(
    "command",
    [
        "agent-browser open https://example.com",
        "agent-browser snapshot -i",
        "agent-browser click @e1",
        "agent-browser screenshot /tmp/step_001.png",
        "/usr/local/bin/agent-browser get url",
    ],
)
def test_policy_allows_one_direct_agent_browser_command(command):
    assert not _policy_violation("agent-browser", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "/bin/zsh -lc 'agent-browser skills get core'",
        "/bin/zsh -lc 'agent-browser snapshot -i'",
        "bash -lc 'agent-browser screenshot /tmp/step_001.png'",
        "sh -c 'agent-browser read'",
        "zsh -lc 'agent-browser read --filter heading'",
    ],
)
def test_policy_allows_controller_shell_wrapper_and_active_tab_read(command):
    assert not _policy_violation("agent-browser", [command], [])


def test_policy_allows_literal_dollar_that_is_not_shell_expansion():
    command = "/bin/zsh -lc 'agent-browser eval \"(() => ({key: [\"$\"]}))()\"'"

    assert not _policy_violation("agent-browser", [command], [])


def test_policy_does_not_treat_failed_unterminated_agent_browser_command_as_wrong_tool():
    failed_agent_command = (
        '/bin/zsh -lc "agent-browser open '
        "'https://www.google.com/search?q=unfinished\""
    )
    failed_wrong_tool = '/bin/zsh -lc "curl \'https://example.com"'

    assert not _policy_violation("agent-browser", [failed_agent_command], [])
    assert _policy_violation("agent-browser", [failed_wrong_tool], [])


@pytest.mark.parametrize(
    ("tool", "command"),
    [
        (
            "webcmd",
            "/bin/zsh -lc \"webcmd browser research open 'https://example.com\"",
        ),
        (
            "chrome-devtools-axi",
            "/bin/zsh -lc \"npx -y chrome-devtools-axi open 'https://example.com\"",
        ),
    ],
)
def test_policy_treats_unterminated_selected_tool_command_as_command_failure(tool, command):
    assert not _policy_violation(tool, [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "agent-browser batch '[\"open\",\"https://example.com\"]'",
        "agent-browser --cdp 9222 snapshot -i",
        "agent-browser --session other snapshot -i",
        "agent-browser --namespace other snapshot -i",
        "agent-browser --profile /tmp/shared open https://example.com",
        "agent-browser --executable-path /tmp/chrome open https://example.com",
        "agent-browser --auto-connect snapshot -i",
        "agent-browser close --all",
        "agent-browser read https://example.com",
        "npx agent-browser snapshot -i",
        "zsh -lc 'agent-browser --session other snapshot -i'",
        "zsh -lc 'agent-browser read https://example.com'",
        "zsh -lc 'agent-browser snapshot -i && agent-browser get url'",
        "zsh -lc 'curl https://example.com'",
        "agent-browser snapshot -i && agent-browser get url",
        "agent-browser snapshot -i > page.txt",
        "curl https://example.com",
    ],
)
def test_policy_rejects_agent_browser_batch_connection_overrides_and_shell_composition(command):
    assert _policy_violation("agent-browser", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "dev-browser <<'EOF'\n"
        'const page = await browser.getPage("main");\n'
        'await page.goto("https://example.com?a=1&b=2");\n'
        'console.log(`${await page.title()} $5`);\n'
        "EOF",
        '/bin/zsh -lc \'dev-browser <<\'"\'"\'SCRIPT\'"\'"\'\n'
        'const page = await browser.getPage("main");\n'
        'console.log(await page.locator("body").innerText());\n'
        "SCRIPT'",
        "bash -lc 'dev-browser --timeout 60 <<\"JS\"\n"
        'console.log(JSON.stringify(await browser.listPages()));\n'
        "JS'",
    ],
)
def test_policy_allows_dev_browser_quoted_heredoc_and_controller_shell_wrapper(
    command,
):
    assert not _policy_violation("dev-browser", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"/bin/zsh -lc \"sed -n '1,240p' {Path.home()}/.codex/skills/dev-browser/SKILL.md\"",
        f"/bin/zsh -lc 'cat {Path.home()}/.codex/skills/dev-browser/SKILL.md'",
    ],
)
def test_policy_allows_reading_only_the_installed_dev_browser_skill(command):
    assert not _policy_violation("dev-browser", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"cat {Path.home()}/.codex/skills/agent-browser/SKILL.md",
        f"cat {Path.home()}/.codex/skills/dev-browser/SKILL.md /etc/passwd",
        f"sed -n '1,240p' {Path.home()}/.codex/skills/dev-browser/SKILL.md; curl https://example.com",
        f"head {Path.home()}/.codex/skills/dev-browser/SKILL.md",
    ],
)
def test_policy_rejects_other_skill_reads_files_and_composed_commands(command):
    assert _policy_violation("dev-browser", [command], [])


@pytest.mark.parametrize(
    "tool",
    ["webcmd", "chrome-devtools-axi", "agent-browser"],
)
def test_dev_browser_skill_read_exception_does_not_change_other_tool_policies(tool):
    command = (
        f"/bin/zsh -lc \"sed -n '1,240p' "
        f"{Path.home()}/.codex/skills/dev-browser/SKILL.md\""
    )

    assert _policy_violation(tool, [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "dev-browser <<EOF\n$(curl https://example.com)\nEOF",
        "dev-browser <<'EOF'\nconsole.log('missing terminator');",
        "dev-browser --connect http://127.0.0.1:9222 <<'EOF'\nconsole.log(1);\nEOF",
        "dev-browser --browser other <<'EOF'\nconsole.log(1);\nEOF",
        "dev-browser --headless <<'EOF'\nconsole.log(1);\nEOF",
        "dev-browser run /tmp/script.js",
        "dev-browser stop",
        "dev-browser <<'EOF'\nconsole.log(1);\nEOF\ncurl https://example.com",
        "curl https://example.com",
    ],
)
def test_policy_rejects_dev_browser_connection_overrides_unsafe_heredocs_and_other_tools(
    command,
):
    assert _policy_violation("dev-browser", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "python -c 'import requests; requests.get(\"https://example.com\")'",
        "python3 -c 'from urllib.request import urlopen; urlopen(\"https://example.com\")'",
        "python -c 'from urllib import request; request.urlopen(\"https://example.com\")'",
        "python -c 'import http.client'",
        "uv run python -c 'import httpx; httpx.get(\"https://example.com\")'",
        "python -c 'import aiohttp'",
        "python -m httpie GET https://example.com",
        "http GET https://example.com",
        "https GET https://example.com",
        "xh get https://example.com",
    ],
)
def test_policy_scan_rejects_common_raw_http_commands(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser tabs",
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser snapshot --snapshot-mode read --max-output 20000",
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser snapshot --ref e42 --snapshot-mode act",
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser bind --page page-1",
    ],
)
def test_policy_scan_preserves_selected_browser_cli_commands(command):
    assert not _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser legacy-session tabs",
        f"webcmd --profile default --session {WEBCMD_SESSION} browser tabs",
        f"webcmd --profile benchmark browser tabs",
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser close",
        "webcmd --profile benchmark session create -f json",
        f"webcmd --profile benchmark session close {WEBCMD_SESSION}",
    ],
)
def test_policy_rejects_agent_owned_or_unpinned_webcmd_lifecycle(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser s open https://example.com",
        "webcmd browser s state",
        "webcmd browser s click ref",
        "webcmd browser s type ref value",
        "webcmd browser s screenshot out.png",
        "webcmd browser s wait 1000",
        "webcmd browser s eval 'document.title'",
        "webcmd browser s observe",
        "webcmd browser s tab list",
        "webcmd browser s snapshot --snapshot-mode scan",
        "webcmd browser s snapshot --max-output 0",
    ],
)
def test_policy_rejects_removed_webcmd_browser_primitives(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"webcmd --profile benchmark --session {WEBCMD_SESSION} browser run --stdin <<'JS'\n"
        "await page.goto('https://example.com');\n"
        "console.log(`${await page.title()} $5 ; && | > < $(not-shell)`);\n"
        "return page.url();\n"
        "JS",
        f"/bin/zsh -lc \"webcmd --profile benchmark --session {WEBCMD_SESSION} browser run --stdin <<'JS'\n"
        "return await page.title();\n"
        "JS\"",
    ],
)
def test_policy_allows_exact_webcmd_browser_run_quoted_heredoc(command):
    assert not _policy_violation("webcmd", [command], [])


def test_policy_allows_realistic_safe_webcmd_run_program():
    command = (
        f"/bin/zsh -lc \"{WEBCMD_BROWSER} run --stdin <<'JS'\n"
        "const title = await page.locator('h1').innerText();\n"
        "await page.screenshot({ path: 'shots/step.png' });\n"
        "console.log(title);\n"
        "return null;\n"
        "JS\""
    )

    assert not _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"{WEBCMD_BROWSER} run --stdin --timeout 30 --max-output 20000 <<'EOF'\n"
        "return await page.title();\n"
        "EOF",
        f"{WEBCMD_BROWSER} run --no-snapshot-diff --max-output 1 --timeout 1 --snapshot-mode act --stdin <<'JS'\n"
        "return page.url();\n"
        "JS",
        f"{WEBCMD_BROWSER} run --snapshot-mode tree --stdin <<'JS'\n"
        "return page.url();\n"
        "JS",
    ],
)
def test_policy_allows_supported_webcmd_browser_run_options(command):
    assert not _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser work run --stdin <<JS\nreturn 1;\nJS",
        "webcmd browser work run --stdin <<'JS'\nreturn 1;",
        "webcmd browser work run --file task.js <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --observe none <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --tab page-1 <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --timeout 0 <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --max-output -1 <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --unknown value <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --snapshot-diff <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --snapshot-mode read <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --snapshot-mode scan <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --no-snapshot-diff --no-snapshot-diff --stdin <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin --stdin <<'JS'\nreturn 1;\nJS",
        "webcmd browser work run --stdin <<'JS'\nreturn 1;\nJS\ncurl https://example.com",
        "curl https://example.com <<'JS'\nignored\nJS",
    ],
)
def test_policy_rejects_other_webcmd_heredocs(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize("mode", ["act", "tree", "read"])
def test_policy_allows_supported_webcmd_snapshot_modes(mode):
    assert not _policy_violation(
        "webcmd", [f"{WEBCMD_BROWSER} snapshot --snapshot-mode {mode}"], []
    )


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser session state; curl https://example.com",
        "webcmd browser session state | xh get https://example.com",
        "webcmd browser session state && other-browser --session other state",
        "webcmd browser session state || npx playwright open https://example.com",
    ],
)
def test_policy_scan_rejects_later_prohibited_executables_in_compound_commands(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser session state\ncurl https://example.com",
        "webcmd browser session state; (curl https://example.com)",
        "webcmd browser session type ref $(curl https://example.com)",
    ],
)
def test_policy_scan_rejects_forbidden_executables_in_newline_and_subshell_segments(command):
    assert _policy_violation("webcmd", [command], [])


def test_policy_scan_allows_quoted_newline_as_selected_cli_page_data():
    command = (
        f"{WEBCMD_BROWSER} run --stdin <<'JS'\n"
        "return 'page line one\\ncurl is documentation text';\n"
        "JS"
    )

    assert not _policy_violation("webcmd", [command], [])


def test_policy_scan_ignores_raw_http_names_in_command_output():
    event = {"type": "item.completed", "item": {"type": "command_execution", "command": f"{WEBCMD_BROWSER} tabs", "aggregated_output": "Documentation mentions curl, requests, and httpx"}}
    parsed = _parse_events("codex", [json.dumps(event)])

    assert not _policy_violation("webcmd", parsed.commands, parsed.event_types)


@pytest.mark.parametrize(
    "command",
    [
        "/usr/local/bin/webcmd browser session tabs",
        "./webcmd browser session tabs",
    ],
)
def test_strict_policy_rejects_webcmd_paths_that_bypass_pinned_path(command):
    assert _policy_violation("webcmd", [command], [])


def test_strict_policy_allows_bare_webcmd_from_pinned_path():
    assert not _policy_violation("webcmd", [f"{WEBCMD_BROWSER} tabs"], [])


@pytest.mark.parametrize(
    "command",
    [
        "webcmd browser --help tabs",
        "webcmd browser ../other close",
        "webcmd browser /tmp/other bind --page page-1",
    ],
)
def test_policy_rejects_invalid_webcmd_browser_sessions(command):
    assert _policy_violation("webcmd", [command], [])


def test_strict_policy_allows_quoted_selected_cli_page_data():
    command = (
        f"{WEBCMD_BROWSER} run --stdin <<'JS'\n"
        "return 'other-browser webcmd Playwright Puppeteer curl wget httpx https://example.com ; && | > < ( ) $(curl x) `curl x`\\nnext line';\n"
        "JS"
    )

    assert not _policy_violation("webcmd", [command], [])


def test_strict_policy_allows_multiple_direct_selected_cli_segments():
    command = f"{WEBCMD_BROWSER} tabs; {WEBCMD_BROWSER} tabs && {WEBCMD_BROWSER} tabs | {WEBCMD_BROWSER} tabs"

    assert not _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        f"/bin/zsh -lc '{WEBCMD_BROWSER} tabs'",
        f"bash -lc '{WEBCMD_BROWSER} bind --page page-1'",
    ],
)
def test_policy_allows_simple_shell_wrappers_around_selected_cli(command):
    assert not _policy_violation("webcmd", [command], [])


def test_policy_rejects_removed_webcmd_eval_in_shell_wrapper():
    command = "/bin/zsh -lc \"webcmd browser bench eval \\\"(() => ({x: document.querySelector('input[name=email]')?.value || null}))()\\\"\""

    assert _policy_violation("webcmd", [command], [])


def test_policy_rejects_unquoted_query_url_with_ampersand_in_shell_wrapper():
    command = "/bin/zsh -lc 'webcmd browser bench open https://example.com/search?a=1&b=2'"

    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "/bin/zsh -lc 'curl https://example.com'",
        "zsh -lc 'webcmd browser session state; curl https://example.com'",
        "bash -lc 'other-browser --session other state'",
        "sh -c 'webcmd browser session type ref $(curl https://example.com)'",
    ],
)
def test_policy_rejects_shell_wrappers_around_prohibited_commands(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "other-browser --session other state",
        "curl https://example.com",
        "python -c 'import requests'",
        "playwright open https://example.com",
        "puppeteer https://example.com",
        "echo webcmd browser session state",
        "mkdir screenshots",
    ],
)
def test_strict_policy_rejects_every_other_direct_executable(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "sudo -u user webcmd browser session state",
        "env -u TOKEN webcmd browser session state",
        "command webcmd browser session state",
        "pnpm exec webcmd browser session state",
        "npx webcmd browser session state",
        "uv run webcmd browser session state",
    ],
)
def test_strict_policy_rejects_wrapped_selected_cli(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    "command",
    [
        "TOKEN=value webcmd browser session state",
        "webcmd browser session state > output.txt",
        "webcmd browser session state 2> errors.txt",
        "webcmd browser session state\necho later",
        "(webcmd browser session state)",
        "webcmd browser session type ref $(echo value)",
        "webcmd browser session type ref `echo value`",
    ],
)
def test_strict_policy_fails_closed_on_shell_syntax_and_ambiguity(command):
    assert _policy_violation("webcmd", [command], [])


@pytest.mark.parametrize(
    ("tool", "prefix"),
    [
        ("webcmd", "webcmd stackexchange search"),
    ],
)
@pytest.mark.parametrize("value", ["$HOME", "${HOME}", '"$HOME"', "$?", "$$", "$((1 + 2))"])
def test_strict_policy_rejects_unescaped_shell_expansion_for_webcmd(tool, prefix, value):
    assert _policy_violation(tool, [f"{prefix} {value}"], [])


def test_controller_commands_are_noninteractive():
    codex, codex_input = _controller_command("codex", "gpt-5", "prompt")
    claude, claude_input = _controller_command("claude", "claude-sonnet-4-5", "prompt")
    pi, pi_input = _controller_command("pi", "openai/gpt-5.6-sol", "prompt")

    assert codex[:3] == ["codex", "exec", "--json"]
    assert "--ignore-user-config" in codex
    assert codex_input == b"prompt"
    assert claude[:2] == ["claude", "-p"]
    assert "--bare" in claude
    assert claude_input is None
    assert pi == [
        "node",
        str(run_controller.PI_CONTROLLER),
        "--model",
        "openai/gpt-5.6-sol",
        "--skill-path",
        str(WEBCMD_BROWSER_SKILL),
    ]
    assert run_controller.PI_CONTROLLER.is_absolute()
    assert pi_input == b"prompt"


def test_pi_dev_browser_command_mounts_only_the_dev_browser_skill():
    command, stdin = _controller_command(
        "pi", "openai/gpt-5.6-sol", "prompt", tool="dev-browser"
    )

    assert command == [
        "node",
        str(run_controller.PI_CONTROLLER),
        "--model",
        "openai/gpt-5.6-sol",
        "--tool",
        "dev-browser",
        "--skill-path",
        str(Path.home() / ".codex/skills/dev-browser"),
    ]
    assert str(WEBCMD_BROWSER_SKILL) not in command
    assert stdin == b"prompt"


def test_pi_libretto_command_uses_direct_tools_without_a_skill_path():
    command, stdin = _controller_command(
        "pi",
        "openai/gpt-5.6-sol",
        "prompt",
        tool="libretto",
        runtime_env={"LIBRETTO_CDP_URL": "http://127.0.0.1:43210"},
    )

    assert command == [
        "node",
        str(run_controller.PI_CONTROLLER),
        "--model",
        "openai/gpt-5.6-sol",
        "--tool",
        "libretto",
    ]
    assert "--skill-path" not in command
    assert stdin == b"prompt"


def test_codex_controller_command_applies_reasoning_effort_override():
    command, stdin = _controller_command("codex", "gpt-5.6-sol", "prompt", "high")

    override_index = command.index("-c")
    assert command[override_index + 1] == 'model_reasoning_effort="high"'
    assert command[-1] == "-"
    assert stdin == b"prompt"


def test_codex_controller_command_configures_task_private_turn_telemetry():
    command, stdin = _controller_command(
        "codex",
        "gpt-5.6-sol",
        "prompt",
        otel_endpoint="http://127.0.0.1:4318/v1/logs",
    )

    assert (
        'otel.exporter={otlp-http={endpoint="http://127.0.0.1:4318/v1/logs",protocol="json"}}'
        in command
    )
    assert stdin == b"prompt"


def test_codex_libretto_command_adds_only_task_local_mcp_configuration():
    baseline, _ = _controller_command("codex", "gpt-5", "prompt")
    command, stdin = _controller_command(
        "codex",
        "gpt-5",
        "prompt",
        tool="libretto",
        runtime_env={
            "LIBRETTO_CDP_URL": "http://127.0.0.1:43210",
        },
    )

    assert command[:4] == baseline[:4]
    assert str(run_controller.LIBRETTO_MCP) in "\n".join(command)
    assert 'mcp_servers.libretto.command="node"' in command
    assert "mcp_servers.libretto.required=true" in command
    assert (
        'mcp_servers.libretto.enabled_tools=["browser_open","browser_exec",'
        '"browser_snapshot","browser_status","browser_close"]'
    ) in command
    assert (
        'mcp_servers.libretto.env={LIBRETTO_CDP_URL="http://127.0.0.1:43210"}'
        in command
    )
    assert command[-5:] == baseline[-5:]
    assert stdin == b"prompt"


def test_pi_controller_command_applies_thinking_level():
    command, stdin = _controller_command(
        "pi", "openai/gpt-5.6-sol", "prompt", "low"
    )

    assert command[-2:] == ["--thinking", "low"]
    assert stdin == b"prompt"


def test_session_names_are_unique_for_same_basename_in_different_parents(tmp_path):
    first = run_controller._session_name(tmp_path / "one" / "attempt")
    second = run_controller._session_name(tmp_path / "two" / "attempt")

    assert first != second
    assert first.startswith("attempt-")
    assert len(first) <= 48
    assert all(character.islower() or character.isdigit() or character == "-" for character in first)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("FINAL ANSWER: 42", "42"),
        ("FINAL ANSWER:\t spaced answer  ", "spaced answer"),
        ("FINAL ANSWER:\n42", ""),
        ("FINAL ANSWER:   \n42", ""),
        ("FINAL ANSWER:   ", ""),
    ],
)
def test_final_answer_must_be_nonempty_on_the_same_physical_line(text, expected):
    assert _extract_final_answer(text) == expected


def test_ordinary_normalized_steps_are_capped_at_2000_characters():
    long = "x" * 3000
    codex = [
        long,
        json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": long}}),
        json.dumps({"type": "item.completed", "item": {"type": "web_search", "query": long}}),
        json.dumps({"type": long, "payload": long}),
    ]
    claude = [
        json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": long}},
            {"type": "tool_result", "content": long},
            {"type": "text", "text": long},
        ]}}),
        json.dumps({"type": "result", "result": long}),
        json.dumps({"type": long, "payload": long}),
    ]

    steps = _parse_events("codex", codex).steps + _parse_events("claude", claude).steps

    assert steps
    assert any(len(step) == 2000 for step in steps)
    assert all(len(step) <= 2000 for step in steps)


def test_codex_command_step_preserves_bounded_browser_output():
    command = "c" * 3000
    output = "o" * 7000 + "EVENT_TIME_8PM" + "z" * 2000
    events = [
        json.dumps(
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "command": command,
                    "aggregated_output": output,
                },
            }
        )
    ]

    step = _parse_events("codex", events).steps[0]

    assert "EVENT_TIME_8PM" in step
    assert step.count("[truncated]") == 2
    assert len(step) <= 10_020


def test_webcmd_screenshot_receipts_collect_only_current_task_artifacts(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    cache = home / ".webcmd" / "cache" / "browser-run"
    first = cache / "artifact_111111111111111111111111" / "shots" / "first.png"
    second = cache / "artifact_222222222222222222222222" / "shots" / "nested" / "second.png"
    unrelated = cache / "artifact_333333333333333333333333" / "shots" / "unrelated.png"
    for path, contents in ((first, b"first"), (second, b"second"), (unrelated, b"unrelated")):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
    receipts = {
        "error": {
            "code": "BROWSER_RUN_SERIALIZATION_ERROR",
            "details": {
                "artifacts": [
                    {
                        "locator": "browser-run://artifact_222222222222222222222222/shots%2Fnested%2Fsecond.png",
                    },
                    {
                        "locator": "browser-run://artifact_111111111111111111111111/shots%2Ffirst.png",
                    },
                    {
                        "locator": "browser-run://artifact_222222222222222222222222/shots%2Fnested%2Fsecond.png",
                    },
                ]
            },
        }
    }
    command_event = json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": f"{WEBCMD_BROWSER} run --stdin <<'JS'\nawait page.screenshot({{path:'shots/first.png'}});\nreturn null;\nJS", "aggregated_output": json.dumps(receipts)}})
    answer_event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}})
    script = (
        "import os; from pathlib import Path; "
        "Path('controller-path.txt').write_text(os.environ['PATH']); "
        "Path('shots/step_010.png').write_bytes(b'10'); "
        "Path('shots/step_002.png').write_bytes(b'2'); "
        f"print({command_event!r}); print({answer_event!r})"
    )
    marker = tmp_path / "cleanup.txt"
    attempt = tmp_path / "attempt"

    async def record_cleanup(tool, session, tool_env=None):
        assert tool_env == {"PATH": "/verified/bin:/original/bin"}
        marker.write_text(f"{tool}:{session}")

    _fake_controller(monkeypatch, script)
    monkeypatch.setattr(run_controller, "_close_session", record_cleanup)

    evidence = asyncio.run(
        execute_controller(
            "codex", "gpt-5", "webcmd", "task", attempt, 5,
            tool_env={"PATH": "/verified/bin:/original/bin"},
        )
    )

    assert evidence.termination == "completed"
    assert evidence.final_answer == "42"
    assert [path.name for path in evidence.screenshot_paths] == [
        "step_001.png",
        "step_002.png",
        "step_003.png",
        "step_010.png",
    ]
    assert [path.read_bytes() for path in evidence.screenshot_paths] == [
        b"second",
        b"2",
        b"first",
        b"10",
    ]
    assert (attempt / "controller-path.txt").read_text() == "/verified/bin:/original/bin"
    assert (attempt / "controller.jsonl").read_text() == f"{command_event}\n{answer_event}\n"
    assert marker.read_text() == f"webcmd:{WEBCMD_SESSION}"


@pytest.mark.parametrize(
    "locator",
    [
        "browser-run://artifact_444444444444444444444444/shots%2Fmissing.png",
        "browser-run://artifact_444444444444444444444444/%2E%2E%2Foutside.png",
    ],
)
def test_webcmd_screenshot_receipts_fail_instead_of_silently_losing_evidence(
    tmp_path, monkeypatch, locator
):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    command_event = json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "command_execution",
                "command": f"{WEBCMD_BROWSER} run --stdin <<'JS'\nawait page.screenshot({{path:'shots/missing.png'}});\nreturn null;\nJS",
                "aggregated_output": json.dumps(
                    {"ok": True, "artifacts": [{"locator": locator}]}
                ),
            },
        }
    )
    answer_event = json.dumps(
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"},
        }
    )
    _fake_controller(
        monkeypatch,
        f"print({command_event!r}); print({answer_event!r})",
    )

    async def close_session(*args, **kwargs):
        return None

    monkeypatch.setattr(run_controller, "_close_session", close_session)

    with pytest.raises((FileNotFoundError, ValueError)):
        asyncio.run(
            execute_controller(
                "codex",
                "gpt-5",
                "webcmd",
                "task",
                tmp_path / "attempt",
                5,
            )
        )


def test_codex_execution_collects_completed_model_responses(tmp_path, monkeypatch):
    payload = _otel_payload(
        _otel_log_record(
            ("event.name", "codex.sse_event"),
            ("event.kind", "response.completed"),
            ("input_token_count", "100"),
        )
    )
    answer_event = json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "FINAL ANSWER: 42",
            },
        }
    )

    def fake_command(*args, otel_endpoint=None, **kwargs):
        assert otel_endpoint is not None
        script = (
            "import json, urllib.request\n"
            f"payload = {payload!r}\n"
            "request = urllib.request.Request("
            f"{otel_endpoint!r}, data=json.dumps(payload).encode(), "
            "headers={'Content-Type': 'application/json'}, method='POST')\n"
            "urllib.request.urlopen(request).read()\n"
            f"print({answer_event!r})\n"
        )
        return [sys.executable, "-c", script], None

    monkeypatch.setattr(run_controller, "_controller_command", fake_command)
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(
        execute_controller(
            "codex",
            "gpt-5.6-sol",
            "webcmd",
            "task",
            tmp_path / "attempt",
            5,
        )
    )

    assert evidence.metrics.agent_turns == 1


def test_pi_execution_records_agent_turns_and_controller_cost(tmp_path, monkeypatch):
    usage_event = json.dumps(
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 20,
                    "cacheRead": 5,
                    "cacheWrite": 0,
                    "output": 4,
                    "totalTokens": 29,
                    "cost": {
                        "input": 0.02,
                        "output": 0.04,
                        "cacheRead": 0.001,
                        "cacheWrite": 0.0,
                        "total": 0.061,
                    },
                },
                "content": [
                    {"type": "text", "text": "FINAL ANSWER: 42"}
                ],
            },
        }
    )
    result_event = json.dumps(
        {
            "type": "result",
            "result": "FINAL ANSWER: 42",
            "duration_ms": 100,
        }
    )

    _fake_controller(
        monkeypatch, f"print({usage_event!r}); print({result_event!r})"
    )
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(
        execute_controller(
            "pi",
            "openai/gpt-5.6-sol",
            "webcmd",
            "task",
            tmp_path / "attempt",
            5,
        )
    )

    assert evidence.metrics.agent_turns == 1
    assert evidence.metrics.tokens.estimated_api_cost_usd == pytest.approx(0.061)


def test_axi_execution_passes_private_runtime_env_and_closes_runtime(tmp_path, monkeypatch):
    command_event = json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "npx -y chrome-devtools-axi snapshot -i", "aggregated_output": "page"}})
    answer_event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}})
    captured = {}

    class Runtime:
        env = {
            "CHROME_DEVTOOLS_AXI_BROWSER_URL": "http://127.0.0.1:43210",
            "CHROME_DEVTOOLS_AXI_SESSION": "task-session",
        }

        async def close(self):
            captured["closed"] = True

    async def fake_start(session, work_dir, base_env):
        captured["session"] = session
        return Runtime()

    original_create = asyncio.create_subprocess_exec

    async def create_process(*args, **kwargs):
        captured["controller_env"] = kwargs["env"]
        return await original_create(*args, **kwargs)

    _fake_controller(monkeypatch, f"print({command_event!r}); print({answer_event!r})")
    monkeypatch.setattr(run_controller, "start_axi_runtime", fake_start)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "chrome-devtools-axi", "task", tmp_path / "attempt", 5))

    assert evidence.termination == "completed"
    assert captured["controller_env"]["CHROME_DEVTOOLS_AXI_BROWSER_URL"] == "http://127.0.0.1:43210"
    assert captured["controller_env"]["CHROME_DEVTOOLS_AXI_SESSION"] == "task-session"
    assert captured["closed"] is True


def test_axi_runtime_closes_if_controller_process_cannot_start(tmp_path, monkeypatch):
    class Runtime:
        env = {}
        closed = False

        async def close(self):
            self.closed = True

    runtime = Runtime()

    async def fake_start(*args):
        return runtime

    async def fail_to_start(*args, **kwargs):
        raise RuntimeError("controller spawn failed")

    monkeypatch.setattr(run_controller, "start_axi_runtime", fake_start)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", fail_to_start)

    with pytest.raises(RuntimeError, match="controller spawn failed"):
        asyncio.run(execute_controller("codex", "gpt-5", "chrome-devtools-axi", "task", tmp_path / "attempt", 5))

    assert runtime.closed is True


def test_agent_browser_execution_passes_private_runtime_env_and_closes_runtime(tmp_path, monkeypatch):
    command_event = json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "agent-browser snapshot -i", "aggregated_output": "page"}})
    answer_event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}})
    captured = {}

    class Runtime:
        env = {
            "AGENT_BROWSER_CDP": "http://127.0.0.1:43210",
            "AGENT_BROWSER_SESSION": "task-session",
            "AGENT_BROWSER_NAMESPACE": "task-session",
        }

        async def close(self):
            captured["closed"] = True

    async def fake_start(session, work_dir, base_env):
        captured["session"] = session
        return Runtime()

    original_create = asyncio.create_subprocess_exec

    async def create_process(*args, **kwargs):
        captured["controller_env"] = kwargs["env"]
        return await original_create(*args, **kwargs)

    _fake_controller(monkeypatch, f"print({command_event!r}); print({answer_event!r})")
    monkeypatch.setattr(run_controller, "start_agent_browser_runtime", fake_start)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "agent-browser", "task", tmp_path / "attempt", 5))

    assert evidence.termination == "completed"
    assert captured["controller_env"]["AGENT_BROWSER_CDP"] == "http://127.0.0.1:43210"
    assert captured["controller_env"]["AGENT_BROWSER_SESSION"] == "task-session"
    assert captured["controller_env"]["AGENT_BROWSER_NAMESPACE"] == "task-session"
    assert captured["closed"] is True


def test_agent_browser_runtime_closes_if_controller_process_cannot_start(tmp_path, monkeypatch):
    class Runtime:
        env = {}
        closed = False

        async def close(self):
            self.closed = True

    runtime = Runtime()

    async def fake_start(*args):
        return runtime

    async def fail_to_start(*args, **kwargs):
        raise RuntimeError("controller spawn failed")

    monkeypatch.setattr(run_controller, "start_agent_browser_runtime", fake_start)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", fail_to_start)

    with pytest.raises(RuntimeError, match="controller spawn failed"):
        asyncio.run(execute_controller("codex", "gpt-5", "agent-browser", "task", tmp_path / "attempt", 5))

    assert runtime.closed is True


def test_dev_browser_execution_passes_task_private_path_and_closes_runtime(
    tmp_path, monkeypatch
):
    command = "dev-browser <<'EOF'\nconsole.log(1);\nEOF"
    command_event = json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "command_execution",
                "command": command,
                "aggregated_output": "1",
            },
        }
    )
    answer_event = json.dumps(
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"},
        }
    )
    captured = {}

    class Runtime:
        env = {"PATH": "/task/dev-browser-bin:/bin"}

        async def close(self):
            captured["closed"] = True

    async def fake_start(session, work_dir, base_env):
        captured["session"] = session
        return Runtime()

    original_create = asyncio.create_subprocess_exec

    async def create_process(*args, **kwargs):
        captured["controller_env"] = kwargs["env"]
        return await original_create(*args, **kwargs)

    _fake_controller(
        monkeypatch, f"print({command_event!r}); print({answer_event!r})"
    )
    monkeypatch.setattr(run_controller, "start_dev_browser_runtime", fake_start)
    monkeypatch.setattr(
        run_controller.asyncio, "create_subprocess_exec", create_process
    )

    evidence = asyncio.run(
        execute_controller(
            "codex", "gpt-5", "dev-browser", "task", tmp_path / "attempt", 5
        )
    )

    assert evidence.termination == "completed"
    assert captured["controller_env"]["PATH"] == "/task/dev-browser-bin:/bin"
    assert captured["closed"] is True


def test_dev_browser_runtime_closes_if_controller_process_cannot_start(
    tmp_path, monkeypatch
):
    class Runtime:
        env = {}
        closed = False

        async def close(self):
            self.closed = True

    runtime = Runtime()

    async def fake_start(*args):
        return runtime

    async def fail_to_start(*args, **kwargs):
        raise RuntimeError("controller spawn failed")

    monkeypatch.setattr(run_controller, "start_dev_browser_runtime", fake_start)
    monkeypatch.setattr(
        run_controller.asyncio, "create_subprocess_exec", fail_to_start
    )

    with pytest.raises(RuntimeError, match="controller spawn failed"):
        asyncio.run(
            execute_controller(
                "codex", "gpt-5", "dev-browser", "task", tmp_path / "attempt", 5
            )
        )

    assert runtime.closed is True


def test_libretto_execution_collects_mcp_snapshot_and_closes_runtime(
    tmp_path, monkeypatch
):
    png = b"\x89PNG\r\nruntime"
    tool_event = json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "mcp_tool_call",
                "server": "libretto",
                "tool": "browser_snapshot",
                "arguments": {
                    "sessionId": "ses-1",
                    "screenshot": True,
                },
                "result": {
                    "content": [
                        {
                            "type": "image",
                            "data": base64.b64encode(png).decode(),
                            "mimeType": "image/png",
                        }
                    ]
                },
            },
        }
    )
    answer_event = json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "FINAL ANSWER: 42",
            },
        }
    )
    captured = {}

    class Runtime:
        env = {"LIBRETTO_CDP_URL": "http://127.0.0.1:43210"}

        async def close(self):
            captured["closed"] = True

    async def fake_start(session, work_dir, base_env):
        captured["session"] = session
        return Runtime()

    original_create = asyncio.create_subprocess_exec

    async def create_process(*args, **kwargs):
        captured["controller_env"] = kwargs["env"]
        return await original_create(*args, **kwargs)

    _fake_controller(
        monkeypatch, f"print({tool_event!r}); print({answer_event!r})"
    )
    monkeypatch.setattr(
        run_controller, "start_libretto_runtime", fake_start
    )
    monkeypatch.setattr(
        run_controller.asyncio, "create_subprocess_exec", create_process
    )

    evidence = asyncio.run(
        execute_controller(
            "codex",
            "gpt-5",
            "libretto",
            "task",
            tmp_path / "attempt",
            5,
        )
    )

    assert evidence.termination == "completed"
    assert evidence.metrics.tool_calls == 1
    assert evidence.metrics.steps == 2
    assert evidence.screenshot_paths[0].read_bytes() == png
    assert evidence.screenshot_paths[0].name == "step_001.png"
    assert (
        captured["controller_env"]["LIBRETTO_CDP_URL"]
        == "http://127.0.0.1:43210"
    )
    assert captured["closed"] is True


def test_libretto_runtime_closes_if_controller_process_cannot_start(
    tmp_path, monkeypatch
):
    class Runtime:
        env = {"LIBRETTO_CDP_URL": "http://127.0.0.1:43210"}
        closed = False

        async def close(self):
            self.closed = True

    runtime = Runtime()

    async def fake_start(*args):
        return runtime

    async def fail_to_start(*args, **kwargs):
        raise RuntimeError("controller spawn failed")

    monkeypatch.setattr(
        run_controller, "start_libretto_runtime", fake_start
    )
    monkeypatch.setattr(
        run_controller.asyncio, "create_subprocess_exec", fail_to_start
    )

    with pytest.raises(RuntimeError, match="controller spawn failed"):
        asyncio.run(
            execute_controller(
                "codex",
                "gpt-5",
                "libretto",
                "task",
                tmp_path / "attempt",
                5,
            )
        )

    assert runtime.closed is True


def test_timeout_is_a_scored_controller_termination(tmp_path, monkeypatch):
    _fake_controller(monkeypatch, "import time; time.sleep(10)")
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 0.02))

    assert evidence.termination == "timeout"
    assert evidence.controller_exit_code != 0


def test_timeout_kills_pipe_holding_descendants_in_new_process_session(tmp_path, monkeypatch):
    script = (
        "import subprocess, sys, time; "
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']); "
        "time.sleep(10)"
    )
    original_create = asyncio.create_subprocess_exec
    captured = {}

    async def create_process(*args, **kwargs):
        captured.update(kwargs)
        return await original_create(*args, **kwargs)

    _fake_controller(monkeypatch, script)
    monkeypatch.setattr(run_controller, "_close_session", _no_close)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    started = time.monotonic()

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 0.02))

    assert evidence.termination == "timeout"
    assert time.monotonic() - started < 2
    assert captured["start_new_session"] is True


def test_timeout_bounds_failed_pipe_drain_and_still_waits_to_reap(tmp_path, monkeypatch):
    class Process:
        returncode = -9

        def __init__(self):
            self.killed = False
            self.wait_calls = 0

        def kill(self):
            self.killed = True

        def communicate(self, stdin=None):
            async def result():
                return b"", b""
            return result()

        async def wait(self):
            self.wait_calls += 1
            return self.returncode

    process = Process()
    wait_for_calls = 0

    async def create_process(*args, **kwargs):
        return process

    async def timeout_twice(awaitable, timeout):
        nonlocal wait_for_calls
        wait_for_calls += 1
        if wait_for_calls <= 2:
            awaitable.close()
            raise asyncio.TimeoutError
        return await awaitable

    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(run_controller.asyncio, "wait_for", timeout_twice)
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 1))

    assert evidence.termination == "timeout"
    assert process.killed
    assert process.wait_calls == 1
    assert wait_for_calls == 3


def test_cancellation_kills_and_reaps_pipe_holding_process_group_then_reraises(tmp_path, monkeypatch):
    script = (
        "import subprocess, sys, time; from pathlib import Path; "
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']); "
        "Path('spawned').write_text('ready'); time.sleep(10)"
    )
    original_create = asyncio.create_subprocess_exec
    captured = {}
    closed = []

    async def create_process(*args, **kwargs):
        process = await original_create(*args, **kwargs)
        captured["process"] = process
        return process

    async def record_close(*args):
        closed.append(args)

    async def scenario():
        attempt = tmp_path / "attempt"
        task = asyncio.create_task(execute_controller("codex", "gpt-5", "webcmd", "task", attempt, 30))
        deadline = time.monotonic() + 2
        while not (attempt / "spawned").exists() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert (attempt / "spawned").exists()

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        process = captured["process"]
        deadline = time.monotonic() + 1
        group_gone = False
        while time.monotonic() < deadline:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                group_gone = True
                break
            await asyncio.sleep(0.01)
        if not group_gone:
            os.killpg(process.pid, signal.SIGKILL)
            await asyncio.wait_for(process.wait(), timeout=1)
        assert group_gone
        assert process.returncode is not None

    _fake_controller(monkeypatch, script)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(run_controller, "_close_session", record_close)

    asyncio.run(scenario())

    assert len(closed) == 1


def test_communication_exception_kills_reaps_closes_and_reraises_original(tmp_path, monkeypatch):
    class CommunicationAbort(BaseException):
        pass

    class Process:
        returncode = -9

        def __init__(self):
            self.killed = False
            self.communicate_calls = 0
            self.wait_calls = 0

        def kill(self):
            self.killed = True

        async def communicate(self, stdin=None):
            self.communicate_calls += 1
            raise CommunicationAbort("communication failed")

        async def wait(self):
            self.wait_calls += 1
            return self.returncode

    process = Process()
    closed = []

    async def create_process(*args, **kwargs):
        return process

    async def record_close(*args):
        closed.append(args)

    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(run_controller, "_close_session", record_close)

    with pytest.raises(CommunicationAbort, match="communication failed"):
        asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 30))

    assert process.killed
    assert process.wait_calls == 1
    assert len(closed) == 1


def test_repeated_cancellation_finishes_close_once_and_preserves_original_cancellation(tmp_path, monkeypatch):
    script = (
        "import subprocess, sys, time; from pathlib import Path; "
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']); "
        "Path('spawned').write_text('ready'); time.sleep(10)"
    )
    original_create = asyncio.create_subprocess_exec
    captured = {}
    close_started = asyncio.Event()
    allow_close = asyncio.Event()
    close_calls = 0
    close_finishes = 0

    async def create_process(*args, **kwargs):
        process = await original_create(*args, **kwargs)
        captured["process"] = process
        return process

    async def blocking_close(*args):
        nonlocal close_calls, close_finishes
        close_calls += 1
        close_started.set()
        await allow_close.wait()
        close_finishes += 1

    async def scenario():
        attempt = tmp_path / "attempt"
        task = asyncio.create_task(execute_controller("codex", "gpt-5", "webcmd", "task", attempt, 30))
        deadline = time.monotonic() + 2
        while not (attempt / "spawned").exists() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert (attempt / "spawned").exists()

        task.cancel("original cancellation")
        await asyncio.wait_for(close_started.wait(), timeout=2)
        task.cancel("second cancellation")
        await asyncio.sleep(0)
        allow_close.set()
        with pytest.raises(asyncio.CancelledError) as cancelled:
            await task

        process = captured["process"]
        deadline = time.monotonic() + 1
        group_gone = False
        while time.monotonic() < deadline:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                group_gone = True
                break
            await asyncio.sleep(0.01)
        if not group_gone:
            os.killpg(process.pid, signal.SIGKILL)
            await asyncio.wait_for(process.wait(), timeout=1)
        assert cancelled.value.args == ("original cancellation",)
        assert group_gone
        assert process.returncode is not None

    _fake_controller(monkeypatch, script)
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(run_controller, "_close_session", blocking_close)

    asyncio.run(scenario())

    assert close_calls == 1
    assert close_finishes == 1


def test_cancellation_first_arriving_during_normal_close_finishes_close_then_propagates(tmp_path, monkeypatch):
    event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}})
    close_started = asyncio.Event()
    allow_close = asyncio.Event()
    close_finishes = 0

    async def blocking_close(*args):
        nonlocal close_finishes
        close_started.set()
        await allow_close.wait()
        close_finishes += 1

    async def scenario():
        task = asyncio.create_task(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 5))
        await asyncio.wait_for(close_started.wait(), timeout=2)
        task.cancel("close cancellation")
        await asyncio.sleep(0)
        allow_close.set()
        with pytest.raises(asyncio.CancelledError) as cancelled:
            await task
        assert cancelled.value.args == ("close cancellation",)

    _fake_controller(monkeypatch, f"print({event!r})")
    monkeypatch.setattr(run_controller, "_close_session", blocking_close)

    asyncio.run(scenario())

    assert close_finishes == 1


def test_nonzero_exit_precedes_valid_final_answer(tmp_path, monkeypatch):
    event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FINAL ANSWER: 42"}})
    _fake_controller(monkeypatch, f"print({event!r}); raise SystemExit(7)")
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 5))

    assert evidence.termination == "controller_error"
    assert evidence.controller_exit_code == 7


def test_controller_error_precedes_raw_http_policy_violation(tmp_path, monkeypatch):
    event = json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "python -c 'import requests'", "aggregated_output": "failed"}})
    _fake_controller(monkeypatch, f"print({event!r}); raise SystemExit(7)")
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 5))

    assert evidence.termination == "controller_error"


def test_policy_violation_precedes_missing_final_answer(tmp_path, monkeypatch):
    event = json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "other-browser --session x state", "aggregated_output": "page"}})
    _fake_controller(monkeypatch, f"print({event!r})")
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 5))

    assert evidence.termination == "tool_policy_violation"
    assert evidence.final_answer == ""


def test_missing_final_answer_is_a_scored_controller_termination(tmp_path, monkeypatch):
    event = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "finished"}})
    _fake_controller(monkeypatch, f"print({event!r})")
    monkeypatch.setattr(run_controller, "_close_session", _no_close)

    evidence = asyncio.run(execute_controller("codex", "gpt-5", "webcmd", "task", tmp_path / "attempt", 5))

    assert isinstance(evidence, ExecutionEvidence)
    assert evidence.termination == "missing_final_answer"
    assert evidence.controller_exit_code == 0


def test_close_session_kills_and_reaps_a_timed_out_close_process(monkeypatch):
    class Process:
        def __init__(self):
            self.killed = False
            self.wait_calls = 0

        def kill(self):
            self.killed = True

        async def wait(self):
            self.wait_calls += 1

    process = Process()
    wait_for_calls = 0
    captured = {}

    async def create_process(*args, **kwargs):
        captured["args"] = args
        captured.update(kwargs)
        return process

    async def timeout(awaitable, timeout):
        nonlocal wait_for_calls
        wait_for_calls += 1
        if wait_for_calls == 1:
            awaitable.close()
            raise asyncio.TimeoutError
        return await awaitable

    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(run_controller.asyncio, "wait_for", timeout)

    asyncio.run(run_controller._close_session("webcmd", WEBCMD_SESSION))

    assert process.killed
    assert process.wait_calls == 1
    assert wait_for_calls == 2
    assert captured["start_new_session"] is True
    assert captured["args"] == (
        "webcmd",
        "--profile",
        "benchmark",
        "session",
        "close",
        WEBCMD_SESSION,
        "--force",
        "-f",
        "json",
    )


def test_close_session_uses_only_selected_tool_environment(monkeypatch):
    class Process:
        async def wait(self):
            return 0

    captured = {}

    async def create_process(*args, **kwargs):
        captured.update(kwargs)
        return Process()

    monkeypatch.setenv("PATH", "/bin")
    monkeypatch.setenv("GOOGLE_API_KEY", "judge-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "controller-secret")
    monkeypatch.setenv("WEBCMD_API_KEY", "selected-tool-secret")
    monkeypatch.setenv("BROWSER_USE_API_KEY", "competing-tool-secret")
    monkeypatch.setenv("DATABASE_URL", "unrelated-secret")
    monkeypatch.setattr(run_controller.asyncio, "create_subprocess_exec", create_process)

    asyncio.run(
        run_controller._close_session(
            "webcmd", WEBCMD_SESSION, {"PATH": "/verified/bin:/original/bin"}
        )
    )

    assert captured["env"]["WEBCMD_API_KEY"] == "selected-tool-secret"
    assert captured["env"]["PATH"] == "/verified/bin:/original/bin"
    assert {"GOOGLE_API_KEY", "OPENAI_API_KEY", "BROWSER_USE_API_KEY", "DATABASE_URL"}.isdisjoint(captured["env"])
