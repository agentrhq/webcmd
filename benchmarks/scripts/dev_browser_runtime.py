#!/usr/bin/env python3
import asyncio
import json
import shlex
import shutil
from dataclasses import dataclass
from pathlib import Path

from axi_runtime import STARTUP_TIMEOUT_SECONDS, _launch_cloak, _terminate_profile


DEV_BROWSER_COMMAND = ("dev-browser",)
PREWARM_SCRIPT = 'console.log(JSON.stringify(await browser.listPages()));'
CLOSE_PAGES_SCRIPT = """const pages = await browser.listPages();
for (const page of pages) {
  if (page.name) await browser.closePage(page.name);
}"""


def _find_dev_browser(env: dict[str, str]) -> Path:
    executable = shutil.which(DEV_BROWSER_COMMAND[0], path=env.get("PATH"))
    if not executable:
        raise RuntimeError(
            "dev-browser was not found. Install it with: npm install -g dev-browser"
        )
    return Path(executable).resolve()


def dev_browser_version(env: dict[str, str]) -> str:
    executable = _find_dev_browser(env)
    for directory in executable.parents:
        package_json = directory / "package.json"
        if not package_json.is_file():
            continue
        try:
            package = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if package.get("name") == "dev-browser" and package.get("version"):
            return str(package["version"])
    raise RuntimeError(
        f"could not determine dev-browser version from executable: {executable}"
    )


def _dev_browser_tmp_dir() -> Path:
    return Path.home() / ".dev-browser" / "tmp"


async def _run_dev_browser(
    executable: Path,
    arguments: list[str],
    script: str,
    env: dict[str, str],
) -> None:
    process = await asyncio.create_subprocess_exec(
        str(executable),
        *arguments,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(script.encode()), timeout=STARTUP_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("dev-browser timed out")
    if process.returncode:
        message = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"dev-browser failed: {message}")


def _write_shim(
    path: Path, executable: Path, session: str, connect_url: str
) -> None:
    command = " ".join(
        shlex.quote(value)
        for value in (
            str(executable),
            "--browser",
            session,
            "--connect",
            connect_url,
        )
    )
    path.write_text(f'#!/bin/sh\nexec {command} "$@"\n', encoding="utf-8")
    path.chmod(0o700)


def _collect_screenshots(session: str, shots_dir: Path) -> None:
    source_dir = _dev_browser_tmp_dir()
    if not source_dir.is_dir():
        return
    prefix = f"{session}-"
    for source in sorted(source_dir.glob(f"{session}-step_*.png")):
        destination = shots_dir / source.name.removeprefix(prefix)
        shutil.copy2(source, destination)
        source.unlink()


@dataclass
class DevBrowserRuntime:
    env: dict[str, str]
    profile_dir: Path
    executable: Path
    arguments: list[str]
    process_env: dict[str, str]
    session: str
    shots_dir: Path
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await _run_dev_browser(
                self.executable,
                self.arguments,
                CLOSE_PAGES_SCRIPT,
                self.process_env,
            )
        except Exception:
            pass
        finally:
            try:
                _collect_screenshots(self.session, self.shots_dir)
            finally:
                await _terminate_profile(self.profile_dir)


async def start_dev_browser_runtime(
    session: str, work_dir: Path, base_env: dict[str, str]
) -> DevBrowserRuntime:
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    shots_dir = work_dir / "shots"
    shots_dir.mkdir(exist_ok=True)
    executable = _find_dev_browser(base_env)
    try:
        port = await _launch_cloak(profile_dir, base_env)
        connect_url = f"http://127.0.0.1:{port}"
        arguments = [
            "--browser",
            session,
            "--connect",
            connect_url,
        ]
        await _run_dev_browser(
            executable,
            arguments,
            PREWARM_SCRIPT,
            base_env,
        )
        shim_dir = work_dir / "dev-browser-bin"
        shim_dir.mkdir()
        _write_shim(shim_dir / "dev-browser", executable, session, connect_url)
    except BaseException:
        await _terminate_profile(profile_dir)
        raise
    return DevBrowserRuntime(
        env={"PATH": f"{shim_dir}:{base_env.get('PATH', '')}"},
        profile_dir=profile_dir,
        executable=executable,
        arguments=arguments,
        process_env=base_env,
        session=session,
        shots_dir=shots_dir,
    )
