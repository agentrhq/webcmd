import { Command, CommanderError } from 'commander';
import {
  CommanderStructuralError,
  outputFormatIsExplicit,
  requestedOutputFormat,
  resolveCommandFromArgv,
  structuralErrorFromCommander,
  type ParsedCommandSurface,
} from '../command-surface.js';
import { configureAuthCommandSurface, parseAuthPositiveInt } from '../commands/auth.js';
import {
  commanderCommandHelpData,
  commanderNamespaceHelpData,
  getRequestedHelpFormat,
  renderStructuredHelp,
} from '../help.js';
import { configureRootCommandSurface } from '../root-command-surface.js';
import { validateHostedFormat } from './core-command-surface.js';

export type ParsedHostedAuthCommand =
  | { kind: 'help'; output: string }
  | ({ kind: 'run'; command: 'auth/status' | 'auth/refresh' } & ParsedCommandSurface);

export function parseHostedAuthCommand(argv: readonly string[], _literal: boolean): ParsedHostedAuthCommand {
  let parsed: Extract<ParsedHostedAuthCommand, { kind: 'run' }> | undefined;
  let stdout = '';
  let stderr = '';
  const root = configureRootCommandSurface(new Command('webcmd'));
  const { auth, status, refresh } = configureAuthCommandSurface(root);
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  for (const command of [root, auth, status, refresh]) command.exitOverride().configureOutput(output);

  status.action((options: Record<string, unknown>) => {
    parsed = authRun('auth/status', status, options);
  });
  refresh.action((options: Record<string, unknown>) => {
    parsed = authRun('auth/refresh', refresh, options);
  });

  try {
    root.parse([...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    const command = resolveCommandFromArgv(root, argv);
    if (error.code === 'commander.helpDisplayed') {
      const format = getRequestedHelpFormat(argv);
      if (!format) return { kind: 'help', output: stdout };
      const data = command === auth
        ? commanderNamespaceHelpData(auth, { globalCommand: root })
        : commanderCommandHelpData(auth, command, { globalCommand: root });
      return { kind: 'help', output: renderStructuredHelp(data, format) };
    }
    throw structuralErrorFromCommander(error, command, stderr);
  }
  if (!parsed) throw new CommanderStructuralError("error: command 'auth' did not run\n", 1);
  for (const name of ['concurrency', 'timeout'] as const) {
    const value = parsed.args[name];
    if (value !== undefined) parsed.args[name] = parseAuthPositiveInt(String(value), `--${name}`);
  }
  return parsed;
}

function authRun(
  command: 'auth/status' | 'auth/refresh',
  surface: Command,
  options: Record<string, unknown>,
): Extract<ParsedHostedAuthCommand, { kind: 'run' }> {
  const args: Record<string, unknown> = {};
  const optionSources: Record<string, 'cli' | 'default'> = {};
  for (const option of surface.options) {
    const name = option.attributeName();
    if (name === 'format' || name === 'json' || name === 'verbose') continue;
    const value = options[name];
    if (value !== undefined) args[name] = value;
    const source = surface.getOptionValueSource(name);
    if (source === 'cli') optionSources[name] = 'cli';
    else if (source === 'default') optionSources[name] = 'default';
  }
  return {
    kind: 'run',
    command,
    args,
    optionSources,
    format: validateHostedFormat(String(requestedOutputFormat(surface, options.format))),
    formatExplicit: outputFormatIsExplicit(surface),
    trace: 'off',
    verbose: options.verbose === true,
    help: false,
  };
}
