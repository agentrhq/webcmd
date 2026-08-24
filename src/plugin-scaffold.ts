/**
 * Plugin scaffold: generates a ready-to-develop plugin directory.
 *
 * Usage: webcmd plugin create <name> [--dir <path>]
 *
 * Creates:
 *   <name>/
 *     webcmd-plugin.json   — manifest with name, version, description
 *     package.json          — ESM package with webcmd peer dependency
 *     hello.ts              — sample pipeline command
 *     greet.ts              — sample TS command using func()
 *     README.md             — basic documentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeVirtualPath } from './hosted/virtual-files.js';
import { validatePluginAuthor, type PluginAuthor } from './plugin-manifest.js';
import { PKG_VERSION } from './version.js';

export interface ScaffoldOptions {
  /** Directory to create the plugin in. Defaults to `./<name>` */
  dir?: string;
  /** Plugin description */
  description?: string;
  /** Required author attribution for the generated plugin manifest. */
  author: PluginAuthor;
  /** Defaults to the real filesystem. The hosted path injects a virtual writer. */
  io?: ScaffoldIo;
}

export interface ScaffoldResult {
  name: string;
  dir: string;
  files: string[];
}

export interface ScaffoldIo {
  exists(target: string): boolean;
  isEmptyDir(target: string): boolean;
  mkdir(target: string): void;
  writeFile(target: string, body: string): void;
}

export const realScaffoldIo: ScaffoldIo = {
  exists: (target) => fs.existsSync(target),
  isEmptyDir: (target) => fs.readdirSync(target).length === 0,
  mkdir: (target) => void fs.mkdirSync(target, { recursive: true }),
  writeFile: (target, body) => fs.writeFileSync(target, body, 'utf8'),
};

type ScaffoldPathJoin = (directory: string, name: string) => string;

/**
 * Create a new plugin scaffold directory.
 */
export function createPluginScaffold(name: string, opts: ScaffoldOptions): ScaffoldResult {
  const io = opts.io ?? realScaffoldIo;
  const targetDir = opts.dir
    ? path.resolve(opts.dir)
    : path.resolve(name);
  return createPluginScaffoldAt(name, opts, targetDir, io, path.join);
}

/**
 * Create a plugin scaffold in a relative POSIX virtual filesystem.
 *
 * This is deliberately separate from the installed scaffold path: real
 * scaffolds retain native path resolution and synchronous filesystem errors,
 * while programmatic callers never receive an absolute host path.
 */
export function createVirtualPluginScaffold(
  name: string,
  opts: Omit<ScaffoldOptions, 'io'>,
  io: ScaffoldIo,
): ScaffoldResult {
  const targetDir = normalizeVirtualPath(opts.dir ?? name);
  return createPluginScaffoldAt(name, opts, targetDir, io, path.posix.join);
}

function createPluginScaffoldAt(
  name: string,
  opts: Omit<ScaffoldOptions, 'io'>,
  targetDir: string,
  io: ScaffoldIo,
  joinPath: ScaffoldPathJoin,
): ScaffoldResult {
  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}". ` +
      `Plugin names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.`
    );
  }

  const author = validatePluginAuthor(opts.author);

  if (io.exists(targetDir) && !io.isEmptyDir(targetDir)) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }

  io.mkdir(targetDir);

  const files: string[] = [];
  const writeFile = (dir: string, name: string, content: string): void => {
    io.writeFile(joinPath(dir, name), content);
  };

  // webcmd-plugin.json
  const manifest = {
    name,
    version: '0.1.0',
    description: opts.description ?? `A webcmd plugin: ${name}`,
    webcmd: `>=${PKG_VERSION}`,
    author,
  };
  writeFile(targetDir, 'webcmd-plugin.json', JSON.stringify(manifest, null, 2) + '\n');
  files.push('webcmd-plugin.json');

  // package.json
  const pkg = {
    name: `webcmd-plugin-${name}`,
    version: '0.1.0',
    type: 'module',
    description: opts.description ?? `A webcmd plugin: ${name}`,
    peerDependencies: {
      '@agentrhq/webcmd': `>=${PKG_VERSION}`,
    },
  };
  writeFile(targetDir, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
  files.push('package.json');

  // hello.ts — sample pipeline command
  const helloContent = `/**
 * Sample pipeline command for ${name}.
 * Demonstrates the declarative pipeline API.
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';

cli({
  site: '${name}',
  name: 'hello',
  description: 'A sample pipeline command',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['greeting'],
  pipeline: [
    { fetch: { url: 'https://httpbin.org/get?greeting=hello' } },
    { select: 'args' },
  ],
});
`;
  writeFile(targetDir, 'hello.ts', helloContent);
  files.push('hello.ts');

  // greet.ts — sample TS command using registry API
  const tsContent = `/**
 * Sample TypeScript command for ${name}.
 * Demonstrates the programmatic cli() registration API.
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';

cli({
  site: '${name}',
  name: 'greet',
  description: 'Greet someone by name',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'name', positional: true, required: true, help: 'Name to greet' },
  ],
  columns: ['greeting'],
  func: async (kwargs) => [{ greeting: \`Hello, \${String(kwargs.name ?? 'World')}!\` }],
});
`;
  writeFile(targetDir, 'greet.ts', tsContent);
  files.push('greet.ts');

  // README.md
  const readme = `# webcmd-plugin-${name}

${opts.description ?? `A webcmd plugin: ${name}`}

## Install

\`\`\`bash
# From local development directory
webcmd plugin install file://${targetDir}

# From the catalog (after publishing)
webcmd plugin search ${name} -f json
webcmd plugin install <installSource-from-search>
\`\`\`

## Commands

| Command | Type | Description |
|---------|------|-------------|
| \`${name}/hello\` | Pipeline | Sample pipeline command |
| \`${name}/greet\` | TypeScript | Sample TS command with func() |

## Development

Use \`webcmd browser init <site>/<command>\` for private local adapter iteration.
Use \`webcmd adapter override <site>/<command>\` to patch an installed command.
Use this plugin scaffold when you are ready to publish or raise a PR.

\`\`\`bash
# Install locally for development (symlinked, changes reflect immediately)
webcmd plugin install file://${targetDir}

# Verify commands are registered
webcmd list | grep ${name}

# Run a command
webcmd ${name} hello
webcmd ${name} greet --name World
\`\`\`
`;
  writeFile(targetDir, 'README.md', readme);
  files.push('README.md');

  return { name, dir: targetDir, files };
}
