# webcmd-plugin-ycombinator

Read-only access to the public Y Combinator startup directory. No login is required.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/ycombinator
```

## Commands

| Command | Description |
|---------|-------------|
| `ycombinator companies [query]` | Search public YC companies, optionally filtering and sorting by launch date |

## Examples

```bash
# Latest AI startups from recent batches
webcmd ycombinator companies AI --recent --limit 20

# AI companies in a specific batch
webcmd ycombinator companies AI --batch "Spring 2026" --recent

# Browse an industry
webcmd ycombinator companies --industry B2B --limit 15
```
