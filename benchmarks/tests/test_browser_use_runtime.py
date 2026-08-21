import asyncio

import browser_use_runtime
import pytest


import asyncio

import browser_use_runtime
import pytest


def test_runtime_wires_dedicated_cloak_and_isolated_home_then_cleans_once(
    tmp_path, monkeypatch
):
    calls = []

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env.copy()))
        return 43210

    async def fake_reload(arguments, env):
        calls.append(("reload", arguments, env.copy()))

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(browser_use_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(browser_use_runtime, "_run_browser_use", fake_reload)
    monkeypatch.setattr(browser_use_runtime, "_terminate_profile", fake_terminate)

    runtime = asyncio.run(
        browser_use_runtime.start_browser_use_runtime(
            "task-session", tmp_path, {"PATH": "/bin"}
        )
    )

    profile = tmp_path / "cloak-profile"
    home = browser_use_runtime.browser_use_runtime_home("task-session")
    runtime_dir = home / "run"
    sock = runtime_dir / "bu.sock"
    assert runtime.env == {
        "BU_CDP_URL": "http://127.0.0.1:43210",
        "BU_NAME": "task-session",
        "BH_HOME": str(home),
        "BH_RUNTIME_DIR": str(runtime_dir),
        "BH_RECORD": "0",
    }
    assert str(home).startswith("/tmp/wbu-")
    assert len(str(sock)) < 104
    assert home.is_dir()
    assert runtime_dir.is_dir()
    assert calls == [("launch", profile, {"PATH": "/bin"})]
    assert "BROWSER_USE_API_KEY" not in runtime.env
    assert runtime.env["BH_HOME"] != str(tmp_path / "browser-use-home")

    asyncio.run(runtime.close())
    asyncio.run(runtime.close())

    assert calls[1][0:2] == ("reload", ["--reload"])
    assert calls[1][2]["BU_CDP_URL"] == "http://127.0.0.1:43210"
    assert calls[1][2]["BH_HOME"] == str(home)
    assert calls[-1] == ("terminate", profile)
    assert [call[0] for call in calls].count("terminate") == 1
    assert not home.exists()


def test_runtime_terminates_cloak_if_launch_fails(tmp_path, monkeypatch):
    terminated = []

    async def failing_launch(profile_dir, env):
        raise RuntimeError("cloak failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(browser_use_runtime, "_launch_cloak", failing_launch)
    monkeypatch.setattr(browser_use_runtime, "_terminate_profile", fake_terminate)

    with pytest.raises(RuntimeError, match="cloak failed"):
        asyncio.run(
            browser_use_runtime.start_browser_use_runtime(
                "task-session", tmp_path, {"PATH": "/bin"}
            )
        )

    assert terminated == [tmp_path / "cloak-profile"]
