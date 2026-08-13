# Benchmark-Specific Judge Prompts

## Goal

Use separate judge system prompts so general benchmarks measure task completion while Stealth Bench measures only whether anti-bot protection blocked the browser.

## Design

Keep `benchmarks/references/judge-contract.md` as the general benchmark contract. Add `benchmarks/references/stealth-judge-contract.md` with Browser Use's binary criteria:

- Pass when the target site loads and the agent is not blocked by a CAPTCHA, anti-bot challenge, or security refusal.
- Pass when the agent encounters and passes a challenge.
- Fail when a challenge remains blocking or the target page does not load.
- Do not judge whether the task steps were completed correctly; they only create realistic site interaction.

Pass the benchmark name from `run_attempt()` to `judge_execution()`. `judge.py` selects the Stealth contract for `Stealth_Bench_V1` and `Stealth_Webcmd`; all other benchmarks use the existing general contract. Ground-truth handling, evidence truncation, screenshots, structured output, retries, and score calculation remain unchanged.

## Verification

Add focused tests proving that Stealth benchmarks load the Stealth contract and omit general task-completion instructions, while BU Bench continues to load the general contract. Existing judge and evaluation tests must continue to pass.

## Non-Goals

Do not add task-completion scoring to Stealth Bench, change repeat-run aggregation, alter datasets, or introduce partial scores.
