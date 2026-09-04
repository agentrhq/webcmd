/**
 * Shared constants and shell script generators for tab-completion.
 *
 * This module MUST remain lightweight (no registry, no discovery imports).
 * Both completion.ts (full path) and completion-fast.ts (manifest path) import from here.
 */

import { CLI_COMMAND } from './brand.js';
import type { RootHelpCommand, RootHelpPresentation } from './command-presentation.js';
import { hasHostedCoreCommand, type HostedCoreCommandId } from './hosted/core-commands.js';

/**
 * Built-in (non-dynamic) top-level commands.
 */
export const BUILTIN_COMMANDS = [
  'list',
  'validate',
  'verify',
  'auth',
  'browser',
  'tab',
  'doctor',
  'plugin',
  'external',
  'completion',
];

export const LOCAL_ONLY_COMMAND_HELP = 'Run `webcmd setup` and choose local mode to use local-only commands.';

const HOSTED_CLIENT_ROOT_COMMANDS: readonly RootHelpCommand[] = [
  { name: 'adapter', description: 'Manage hosted adapter sources and overrides' },
  { name: 'artifact', description: 'Download a hosted execution artifact to a local path' },
  { name: 'auth', description: 'Inspect hosted authentication status' },
  { name: 'browser', description: 'Browser control through a hosted browser session' },
  { name: 'completion <shell>', description: 'Output a shell completion script' },
  { name: 'external', description: 'Manage local CLI passthrough commands' },
  { name: 'list', description: 'List all available hosted CLI commands' },
  { name: 'plugin', description: 'Manage Webcmd plugins' },
  { name: 'profile', description: 'Manage hosted browser profiles' },
  { name: 'session', description: 'Create, list, and close browser Sessions' },
  { name: 'setup', description: 'Configure local or hosted mode' },
  { name: 'site', description: 'Read and write per-site memory: notes, endpoints, field maps, fixtures' },
  { name: 'skills', description: 'Manage bundled Webcmd skills on this computer' },
  { name: 'update', description: 'Update the installed Webcmd CLI on this computer' },
  { name: 'web', description: 'Fetch URLs locally without launching a browser. Use after a blocked, 403, or Cloudflare response.' },
];

const HOSTED_CORE_ROOT_COMMANDS: Record<HostedCoreCommandId, RootHelpCommand | undefined> = {
  validate: { name: 'validate', description: 'Validate hosted CLI definitions' },
  verify: { name: 'verify', description: 'Validate and smoke-test hosted adapters' },
  'convention-audit': { name: 'convention-audit', description: 'Audit hosted adapter source conventions' },
  doctor: { name: 'doctor', description: 'Diagnose hosted readiness' },
  'adapter/status': undefined,
  'adapter/reset': undefined,
  'profile/create': undefined,
  'profile/rename': undefined,
  'plugin/catalog/list': undefined,
};

const HOSTED_ROOT_HELP_BASE: Omit<RootHelpPresentation, 'commands'> = {
  description: 'Make any website your CLI. Zero setup. AI-powered.',
  usage: [
    `${CLI_COMMAND} [options] [command]`,
    `${CLI_COMMAND} <site> <command> [args] [options]`,
    `${CLI_COMMAND} --session <session-id> browser <command> [args] [options]`,
    `${CLI_COMMAND} list [options]`,
    `${CLI_COMMAND} setup`,
  ],
  options: [
    { flags: '--profile <name>', description: 'Browser profile/context alias for browser runtime commands' },
    { flags: '--session <session-id>', description: 'Existing readable Session ID from `webcmd session create <name>`' },
    { flags: '--workspace <id>', description: 'Hosted workspace id/slug; also WEBCMD_WORKSPACE' },
    { flags: '-V, --version', description: 'Output the version number' },
    { flags: '-h, --help', description: 'Display help for command' },
  ],
  localOnlyCommands: [
    { name: 'daemon', description: 'Manage the local Webcmd daemon' },
  ],
  examples: [
    `${CLI_COMMAND} list`,
    `${CLI_COMMAND} <site> --help`,
    `${CLI_COMMAND} --session <session-id> browser tabs`,
    `${CLI_COMMAND} setup`,
  ],
  agents: [
    `${CLI_COMMAND} <site> --help -f yaml`,
    `${CLI_COMMAND} list -f yaml`,
    `${CLI_COMMAND} <site> <command> -f yaml`,
  ],
};

