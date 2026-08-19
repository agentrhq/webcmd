#!/usr/bin/env python3
import asyncio
from dataclasses import dataclass
from pathlib import Path

from axi_runtime import STARTUP_TIMEOUT_SECONDS, _launch_cloak, _terminate_profile


AGENT_BROWSER_COMMAND = ("agent-browser",)


async def _run_agent_browser(arguments: list[str], env: dict[str, str]) -> None:
    process = await asyncio.create_subprocess_exec(
        *AGENT_BROWSER_COMMAND,
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
        raise RuntimeError(f"agent-browser {' '.join(arguments)} timed out")
    if process.returncode:
        message = stderr.decode(errors="replace").strip()
        raise RuntimeError(
            f"agent-browser {' '.join(arguments)} failed: {message}"
        )


@dataclass
class AgentBrowserRuntime:
    env: dict[str, str]
    profile_dir: Path
    process_env: dict[str, str]
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await _run_agent_browser(["close"], self.process_env)
        except Exception:
            pass
        finally:
            await _terminate_profile(self.profile_dir)


async def start_agent_browser_runtime(
    session: str, work_dir: Path, base_env: dict[str, str]
) -> AgentBrowserRuntime:
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    process_env = None
    try:
        port = await _launch_cloak(profile_dir, base_env)
        overrides = {
            "AGENT_BROWSER_CDP": f"http://127.0.0.1:{port}",
            "AGENT_BROWSER_SESSION": session,
            "AGENT_BROWSER_NAMESPACE": session,
        }
        process_env = {**base_env, **overrides}
        await _run_agent_browser(["open"], process_env)
    except BaseException:
        if process_env is not None:
            try:
                await _run_agent_browser(["close"], process_env)
            except Exception:
                pass
        await _terminate_profile(profile_dir)
        raise
    return AgentBrowserRuntime(
        env=overrides,
        profile_dir=profile_dir,
        process_env=process_env,
    )
