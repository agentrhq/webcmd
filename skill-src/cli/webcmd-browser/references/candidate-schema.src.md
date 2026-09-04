# Candidate schema

Record only a qualifying observation. Do not capture trivial page loads, no-op clicks, or restated memory.

```bash
webcmd site memory candidate add <product> \
  --kind <kind> --claim <claim> --evidence <evidence> --consequence <consequence> -f json
```

Kinds: `action_space`, `better_path`, `access`, `high_consequence`, `repeated_mistake`.

| field | rule |
| --- | --- |
| `--kind` | One of the five kinds. |
| `--claim` | Short reusable claim. |
| `--evidence` | Bounded secret-free evidence from this task. |
| `--consequence` | Why a later agent should care. |
| `--hostname` | Live host when it differs from the product key. |

If context returned `provisional-fallback`, classify before `candidate add`. Do not capture onto the parent. After `--same-product`, `<product>` is the parent and `--hostname` is the live host.

`high_consequence` is an immediate warning: capture it as soon as the danger is observed. Every other kind needs a materially useful reusable observation, not a trivial success or a no-op. An `action_space`, `access`, or `better_path` fact qualifies on its own usefulness; it does not need anything to have gone wrong.

Never record passwords, cookies, tokens, or secret-bearing fields. Inspect with `candidate search`, `show`, and `list`; do not dump environment from search or list.

```bash
webcmd site memory candidate search <product> --query "<tokens>" -f json
webcmd site memory candidate show <product> <id> -f json
webcmd site memory candidate list <product> -f json
```

After capture, search and inspect semantically related pending candidates.

Ordinary ingestion is judgment, not automatic. Matching evidence must appear on at least two distinct `observed_date_utc` dates.

`high_consequence` may ingest immediately only if active memory is silent. If it conflicts, wait for a matching later-date occurrence.

Direct live proof that active factual memory is stale uses `direct_correction` immediately. Inferred causal or risk claims remain candidates.

Candidate files are never deleted. An `ingested` or `rejected` candidate is completed: do not reopen, re-litigate, or re-count it during ordinary work or a major rewrite. When the same thing happens again and still qualifies on its own, capture a new pending candidate rather than adding to or restating an existing one. A recurrence of something active memory already states adequately is not a new candidate.

Considered supporting and dissenting evidence that contributes to a published conclusion is ingested with `evidenceRole`. Reject only when publishing no conclusion because the candidate is wrong, transient, private, or useless. Unrelated candidates stay pending.
