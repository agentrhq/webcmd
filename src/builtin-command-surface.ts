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

export function configureSiteMemoryShowSurface(command: Command): Command {
  return command
    .description('Print site memory')
    .argument('<site>', 'Site name')
    .option('--kind <kind>', 'Filter: notes, endpoints, field-map, verify, fixture');
}

export function configureSiteMemoryListSurface(command: Command): Command {
  return command
    .description('List site memory artifacts')
    .argument('<site>', 'Site name');
}

export function configureSiteNoteAddSurface(command: Command): Command {
  return command
    .description('Add a site memory note')
    .argument('<site>', 'Site name')
    .requiredOption('--text <markdown>', 'Note text')
    .option('--author <author>', 'Note author');
}

export function configureSiteEndpointSetSurface(command: Command): Command {
  return command
    .description('Set a verified endpoint')
    .argument('<site>', 'Site name')
    .argument('<name>', 'Endpoint name')
    .requiredOption('--url <url>', 'Endpoint URL')
    .requiredOption('--method <method>', 'HTTP method')
    .option('--params <json>', 'Endpoint parameters as a JSON object')
    .option('--rows-path <path>', 'Result rows path')
    .option('--fields <fields>', 'Comma-separated sample fields')
    .option('--notes <text>', 'Endpoint notes');
}

export function configureSiteEndpointStaleSurface(command: Command): Command {
  return command
    .description('Mark an endpoint stale')
    .argument('<site>', 'Site name')
    .argument('<name>', 'Endpoint name');
}

export function configureSiteFieldMapAddSurface(command: Command): Command {
  return command
    .description('Add a field mapping')
    .argument('<site>', 'Site name')
    .argument('<key>', 'Observed field key')
    .requiredOption('--meaning <meaning>', 'Field meaning')
    .requiredOption('--source <source>', 'Evidence source')
    .option('--force', 'Overwrite an existing mapping');
}

export function configureSiteFixtureGetSurface(command: Command): Command {
  return command
    .description('Get a verify fixture')
    .argument('<site-command>', 'Site and command in site/command format')
    .option('--output <path>', 'Write fixture to this path');
}

export function configureSiteFixturePutSurface(command: Command): Command {
  return command
    .description('Validate and store a verify fixture')
    .argument('<site-command>', 'Site and command in site/command format')
    .argument('<path>', 'Fixture file path');
}

export function configureSiteSampleAddSurface(command: Command): Command {
  return command
    .description('Store a response sample')
    .argument('<site-command>', 'Site and command in site/command format')
    .argument('<path>', 'Sample file path');
}
