import type { CommandSurfaceMetadata } from '../command-surface.js';
import type { Arg } from '../registry.js';

export type HostedCommandStrategy = 'PUBLIC' | 'COOKIE' | 'INTERCEPT' | 'UI' | 'LOCAL' | string;

export interface HostedCommandArg extends Arg {}

export interface HostedFileArgument {
  name: string;
  direction: 'input' | 'output';
  pathKind: 'file' | 'directory';
  multiple: boolean;
  required: boolean;
  separator?: ',';
  contentTypes?: string[];
  contentType?: string;
  maxBytes?: number;
  defaultPath?: string;
}

export interface HostedCommand extends CommandSurfaceMetadata {
  site: string;
  name: string;
  aliases?: string[];
  command: string;
  description: string;
  access: 'read' | 'write' | string;
  strategy: HostedCommandStrategy;
  browser: boolean;
  args: HostedCommandArg[];
  columns: string[];
  domain?: string | null;
  defaultFormat?: string | null;
  freshPage?: boolean;
}

export interface HostedManifest {
  userId: string;
  metadata: {
    contractSchemaVersion: number;
    webcmdPackageVersion: string;
    generatedAt: string;
  };
  commands: HostedCommand[];
}

export interface HostedPublicProfile {
  id: string;
  name: string | null;
  userId: string | null;
  default: boolean;
  status: 'pending' | 'available';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

export interface HostedProfilesResponse {
  ok: true;
  profiles: HostedPublicProfile[];
}

export interface HostedProfileResponse {
  ok: true;
  profile: HostedPublicProfile;
}

export interface HostedExecution {
  id: string;
  command: string;
  status: 'succeeded' | 'failed' | 'timed_out';
}

export interface HostedTraceReceipt {
  receipt: string;
  executionId: string;
  artifactsUrl?: string;
  liveViewUrl?: string;
  replayUrl?: string;
}

export interface HostedExecuteResponse {
  ok: true;
  result: unknown;
  columns?: string[];
  footerExtra?: string;
  execution: HostedExecution;
  trace?: HostedTraceReceipt;
  artifacts?: HostedArtifactReceipt[];
}

export interface HostedPreparedExecution {
  id: string;
  command: string;
  status: 'queued';
}

export interface HostedPrepareExecutionResponse {
  ok: true;
  execution: HostedPreparedExecution;
  fileArguments: HostedFileArgument[];
}

export interface HostedArtifactReceipt {
  artifactId: string;
  argument: string;
  direction: 'input' | 'output';
  pathKind: 'file' | 'directory';
  filename: string;
  contentType: string;
  byteSize: number;
  sha256?: string;
  relativePath?: string;
  expiresAt: string;
}

export interface HostedArtifactReference {
  $webcmdArtifact: {
    id?: string;
    direction?: 'input' | 'output';
    filename?: string;
    contentType?: string;
  };
}

export interface HostedUploadArtifactResponse {
  ok: true;
  artifact: HostedArtifactReceipt;
  reference: HostedArtifactReference;
}

export type HostedBrowserActionName =
  | 'analyze'
  | 'back'
  | 'check'
  | 'click'
  | 'close-window'
  | 'console'
  | 'dblclick'
  | 'dialog-accept'
  | 'dialog-dismiss'
  | 'drag'
  | 'exec'
  | 'extract'
  | 'fill'
  | 'find'
  | 'focus'
  | 'frames'
  | 'get-attributes'
  | 'get-html'
  | 'get-text'
  | 'get-title'
  | 'get-url'
  | 'get-value'
  | 'hover'
  | 'init'
  | 'insert-text'
  | 'navigate'
  | 'network'
  | 'press-key'
  | 'screenshot'
  | 'scroll'
  | 'select'
  | 'set-file-input'
  | 'snapshot'
  | 'tabs'
  | 'type'
  | 'uncheck'
  | 'verify'
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
  result: unknown;
  columns: string[];
  trace: HostedBrowserActionTrace | null;
}

export interface HostedBrowserActionTrace {
  id: string;
  receipt: string;
  kind: string;
  contentType?: string;
  byteSize?: number;
  storagePath?: string;
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
    code: string;
    message: string;
    help?: string;
    exitCode?: number;
  };
  execution?: HostedExecution;
  trace?: HostedTraceReceipt;
}
