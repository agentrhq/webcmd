# Browser Agent Benchmark Comparison

5 agents · 99 tasks each · 5 categories · accuracy, speed & token efficiency

## Summary table

| Agent | Accuracy | Avg time/task | Total time | Total tokens | Tokens/correct | Steps | Tool calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| **dev-browser** | **75.8%** | 162.1s | 267 min | **4.49M** | **59.8K** | 1,710 | 1,504 |
| **libretto** | 73.7% | 141.9s | 234 min | 6.10M | 83.6K | **1,452** | **1,249** |
| **webcmd** | 70.7% | 188.8s | 312 min | 7.11M | 101.6K | 2,936 | 2,709 |
| **agent-browser** | 63.6% | 151.9s | 251 min | 6.39M | 101.4K | 2,815 | 2,614 |
| **chrome-devtools-axi** | 62.6% | **136.6s** | **225 min** | 6.10M | 95.3K | 2,317 | 2,116 |

**Best in class:** accuracy → dev-browser · speed → chrome-devtools-axi · tokens → dev-browser · efficiency → dev-browser · fewest steps → libretto

## Overall accuracy (% of 99 passed)

```
dev-browser          ███████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░  75.8%
libretto             █████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░  73.7%
webcmd               ██████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░  70.7%
agent-browser        █████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  63.6%
chrome-devtools-axi  ████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  62.6%
```

## Avg time per task (seconds — lower is better)

```
chrome-devtools-axi  ██████████████████████████████████████████████░░░░░░░░░░  136.6s  ← fastest
libretto             ████████████████████████████████████████████████░░░░░░░░  141.9s
agent-browser        ███████████████████████████████████████████████████░░░░░  151.9s
dev-browser          ██████████████████████████████████████████████████████░░  162.1s
webcmd               ████████████████████████████████████████████████████████████████  188.8s
```

## Total tokens (millions — lower is better)

```
dev-browser          ████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  4.49M  ← leanest
chrome-devtools-axi  ██████████████████████████████████████████████████████░░░░░░░░░░  6.10M
libretto             ██████████████████████████████████████████████████████░░░░░░░░░░  6.10M
agent-browser        █████████████████████████████████████████████████████████░░░░░░  6.39M
webcmd               ████████████████████████████████████████████████████████████████  7.11M
```

## Tokens per correct answer (lower = more efficient)

```
dev-browser          █████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  59.8K  ← best
libretto             ████████████████████████████████████████████████████░░░░░░░░░░░░  83.6K
chrome-devtools-axi  ████████████████████████████████████████████████████████████░░░░  95.3K
agent-browser        ███████████████████████████████████████████████████████████████░  101.4K
webcmd               ████████████████████████████████████████████████████████████████  101.6K
```

## Accuracy by category (% pass rate)

| Category | webcmd | chrome-devtools-axi | agent-browser | dev-browser | libretto |
|---|---:|---:|---:|---:|---:|
| BrowseComp | 75% | 80% | 75% | **90%** | 80% |
| GAIA | 55% | 35% | **65%** | 60% | 40% |
| InteractionTests | **100%** | 84.2% | 84.2% | 89.5% | **100%** |
| OM2W2 | 65% | 60% | 45% | **80%** | 70% |
| WebBenchREAD | 60% | 55% | 50% | 60% | **80%** |

## Steps & tool calls (total actions)

| Agent | Steps | Tool calls |
|---|---:|---:|
| libretto | 1,452 | 1,249 |
| dev-browser | 1,710 | 1,504 |
| chrome-devtools-axi | 2,317 | 2,116 |
| agent-browser | 2,815 | 2,614 |
| webcmd | 2,936 | 2,709 |

---

*All five agents completed 99 tasks. Time and token totals are cumulative across the run. Avg time = total time ÷ 99. Tokens/correct = total tokens ÷ tasks passed.*

---


# Browser Bench Eval

Run a controlled browser-tool benchmark. Keep task data and local evidence private.

## Workflow

1. Confirm `uv`, the selected controller CLI, selected browser tool, and a judge API key are available (`GOOGLE_API_KEY` for `--judge-provider google`, or `OPENAI_API_KEY` for `--judge-provider openai`). AXI, agent-browser, and dev-browser runs also require CloakBrowser.
2. Ask the user to choose a controller, model, benchmark, and task selection if any is missing.
3. Start with one task unless the user explicitly requests a larger or full run.
4. Run `scripts/run_eval.py` with the explicit choices.
5. Report selected task count, overall accuracy, category accuracy, terminal statuses, controller time, steps, tool calls, token usage, and the ignored local result path.
6. Compare runs only when manifest metadata (benchmark, dataset hash, controller, model, tools, and parallelism) match.

The legacy `tokens` metric remains non-cached controller input plus controller
output. Task results also record the controller's ordinary input, cached reads,
cache writes, output, and reasoning-output detail. For `gpt-5.6-sol`,
`estimated_api_cost_usd` applies the documented API rates to each completed
controller turn before summing them, including the long-context multiplier.
This is an API-equivalent estimate; ChatGPT-authenticated Codex runs are not
necessarily billed through the API. Judge usage is excluded.

## Commands

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5 \
  --benchmark BU_Bench_V1 \
  --tasks 1 \
  --tools webcmd
