# webcmd-plugin-bikewale

BikeWale bike search, news, featured lists, and variant prices for Webcmd.

## Install

```bash
webcmd plugin install github:rishabhraj36/webcmd-plugin-bikewale
```

## Commands

| Command | Description |
|---------|-------------|
| `bikewale search <query>` | Search BikeWale for bikes, scooters, comparisons, prices, media, and related pages |
| `bikewale news` | Fetch latest BikeWale bike news |
| `bikewale featured` | List featured BikeWale homepage bike sections |
| `bikewale variants <model>` | List variants and prices for a BikeWale model page or search query |

## Examples

```bash
webcmd bikewale search "classic 350" -f yaml
webcmd bikewale news --limit 5 -f yaml
webcmd bikewale featured --section electric --limit 5 -f yaml
webcmd bikewale variants "classic 350" -f yaml
```
