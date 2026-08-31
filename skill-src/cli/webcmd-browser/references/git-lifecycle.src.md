# Checkpoint lifecycle

Never use git against site memory. Webcmd owns the repository. If `SITE_MEMORY_CONFLICT` is returned, retry once: `Retry webcmd site memory context, then checkpoint once.` That is exactly one retry. Stop after the second conflict.

```bash
webcmd site memory checkpoint <product> \
  --task-id <id> \
  --expected-revision <revision-or-null> \
  --reason candidate_ingestion|direct_correction|major_rewrite \
  --paths sitemap/SITE.md \
  --dispositions '<json>' \
  -f json
```

`--expected-revision` is the `revision` from context (`null` when context returned none). `--paths` are explicit draft Markdown paths to publish.

| reason | when |
| --- | --- |
| `candidate_ingestion` | Promoting candidates. Requires `--dispositions` and a memory change when any row is `ingested`. |
| `direct_correction` | Editing memory without promoting candidates. No dispositions. |
| `major_rewrite` | Replacing a SITE.md that outgrew its bound. No dispositions. |

Dispositions are `[{ "id", "status": "ingested"|"rejected", "evidenceRole"?, "rejectionReason"?, "conflictsWithMemory"? }]`. Ingested rows need `evidenceRole` `supporting` or `dissenting`. Rejected rows need `rejectionReason`.

On conflict, run context again, then checkpoint once with the new revision. Do not loop.
