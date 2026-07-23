import type { SessionLeaseStatus } from '../session-lease.js';

export type BrowserRuntimeAction =
  | 'exec'
  | 'navigate'
  | 'tabs'
  | 'cookies'
  | 'screenshot'
  | 'close-window'
  | 'set-file-input'
  | 'insert-text'
  | 'bind'
  | 'network-capture-start'
  | 'network-capture-read'
  | 'wait-download'
  | 'cdp'
  | 'frames'
  | 'lease-release';

export type BrowserSurface = 'browser' | 'adapter';
export type SiteSessionMode = 'ephemeral' | 'persistent';
export type BrowserWindowMode = 'foreground' | 'background';

export interface BrowserRuntimeCommand {
  id: string;
  action: BrowserRuntimeAction;
  page?: string;
  code?: string;
  session?: string;
  surface?: BrowserSurface;
  siteSession?: SiteSessionMode;
  /** Close any existing leased page and start on a new one (sent on the first action of a command run). */
  freshPage?: boolean;
  url?: string;
  /** Navigation wait condition: 'none' returns once navigation commits instead of waiting for the load event. */
  waitUntil?: 'load' | 'none';
  op?: string;
  index?: number;
  domain?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  width?: number;
  height?: number;
  files?: string[];
  selector?: string;
  text?: string;
  pattern?: string;
  timeoutMs?: number;
  /** Daemon command timeout in seconds. Preserves the existing daemon protocol field. */
  timeout?: number;
  /** Absolute command deadline in epoch milliseconds. Preferred by newer daemons. */
  deadlineAt?: number;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
  windowMode?: BrowserWindowMode;
  idleTimeout?: number;
  frameIndex?: number;
  contextId?: string;
  preferredContextId?: string;
  profileId?: string;
  /** Stable identity for the complete logical CLI command run. */
  runId?: string;
  /** Human-readable canonical command that owns the logical run. */
  command?: string;
  /** Access classification used by daemon-local lease arbitration. */
  access?: 'read' | 'write';
  /** Originating CLI process, used only for actionable local busy guidance. */
  pid?: number;
}

export interface BrowserRuntimeResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errorHint?: string;
  page?: string;
}

export interface BrowserRuntimeProfileStatus {
  contextId: string;
  runtimeConnected: boolean;
  runtimeVersion?: string;
  pending: number;
  lastSeenAt?: number;
}

export interface BrowserRuntimeStatus {
  runtimeConnected: boolean;
  runtimeName: string;
  runtimeVersion?: string;
  contextId?: string;
  profileRequired?: boolean;
  profileDisconnected?: boolean;
  profiles: BrowserRuntimeProfileStatus[];
  pending: number;
  commandResultUnknown?: number;
  /** Active local leases with internal run ownership tokens removed. */
  sessionLeases?: SessionLeaseStatus[];
}
