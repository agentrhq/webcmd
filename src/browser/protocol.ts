import type { SessionLeaseStatus } from '../session-lease.js';
import type { BrowserSessionListRow } from './sessions.js';
import type { SnapshotMode } from './snapshot/index.js';

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
  | 'run'
  | 'snapshot'
  | 'lease-release'
  | 'run-cancel'
  | 'session-create'
  | 'session-list'
  | 'session-close'
  | 'session-handoff-start'
  | 'session-handoff-clear';

export type BrowserSurface = 'browser' | 'adapter';
export type SiteSessionMode = 'ephemeral' | 'persistent';
export type BrowserWindowMode = 'foreground' | 'background';

export interface BrowserRuntimeCommand {
  id: string;
  action: BrowserRuntimeAction;
  page?: string;
  code?: string;
  session?: string;
  sessionId?: string;
  sessionKind?: 'explicit' | 'adapter-default';
  surface?: BrowserSurface;
  siteSession?: SiteSessionMode;
  /** Trusted adapter identity used for admission and tab routing. */
  adapterSite?: string;
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
  /** Force Session lifecycle actions such as close past active work/handoff guards. */
  force?: boolean;
  /** Maximum Session rows returned by session-list. */
  limit?: number;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
  windowMode?: BrowserWindowMode;
  idleTimeout?: number;
  frameIndex?: number;
  /** Agent-authored JavaScript executed by the browser-run QuickJS sandbox. */
  source?: string;
  snapshotDiff?: boolean;
  snapshotMode?: SnapshotMode;
  ref?: string;
  noSnapshotDiff?: boolean;
  maxOutputChars?: number;
  memoryLimitBytes?: number;
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
  /** Site and expiry payload for internal Session handoff controls. */
  site?: string;
  expiresAt?: string;
}

export interface BrowserRuntimeResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errorHint?: string;
  details?: unknown;
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
  sessions?: BrowserSessionListRow[];
}
