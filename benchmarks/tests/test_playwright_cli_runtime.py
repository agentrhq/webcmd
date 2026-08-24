import asyncio
import json

import pytest

import playwright_cli_runtime


def test_runtime_attaches_to_cloak_then_detaches_on_close(tmp_path, monkeypatch):
    calls = []

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env.copy()))
        return 43210

    async def fake_playwright(arguments, env, cwd=None):
        calls.append(("playwright-cli", arguments, env.copy(), cwd))

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(playwright_cli_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(playwright_cli_runtime, "_run_playwright_cli", fake_playwright)
    monkeypatch.setattr(playwright_cli_runtime, "_terminate_profile", fake_terminate)

    runtime = asyncio.run(
        playwright_cli_runtime.start_playwright_cli_runtime(
            "task-session", tmp_path, {"PATH": "/bin"}
        )
    )

    profile = tmp_path / "cloak-profile"
    assert runtime.env == {
        "PLAYWRIGHT_CLI_SESSION": "task-session",
        "PLAYWRIGHT_CLI_CDP": "http://127.0.0.1:43210",
    }
    assert calls[0][:2] == ("launch", profile)
    assert calls[1][0:2] == (
        "playwright-cli",
        ["attach", "--cdp=http://127.0.0.1:43210"],
    )
    assert calls[1][2]["PLAYWRIGHT_CLI_SESSION"] == "task-session"
    assert calls[1][3] == tmp_path
    assert json.loads((tmp_path / ".playwright" / "cli.config.json").read_text()) == {
        "cdpEndpoint": "http://127.0.0.1:43210",
        "outputDir": str((tmp_path / ".playwright-cli").resolve()),
    }

    asyncio.run(runtime.close())
    asyncio.run(runtime.close())

    assert [call[:2] for call in calls if call[0] == "playwright-cli"] == [
        ("playwright-cli", ["attach", "--cdp=http://127.0.0.1:43210"]),
        ("playwright-cli", ["detach"]),
    ]
    assert calls[-1] == ("terminate", profile)


def test_runtime_terminates_cloak_if_attach_fails(tmp_path, monkeypatch):
    terminated = []
    commands = []

    async def fake_launch(profile_dir, env):
        return 43210

    async def failing_playwright(arguments, env, cwd=None):
        commands.append(arguments)
        raise RuntimeError("playwright-cli failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(playwright_cli_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(playwright_cli_runtime, "_run_playwright_cli", failing_playwright)
    monkeypatch.setattr(playwright_cli_runtime, "_terminate_profile", fake_terminate)

    with pytest.raises(RuntimeError, match="playwright-cli failed"):
        asyncio.run(
            playwright_cli_runtime.start_playwright_cli_runtime(
                "task-session", tmp_path, {"PATH": "/bin"}
            )
        )

    assert commands == [["attach", "--cdp=http://127.0.0.1:43210"], ["detach"]]
    assert terminated == [tmp_path / "cloak-profile"]
