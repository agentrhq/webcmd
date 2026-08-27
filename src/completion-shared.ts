/**
 * Shared constants and shell script generators for tab-completion.
 *
 * This module MUST remain lightweight (no registry, no discovery imports).
 * Both completion.ts (full path) and completion-fast.ts (manifest path) import from here.
 */

import { CLI_COMMAND } from './brand.js';
import type { RootHelpPresentation } from './command-presentation.js';

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

export const HOSTED_ROOT_HELP: RootHelpPresentation = {
  description: 'Make any website your CLI. Zero setup. AI-powered.',
  usage: [
    `${CLI_COMMAND} <site> <command> [args] [options]`,
    `${CLI_COMMAND} --session <session-id> browser <command> [args] [options]`,
    `${CLI_COMMAND} list [options]`,
    `${CLI_COMMAND} setup`,
  ],
  options: [
    { flags: '--profile <name>', description: 'Browser profile/context alias for browser runtime commands' },
    { flags: '-V, --version', description: 'Output the version number' },
    { flags: '-h, --help', description: 'Display help for command' },
  ],
  commands: [
    { name: 'artifact', description: 'Download a hosted execution artifact to a local path' },
    { name: 'browser', description: 'Browser control through a hosted browser session' },
    { name: 'completion <shell>', description: 'Output a shell completion script' },
    { name: 'list', description: 'List all available hosted CLI commands' },
    { name: 'profile', description: 'Manage hosted browser profiles' },
    { name: 'setup', description: 'Configure local or hosted mode' },
    { name: 'skills', description: 'Manage bundled Webcmd skills on this computer' },
    { name: 'update', description: 'Update the installed Webcmd CLI on this computer' },
    { name: 'web', description: 'Fetch URLs locally without launching a browser. Use after a blocked, 403, or Cloudflare response.' },
  ],
  localOnlyCommands: [
    { name: 'adapter', description: 'Manage adapters installed on this computer' },
    { name: 'antigravity', description: 'Run the local Antigravity proxy' },
    { name: 'auth', description: 'Inspect credentials in the local browser runtime' },
    { name: 'convention-audit', description: 'Audit adapter source files on this computer' },
    { name: 'daemon', description: 'Manage the local Webcmd daemon' },
    { name: 'doctor', description: 'Diagnose local browser bridge connectivity' },
    { name: 'external', description: 'Manage local CLI passthrough commands' },
    { name: 'plugin', description: 'Manage plugins installed on this computer' },
    { name: 'validate', description: 'Validate local CLI definitions' },
    { name: 'verify', description: 'Validate and smoke-test local adapters' },
  ],
};

const LOCAL_CLIENT_ROOT_COMMANDS = new Set(['skills', 'update']);

export function getHostedRootHelp(hasLocalClientCommandHandlers = true): RootHelpPresentation {
  if (hasLocalClientCommandHandlers) return HOSTED_ROOT_HELP;
  return {
    ...HOSTED_ROOT_HELP,
    commands: HOSTED_ROOT_HELP.commands.filter(command => !LOCAL_CLIENT_ROOT_COMMANDS.has(command.name.split(/\s/, 1)[0]!)),
  };
}

export function getHostedBuiltinCommands(hasLocalClientCommandHandlers = true): string[] {
  return getHostedRootHelp(hasLocalClientCommandHandlers).commands
    .map((command) => command.name.split(/\s/, 1)[0]!);
}

export function isLocalClientRootCommand(command: string | undefined): boolean {
  return command !== undefined && LOCAL_CLIENT_ROOT_COMMANDS.has(command);
}

export const HOSTED_BUILTIN_COMMANDS = getHostedBuiltinCommands();

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
