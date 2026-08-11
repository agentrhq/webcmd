import { classifyAdapter } from '../help.js';
import { Strategy } from '../registry.js';

export type HostedAvailability =
  | { mode: 'hosted' }
  | { mode: 'local-only'; reason: 'desktop-app' | 'local-tool' | 'browser-bind' | 'client-owned' };

export interface HostedAvailabilityMetadata {
  strategy?: Strategy | string;
  domain?: string;
  /** The CLI always executes this command itself — see BaseCliCommand.clientOwned. */
  clientOwned?: boolean;
}

export function deriveHostedAvailability(command: HostedAvailabilityMetadata): HostedAvailability {
  // Ownership is declared, not inferred: a client-owned command is PUBLIC and
  // non-browser, so nothing else in its metadata would keep the server from
  // advertising and executing a second, differently-behaved copy of it.
  if (command.clientOwned === true) {
    return { mode: 'local-only', reason: 'client-owned' };
  }
  if (String(command.strategy).toLowerCase() === Strategy.LOCAL) {
    return { mode: 'local-only', reason: 'local-tool' };
  }
  if (classifyAdapter(command.domain) === 'app') {
    return { mode: 'local-only', reason: 'desktop-app' };
  }
  return { mode: 'hosted' };
}

export function deriveBrowserAvailability(command: string): HostedAvailability {
  void command;
  return { mode: 'hosted' };
}
