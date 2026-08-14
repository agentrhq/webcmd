import asyncio
import json
import os
import shlex
import subprocess
from urllib.parse import quote
from urllib.request import Request, urlopen

import pytest

from agent_browser_runtime import start_agent_browser_runtime
from axi_runtime import _profile_pids, start_axi_runtime
from dev_browser_runtime import start_dev_browser_runtime
from libretto_runtime import start_libretto_runtime
from run_controller import (
    _close_session,
    _create_webcmd_session,
    _pin_webcmd_env,
    _subprocess_env,
)


ENABLED = {
    value.strip()
    for value in os.environ.get("BROWSER_BENCH_LIVE_COMPETITORS", "").split(",")
    if value.strip()
}
RUNTIMES = {
    "chrome-devtools-axi": start_axi_runtime,
    "agent-browser": start_agent_browser_runtime,
    "dev-browser": start_dev_browser_runtime,
    "libretto": start_libretto_runtime,
}
PROCESS_MARKERS = {
    "chrome-devtools-axi": ("chrome-devtools-axi", "chrome-devtools-mcp"),
    "agent-browser": ("agent-browser",),
    "dev-browser": ("dev-browser",),
    "libretto": ("libretto_mcp.mjs",),
}


def _cdp_json(endpoint: str, path: str, method: str = "GET"):
    with urlopen(Request(f"{endpoint}{path}", method=method), timeout=10) as response:
        return json.load(response)


def _endpoint(tool: str, runtime) -> str:
    if tool == "chrome-devtools-axi":
        return runtime.env["CHROME_DEVTOOLS_AXI_BROWSER_URL"]
    if tool == "agent-browser":
        return runtime.env["AGENT_BROWSER_CDP"]
    if tool == "dev-browser":
        return runtime.arguments[runtime.arguments.index("--connect") + 1]
    return runtime.env["LIBRETTO_CDP_URL"]


def _namespace(tool: str, runtime) -> str:
    if tool == "chrome-devtools-axi":
        return runtime.env["CHROME_DEVTOOLS_AXI_SESSION"]
    if tool == "agent-browser":
        assert runtime.env["AGENT_BROWSER_NAMESPACE"] == runtime.env["AGENT_BROWSER_SESSION"]
        return runtime.env["AGENT_BROWSER_SESSION"]
    if tool == "dev-browser":
        return runtime.arguments[runtime.arguments.index("--browser") + 1]
    return _endpoint(tool, runtime)


