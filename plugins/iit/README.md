# webcmd-plugin-iit

Illinois Institute of Technology postgraduate course export adapter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/iit
```

## Command

| Command | Description |
| --- | --- |
| `webcmd iit export-postgraduate-courses --count 10 -f csv` | Export postgraduate courses in the shared 52-column CSV schema |

## Examples

```bash
webcmd iit export-postgraduate-courses --count 10 -f json
webcmd iit export-postgraduate-courses --degree-level masters -f csv
```
