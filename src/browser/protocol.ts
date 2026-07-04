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
  | 'frames';

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
  url?: string;
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
  profileId?: string;
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
}
