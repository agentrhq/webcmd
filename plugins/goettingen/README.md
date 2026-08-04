# webcmd-plugin-goettingen

University of Göttingen postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/goettingen
```

## Command

| Command | Description |
| --- | --- |
| `webcmd goettingen export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd goettingen export-postgraduate-courses --count 10 -f json
webcmd goettingen export-postgraduate-courses --degree-level masters -f csv
```
