/**
 * Serialization and formatting helpers for CLI commands and args.
 *
 * Used by the `list` command, Commander --help, and build-manifest.
 * Separated from registry.ts to keep the registry focused on types + registration.
 */

import type { Arg, CliCommand } from './registry.js';
import {
  commandListRows,
  formatArgumentSummary,
  formatPresentableCommandExample,
  serializePresentableArg,
  toPresentableCommand,
} from './command-presentation.js';

// ── Serialization ───────────────────────────────────────────────────────────

export type SerializedArg = {
  name: string;
  type: string;
  required: boolean;
  valueRequired: boolean;
  positional: boolean;
  choices: string[];
  default: unknown;
  help: string;
};

/** Stable arg schema — every field is always present (no sparse objects). */
export function serializeArg(a: Arg): SerializedArg {
  return serializePresentableArg(a) as SerializedArg;
}

/** Full command metadata for structured output (json/yaml). */
export function serializeCommand(cmd: CliCommand) {
  return commandListRows([toPresentableCommand(cmd)], true)[0]!;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Human-readable arg summary: `<required> [optional]` style. */
export function formatArgSummary(args: Arg[]): string {
  return formatArgumentSummary(args);
}

function summarizeChoices(choices: string[]): string {
  if (choices.length <= 4) return choices.join(', ');
  return `${choices.slice(0, 4).join(', ')}, ... (+${choices.length - 4} more)`;
}

/** Agent-facing canonical invocation. Adapter authors may override with `example`. */
export function formatCommandExample(cmd: CliCommand): string {
  return formatPresentableCommandExample(toPresentableCommand(cmd));
}

/** Generate the --help appendix showing registry metadata not exposed by Commander. */
export function formatRegistryHelpText(cmd: CliCommand): string {
  const lines: string[] = [];
  const choicesArgs = cmd.args.filter(a => a.choices?.length);
  for (const a of choicesArgs) {
    const prefix = a.positional ? `<${a.name}>` : `--${a.name}`;
    const def = a.default != null ? `  (default: ${a.default})` : '';
    lines.push(`  ${prefix}: ${summarizeChoices(a.choices!)}${def}`);
  }
  const meta: string[] = [];
  meta.push(`Access: ${cmd.access}`);
  meta.push(`Browser: ${cmd.browser ? 'yes' : 'no'}`);
  if (cmd.domain) meta.push(`Domain: ${cmd.domain}`);
  if (cmd.defaultFormat) meta.push(`Default format: ${cmd.defaultFormat}`);
  if (cmd.aliases?.length) meta.push(`Aliases: ${cmd.aliases.join(', ')}`);
  lines.push(meta.join(' | '));
  lines.push(`Example: ${formatCommandExample(cmd)}`);
  if (cmd.columns?.length) lines.push(`Output columns: ${cmd.columns.join(', ')}`);
  return '\n' + lines.join('\n') + '\n';
}