```

Run up to five complete attempts concurrently. Each slot covers the controller
subprocess and its judge call, and the next task starts as soon as a slot is
free:

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5 \
  --benchmark BU_Bench_V1 \
  --tasks all \
  --tools webcmd \
  --parallel 5
```

`--parallel` defaults to `1`. Increase it only as far as the machine, model
provider, and target sites can sustain without throttling. Webcmd Sessions
isolate task tabs, while the `benchmark` Profile's cookies and cache remain
shared across tasks.

Before enabling parallel runs for a competitor, run its live concurrency gate.
The gate starts two real task-private browser runtimes, creates marker tabs
concurrently, checks that neither runtime can see the other's tab, and verifies
that both Cloak process trees are removed. It does not invoke a controller or
judge:

```bash
cd benchmarks
BROWSER_BENCH_LIVE_COMPETITORS=chrome-devtools-axi,agent-browser,dev-browser,libretto \
  uv run pytest tests/test_competitor_concurrency_integration.py -q
```

Use `BROWSER_BENCH_LIVE_COMPETITORS=all` to require every gate. AXI uses its
`npx` package; agent-browser and dev-browser must already be installed. Without
the environment variable, these expensive live gates are skipped.

Use OpenAI instead of Gemini for judging:

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5 \
  --benchmark BU_Bench_V1 \
  --tasks 1 \
  --tools webcmd \
  --judge-provider openai \
  --judge-model gpt-4o-mini
```

Pi uses the pinned SDK sidecar from the repository's Node lockfile:

```bash
npm ci --ignore-scripts
webcmd skills add --provider codex --scope user

uv run python benchmarks/scripts/run_eval.py \
  --controller pi \
  --model openai/gpt-5.6-sol \
  --reasoning-effort low \
  --benchmark BU_Bench_V1 \
  --tasks 1 \
  --tools webcmd
```

For AXI with one dedicated CloakBrowser process and profile per task:

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5.6-sol \
  --reasoning-effort high \
  --benchmark BU_Bench_V1 \
  --tasks 1 \
  --tools chrome-devtools-axi
```

For agent-browser with one dedicated CloakBrowser process and profile per task:

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5.6-sol \
  --reasoning-effort high \
  --benchmark BU_Bench_V1 \
  --tasks 1 \
  --tools agent-browser
```

For dev-browser with one dedicated CloakBrowser process and profile per task:

```bash
npm install -g dev-browser
dev-browser install
dev-browser install-skill --codex

uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5.6-sol \
  --benchmark BU_Bench_V1 \
  --tasks all \
  --tools dev-browser
```

`dev-browser install` is required because it installs the daemon's Playwright
and QuickJS dependencies. It may also download dev-browser's Chromium, but the
benchmark does not use that browser: the task-private shim always connects
dev-browser to the task's dedicated CloakBrowser CDP endpoint.

For Libretto Browser Tools with Codex and one dedicated CloakBrowser per task:

```bash
npm ci

uv run python benchmarks/scripts/run_eval.py \
  --controller codex \
  --model gpt-5.6-sol \
  --reasoning-effort low \
  --benchmark BU_Bench_V1 \
  --task-indices 0,1 \
  --tools libretto
```

Libretto is currently Codex-only. The harness injects its pinned stdio MCP
server per attempt and exposes `browser_open`, `browser_exec`,
`browser_snapshot`, `browser_status`, and `browser_close`. `browser_connect`
is disabled so the agent cannot leave the task's dedicated CloakBrowser.

Use `--stealth-view official` only with `Stealth_Bench_V1`. Never publish `results/`.

Webcmd attempts use the dedicated `benchmark` Profile. The harness creates one
opaque Session per task before starting the controller, passes that Session to
the controller, and closes it only after the controller exits. The agent does
not create or close Sessions. Its browser surface is only
`webcmd --profile benchmark --session <session-id> browser tabs` → optional
`bind --page PAGE` → optional `snapshot` → one or more
`run --stdin <<'JS' ... JS` calls. Profile-level cookies, cache, and storage are
shared across the Webcmd run; tabs and browser workspace are task-specific.
Removed browser primitives (`open`, `state`,
`click`, `type`, `screenshot`, `wait`, `eval`, `observe`, and `tab`) are not
allowed. Do not run `webcmd browser --help`; the allowed surface is complete.
Run programs must use one quoted heredoc; never invoke `run --stdin` with an
empty stdin body. Avoid shell-fragile JavaScript such as
`$`, template literals, regex end anchors, and mixed-quote one-liners. The global `page` is already
available; do not call `browser.currentPage()` or `page.snapshotForAI()`. `run`
returns a snapshot diff by default. Only positive `--timeout` and `--max-output`
values, `--snapshot-mode act|tree`, and the boolean `--no-snapshot-diff` flag are
accepted:

```bash
webcmd --profile benchmark \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser run --stdin --snapshot-mode act <<'JS'
return await page.title()
JS
```

The separate `snapshot` command accepts `--snapshot-mode act|tree|read`.

BU Bench loads `datasets/BU_Bench_V1.json`. To skip a task without shifting its raw index, set its optional field to `"enabled": false`; leave all 100 entries in their original order.

## References

- Read `references/judge-contract.md` when auditing judge decisions.
- Read `references/dataset-provenance.md` before copying, updating, or publishing datasets.
