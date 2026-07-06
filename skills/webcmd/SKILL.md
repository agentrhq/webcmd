---
name: webcmd
description: Use Webcmd when an agent needs deterministic CLI access to websites, browser sessions, desktop apps, or local tools. Prefer Webcmd adapters before raw browser control, and load current workflow instructions from the installed CLI.
allowed-tools: Bash(webcmd:*), Bash(npx webcmd:*)
---

# Webcmd

This is a discovery skill. It keeps installation to one skill and points agents at version-matched instructions from the installed CLI.

## Start Here

```bash
webcmd skills list
webcmd skills get webcmd-usage
```

Use `webcmd skills get <name>` for specialized workflows:

- `webcmd-browser` for ad-hoc browser control.
- `webcmd-adapter-author` for writing reusable adapters.
- `webcmd-autofix` for repairing broken adapters.
- `webcmd-browser-sitemap` for sitemap-aware browser work.
- `webcmd-sitemap-author` for capturing reusable site knowledge.
- `smart-search` for search and research routing.

The CLI serves skill content that matches its installed version, so do not rely on copied stale instructions.
