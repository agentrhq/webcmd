import { parseCommandSurface, type ParsedCommandSurface } from '../command-surface.js';
import type { HostedCommand } from './types.js';

export type ParsedHostedInvocation = ParsedCommandSurface;

export function parseHostedInvocation(command: HostedCommand, argv: string[]): ParsedHostedInvocation {
  return parseCommandSurface(command, argv);
}
