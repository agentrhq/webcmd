# Sitemap memory

`webcmd site memory context <url> --task-id <id> -f json` is the only load path. Use `siteMarkdown`, `references`, `draftPath`, and `revision` from that result. Do not browse the sites directory by hand.

Sitemap memory is **prior knowledge**, not ground truth. If the live page disagrees, trust the live browser.

If `resolution.status` is `provisional-fallback`, classify the hostname as the same product or a distinct product **before any write**, including `candidate add`. Use `webcmd site memory classify` — do not write `~/.webcmd` and never use git. After classify, rerun context for that host before capturing or checkpointing. Visiting a provisional host does not make an exact draft already opened in this task read-only.

- `old.reddit.com` is the same product: `webcmd site memory classify old.reddit.com --same-product reddit.com --expected-revision <revision> -f json`
- `news.ycombinator.com` is a distinct product: `webcmd site memory classify news.ycombinator.com --distinct --expected-revision <revision> -f json`

## Read

1. Run context before any live browser action.
2. Use `SITE.md` for orientation.
3. Open only the `references` paths the current page or goal needs.
4. After navigation or a write, take a fresh snapshot and compare. Do not keep clicking because memory said a control should exist.

## Write

Edit files under the returned `draftPath`. Durable facts need `[verified YYYY-MM-DD]` with a real UTC date. Publish through checkpointing in [`git-lifecycle.md`](git-lifecycle.md); do not edit active memory in place.

When reality drifts, record expected vs actual vs next probe in the draft, then checkpoint. Leave unverified guesses out of `SITE.md`.
