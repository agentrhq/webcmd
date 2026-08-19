#!/usr/bin/env python3
from dataclasses import dataclass
from pathlib import Path

from axi_runtime import _launch_cloak, _terminate_profile


@dataclass
class LibrettoRuntime:
    env: dict[str, str]
    profile_dir: Path
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        await _terminate_profile(self.profile_dir)


async def start_libretto_runtime(
    session: str, work_dir: Path, base_env: dict[str, str]
) -> LibrettoRuntime:
    del session
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    try:
        port = await _launch_cloak(profile_dir, base_env)
    except BaseException:
        await _terminate_profile(profile_dir)
        raise
    return LibrettoRuntime(
        env={"LIBRETTO_CDP_URL": f"http://127.0.0.1:{port}"},
        profile_dir=profile_dir,
    )
