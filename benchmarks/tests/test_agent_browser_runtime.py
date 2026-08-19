import asyncio

import pytest

import agent_browser_runtime


def test_runtime_wires_unique_cloak_profile_and_private_session_then_cleans_up_once(tmp_path, monkeypatch):
    calls = []

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env.copy()))
        return 43210

    async def fake_agent_browser(arguments, env):
        calls.append(("agent-browser", arguments, env.copy()))

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(agent_browser_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(agent_browser_runtime, "_run_agent_browser", fake_agent_browser)
    monkeypatch.setattr(agent_browser_runtime, "_terminate_profile", fake_terminate)

    runtime = asyncio.run(
        agent_browser_runtime.start_agent_browser_runtime(
            "task-session", tmp_path, {"PATH": "/bin"}
        )
    )

    profile = tmp_path / "cloak-profile"
    assert runtime.env == {
        "AGENT_BROWSER_CDP": "http://127.0.0.1:43210",
        "AGENT_BROWSER_SESSION": "task-session",
        "AGENT_BROWSER_NAMESPACE": "task-session",
    }
    assert calls[0][:2] == ("launch", profile)
    assert calls[1][0:2] == ("agent-browser", ["open"])
    assert calls[1][2]["AGENT_BROWSER_CDP"] == "http://127.0.0.1:43210"

    asyncio.run(runtime.close())
    asyncio.run(runtime.close())

    assert [call[:2] for call in calls if call[0] == "agent-browser"] == [
        ("agent-browser", ["open"]),
        ("agent-browser", ["close"]),
    ]
    assert calls[-1] == ("terminate", profile)


def test_runtime_terminates_cloak_if_agent_browser_prewarm_fails(tmp_path, monkeypatch):
    terminated = []
    commands = []

    async def fake_launch(profile_dir, env):
        return 43210

    async def failing_agent_browser(arguments, env):
        commands.append(arguments)
        raise RuntimeError("agent-browser failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(agent_browser_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(agent_browser_runtime, "_run_agent_browser", failing_agent_browser)
    monkeypatch.setattr(agent_browser_runtime, "_terminate_profile", fake_terminate)

    with pytest.raises(RuntimeError, match="agent-browser failed"):
        asyncio.run(
            agent_browser_runtime.start_agent_browser_runtime(
                "task-session", tmp_path, {"PATH": "/bin"}
            )
        )

    assert commands == [["open"], ["close"]]
    assert terminated == [tmp_path / "cloak-profile"]
