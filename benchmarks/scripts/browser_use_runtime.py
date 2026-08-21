#!/usr/bin/env python3
import asyncio
import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path

from axi_runtime import STARTUP_TIMEOUT_SECONDS, _launch_cloak, _terminate_profile


BROWSER_USE_COMMAND = ("browser-use",)
MACOS_AF_UNIX_MAX = 104


def browser_use_runtime_home(session: str) -> Path:
    digest = hashlib.sha256(session.encode()).hexdigest()[:10]
    return Path("/tmp") / f"wbu-{digest}"


async def _run_browser_use(arguments: list[str], env: dict[str, str]) -> None:
    process = await asyncio.create_subprocess_exec(
        *BROWSER_USE_COMMAND,
        *arguments,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(), timeout=STARTUP_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("browser-use timed out")
    if process.returncode:
        message = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"browser-use failed: {message}")


@dataclass
class BrowserUseRuntime:
    env: dict[str, str]
    profile_dir: Path
    process_env: dict[str, str]
    home: Path
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await _run_browser_use(["--reload"], self.process_env)
        except Exception:
            pass
        finally:
            try:
                shutil.rmtree(self.home, ignore_errors=True)
            finally:
                await _terminate_profile(self.profile_dir)


async def start_browser_use_runtime(
    session: str, work_dir: Path, base_env: dict[str, str]
) -> BrowserUseRuntime:
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    home = browser_use_runtime_home(session)
    runtime_dir = home / "run"
    try:
        port = await _launch_cloak(profile_dir, base_env)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        sock = runtime_dir / "bu.sock"
        if len(str(sock)) >= MACOS_AF_UNIX_MAX:
            raise RuntimeError(
                f"browser-use AF_UNIX path is too long ({len(str(sock))}): {sock}"
            )
        overrides = {
            "BU_CDP_URL": f"http://127.0.0.1:{port}",
            "BU_NAME": session,
            "BH_HOME": str(home),
            "BH_RUNTIME_DIR": str(runtime_dir),
            "BH_RECORD": "0",
        }
        process_env = {**base_env, **overrides}
    except BaseException:
        shutil.rmtree(home, ignore_errors=True)
        await _terminate_profile(profile_dir)
        raise
    return BrowserUseRuntime(
        env=overrides,
        profile_dir=profile_dir,
        process_env=process_env,
        home=home,
    )
