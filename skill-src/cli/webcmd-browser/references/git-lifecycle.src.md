# Checkpoint lifecycle

Never use git against site memory. Webcmd owns the repository. If `SITE_MEMORY_CONFLICT` is returned, retry once: `Retry webcmd site memory context, then checkpoint once.` After refreshing context, compare new active `siteMarkdown` with the preserved draft and re-apply the intended edit on top of the refreshed content before retrying checkpoint. That is exactly one retry. Stop after the second conflict.

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

After the final candidate capture or search decision and before editing the draft, rerun context with the same task id:

```bash
webcmd site memory context <url> --task-id <id> -f json
```

Use that refreshed `revision`. This rerun happens before any draft edit, so it does not destroy edits. Then edit the draft and checkpoint.

| reason | when |
| --- | --- |
| `candidate_ingestion` | Promoting candidates. Requires `--dispositions` and a memory change when any row is `ingested`. |
| `direct_correction` | Editing memory without promoting candidates. No dispositions. |
| `major_rewrite` | Replacing a SITE.md that outgrew its bound. No dispositions. |

Any active-memory update that finds `SITE.md` over 500 physical lines must rewrite it to at most 200 lines with contextual reference pointers in that same task, even if only a reference path was requested.

Dispositions are `[{ "id", "status": "ingested"|"rejected", "evidenceRole"?, "rejectionReason"?, "conflictsWithMemory"? }]`. Ingested rows need `evidenceRole` `supporting` or `dissenting`. Rejected rows need `rejectionReason`.

On conflict, run context again with the same task id. Context does not overwrite the existing draft. Compare the new active `siteMarkdown` with that preserved draft, reconcile the intended edit onto the refreshed content, then checkpoint once with the new revision. A `committed` result with no memory change did not publish new content. Do not loop.
