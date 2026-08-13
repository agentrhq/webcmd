# webcmd-plugin-yale

Yale University postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/yale
```

## Command

| Command | Description |
| --- | --- |
| `webcmd yale export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd yale export-postgraduate-courses --count 10 -f json
webcmd yale export-postgraduate-courses --degree-level masters -f csv
```
