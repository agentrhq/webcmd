# webcmd-plugin-ualberta

University of Alberta postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/ualberta
```

## Command

| Command | Description |
| --- | --- |
| `webcmd ualberta export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd ualberta export-postgraduate-courses --count 10 -f json
webcmd ualberta export-postgraduate-courses --degree-level masters -f csv
```
