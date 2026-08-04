# webcmd-plugin-jhu

Johns Hopkins University postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/jhu
```

## Command

| Command | Description |
| --- | --- |
| `webcmd jhu export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd jhu export-postgraduate-courses --count 10 -f json
webcmd jhu export-postgraduate-courses --degree-level masters -f csv
```
