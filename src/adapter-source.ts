import * as fs from 'node:fs';
import type { InternalCliCommand } from './registry.js';

/** Split `site/command` or `site command` into segments. Null when the shape is wrong. */
export function splitAdapterCommandKey(commandKey: string, commandName?: string): { site: string; command: string } | null {
  const parts = [commandKey, commandName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('/')
    .trim()
    .split(/[/\s]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const [site, command] = parts;
  if (!site || !command || site === '.' || site === '..' || command === '.' || command === '..' || site.includes('\\') || command.includes('\\') || site.includes('\0') || command.includes('\0')) {
    return null;
  }
  return { site, command };
}

/**
 * Resolve the editable source file path for an adapter.
 *
 * Priority:
 * 1. cmd.source (set for FS-scanned JS and manifest lazy-loaded JS)
 * 2. cmd._modulePath (set for manifest lazy-loaded JS)
 *
 * Skip manifest: prefixed pseudo-paths (YAML commands inlined in manifest).
 */
export function resolveAdapterSourcePath(cmd: InternalCliCommand): string | undefined {
  const candidates: string[] = [];

  if (cmd.source && !cmd.source.startsWith('manifest:')) {
    candidates.push(cmd.source);
  }
  if (cmd._modulePath) {
    candidates.push(cmd._modulePath);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}
