import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../protocol.js';
import type { BrowserSessionListRow, BrowserSessionRecord } from '../sessions.js';

export interface RuntimeStatusOptions {
  contextId?: string;
}

export interface BrowserRuntimeProvider {
  status(opts?: RuntimeStatusOptions): Promise<BrowserRuntimeStatus>;
  resolveProfileId?(command: BrowserRuntimeCommand): string;
  ensureProfile?(input: { alias: string; idempotencyKey: string }): Promise<{ profile: { id: string; displayName: string }; created: boolean }>;
  createSession?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  requireSession?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  resolveAdapterDefault?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  startSessionHandoff?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  clearSessionHandoff?(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
  listSessions?(input: { profileId?: string; limit?: number; includeDiscovered?: boolean }): Promise<BrowserSessionListRow[]>;
  closeSession?(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }>;
  dispatch(command: BrowserRuntimeCommand, signal?: AbortSignal): Promise<BrowserRuntimeResult>;
  shutdown(): Promise<void>;
}
