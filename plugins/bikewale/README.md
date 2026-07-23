# webcmd-plugin-bikewale

BikeWale bike search, news, featured lists, and variant prices for Webcmd.

## Install

```bash
webcmd plugin install github:beubax/webcmd-plugin-bikewale
```

## Commands

| Command | Description |
|---------|-------------|
| `bikewale search <query>` | Search BikeWale for bikes, scooters, comparisons, prices, media, and related pages |
| `bikewale news` | Fetch latest BikeWale bike news from the public news listing |
| `bikewale featured` | List featured BikeWale bike sections from the public homepage |
| `bikewale variants <model>` | List variants and prices for a BikeWale model page or search query |

## Examples

```bash
webcmd bikewale search "classic 350" --limit 5
webcmd bikewale news --limit 5
webcmd bikewale featured --section trending --limit 5
webcmd bikewale variants "classic 350" --limit 5
```
