# webcmd-plugin-omnisearch

**OmniSearch** — universal search across public platforms, no login.

Search what people are saying about any topic, product, or problem across
multiple platforms (Bluesky, Hacker News, Lobsters, and more) in one tool.
No browser, no login, no credentials — just structured data.

## Install

```bash
webcmd plugin install github:Rishet11/webcmd-plugin-omnisearch
```

## Commands

| Command | Type | Description |
|---------|------|-------------|
| `omnisearch bluesky-posts <handle>` | public | Recent posts from a public Bluesky account (no login) |
| `omnisearch hackermind <query>` | public | Search Hacker News stories & comments (no login) |
| `omnisearch lobsters [--sort newest\|active\|hot]` | public | Lobste.rs newest / active / hot discussions (no login) |
| `omnisearch research <topic>` | public | Aggregate results across Hacker News + Lobste.rs in one feed |

## Examples

```bash
# Read what a public Bluesky account (Twitter/X-like) is saying, no login
webcmd omnisearch bluesky-posts paulgraham.bsky.social --limit 10 -f json

# Search Hacker News for what people think about a product/problem
webcmd omnisearch hackermind "saas pricing" --limit 10 -f json

# Search comment text specifically for problem reports
webcmd omnisearch hackermind "billing is confusing" --limit 10 --scope comment -f json

# One command, search across platforms
webcmd omnisearch research "LLM" --limit 10 -f json
```

## Output

All commands return clean, consistent camelCase JSON:

| Field | Meaning |
|---|---|
| `title` | Title / headline / post text |
| `author` | Author or handle |
| `score` | Upvotes / points |
| `commentCount` | Number of comments |
| `createdAt` | ISO timestamp |
| `url` | Absolute link to the source |
| `platform` | Source platform (`research` aggregator only) |

## Development

```bash
# Install locally for development (symlinked, changes reflect immediately)
webcmd plugin install file:///Users/rishetmehra/webcmd-opinions

# Verify commands are registered
webcmd list | grep -A12 omnisearch

# Validate definitions
webcmd validate omnisearch
```
