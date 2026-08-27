import { Command, CommanderError } from 'commander';
import {
  addOutputFormatOption,
  CommanderStructuralError,
  outputFormatIsExplicit,
  parseOutputFormat,
  requestedOutputFormat,
  resolveCommandFromArgv,
  structuralErrorFromCommander,
} from '../command-surface.js';
import { CliError, EXIT_CODES } from '../errors.js';

export type ParsedHostedCoreCommand =
  | { command: 'validate'; target?: string; format: string; formatExplicit: boolean }
  | { command: 'verify'; target?: string; smoke: boolean; format: string; formatExplicit: boolean }
  | { command: 'convention-audit'; target?: string; site?: string; strict: boolean; format: string; formatExplicit: boolean }
  | { command: 'doctor'; verbose: boolean; format: string; formatExplicit: boolean };

/** Normalize a hosted built-in's format, preserving Commander-style usage errors. */
export function validateHostedFormat(raw: string): string {
  try {
    return parseOutputFormat(raw);
  } catch (error) {
    if (error instanceof CliError) {
      throw new CommanderStructuralError(`error: ${error.message}\n`, EXIT_CODES.USAGE_ERROR);
    }
    throw error;
  }
}

export function parseHostedCoreCommand(argv: readonly string[], literal: boolean): ParsedHostedCoreCommand {
  let parsed: ParsedHostedCoreCommand | undefined;
  let stdout = '';
  let stderr = '';
  const root = new Command('webcmd');
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);

  const format = (surface: Command, raw: string): { format: string; formatExplicit: boolean } => ({
    format: validateHostedFormat(String(requestedOutputFormat(surface, raw))),
    formatExplicit: outputFormatIsExplicit(surface),
  });
  const configure = (surface: Command): Command => surface.exitOverride().configureOutput(output);

  const validate = configure(addOutputFormatOption(root.command('validate').argument('[target]')));
  validate.action((target: string | undefined, options: { format: string }) => {
    parsed = { command: 'validate', ...(target !== undefined ? { target } : {}), ...format(validate, options.format) };
  });

  const verify = configure(addOutputFormatOption(root.command('verify').argument('[target]').option('--smoke', 'Run smoke tests', false)));
  verify.action((target: string | undefined, options: { format: string; smoke?: boolean }) => {
    parsed = { command: 'verify', ...(target !== undefined ? { target } : {}), smoke: options.smoke === true, ...format(verify, options.format) };
  });

  const audit = configure(addOutputFormatOption(root.command('convention-audit')
    .argument('[target]')
    .option('--site <site>', 'Limit audit to one site')
    .option('--strict', 'Exit non-zero when violations are found', false)));
  audit.action((target: string | undefined, options: { format: string; site?: string; strict?: boolean }) => {
    parsed = {
      command: 'convention-audit',
      ...(target !== undefined ? { target } : {}),
      ...(options.site !== undefined ? { site: options.site } : {}),
      strict: options.strict === true,
      ...format(audit, options.format),
    };
  });

  const doctor = configure(addOutputFormatOption(root.command('doctor').option('-v, --verbose', 'Show detailed diagnostic output', false)));
  doctor.action((options: { format: string; verbose?: boolean }) => {
    parsed = { command: 'doctor', verbose: options.verbose === true, ...format(doctor, options.format) };
  });

  try {
    root.parse(literal ? ['--', ...argv] : [...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') {
      throw new CommanderStructuralError(stdout, EXIT_CODES.SUCCESS);
    }
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, argv), stderr);
  }
  if (!parsed) throw new CommanderStructuralError(`error: command '${argv[0] ?? ''}' did not run\n`, EXIT_CODES.GENERIC_ERROR);
  return parsed;
}
