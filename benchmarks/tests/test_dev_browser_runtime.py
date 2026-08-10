import asyncio
import json
from pathlib import Path

import pytest

import dev_browser_runtime


def test_dev_browser_version_reads_package_for_resolved_executable(
    tmp_path, monkeypatch
):
    package = tmp_path / "lib" / "node_modules" / "dev-browser"
    executable = package / "bin" / "dev-browser.js"
    executable.parent.mkdir(parents=True)
    executable.write_text("")
    (package / "package.json").write_text(
        json.dumps({"name": "dev-browser", "version": "0.2.9"})
    )
    monkeypatch.setattr(
        dev_browser_runtime.shutil,
        "which",
        lambda command, path=None: str(executable),
    )

    assert dev_browser_runtime.dev_browser_version({"PATH": "/bin"}) == "0.2.9"


def test_runtime_pins_unique_cloak_connection_collects_screenshots_and_cleans_once(
    tmp_path, monkeypatch
):
    calls = []
    tool_tmp = tmp_path / "dev-browser-tmp"
    tool_tmp.mkdir()
    unrelated = tool_tmp / "other-task-step_001.png"
    unrelated.write_bytes(b"other")

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env.copy()))
        return 43210

    async def fake_run(executable, arguments, script, env):
        calls.append(("dev-browser", executable, arguments, script, env.copy()))

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(dev_browser_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(dev_browser_runtime, "_run_dev_browser", fake_run)
    monkeypatch.setattr(dev_browser_runtime, "_terminate_profile", fake_terminate)
    monkeypatch.setattr(
        dev_browser_runtime, "_find_dev_browser", lambda env: Path("/opt/dev-browser")
    )
    monkeypatch.setattr(
        dev_browser_runtime, "_dev_browser_tmp_dir", lambda: tool_tmp
    )

    runtime = asyncio.run(
        dev_browser_runtime.start_dev_browser_runtime(
            "task-session", tmp_path, {"PATH": "/bin"}
        )
    )

    profile = tmp_path / "cloak-profile"
    shim = tmp_path / "dev-browser-bin" / "dev-browser"
    assert calls[0][:2] == ("launch", profile)
    assert calls[1][0:4] == (
        "dev-browser",
        Path("/opt/dev-browser"),
        [
            "--browser",
            "task-session",
            "--connect",
            "http://127.0.0.1:43210",
        ],
        'console.log(JSON.stringify(await browser.listPages()));',
    )
    assert runtime.env["PATH"].split(":", 1)[0] == str(shim.parent)
    assert shim.stat().st_mode & 0o111
    shim_text = shim.read_text()
    assert "/opt/dev-browser" in shim_text
    assert "http://127.0.0.1:43210" in shim_text
    assert "task-session" in shim_text

    (tool_tmp / "task-session-step_002.png").write_bytes(b"two")
    (tool_tmp / "task-session-step_001.png").write_bytes(b"one")
    asyncio.run(runtime.close())
    asyncio.run(runtime.close())

    assert (tmp_path / "shots" / "step_001.png").read_bytes() == b"one"
    assert (tmp_path / "shots" / "step_002.png").read_bytes() == b"two"
    assert unrelated.read_bytes() == b"other"
    assert not list(tool_tmp.glob("task-session-*"))
    assert [call[0] for call in calls].count("dev-browser") == 2
    assert calls[-1] == ("terminate", profile)


def test_runtime_terminates_cloak_if_dev_browser_prewarm_fails(
    tmp_path, monkeypatch
):
    terminated = []

    async def fake_launch(profile_dir, env):
        return 43210

    async def failing_run(*args):
        raise RuntimeError("dev-browser failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(dev_browser_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(dev_browser_runtime, "_run_dev_browser", failing_run)
    monkeypatch.setattr(dev_browser_runtime, "_terminate_profile", fake_terminate)
    monkeypatch.setattr(
        dev_browser_runtime, "_find_dev_browser", lambda env: Path("/opt/dev-browser")
    )

    with pytest.raises(RuntimeError, match="dev-browser failed"):
        asyncio.run(
            dev_browser_runtime.start_dev_browser_runtime(
                "task-session", tmp_path, {"PATH": "/bin"}
            )
        )

    assert terminated == [tmp_path / "cloak-profile"]
