/** Validate CLI definitions from the registry (JS-first). */
import { getRegistry, fullName, type CliCommand, type InternalCliCommand } from './registry.js';
import { getRegisteredStepNames } from './pipeline/registry.js';
import { CLI_COMMAND } from './brand.js';
import { ArgumentError } from './errors.js';

const SITE_LIST_LIMIT = 20;

/**
 * Pipeline step names — derived from the live pipeline registry on each
 * validate call so a new step registered in src/pipeline/registry.ts (or by
 * a plugin at runtime) is automatically allowlisted here (no parallel
 * hand-maintained list, no stale-snapshot drift).
 */
function getKnownStepNames(): Set<string> {
  return new Set(getRegisteredStepNames());
}

export interface CommandValidationResult {
  /** Display label: "site/name" or source path if available */
  label: string;
  errors: string[];
  warnings: string[];
}

export interface ValidationReport {
  ok: boolean;
  results: CommandValidationResult[];
  errors: number;
  warnings: number;
  commands: number;
}

/**
 * Validate registered CLI commands from the in-memory registry.
 *
 * The `_dirs` parameter is kept for call-site compatibility but is no longer
 * used — validation now operates on the registry populated by `discoverClis()`.
 */
export function validateClisWithTarget(_dirs: string[], target?: string): ValidationReport {
  const registry = getRegistry();
  const commands = collectCanonicalCommands(registry);
  const normalizedTarget = target?.trim();
  const selected = normalizedTarget
    ? commandsMatchingTarget(commands, resolveValidateTarget(registry, normalizedTarget))
    : commands;

  if (normalizedTarget && selected.length === 0) {
    throwUnknownValidateTarget(normalizedTarget, commands);
  }

  if (commands.length === 0) {
    const r: CommandValidationResult = {
      label: '(registry)',
      errors: [],
      warnings: ['Registry is empty — no commands discovered. Did discoverClis() run?'],
    };
    return { ok: true, results: [r], errors: 0, warnings: 1, commands: 0 };
  }

  const results: CommandValidationResult[] = [];
  let errors = 0; let warnings = 0;
  for (const cmd of selected) {
    const r = validateCommand(cmd);
    results.push(r);
    errors += r.errors.length;
    warnings += r.warnings.length;
  }

  return { ok: errors === 0, results, errors, warnings, commands: results.length };
}

function collectCanonicalCommands(registry: Map<string, CliCommand>): CliCommand[] {
  const seen = new Set<CliCommand>();
  const commands: CliCommand[] = [];
  for (const [key, cmd] of registry) {
    if (seen.has(cmd) || key !== fullName(cmd)) continue;
    seen.add(cmd);
    commands.push(cmd);
  }
  return commands;
}

function resolveValidateTarget(registry: Map<string, CliCommand>, target: string): string {
  if (!target.includes('/')) return target;
  const cmd = registry.get(target);
  return cmd ? fullName(cmd) : target;
}

function commandsMatchingTarget(commands: CliCommand[], target: string): CliCommand[] {
  if (target.includes('/')) return commands.filter(cmd => fullName(cmd) === target);
  return commands.filter(cmd => cmd.site === target);
}

function throwUnknownValidateTarget(target: string, commands: CliCommand[]): never {
  const usage = `usage: ${CLI_COMMAND} validate <site|site/name>`;
  const sites = [...new Set(commands.map(cmd => cmd.site))].sort((a, b) => a.localeCompare(b));

  if (target.includes('/')) {
    const site = target.slice(0, target.indexOf('/'));
    const names = commands.filter(cmd => cmd.site === site).map(cmd => cmd.name).sort((a, b) => a.localeCompare(b));
    if (names.length > 0) {
      throw new ArgumentError(
        `No command matches "${target}". Valid commands for ${site}: ${names.join(', ')}`,
        `${usage}\nexample: ${CLI_COMMAND} validate ${site}/${names[0]}`,
      );
    }
  }

  if (sites.length === 0) {
    const search = target.includes('/') ? target.slice(0, target.indexOf('/')) : target;
    throw new ArgumentError(
      `No command matches "${target}". No sites are installed.`,
      `${usage}\nSearch: ${CLI_COMMAND} plugin search ${search}`,
    );
  }

  const listed = sites.slice(0, SITE_LIST_LIMIT);
  const siteList = sites.length > SITE_LIST_LIMIT
    ? `Valid sites (${listed.length} of ${sites.length}): ${listed.join(', ')}`
    : `Valid sites: ${listed.join(', ')}`;
  const more = sites.length > SITE_LIST_LIMIT ? `\nList all: ${CLI_COMMAND} list` : '';
  throw new ArgumentError(
    `No command matches "${target}". ${siteList}`,
    `${usage}\nexample: ${CLI_COMMAND} validate ${sites[0]}${more}`,
  );
}

function validateCommand(cmd: CliCommand): CommandValidationResult {
  const label = fullName(cmd);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cmd.description) warnings.push('Missing description');

  // Browser commands should specify a domain for authenticated browser context
  if (cmd.browser && !cmd.domain) {
    warnings.push('Browser command without "domain" — authenticated browser context may not work');
  }

  // Pipeline validation: check step names for typos
  if (Array.isArray(cmd.pipeline)) {
    const knownStepNames = getKnownStepNames();
    for (let i = 0; i < cmd.pipeline.length; i++) {
      const step = cmd.pipeline[i];
      if (step && typeof step === 'object') {
        for (const key of Object.keys(step)) {
          if (!knownStepNames.has(key)) {
            warnings.push(
              `Pipeline step ${i}: unknown step name "${key}" (did you mean one of: ${[...knownStepNames].join(', ')}?)`
            );
          }
        }
      }
    }
  }

  // Commands should have either func, pipeline, or be a lazy-loaded module
  const internal = cmd as InternalCliCommand;
  if (!cmd.func && !cmd.pipeline && !internal._lazy) {
    errors.push('Command has neither "func" nor "pipeline" — it cannot execute');
  }

  // Arg validation
  if (cmd.args && cmd.args.length > 0) {
    const argNames = new Set<string>();
    let seenNonPositional = false;
    for (const arg of cmd.args) {
      if (argNames.has(arg.name)) {
        errors.push(`Duplicate arg name "${arg.name}"`);
      }
      argNames.add(arg.name);

      if (arg.positional && seenNonPositional) {
        warnings.push(`Positional arg "${arg.name}" appears after named args`);
      }
      if (!arg.positional) seenNonPositional = true;
    }
  }

  return { label, errors, warnings };
}

export function renderValidationReport(report: ValidationReport): string {
  const lines = [
    `${CLI_COMMAND} validate: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Checked ${report.commands} command(s)`,
    `Errors: ${report.errors}  Warnings: ${report.warnings}`,
  ];
  for (const r of report.results) {
    if (r.errors.length > 0 || r.warnings.length > 0) {
      lines.push(`\n${r.label}:`);
      for (const e of r.errors) lines.push(`  ❌ ${e}`);
      for (const w of r.warnings) lines.push(`  ⚠️  ${w}`);
    }
  }
  return lines.join('\n');
}
