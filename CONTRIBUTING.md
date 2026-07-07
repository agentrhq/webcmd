# Contributing to Webcmd

## Setup

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Adapter Imports

Adapters must import public APIs from `@agentrhq/webcmd`:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
```

## Local State

User adapters, plugins, cache, traces, and site memory live under `~/.webcmd`.

## Contributing Adapters

There are two ways to contribute a new site adapter:

### 1. Built-in Adapter (Core Registry)

Add your adapter directly to the `clis/` folder and open a PR. This is the right path when:

- The site is widely used.
- The adapter is stable and tested.
- You want it to ship with every `webcmd` install.

**Steps:**

1. Create a folder under `clis/<site>/` (e.g. `clis/imdb/`).
2. Add your adapter file(s) (e.g. `search.js`, `movie.js`).
3. Add a test file (e.g. `imdb.test.js`).
4. Run `npm run build` to regenerate `cli-manifest.json`.
5. Run `npm test` and `npm run typecheck` to verify.
6. Open a PR.

### 2. Community Plugin (External Repository)

Package your adapter as a standalone plugin in its own repository. This is the right path when:

- You want to ship and iterate independently from the core.
- The adapter is experimental or niche.
- You want full ownership of the release cycle.

See the [Community Plugins](#community-plugins) section below.

## Community Plugins

Anyone can create and share a Webcmd plugin. A plugin is a standalone Git repository that contains one or more adapters.

### Plugin Structure

```
webcmd-plugin-<site>/
├── webcmd-plugin.json      # Plugin manifest (required)
├── package.json             # Node package metadata
├── <command>.js             # Adapter file(s)
├── <site>.test.js           # Tests (recommended)
├── README.md
└── LICENSE
```

### `webcmd-plugin.json`

```json
{
  "name": "<site>",
  "version": "0.1.0",
  "description": "Short description of what this plugin does",
  "webcmd": ">=0.2.0"
}
```

The `name` field determines the site namespace. For example, `"name": "allrecipes"` means commands register as `webcmd allrecipes <command>`.

### `package.json`

```json
{
  "name": "webcmd-plugin-<site>",
  "version": "0.1.0",
  "type": "module",
  "description": "Short description of what this plugin does",
  "peerDependencies": {
    "@agentrhq/webcmd": ">=0.2.0"
  }
}
```

### Naming Convention

Repositories should follow the pattern: **`webcmd-plugin-<site>`**

Examples:
- `webcmd-plugin-allrecipes`
- `webcmd-plugin-bookmyshow`
- `webcmd-plugin-notion`

### Writing the Adapter

Adapter files use the same `cli()` API as built-in adapters:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

cli({
    site: '<site>',
    name: '<command>',
    access: 'read',
    description: 'What this command does',
    domain: '<domain>',
    strategy: Strategy.PUBLIC,  // or COOKIE, UI, INTERCEPT, LOCAL
    browser: false,             // true if this adapter needs a browser
    args: [
        { name: 'query', positional: true, required: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results' },
    ],
    columns: ['title', 'url', 'description'],
    func: async (page, kwargs) => {
        // Your adapter logic here
        return [{ title: '...', url: '...', description: '...' }];
    },
});
```

### Testing Locally

```bash
# Install the plugin from your local directory
webcmd plugin install file:///path/to/webcmd-plugin-<site>

# Verify the commands are registered
webcmd list | grep <site>

# Run a command
webcmd <site> <command> -f json

# Uninstall when done testing
webcmd plugin uninstall <site>
```

### Sharing Your Plugin

Push your plugin to a public GitHub repository. Others can install it with:

```bash
webcmd plugin install github:<user>/webcmd-plugin-<site>
```

### Plugin Checklist

- [ ] `webcmd-plugin.json` has a `name`, `version`, and `webcmd` compatibility field
- [ ] `package.json` has `"type": "module"` and a `peerDependencies` entry for `@agentrhq/webcmd`
- [ ] Adapter imports use `@agentrhq/webcmd/registry` and `@agentrhq/webcmd/errors`
- [ ] Commands return an array of row objects with consistent columns
- [ ] README includes install command, available commands table, and usage examples
- [ ] Plugin installs cleanly with `webcmd plugin install file:///...`
- [ ] Commands appear in `webcmd list`
- [ ] At least one command runs successfully with `-f json`
