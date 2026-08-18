#!/usr/bin/env python3
import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


AXI_COMMAND = ("npx", "-y", "chrome-devtools-axi")
STARTUP_TIMEOUT_SECONDS = 60


def find_cloak_package() -> Path:
    """Locate the private benchmark harness's legacy CloakBrowser package."""
    override = os.environ.get("BROWSER_BENCH_CLOAK_PACKAGE")
    if override:
        candidates = [Path(override).expanduser()]
    else:
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("npm is required to locate the legacy benchmark CloakBrowser")
        result = subprocess.run(
            [npm, "root", "-g"],
            text=True,
            capture_output=True,
            timeout=15,
        )
        if result.returncode:
            raise RuntimeError(f"could not locate global Node modules: {result.stderr.strip()}")
        root = Path(result.stdout.strip())
        candidates = [
            root / "cloakbrowser",
            root / "@agentrhq" / "webcmd" / "node_modules" / "cloakbrowser",
        ]
    for candidate in candidates:
        package_json = candidate / "package.json"
        if not package_json.is_file():
            continue
        try:
            package = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if package.get("name") == "cloakbrowser":
            return candidate.resolve()
    raise RuntimeError(
        "Legacy benchmark CloakBrowser was not found. Install it globally, keep Webcmd installed, "
        "or set BROWSER_BENCH_CLOAK_PACKAGE to its package directory."
    )


def cloakbrowser_version() -> str:
    package = json.loads((find_cloak_package() / "package.json").read_text(encoding="utf-8"))
    return str(package["version"])


async def _launch_options(profile_dir: Path, env: dict[str, str]) -> dict:
    entry = find_cloak_package() / "dist" / "index.js"
    script = (
        "import {pathToFileURL} from 'node:url';"
        "const mod=await import(pathToFileURL(process.argv[1]).href);"
        "const options=await mod.buildLaunchOptions({headless:false,userDataDir:process.argv[2]});"
        "process.stdout.write(JSON.stringify(options));"
    )
    process = await asyncio.create_subprocess_exec(
        "node",
        "--input-type=module",
        "-e",
        script,
        str(entry),
        str(profile_dir),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=STARTUP_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("timed out resolving legacy benchmark CloakBrowser launch options")
    if process.returncode:
        raise RuntimeError(f"Legacy benchmark CloakBrowser launch configuration failed: {stderr.decode(errors='replace').strip()}")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Legacy benchmark CloakBrowser returned invalid launch configuration") from error


async def _wait_for_devtools_port(profile_dir: Path) -> int:
    port_file = profile_dir / "DevToolsActivePort"
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            port = int(port_file.read_text(encoding="utf-8").splitlines()[0])
            if port > 0:
                return port
        except (FileNotFoundError, IndexError, ValueError):
            pass
        await asyncio.sleep(0.05)
    raise RuntimeError("timed out waiting for legacy benchmark CloakBrowser's CDP endpoint")


async def _launch_cloak(profile_dir: Path, env: dict[str, str]) -> int:
    options = await _launch_options(profile_dir, env)
    executable = Path(str(options.get("executablePath") or ""))
    if not executable.is_file():
        raise RuntimeError(f"Legacy benchmark CloakBrowser executable is missing: {executable}")
    arguments = [
        *map(str, options.get("args") or []),
        "--password-store=basic",
        "--use-mock-keychain",
        f"--user-data-dir={profile_dir}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "about:blank",
    ]
    if sys.platform == "darwin":
        marker = "/Contents/MacOS/"
        executable_text = str(executable)
        if marker not in executable_text:
            raise RuntimeError("Legacy benchmark CloakBrowser executable is not inside a macOS app bundle")
        app_path = executable_text.split(marker, 1)[0]
        command = ["/usr/bin/open", "-g", "-n", app_path, "--args", *arguments]
    else:
        command = [str(executable), *arguments]
    process = await asyncio.create_subprocess_exec(
        *command,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    _, stderr = await process.communicate()
    if process.returncode:
        raise RuntimeError(f"Legacy benchmark CloakBrowser failed to launch: {stderr.decode(errors='replace').strip()}")
    return await _wait_for_devtools_port(profile_dir)


async def _run_axi(arguments: list[str], env: dict[str, str]) -> None:
    process = await asyncio.create_subprocess_exec(
        *AXI_COMMAND,
        *arguments,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=STARTUP_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError(f"AXI {' '.join(arguments)} timed out")
    if process.returncode:
        raise RuntimeError(f"AXI {' '.join(arguments)} failed: {stderr.decode(errors='replace').strip()}")


async def _profile_pids(profile_dir: Path) -> list[int]:
    process = await asyncio.create_subprocess_exec(
        "/bin/ps",
        "-axo",
        "pid=,command=",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await process.communicate()
    needle = f"--user-data-dir={profile_dir}"
    pids = []
    for line in stdout.decode(errors="replace").splitlines():
        if needle not in line:
            continue
        try:
            pid = int(line.strip().split(maxsplit=1)[0])
        except (IndexError, ValueError):
            continue
        if pid != os.getpid():
            pids.append(pid)
    return pids


async def _terminate_profile(profile_dir: Path) -> None:
    pids = await _profile_pids(profile_dir)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    remaining = pids
    while remaining and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
        live = set(await _profile_pids(profile_dir))
        remaining = [pid for pid in remaining if pid in live]
    for pid in remaining:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


@dataclass
class AxiRuntime:
    env: dict[str, str]
    profile_dir: Path
    process_env: dict[str, str]
    closed: bool = False

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await _run_axi(["stop"], self.process_env)
        except Exception:
            pass
        finally:
            await _terminate_profile(self.profile_dir)


async def start_axi_runtime(session: str, work_dir: Path, base_env: dict[str, str]) -> AxiRuntime:
    profile_dir = work_dir / "cloak-profile"
    profile_dir.mkdir()
    try:
        port = await _launch_cloak(profile_dir, base_env)
        overrides = {
            "CHROME_DEVTOOLS_AXI_BROWSER_URL": f"http://127.0.0.1:{port}",
            "CHROME_DEVTOOLS_AXI_SESSION": session,
        }
        process_env = {**base_env, **overrides}
        await _run_axi(["start"], process_env)
    except BaseException:
        await _terminate_profile(profile_dir)
        raise
    return AxiRuntime(env=overrides, profile_dir=profile_dir, process_env=process_env)
