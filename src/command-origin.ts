import * as os from 'node:os';
import * as path from 'node:path';
import { CONFIG_DIR_NAME } from './brand.js';

export type CommandOrigin =
  | { kind: 'plugin'; plugin: string }
  | { kind: 'override'; plugin: string }
  | { kind: 'local' }
  | { kind: 'builtin' };

interface OriginPaths {
  pluginsDir?: string;
  userClisDir?: string;
}

function defaultPaths(): Required<OriginPaths> {
  const root = path.join(os.homedir(), CONFIG_DIR_NAME);
  return { pluginsDir: path.join(root, 'plugins'), userClisDir: path.join(root, 'clis') };
}

function firstSegmentUnder(root: string, target: string): string | undefined {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  const [segment] = relative.split(path.sep);
  return segment || undefined;
}

/**
 * Classify where a registered command came from, by its `source` path.
 *
 * A command under ~/.webcmd/clis is reported as 'local' here. Whether it is
 * actually an override depends on a provenance record, which this module
 * deliberately does not read — callers combine the two.
 */
export function classifyCommandOrigin(
  command: { source?: string },
  paths: OriginPaths = {},
): CommandOrigin {
  if (!command.source) return { kind: 'builtin' };
  const resolved = path.resolve(command.source);
  const { pluginsDir, userClisDir } = { ...defaultPaths(), ...paths };

  const plugin = firstSegmentUnder(path.resolve(pluginsDir), resolved);
  if (plugin) return { kind: 'plugin', plugin };
  if (firstSegmentUnder(path.resolve(userClisDir), resolved)) return { kind: 'local' };
  return { kind: 'builtin' };
}

export function formatCommandOrigin(origin: CommandOrigin): string {
  switch (origin.kind) {
    case 'plugin': return `plugin:${origin.plugin}`;
    case 'override': return `override:${origin.plugin}`;
    case 'local': return 'local';
    case 'builtin': return 'builtin';
  }
}
