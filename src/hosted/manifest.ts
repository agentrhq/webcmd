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
  return commandListRows(hostedCommands(manifest).map(presentHostedCommand), structured);
}

export function hostedListPresentation(manifest: HostedManifest, format: string): CommandListPresentation {
  return commandListPresentation(hostedCommands(manifest).map(presentHostedCommand), format);
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
