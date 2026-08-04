# webcmd-plugin-cincinnati

University of Cincinnati postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/cincinnati
```

## Command

| Command | Description |
| --- | --- |
| `webcmd cincinnati export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd cincinnati export-postgraduate-courses --count 10 -f json
webcmd cincinnati export-postgraduate-courses --degree-level masters -f csv
```
