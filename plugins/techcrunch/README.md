# webcmd-plugin-techcrunch

Search and read TechCrunch stories through WebCMD using TechCrunch's public API. No login is required.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/techcrunch
```

## Commands

| Command | Description |
|---------|-------------|
| `techcrunch search [query]` | Search stories, or list new stories with `--latest` |
| `techcrunch article <url>` | Read a TechCrunch article |

## Examples

```bash
webcmd techcrunch search "artificial intelligence"
webcmd techcrunch search --latest --limit 10
webcmd techcrunch article "https://techcrunch.com/2026/07/26/are-brain-waves-the-next-unlock-for-physical-ai/"
```
