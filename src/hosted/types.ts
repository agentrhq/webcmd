export type HostedCommandStrategy = 'PUBLIC' | 'COOKIE' | 'INTERCEPT' | 'UI' | 'LOCAL' | string;

export interface HostedCommandArg {
  name: string;
  type?: string;
  required?: boolean;
  valueRequired?: boolean;
  positional?: boolean;
  default?: unknown;
  help?: string;
  choices?: unknown[];
}

export interface HostedCommand {
  site: string;
  name: string;
  aliases?: string[];
  command: string;
  description: string;
  access: 'read' | 'write' | string;
  strategy: HostedCommandStrategy;
  browser: boolean;
  args: HostedCommandArg[];
  columns?: string[];
  domain?: string | null;
  defaultFormat?: string | null;
}

export interface HostedManifest {
  userId: string;
  generatedAt: string;
  commands: HostedCommand[];
}

export interface HostedExecuteResponse {
  ok: true;
  result?: unknown;
  data?: unknown;
  rows?: unknown;
  columns?: string[];
  trace?: unknown;
}

export type HostedBrowserActionName =
  | 'back'
  | 'click'
  | 'close-window'
  | 'console'
  | 'exec'
  | 'fill'
  | 'frames'
  | 'insert-text'
  | 'navigate'
  | 'network'
  | 'press-key'
  | 'screenshot'
  | 'scroll'
  | 'set-file-input'
  | 'snapshot'
  | 'tabs'
  | 'type'
  | 'wait';

export interface HostedBrowserRunRequest {
  command: string;
  args: Record<string, unknown>;
  profile?: string;
  windowMode?: 'foreground' | 'background';
  trace?: string;
}

export interface HostedBrowserRunResponse {
  ok: true;
  run: {
    executionId: string;
    session: string;
    profile: {
      id: string;
      displayName: string;
    };
    liveViewUrl?: string;
  };
}

export interface HostedBrowserActionRequest {
  action: HostedBrowserActionName;
  args: Record<string, unknown>;
  profile?: string;
}

export interface HostedBrowserActionResponse {
  ok: true;
  result?: unknown;
  columns?: string[];
  trace?: unknown;
}

export interface HostedBrowserFinishRequest {
  status: 'succeeded' | 'failed' | 'timed_out';
  errorCode?: string;
  profile?: string;
}

export interface HostedBrowserFinishResponse {
  ok: true;
  execution: {
    id: string;
    status: 'succeeded' | 'failed' | 'timed_out';
  };
}

export interface HostedBrowserRunActionInput extends HostedBrowserRunRequest, HostedBrowserActionRequest {}

export interface HostedBrowserRunActionResponse extends HostedBrowserActionResponse {
  run: HostedBrowserRunResponse['run'];
  execution: HostedBrowserFinishResponse['execution'];
}

export interface HostedErrorResponse {
  ok: false;
  error: {
    code?: string;
    message?: string;
    help?: string;
    hint?: string;
    exitCode?: number;
  };
}
