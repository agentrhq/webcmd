# Adapter-only discovery

## Goal

Let humans see the installed adapter namespaces without printing all 801 commands.

## Command surface

```bash
webcmd list --adapters
webcmd <adapter> --help
webcmd <adapter> <command> --help
```

`webcmd list --adapters` prints one row per registered adapter with its name, kind (`app` or `site`), domain, and command count. It includes built-in, plugin, and private adapters from the existing registry and excludes external CLIs.

All existing `webcmd list` behavior remains unchanged, especially the agent-facing `webcmd list -f json` schema. The existing adapter help output remains the command-specific discovery mechanism; no second command-listing hierarchy is added.

## Implementation

Add a boolean `--adapters` option to the existing `list` command. Derive the summary rows from the already-loaded registry, classify them with the existing `classifyAdapter()` helper, and render them through the existing output formatter for table, JSON, YAML, Markdown, and CSV.

## Verification

Add one focused CLI test proving that `--adapters` collapses multiple commands under the same adapter into one summary row and excludes external CLIs. Run the focused test, typecheck, and the existing unit suite.
