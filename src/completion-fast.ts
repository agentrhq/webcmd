/**
 * Lightweight manifest-based completion for the fast path.
 *
 * This module MUST NOT import registry, discovery, or any heavy module.
 * It only reads pre-compiled cli-manifest.json files synchronously.
 */

import * as fs from 'node:fs';
import { getCommandCompletionCandidates } from './command-presentation.js';
import { CliError } from './errors.js';
import {
  BUILTIN_COMMANDS,
  bashCompletionScript,
  zshCompletionScript,
  fishCompletionScript,
} from './completion-shared.js';

interface ManifestCompletionEntry {
  site: string;
  name: string;
  aliases?: string[];
}

/**
 * Returns true only if ALL manifest files exist and are readable.
 * If any source lacks a manifest (e.g. user adapters without a compiled manifest),
 * the fast path must not be used — otherwise those adapters would silently
 * disappear from completion results.
 */
export function hasAllManifests(manifestPaths: string[]): boolean {
  for (const p of manifestPaths) {
    try {
      fs.accessSync(p);
    } catch {
      return false;
    }
  }
  return manifestPaths.length > 0;
}

/**
 * Lightweight completion that reads directly from manifest JSON files,
 * bypassing full CLI discovery and adapter loading.
 */
export function getCompletionsFromManifest(words: string[], cursor: number, manifestPaths: string[]): string[] {
  const entries = loadManifestEntries(manifestPaths);
  if (entries === null) return [];
  return getCommandCompletionCandidates(entries, words, cursor, BUILTIN_COMMANDS);
}

// ── Shell script generators (re-exported from shared, no registry dependency) ───────

const SHELL_SCRIPTS: Record<string, () => string> = {
  bash: bashCompletionScript,
  zsh: zshCompletionScript,
  fish: fishCompletionScript,
};

/** Return a generated shell script without taking ownership of stdout. */
export function getCompletionScriptFast(shell: string): string | undefined {
  return SHELL_SCRIPTS[shell]?.();
}

/** Return a supported shell script or the canonical local completion error. */
export function requireCompletionScriptFast(shell: string): string {
  const script = getCompletionScriptFast(shell);
  if (script === undefined) {
    throw new CliError('UNSUPPORTED_SHELL', `Unsupported shell: ${shell}. Supported: bash, zsh, fish`);
  }
  return script;
}

function loadManifestEntries(manifestPaths: string[]): ManifestCompletionEntry[] | null {
  const entries: ManifestCompletionEntry[] = [];
  let found = false;
  for (const manifestPath of manifestPaths) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as ManifestCompletionEntry[];
      entries.push(...manifest);
      found = true;
    } catch { /* skip missing/unreadable */ }
  }
  return found ? entries : null;
}
