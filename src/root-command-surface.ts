import { Command, CommanderError } from 'commander';
import { CommanderStructuralError } from './command-surface.js';
import { PKG_VERSION } from './version.js';

export const ROOT_PROFILE_FLAGS = '--profile <name>';
export const ROOT_PROFILE_DESCRIPTION = 'Chrome profile/context alias for browser runtime commands';
export const ROOT_SESSION_FLAGS = '--session <session-id>';
export const ROOT_SESSION_DESCRIPTION = 'Existing opaque Session ID from `webcmd session create`';
export const COMPLETION_SENTINEL = '--get-completions';

/**
 * Configure the structural root options shared by the local and hosted CLI.
 * Keeping this in one place makes Commander the source of truth for attached
 * values, short-option clusters, missing values, and help/version precedence.
 */
export function configureRootCommandSurface(program: Command): Command {
  return program
    .version(PKG_VERSION)
    .option(ROOT_PROFILE_FLAGS, ROOT_PROFILE_DESCRIPTION)
    .option(ROOT_SESSION_FLAGS, ROOT_SESSION_DESCRIPTION)
    .enablePositionalOptions();
}

export type HostedRootCommandSurface =
  | { kind: 'help'; exitCode: number }
  | { kind: 'version'; output: string }
  | { kind: 'completion'; argv: string[] }
  | { kind: 'dispatch'; argv: string[]; profile?: string; session?: string; literal: boolean };

/**
 * Parse only the root command surface without registering or discovering local
 * commands. The completion/version checks reproduce the entry-point fast paths
 * in main.ts; all remaining root grammar is delegated to Commander itself.
 */
export function parseHostedRootCommandSurface(argv: readonly string[]): HostedRootCommandSurface {
  const input = [...argv];

  // main.ts checks an exact first-token version before its completion scan.
  if (input[0] === '--version' || input[0] === '-V') {
    return { kind: 'version', output: `${PKG_VERSION}\n` };
  }
  // The local completion path scans the complete raw argv before discovery or
  // Commander parsing, including after `--` and malformed root options.
  if (input.includes(COMPLETION_SENTINEL)) {
    return { kind: 'completion', argv: input };
  }

  let stdout = '';
  let stderr = '';
  const boundary = findRootCommandBoundary(input);
  const root = configureRootCommandSurface(new Command('webcmd'))
    // Hosted-only: registered here (not in the shared configureRootCommandSurface)
    // so the local CLI surface is unaffected. Lets Commander's structural parse
    // consume `--workspace <id>` before the site/command token instead of
    // throwing an unknown-option error.
    .option('--workspace <id>', 'Hosted workspace id/slug for the request')
    .exitOverride()
    .configureOutput({
      writeOut: value => { stdout += value; },
      writeErr: value => { stderr += value; },
    });
  if (boundary.commandIndex !== undefined) {
    // Register only the token Commander needs in order to stop root option
    // parsing. This is structural scaffolding, not adapter discovery.
    root.command(input[boundary.commandIndex]!)
      .helpOption(false)
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .argument('[commandArgs...]')
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  }

  const structuralArgv = boundary.commandIndex !== undefined
    ? input
    : boundary.separatorIndex !== undefined
      ? input.slice(0, boundary.separatorIndex + 1)
      : input;

  try {
    root.parse(structuralArgv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', exitCode: error.exitCode };
    if (error.code === 'commander.version') {
      return { kind: 'version', output: stdout || `${PKG_VERSION}\n` };
    }
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }

  const { profile, session } = root.opts<{ profile?: string; session?: string }>();
  if (boundary.commandIndex === undefined && boundary.separatorIndex === undefined) return { kind: 'help', exitCode: 1 };
  const literal = boundary.separatorIndex !== undefined;
  const parsedArgv = boundary.commandIndex !== undefined
    ? input.slice(boundary.commandIndex)
    : input.slice(boundary.separatorIndex! + 1);
  if (parsedArgv.length === 0) return { kind: 'help', exitCode: 1 };
  return {
    kind: 'dispatch',
    argv: parsedArgv,
    ...(profile !== undefined ? { profile } : {}),
    ...(session !== undefined ? { session } : {}),
    literal,
  };
}

interface RootCommandBoundary {
  commandIndex?: number;
  separatorIndex?: number;
}

/** Locates the undiscovered command token while respecting root value options. */
function findRootCommandBoundary(argv: readonly string[]): RootCommandBoundary {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--profile' || token === '--session' || token === '--workspace') {
      // Commander requires and consumes the next token even when it is `--` or
      // starts with a dash. Structural failures have already been reported.
      // `--workspace` is hosted-only (not a registered Commander option here)
      // but must still be skipped as a value pair so it and its value are not
      // mistaken for the site/command token and forwarded to the server.
      index += 1;
      continue;
    }
    if (token.startsWith('--profile=') || token.startsWith('--session=') || token.startsWith('--workspace=')) continue;
    if (token === '--') return { separatorIndex: index };
    if (!token.startsWith('-') || token === '-') return { commandIndex: index };
  }
  return {};
}