const LOCAL_CLIENT_ROOT_COMMANDS = new Set(['external', 'skills', 'update']);

export function getHostedRootHelp(
  coreCommands?: readonly HostedCoreCommandId[],
  hasLocalClientCommandHandlers = true,
): RootHelpPresentation {
  const commands = [
    ...HOSTED_CLIENT_ROOT_COMMANDS,
    ...(coreCommands?.flatMap(id => HOSTED_CORE_ROOT_COMMANDS[id] ?? []) ?? []),
  ].sort((left, right) => left.name.localeCompare(right.name));
  return {
    ...HOSTED_ROOT_HELP_BASE,
    commands: hasLocalClientCommandHandlers
      ? commands
      : commands.filter(command => !LOCAL_CLIENT_ROOT_COMMANDS.has(command.name.split(/\s/, 1)[0]!)),
  };
}

export function getHostedBuiltinCommands(
  coreCommands?: readonly HostedCoreCommandId[],
  hasLocalClientCommandHandlers = true,
): string[] {
  return getHostedRootHelp(coreCommands, hasLocalClientCommandHandlers).commands
    .map((command) => command.name.split(/\s/, 1)[0]!);
}

export function getHostedBuiltinSubcommands(
  root: 'adapter' | 'profile' | 'plugin',
  coreCommands?: readonly HostedCoreCommandId[],
): string[] {
  if (root === 'adapter') {
    return [
      'override',
      'path',
      'source',
      ...(hasHostedCoreCommand(coreCommands, 'adapter/status') ? ['status'] : []),
      ...(hasHostedCoreCommand(coreCommands, 'adapter/reset') ? ['reset'] : []),
    ].sort();
  }
  if (root === 'profile') {
    return [
      'delete',
      'list',
      'use',
      ...(hasHostedCoreCommand(coreCommands, 'profile/create') ? ['create'] : []),
      ...(hasHostedCoreCommand(coreCommands, 'profile/rename') ? ['rename'] : []),
    ].sort();
  }
  return [
    'create',
    'install',
    'list',
    'search',
    'uninstall',
    'update',
    ...(hasHostedCoreCommand(coreCommands, 'plugin/catalog/list') ? ['catalog'] : []),
  ].sort();
}

export function isLocalClientRootCommand(command: string | undefined): boolean {
  return command !== undefined && LOCAL_CLIENT_ROOT_COMMANDS.has(command);
}

/** No-core, installed-client snapshot retained for existing callers. */
export const HOSTED_ROOT_HELP = getHostedRootHelp(undefined, true);

export const HOSTED_BUILTIN_COMMANDS = getHostedBuiltinCommands(undefined, true);

// ── Shell script generators ────────────────────────────────────────────────

export function bashCompletionScript(): string {
  return `# Bash completion for ${CLI_COMMAND}
# Add to ~/.bashrc:  eval "$(${CLI_COMMAND} completion bash)"
_${CLI_COMMAND}_completions() {
  local cur words cword
  _get_comp_words_by_ref -n : cur words cword

  local completions
  completions=$(${CLI_COMMAND} --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)

  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )
  __ltrim_colon_completions "$cur"
}
complete -F _${CLI_COMMAND}_completions ${CLI_COMMAND}
`;
}

export function zshCompletionScript(): string {
  return `# Zsh completion for ${CLI_COMMAND}
# Add to ~/.zshrc:  eval "$(${CLI_COMMAND} completion zsh)"
_${CLI_COMMAND}() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(${CLI_COMMAND} --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
compdef _${CLI_COMMAND} ${CLI_COMMAND}
`;
}

export function fishCompletionScript(): string {
  return `# Fish completion for ${CLI_COMMAND}
# Add to ~/.config/fish/config.fish:  ${CLI_COMMAND} completion fish | source
complete -c ${CLI_COMMAND} -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  ${CLI_COMMAND} --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;
}