def _tool_processes(tool: str) -> dict[int, str]:
    output = subprocess.run(
        ["/bin/ps", "-axo", "pid=,command="],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    markers = PROCESS_MARKERS[tool]
    return {
        int(line.strip().split(maxsplit=1)[0]): line
        for line in output.splitlines()
        if any(marker in line for marker in markers)
        and not (tool == "dev-browser" and ".dev-browser/daemon.mjs" in line)
    }


async def _run_webcmd_login_shell(
    env: dict[str, str], session: str, marker: str
) -> dict:
    command = (
        "webcmd --profile benchmark --session "
        f"{shlex.quote(session)} browser run --stdin"
    )
    shell = env.get("SHELL") or (
        "/bin/zsh" if os.path.isfile("/bin/zsh") else "/bin/sh"
    )
    process = await asyncio.create_subprocess_exec(
        shell,
        "-lc",
        command,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    url = f"data:text/html,<title>{marker}</title>"
    program = (
        f"await page.goto({json.dumps(url)});"
        " return {urls: context.pages().map(page => page.url())};"
    )
    stdout, stderr = await process.communicate(program.encode())
    if process.returncode:
        raise AssertionError(
            f"webcmd failed ({process.returncode}): "
            f"{stderr.decode(errors='replace') or stdout.decode(errors='replace')}"
        )
    return json.loads(stdout)


def test_two_live_webcmd_login_shells_are_isolated_and_cleaned_up(tmp_path):
    if "all" not in ENABLED and "webcmd" not in ENABLED:
        pytest.skip(
            "set BROWSER_BENCH_LIVE_COMPETITORS=webcmd to run this live gate"
        )

    async def exercise():
        work_dirs = [tmp_path / "first", tmp_path / "second"]
        for work_dir in work_dirs:
            work_dir.mkdir()
        envs = await asyncio.gather(
            *(
                asyncio.to_thread(
                    _pin_webcmd_env, _subprocess_env(tool="webcmd"), work_dir
                )
                for work_dir in work_dirs
            )
        )
        outcomes = await asyncio.gather(
            *(_create_webcmd_session(env) for env in envs), return_exceptions=True
        )
        successes = [
            (outcome, envs[index])
            for index, outcome in enumerate(outcomes)
            if not isinstance(outcome, BaseException)
        ]
        failures = [
            outcome for outcome in outcomes if isinstance(outcome, BaseException)
        ]
        if failures:
            await asyncio.gather(
                *(
                    _close_session("webcmd", session, env)
                    for session, env in successes
                )
            )
            raise failures[0]

        sessions = [session for session, _ in successes]
        markers = ["webcmd-one", "webcmd-two"]
        try:
            assert sessions[0] != sessions[1]
            results = await asyncio.gather(
                *(
                    _run_webcmd_login_shell(env, session, marker)
                    for env, session, marker in zip(
                        envs, sessions, markers, strict=True
                    )
                )
            )
        finally:
            await asyncio.gather(
                *(
                    _close_session("webcmd", session, env)
                    for session, env in zip(sessions, envs, strict=True)
                )
            )

        urls = [result["result"]["urls"] for result in results]
        assert any(markers[0] in url for url in urls[0])
        assert not any(markers[1] in url for url in urls[0])
        assert any(markers[1] in url for url in urls[1])
        assert not any(markers[0] in url for url in urls[1])

    asyncio.run(exercise())


@pytest.mark.parametrize("tool", RUNTIMES)
def test_two_live_competitor_runtimes_are_isolated_and_cleaned_up(tool, tmp_path):
    if "all" not in ENABLED and tool not in ENABLED:
        pytest.skip(
            f"set BROWSER_BENCH_LIVE_COMPETITORS={tool} to run this live gate"
        )

    async def exercise():
        original_tool_processes = _tool_processes(tool)
        work_dirs = [tmp_path / "first", tmp_path / "second"]
        for work_dir in work_dirs:
            work_dir.mkdir()
        start = RUNTIMES[tool]
        outcomes = await asyncio.gather(
            start("competitor-one", work_dirs[0], _subprocess_env(tool=tool)),
            start("competitor-two", work_dirs[1], _subprocess_env(tool=tool)),
            return_exceptions=True,
        )
        runtimes = [outcome for outcome in outcomes if not isinstance(outcome, BaseException)]
        failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
        if failures:
            await asyncio.gather(*(runtime.close() for runtime in runtimes))
            raise failures[0]
        endpoints = [_endpoint(tool, runtime) for runtime in runtimes]
        try:
            assert endpoints[0] != endpoints[1]
            assert _namespace(tool, runtimes[0]) != _namespace(tool, runtimes[1])
            assert all(
                await asyncio.gather(
                    *(_profile_pids(runtime.profile_dir) for runtime in runtimes)
                )
            )

            markers = ["competitor-one", "competitor-two"]
            await asyncio.gather(
                *(
                    asyncio.to_thread(
                        _cdp_json,
                        endpoint,
                        f"/json/new?{quote(f'data:text/html,<title>{marker}</title>', safe='')}",
                        "PUT",
                    )
                    for endpoint, marker in zip(endpoints, markers, strict=True)
                )
            )
            pages = await asyncio.gather(
                *(asyncio.to_thread(_cdp_json, endpoint, "/json/list") for endpoint in endpoints)
            )
            urls = [[page["url"] for page in listing] for listing in pages]
            assert any(markers[0] in url for url in urls[0])
            assert not any(markers[1] in url for url in urls[0])
            assert any(markers[1] in url for url in urls[1])
            assert not any(markers[0] in url for url in urls[1])
        finally:
            await asyncio.gather(*(runtime.close() for runtime in runtimes))

        assert not any(
            await asyncio.gather(
                *(_profile_pids(runtime.profile_dir) for runtime in runtimes)
            )
        )
        await asyncio.sleep(0.25)
        leaked = _tool_processes(tool).keys() - original_tool_processes.keys()
        assert not leaked

    asyncio.run(exercise())
