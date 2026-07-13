import { formatArgSummary } from '../serialization.js';
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

export function hostedListRows(manifest: HostedManifest, structured: boolean): Record<string, unknown>[] {
  return hostedCommands(manifest).map((command) => {
    const row = {
      command: command.command,
      site: command.site,
      name: command.name,
      aliases: command.aliases ?? [],
      description: command.description,
      access: command.access,
      strategy: command.strategy.toLowerCase(),
      browser: command.browser,
      args: command.args,
      columns: command.columns ?? [],
      domain: command.domain ?? null,
    };
    if (structured) return row;
    return {
      ...row,
      aliases: command.aliases?.join(', ') ?? '',
      args: formatArgSummary(command.args.map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required,
        valueRequired: arg.valueRequired,
        positional: arg.positional,
        help: arg.help,
        choices: arg.choices?.map(String),
        default: arg.default,
      }))),
    };
  });
}

export function siteNames(manifest: HostedManifest): string[] {
  return [...new Set(hostedCommands(manifest).map((command) => command.site))].sort((a, b) => a.localeCompare(b));
}

export function commandNamesForSite(manifest: HostedManifest, site: string): string[] {
  return hostedCommands(manifest)
    .filter((command) => command.site === site)
    .flatMap((command) => [command.name, ...(command.aliases ?? [])])
    .sort((a, b) => a.localeCompare(b));
}

export function renderHostedSiteHelp(manifest: HostedManifest, site: string): string {
  const commands = hostedCommands(manifest).filter((command) => command.site === site);
  if (commands.length === 0) return `Unknown hosted Webcmd site: ${site}\n`;
  const lines = [`Usage: webcmd ${site} <command> [options]`, '', 'Commands:'];
  for (const command of commands) {
    const tag = `[${command.strategy.toLowerCase()}]`;
    lines.push(`  ${command.name.padEnd(18)} ${tag} ${command.description}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderHostedCommandHelp(command: HostedCommand): string {
  const lines = [
    `Usage: webcmd ${command.site} ${command.name} ${formatArgSummary(command.args.map((arg) => ({
      name: arg.name,
      type: arg.type,
      required: arg.required,
      valueRequired: arg.valueRequired,
      positional: arg.positional,
      help: arg.help,
      choices: arg.choices?.map(String),
      default: arg.default,
    })))} [options]`,
    '',
    command.description,
    '',
    `Access: ${command.access}`,
    `Strategy: ${command.strategy.toLowerCase()}`,
    `Browser: ${command.browser ? 'yes' : 'no'}`,
  ];
  if (command.domain) lines.push(`Domain: ${command.domain}`);
  if (command.columns?.length) lines.push(`Output columns: ${command.columns.join(', ')}`);
  return `${lines.join('\n')}\n`;
}
