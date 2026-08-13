# webcmd-plugin-skyscanner

Skyscanner flight search commands for Webcmd.

## Install

```bash
webcmd plugin install github:rishabhraj36/webcmd-plugin-skyscanner
```

## Commands

| Command | Description |
|---------|-------------|
| `skyscanner flights <origin> <destination> --depart-date <YYYY-MM-DD> --return-date <YYYY-MM-DD>` | Visible round-trip flight results from a warmed browser session. Optional `--limit` caps the rows returned (default 10). |

## Examples

```bash
webcmd skyscanner flights nyca lond --depart-date 2027-03-14 --return-date 2027-03-21 --limit 5
```

Both dates are required, and Skyscanner only returns results for dates in the future — substitute your own travel dates rather than copying these.
