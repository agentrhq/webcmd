import asyncio

import libretto_runtime
import pytest


def test_libretto_runtime_wires_dedicated_cloak_and_cleans_up_once(
    tmp_path, monkeypatch
):
    calls = []

    async def fake_launch(profile_dir, env):
        calls.append(("launch", profile_dir, env))
        return 43210

    async def fake_terminate(profile_dir):
        calls.append(("terminate", profile_dir))

    monkeypatch.setattr(libretto_runtime, "_launch_cloak", fake_launch)
    monkeypatch.setattr(libretto_runtime, "_terminate_profile", fake_terminate)

    runtime = asyncio.run(
        libretto_runtime.start_libretto_runtime(
            "task-session", tmp_path, {"PATH": "/bin"}
        )
    )

    profile = tmp_path / "cloak-profile"
    assert runtime.env == {
        "LIBRETTO_CDP_URL": "http://127.0.0.1:43210",
    }
    assert calls == [("launch", profile, {"PATH": "/bin"})]

    asyncio.run(runtime.close())
    asyncio.run(runtime.close())

    assert calls[-1] == ("terminate", profile)
    assert calls.count(("terminate", profile)) == 1


def test_libretto_runtime_terminates_profile_when_launch_fails(
    tmp_path, monkeypatch
):
    terminated = []

    async def failing_launch(profile_dir, env):
        raise RuntimeError("cloak failed")

    async def fake_terminate(profile_dir):
        terminated.append(profile_dir)

    monkeypatch.setattr(libretto_runtime, "_launch_cloak", failing_launch)
    monkeypatch.setattr(libretto_runtime, "_terminate_profile", fake_terminate)

    with pytest.raises(RuntimeError, match="cloak failed"):
        asyncio.run(
            libretto_runtime.start_libretto_runtime(
                "task-session", tmp_path, {"PATH": "/bin"}
            )
        )

    assert terminated == [tmp_path / "cloak-profile"]
