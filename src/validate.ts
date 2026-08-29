/** Validate CLI definitions from the registry (JS-first). */
import { getRegistry, fullName, type CliCommand, type InternalCliCommand } from './registry.js';
import { getRegisteredStepNames } from './pipeline/registry.js';
import { CLI_COMMAND } from './brand.js';
import { ArgumentError } from './errors.js';
import type { AdapterAnalysisCommand } from './adapter-analysis.js';

const SITE_LIST_LIMIT = 20;

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
  const analysisCommands: AdapterAnalysisCommand[] = commands.map(command => ({
    site: command.site,
    name: command.name,
    command: fullName(command),
    ...(command.description ? { description: command.description } : {}),
    ...(command.access ? { access: command.access } : {}),
    browser: command.browser === true,
    ...(command.domain !== undefined ? { domain: command.domain } : {}),
    ...(command.args ? { args: command.args } : {}),
    ...(command.columns ? { columns: command.columns } : {}),
    ...(command.pipeline ? { pipeline: command.pipeline } : {}),
    runnable: Boolean(command.func || command.pipeline || (command as InternalCliCommand)._lazy),
  }));

  return validateAdapterCommands(analysisCommands, {
    ...(normalizedTarget ? { target: resolveValidateTarget(registry, normalizedTarget) } : {}),
    knownPipelineSteps: getRegisteredStepNames(),
  });
}

export function validateAdapterCommands(
  commands: readonly AdapterAnalysisCommand[],
  options: { target?: string; knownPipelineSteps: readonly string[] },
): ValidationReport {
  const selected = selectAdapterCommands(commands, options.target);

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
  const knownStepNames = new Set(options.knownPipelineSteps);
  for (const command of selected) {
    const r = validateCommand(command, knownStepNames);
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

export function selectAdapterCommands(
  commands: readonly AdapterAnalysisCommand[],
  target?: string,
  commandName = 'validate',
): AdapterAnalysisCommand[] {
  const normalizedTarget = target?.trim();
  if (!normalizedTarget) return [...commands];
  const selected = normalizedTarget.includes('/')
    ? commands.filter(command => command.command === normalizedTarget)
    : commands.filter(command => command.site === normalizedTarget);
  if (selected.length === 0) throwUnknownValidateTarget(normalizedTarget, commands, commandName);
  return selected;
}

function throwUnknownValidateTarget(
  target: string,
  commands: readonly AdapterAnalysisCommand[],
  commandName: string,
): never {
  const usage = `usage: ${CLI_COMMAND} ${commandName} <site|site/name>`;
  const sites = [...new Set(commands.map(cmd => cmd.site))].sort((a, b) => a.localeCompare(b));

  if (target.includes('/')) {
    const site = target.slice(0, target.indexOf('/'));
    const names = commands.filter(cmd => cmd.site === site).map(cmd => cmd.name).sort((a, b) => a.localeCompare(b));
    if (names.length > 0) {
      throw new ArgumentError(
        `No command matches "${target}". Valid commands for ${site}: ${names.join(', ')}`,
        `${usage}\nexample: ${CLI_COMMAND} ${commandName} ${site}/${names[0]}`,
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
    `${usage}\nexample: ${CLI_COMMAND} ${commandName} ${sites[0]}${more}`,
  );
}

function validateCommand(
  command: AdapterAnalysisCommand,
  knownStepNames: ReadonlySet<string>,
): CommandValidationResult {
  const label = command.command;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!command.description) warnings.push('Missing description');

  // Browser commands should specify a domain for authenticated browser context
  if (command.browser && !command.domain) {
    warnings.push('Browser command without "domain" — authenticated browser context may not work');
  }

  // Pipeline validation: check step names for typos
  if (Array.isArray(command.pipeline)) {
    for (let i = 0; i < command.pipeline.length; i++) {
      const step = command.pipeline[i];
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

  if (!command.runnable) {
    errors.push('Command has neither "func" nor "pipeline" — it cannot execute');
  }

  // Arg validation
  if (command.args && command.args.length > 0) {
    const argNames = new Set<string>();
    let seenNonPositional = false;
    for (const arg of command.args) {
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
