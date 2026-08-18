import type { Command } from 'commander';

export const LIST_COMMAND_DESCRIPTION = 'List all available CLI commands';
export const LIST_FORMAT_DESCRIPTION = 'Output format: table, json, yaml, md, csv';
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
    .option('-f, --format <fmt>', 'Output format: table, json', 'table');
}

/** Configure plugin installation grammar shared by local and hosted runtimes. */
export function configurePluginInstallSurface(command: Command): Command {
  return command
    .description('Install a plugin from a git repository')
    .argument('<source>', 'Plugin source (e.g. github:user/repo)');
}

/** Configure installed-plugin listing grammar shared by local and hosted runtimes. */
export function configurePluginListSurface(command: Command): Command {
  return command
    .description('List installed plugins')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table');
}

/** Configure plugin uninstall grammar shared by local and hosted runtimes. */
export function configurePluginUninstallSurface(command: Command): Command {
  return command
    .description('Uninstall a plugin')
    .argument('<name>', 'Installed plugin name');
}

/** Configure plugin update grammar shared by local and hosted runtimes. */
export function configurePluginUpdateSurface(command: Command): Command {
  return command
    .description('Update a plugin (or all plugins) to the latest version')
    .argument('[name]', 'Installed plugin name')
    .option('--all', 'Update all installed plugins');
}
