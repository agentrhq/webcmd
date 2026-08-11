import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../protocol.js';
import type { BrowserSessionListRow, BrowserSessionRecord } from '../sessions.js';

export interface RuntimeStatusOptions {
  contextId?: string;
}

export interface BrowserRuntimeProvider {
  status(opts?: RuntimeStatusOptions): Promise<BrowserRuntimeStatus>;
  resolveProfileId?(command: BrowserRuntimeCommand): string;
  createSession?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  requireSession?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  resolveAdapterDefault?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  listSessions?(input: { profileId?: string }): Promise<BrowserSessionListRow[]>;
  closeSession?(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }>;
  dispatch(command: BrowserRuntimeCommand): Promise<BrowserRuntimeResult>;
  shutdown(): Promise<void>;
}
