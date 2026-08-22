# webcmd-plugin-npm

Inspect public npm package metadata, download stats, version history, and
search results. No login or API key is required.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/npm
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd npm package <name>` | Latest metadata: version, license, homepage, repository, maintainers |
| `webcmd npm versions <name>` | Published version history, newest first |
| `webcmd npm downloads <name>` | Daily download counts over a time window |
| `webcmd npm search <query>` | Search the public registry by keyword |

## Examples

```bash
# Package metadata
webcmd npm package react
webcmd npm package @vercel/og

# Version history
webcmd npm versions typescript
webcmd npm versions react --limit 5

# Download stats (defaults to last week, one row per day)
webcmd npm downloads express
webcmd npm downloads express --period last-month
webcmd npm downloads express --period last-year
webcmd npm downloads express --period 2026-01-01:2026-06-30

# Search
webcmd npm search "graphql client"
webcmd npm search vite --limit 5
```

Use this plugin when an agent needs deterministic package metadata before
installing, upgrading, or comparing JavaScript tools.
