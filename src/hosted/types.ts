import type { CommandSurfaceMetadata } from '../command-surface.js';
import type { Arg } from '../registry.js';
import type { FileArgumentDirection } from './contract.js';

export const HOSTED_SESSION_PROTOCOL_VERSION = 1 as const;

export type HostedCommandStrategy = 'PUBLIC' | 'COOKIE' | 'INTERCEPT' | 'UI' | 'LOCAL' | string;

export interface HostedCommandArg extends Arg {}

export interface HostedFileArgument {
  name: string;
  direction: FileArgumentDirection;
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
  clientOwned?: boolean;
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
  tags?: string[];
  keywords?: string[];
  domain?: string | null;
  defaultFormat?: string | null;
  freshPage?: boolean;
  adapterPackageId?: string;
  sourceFile?: string;
  modulePath?: string;
}

export interface HostedManifest {
  userId: string;
  metadata: {
    contractSchemaVersion: number;
    sessionProtocolVersion: number;
    webcmdPackageVersion: string;
    generatedAt: string;
  };
  commands: HostedCommand[];
}

export interface HostedPublicProfile {
  id: string;
  name: string | null;
  workspace: string | null;
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

export interface HostedBrowserSession {
  id: string;
  kind: 'explicit' | 'adapter-default';
  profileId: string;
  runtimeState: 'active' | 'idle';
  handoff: { site: string; expiresAt: string } | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

export interface HostedCreatedBrowserSession extends HostedBrowserSession {
  liveViewUrl: string;
}

export interface HostedBrowserSessionResponse {
  ok: true;
  session: HostedCreatedBrowserSession;
}

export interface HostedBrowserSessionsResponse {
  ok: true;
  sessions: HostedBrowserSession[];
}

export interface HostedBrowserSessionCloseResponse {
  ok: true;
  closed: boolean;
  alreadyIdle: boolean;
  session: string;
  displaced?: { executionId?: string; handoffSite?: string };
}

export type HostedMarketplaceAvailability = 'hosted' | 'mixed' | 'local-only';

export interface HostedMarketplacePlugin {
  name: string;
  description?: string;
  version?: string;
  sourceId: string;
  installSource: string;
  webcmd?: string;
  availability: HostedMarketplaceAvailability;
  excludedCommands: string[];
}

export interface HostedMarketplaceSearchError {
  sourceId: string;
  manifestUrl: string;
  message: string;
}

export interface HostedMarketplaceSearchResult {
  plugins: HostedMarketplacePlugin[];
  errors: HostedMarketplaceSearchError[];
}

export interface HostedMarketplaceInstallation {
  installationId: string;
  name: string;
  version: string;
  installSource: string;
}

export interface HostedMarketplaceInstallationRow {
  name: string;
  version: string;
  installSource: string;
  sourceCommit: string | null;
  installedAt: string;
  updateAvailable: boolean;
}

export interface HostedSiteMemoryArtifact {
  path: string;
  kind: string;
  contentType: string;
  sha256: string;
  byteSize: number;
  updatedAt: string;
}

export interface HostedAdapterSourceWriteResponse {
  packageId: string;
  storagePath: string;
  commands: string[];
}

export interface HostedAdapterOverrideResponse {
  command: string;
  packageId: string;
  packageName: string;
  sourceFile: string | null;
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
  liveViewUrl?: string;
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
    inputId?: string;
    direction?: FileArgumentDirection;
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
  | 'bind'
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
  | 'fork'
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
  | 'run'
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
  args: HostedBrowserActionArgs;
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
    expiresAt?: string;
  };
}

export interface HostedBrowserActionRequest {
  action: HostedBrowserActionName;
  args: HostedBrowserActionArgs;
  profile?: string;
}

export interface HostedBrowserActionArgs extends Record<string, unknown> {
  snapshotMode?: 'act' | 'tree' | 'read';
  ref?: string;
  noSnapshotDiff?: boolean;
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

export interface HostedBrowserSnapshotActionResponse {
  ok: true;
  run: HostedBrowserRunResponse['run'];
  result: unknown;
}

export interface HostedErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    help?: string;
    exitCode?: number;
    details?: Record<string, unknown>;
  };
  execution?: HostedExecution;
  trace?: HostedTraceReceipt;
}
