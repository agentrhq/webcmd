#!/usr/bin/env python3
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

from axi_runtime import STARTUP_TIMEOUT_SECONDS, _launch_cloak, _terminate_profile


PLAYWRIGHT_CLI_COMMAND = ("playwright-cli",)


async def _run_playwright_cli(
    arguments: list[str], env: dict[str, str], cwd: Path
) -> None:
    process = await asyncio.create_subprocess_exec(
        *PLAYWRIGHT_CLI_COMMAND,
        *arguments,
        cwd=cwd,
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
        raise RuntimeError(f"playwright-cli {' '.join(arguments)} timed out")
    if process.returncode:
        message = stderr.decode(errors="replace").strip()
        raise RuntimeError(
            f"playwright-cli {' '.join(arguments)} failed: {message}"
        )


@dataclass
class PlaywrightCliRuntime:
    env: dict[str, str]
    profile_dir: Path
    process_env: dict[str, str]
    work_dir: Path
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await _run_playwright_cli(["detach"], self.process_env, self.work_dir)
        except Exception:
            pass
        finally:
            await _terminate_profile(self.profile_dir)


def _write_cli_config(work_dir: Path, cdp: str) -> None:
    config_dir = work_dir / ".playwright"
    config_dir.mkdir(exist_ok=True)
    output_dir = work_dir / ".playwright-cli"
    output_dir.mkdir(exist_ok=True)
    (config_dir / "cli.config.json").write_text(
        json.dumps({"cdpEndpoint": cdp, "outputDir": str(output_dir.resolve())})
        + "\n",
        encoding="utf-8",
    )


async def start_playwright_cli_runtime(
    session: str, work_dir: Path, base_env: dict[str, str]
) -> PlaywrightCliRuntime:
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    process_env = None
    try:
        port = await _launch_cloak(profile_dir, base_env)
        cdp = f"http://127.0.0.1:{port}"
        _write_cli_config(work_dir, cdp)
        overrides = {
            "PLAYWRIGHT_CLI_SESSION": session,
            "PLAYWRIGHT_CLI_CDP": cdp,
        }
        process_env = {**base_env, **overrides}
        await _run_playwright_cli(
            ["attach", f"--cdp={cdp}"], process_env, work_dir
        )
    except BaseException:
        if process_env is not None:
            try:
                await _run_playwright_cli(["detach"], process_env, work_dir)
            except Exception:
                pass
        await _terminate_profile(profile_dir)
        raise
    return PlaywrightCliRuntime(
        env=overrides,
        profile_dir=profile_dir,
        process_env=process_env,
        work_dir=work_dir,
    )
