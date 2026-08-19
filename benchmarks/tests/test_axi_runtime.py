import asyncio
import json
from pathlib import Path

import axi_runtime


def test_find_cloak_package_accepts_explicit_package_directory(tmp_path, monkeypatch):
    package = tmp_path / "cloakbrowser"
    package.mkdir()
    (package / "package.json").write_text(json.dumps({"name": "cloakbrowser", "version": "0.4.5"}))
    monkeypatch.setenv("BROWSER_BENCH_CLOAK_PACKAGE", str(package))

    assert axi_runtime.find_cloak_package() == package


def test_axi_runtime_wires_unique_cloak_profile_to_axi_and_cleans_up(tmp_path, monkeypatch):
    calls = []

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env))
        return 43210

    async def fake_axi(arguments, env):
        calls.append(("axi", arguments, env.copy()))

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(axi_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(axi_runtime, "_run_axi", fake_axi)
    monkeypatch.setattr(axi_runtime, "_terminate_profile", fake_terminate)

    runtime = asyncio.run(axi_runtime.start_axi_runtime("task-session", tmp_path, {"PATH": "/bin"}))

    profile = tmp_path / "cloak-profile"
    assert runtime.env == {
        "CHROME_DEVTOOLS_AXI_BROWSER_URL": "http://127.0.0.1:43210",
        "CHROME_DEVTOOLS_AXI_SESSION": "task-session",
    }
    assert calls[0][:2] == ("launch", profile)
    assert calls[1][0:2] == ("axi", ["start"])
    assert calls[1][2]["CHROME_DEVTOOLS_AXI_BROWSER_URL"] == "http://127.0.0.1:43210"

    asyncio.run(runtime.close())

    assert calls[-2][0:2] == ("axi", ["stop"])
    assert calls[-1] == ("terminate", profile)


def test_axi_runtime_terminates_cloak_if_bridge_start_fails(tmp_path, monkeypatch):
    terminated = []

    async def fake_launch(profile_dir, env):
        return 43210

    async def failing_axi(arguments, env):
        raise RuntimeError("bridge failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(axi_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(axi_runtime, "_run_axi", failing_axi)
    monkeypatch.setattr(axi_runtime, "_terminate_profile", fake_terminate)

    try:
        asyncio.run(axi_runtime.start_axi_runtime("task-session", tmp_path, {"PATH": "/bin"}))
    except RuntimeError as error:
        assert str(error) == "bridge failed"
    else:
        raise AssertionError("expected bridge startup to fail")

    assert terminated == [tmp_path / "cloak-profile"]
