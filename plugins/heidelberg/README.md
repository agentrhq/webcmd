# webcmd-plugin-heidelberg

Heidelberg University postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/heidelberg
```

## Command

| Command | Description |
| --- | --- |
| `webcmd heidelberg export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd heidelberg export-postgraduate-courses --count 10 -f json
webcmd heidelberg export-postgraduate-courses --degree-level masters -f csv
```
