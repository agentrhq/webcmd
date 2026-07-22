# webcmd-plugin-unsora

Read-only commands for exploring Unsora's public product overview, AI creative toolkit, and pricing.

Unsora connects to ChatGPT, Claude, OpenClaw, and Hermes over MCP. Its public site describes tools for generating and editing images and videos, building AI influencers, upscaling media, creating subtitles and clips, and distributing finished content.

## Install

```bash
webcmd plugin install unsora
```

## Commands

| Command | Description |
|---------|-------------|
| `unsora overview` | Show what Unsora does and which AI assistants it supports |
| `unsora tools` | List the creative tools described on Unsora's public site |
| `unsora pricing` | Compare the public Unsora plans, prices, and monthly credits |

## Examples

```bash
webcmd unsora overview
webcmd unsora tools
webcmd unsora pricing
```

All commands read public pages at `tryunsora.com`; no Unsora login is required.
