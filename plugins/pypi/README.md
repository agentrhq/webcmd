# webcmd-plugin-pypi

Inspect public Python package metadata, downloads, and releases. No login or
API key is required.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/pypi
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd pypi package <name>` | Show current project metadata for a package |
| `webcmd pypi downloads <name>` | Show recent or daily download counts for a package |
| `webcmd pypi releases <name>` | List recent release files for a package |

## Examples

```bash
webcmd pypi package django
webcmd pypi downloads django
webcmd pypi downloads django --period overall
webcmd pypi releases pictovap --limit 5
```

Use this plugin when an agent needs deterministic package metadata before
installing, upgrading, or comparing Python tools.
