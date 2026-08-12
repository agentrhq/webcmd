# webcmd-plugin-concordia

Concordia University Montréal postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/concordia
```

## Command

| Command | Description |
| --- | --- |
| `webcmd concordia export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd concordia export-postgraduate-courses --count 10 -f json
webcmd concordia export-postgraduate-courses --degree-level masters -f csv
```
