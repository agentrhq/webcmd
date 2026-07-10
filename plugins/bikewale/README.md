# webcmd-plugin-bikewale

BikeWale motorcycle and scooter commands for Webcmd

## Install

```bash
# From local development directory
webcmd plugin install file:///Users/ng/Developer/webcmd/plugins/bikewale

# From GitHub (after publishing)
webcmd plugin install github:<user>/webcmd-plugin-bikewale
```

## Commands

| Command | Type | Description |
|---------|------|-------------|
| `bikewale/brands` | JavaScript | List motorcycle and scooter brands available on BikeWale |

## Development

```bash
# Install locally for development (symlinked, changes reflect immediately)
webcmd plugin install file:///Users/ng/Developer/webcmd/plugins/bikewale

# Verify commands are registered
webcmd list | grep bikewale

# Run a command
webcmd bikewale brands --limit 10
```
