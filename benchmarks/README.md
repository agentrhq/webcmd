# Pi Browser Benchmark Comparison

BU Bench results from the Pi harness with the same model and judge configuration.

| Tool | Accuracy | Total tokens | Agent turns | API-equivalent cost |
|---|---:|---:|---:|---:|
| **webcmd** | **67%** | 3,193,816 | **969** | **$25.199668** |
| **Libretto Browser Tools** | 64% | 4,770,806 | 1,293 | $35.402135 |
| **dev-browser** | 56% | **3,190,822** | 1,504 | $25.997430 |

**Best in class:** accuracy → webcmd · tokens → dev-browser · agent turns → webcmd · cost → webcmd

## Evaluation configuration

| Setting | Value |
|---|---|
| Harness | Pi |
| Controller model | `openai-codex/gpt-5.6-sol` |
| Reasoning effort | `low` |
| Benchmark | `BU_Bench_V1` |
| Judge provider | Codex |
| Judge model | `gpt-5.4` |

Accuracy is the percentage of benchmark tasks that passed. Token, turn, and
cost values are recorded controller totals. Cost is an API-equivalent estimate;
judge usage is excluded.

## Reproduce and verify

All three results use the configuration above. Run from the repository root.

First install the pinned benchmark dependencies and authenticate Pi:

```bash
npm --prefix benchmarks ci --ignore-scripts
./benchmarks/node_modules/.bin/pi
# In Pi, run /login, select OpenAI Codex, then exit.
```

Pi reads the resulting credentials from `~/.pi/agent/auth.json`. Preflight
verifies the credentials, benchmark dependencies, and selected browser tool
before starting a task.

### webcmd

```bash
webcmd skills add --provider codex --scope user

uv run python benchmarks/scripts/run_eval.py \
  --controller pi \
  --model openai-codex/gpt-5.6-sol \
  --reasoning-effort low \
  --benchmark BU_Bench_V1 \
  --tasks all \
  --tools webcmd \
  --judge-provider codex \
  --judge-model gpt-5.4
```

### dev-browser

```bash
npm install -g dev-browser
dev-browser install
dev-browser install-skill --codex

uv run python benchmarks/scripts/run_eval.py \
  --controller pi \
  --model openai-codex/gpt-5.6-sol \
  --reasoning-effort low \
  --benchmark BU_Bench_V1 \
  --tasks all \
  --tools dev-browser \
  --judge-provider codex \
  --judge-model gpt-5.4
```

The Pi sidecar mounts the installed `dev-browser` skill and enables only its
`bash` and `read` tools. The benchmark connects it to the task's dedicated
CloakBrowser CDP endpoint.

### Libretto Browser Tools

```bash
uv run python benchmarks/scripts/run_eval.py \
  --controller pi \
  --model openai-codex/gpt-5.6-sol \
  --reasoning-effort low \
  --benchmark BU_Bench_V1 \
  --tasks all \
  --tools libretto \
  --judge-provider codex \
  --judge-model gpt-5.4
```

Pi registers the pinned Libretto browser tools directly:
`browser_open`, `browser_exec`, `browser_snapshot`, `browser_status`, and
`browser_close`. `browser_connect` is disabled so the agent cannot leave the
task's dedicated CloakBrowser.

## Verify a run

Each run writes a manifest, aggregate summary, per-task result, transcript, and
screenshots under `benchmarks/results/<run-id>/`. Verify that the manifests
match on benchmark dataset hash, Pi controller, controller model, reasoning
effort, and judge configuration before comparing tools. The table above reports
the aggregate accuracy, token, agent-turn, and API-equivalent cost fields from
those artifacts.

For an independently auditable public result, publish sanitized copies of each
run's manifest, summary, and per-task result JSON. Review transcripts and
screenshots before publishing because they can contain authenticated browser
state or private account data.

Controller token totals include non-cached input and output tokens. Cached
reads are recorded separately. Cost is calculated per controller turn,
including the model's long-context multiplier, and then summed. Judge tokens
and judge cost are excluded.

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
