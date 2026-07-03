import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../protocol.js';

export interface RuntimeStatusOptions {
  contextId?: string;
}

export interface BrowserRuntimeProvider {
  status(opts?: RuntimeStatusOptions): Promise<BrowserRuntimeStatus>;
  dispatch(command: BrowserRuntimeCommand): Promise<BrowserRuntimeResult>;
  shutdown(): Promise<void>;
}
