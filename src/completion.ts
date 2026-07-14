/**
 * Shell tab-completion support for webcmd.
 *
 * Provides:
 *  - Shell script generators for bash, zsh, and fish
 *  - Dynamic completion logic that returns candidates for the current cursor position
 */

import { getRegistry } from './registry.js';
import { CliError } from './errors.js';
import { getCommandCompletionCandidates, toPresentableCommand } from './command-presentation.js';
import {
  BUILTIN_COMMANDS,
  bashCompletionScript,
  zshCompletionScript,
  fishCompletionScript,
} from './completion-shared.js';

// Re-export shell scripts so existing callers (cli.ts) don't break
export { bashCompletionScript, zshCompletionScript, fishCompletionScript };

// ── Dynamic completion logic ───────────────────────────────────────────────

/**
 * Return completion candidates given the current command-line words and cursor index.
 * Requires full CLI discovery to have been run (uses getRegistry()).
 *
 * @param words  - The argv after 'webcmd' (words[0] is the first arg, e.g. site name)
 * @param cursor - 1-based position of the word being completed (1 = first arg)
 */
export function getCompletions(words: string[], cursor: number): string[] {
  const commands = [...new Set(getRegistry().values())].map(toPresentableCommand);
  return getCommandCompletionCandidates(commands, words, cursor, BUILTIN_COMMANDS);
}

// ── Shell script generators ────────────────────────────────────────────────

/**
 * Print the completion script for the requested shell.
 */
export function printCompletionScript(shell: string): void {
  switch (shell) {
    case 'bash':
      process.stdout.write(bashCompletionScript());
      break;
    case 'zsh':
      process.stdout.write(zshCompletionScript());
      break;
    case 'fish':
      process.stdout.write(fishCompletionScript());
      break;
    default:
      throw new CliError('UNSUPPORTED_SHELL', `Unsupported shell: ${shell}. Supported: bash, zsh, fish`);
  }
}
