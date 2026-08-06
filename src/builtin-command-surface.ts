import { OUTPUT_FORMAT_HELP } from './command-surface.js';
import type { Command } from 'commander';

export const LIST_COMMAND_DESCRIPTION = 'List all available CLI commands';
export const LIST_FORMAT_DESCRIPTION = OUTPUT_FORMAT_HELP;
export const COMPLETION_COMMAND_DESCRIPTION = 'Output shell completion script';
export const COMPLETION_SHELL_DESCRIPTION = 'Shell type: bash, zsh, or fish';

/** Configure built-in grammar shared by the local and hosted runtimes. */
export function configureListCommandSurface(command: Command): Command {
  return command
    .description(LIST_COMMAND_DESCRIPTION)
    .option('-f, --format <fmt>', LIST_FORMAT_DESCRIPTION, 'table')
    .option('--tag <tag>', 'Filter commands by exact tag');
}

/** Configure completion grammar shared by the local and hosted runtimes. */
export function configureCompletionCommandSurface(command: Command): Command {
  return command
    .description(COMPLETION_COMMAND_DESCRIPTION)
    .argument('<shell>', COMPLETION_SHELL_DESCRIPTION);
}

/** Configure plugin marketplace search grammar shared by local and hosted runtimes. */
export function configurePluginSearchSurface(command: Command): Command {
  return command
    .description('Search installable marketplace plugins')
    .argument('[query]', 'Search query matched against plugin name and description')
    .option('-f, --format <fmt>', OUTPUT_FORMAT_HELP, 'table');
}

/** Configure plugin installation grammar shared by local and hosted runtimes. */
export function configurePluginInstallSurface(command: Command): Command {
  return command
    .description('Install a plugin from a git repository')
    .argument('<source>', 'Plugin source (e.g. github:user/repo)');
}
