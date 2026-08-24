import {
  commandHelpData,
  commandListPresentation,
  commandListRows,
  formatCommandHelp,
  formatSiteHelp,
  getCommandCompletionCandidates,
  siteHelpData,
  toPresentableCommand,
  type PresentableCommand,
  type CommandListPresentation,
} from '../command-presentation.js';
import type { HostedCommand, HostedManifest } from './types.js';
import { webFetchCommand } from '../fetch/command.js';

const clientOwnedCommands: HostedCommand[] = [{
  site: webFetchCommand.site,
  name: webFetchCommand.name,
  ...(webFetchCommand.aliases ? { aliases: [...webFetchCommand.aliases] } : {}),
  command: `${webFetchCommand.site}/${webFetchCommand.name}`,
  description: webFetchCommand.description,
  access: webFetchCommand.access,
  strategy: (webFetchCommand.strategy ?? 'public').toUpperCase(),
  browser: webFetchCommand.browser === true,
  args: webFetchCommand.args.map(arg => ({ ...arg, ...(arg.choices ? { choices: [...arg.choices] } : {}) })),
  columns: [...(webFetchCommand.columns ?? [])],
  ...(webFetchCommand.tags ? { tags: [...webFetchCommand.tags] } : {}),
  ...(webFetchCommand.keywords ? { keywords: [...webFetchCommand.keywords] } : {}),
  ...(webFetchCommand.domain ? { domain: webFetchCommand.domain } : {}),
  ...(webFetchCommand.defaultFormat ? { defaultFormat: webFetchCommand.defaultFormat } : {}),
  ...(webFetchCommand.freshPage ? { freshPage: true } : {}),
  clientOwned: true,
}];

export function withClientOwnedCommands(manifest: HostedManifest, enabled = true): HostedManifest {
  const localCommandNames = new Set(clientOwnedCommands.map(command => command.command));
  return {
    ...manifest,
    commands: [
      ...manifest.commands.filter(command => !localCommandNames.has(command.command)),
      ...(enabled ? clientOwnedCommands : []),
    ],
  };
}

export function isLocalOnlyHostedCommand(command: HostedCommand): boolean {
  return command.strategy.toUpperCase() === 'LOCAL';
}

export function hostedCommands(manifest: HostedManifest): HostedCommand[] {
  return manifest.commands
    .filter((command) => !isLocalOnlyHostedCommand(command))
    .sort((a, b) => a.command.localeCompare(b.command));
}

export function findHostedCommand(manifest: HostedManifest, site: string, name: string): HostedCommand | null {
  return manifest.commands.find((command) => {
    return command.site === site && (command.name === name || command.aliases?.includes(name));
  }) ?? null;
}

export function presentHostedCommand(command: HostedCommand): PresentableCommand {
  return toPresentableCommand(command);
}

export function hostedListRows(manifest: HostedManifest, structured: boolean): Record<string, unknown>[] {
  return markClientOwned(commandListRows(hostedCommands(manifest).map(presentHostedCommand), structured), structured);
}

export function hostedListPresentation(manifest: HostedManifest, format: string): CommandListPresentation {
  const presentation = commandListPresentation(hostedCommands(manifest).map(presentHostedCommand), format);
  return {
    ...presentation,
    rows: markClientOwned(presentation.rows, presentation.structured),
  };
}

function markClientOwned(rows: Record<string, unknown>[], structured: boolean): Record<string, unknown>[] {
  if (!structured) return rows;
  return rows.map(row => row.command === 'web/fetch' ? { ...row, clientOwned: true } : row);
}

export function siteNames(manifest: HostedManifest): string[] {
  return getCommandCompletionCandidates(hostedCommands(manifest), [], 1, []);
}

export function commandNamesForSite(manifest: HostedManifest, site: string): string[] {
  return getCommandCompletionCandidates(hostedCommands(manifest), [site], 2, []);
}

export function renderHostedSiteHelp(manifest: HostedManifest, site: string): string {
  const commands = hostedCommands(manifest).filter((command) => command.site === site);
  if (commands.length === 0) return `Unknown hosted Webcmd site: ${site}\n`;
  return formatSiteHelp(site, commands.map(presentHostedCommand));
}

export function hostedSiteHelpData(manifest: HostedManifest, site: string): Record<string, unknown> | null {
  const commands = hostedCommands(manifest).filter((command) => command.site === site);
  if (commands.length === 0) return null;
  return siteHelpData(site, commands.map(presentHostedCommand));
}

export function renderHostedCommandHelp(command: HostedCommand): string {
  return formatCommandHelp(presentHostedCommand(command));
}

export function hostedCommandHelpData(command: HostedCommand): Record<string, unknown> {
  return commandHelpData(presentHostedCommand(command));
}
