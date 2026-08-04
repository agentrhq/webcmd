# webcmd-plugin-hft

HFT Stuttgart postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/hft
```

## Command

| Command | Description |
| --- | --- |
| `webcmd hft export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd hft export-postgraduate-courses --count 10 -f json
webcmd hft export-postgraduate-courses --degree-level masters -f csv
```
