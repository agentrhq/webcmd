import { attachTraceReceipt, CliError, EXIT_CODES, type ExitCode } from '../errors.js';
import { HOSTED_SESSION_PROTOCOL_VERSION } from './types.js';
import type {
  HostedBrowserActionRequest,
  HostedBrowserActionResponse,
  HostedBrowserFinishRequest,
  HostedBrowserFinishResponse,
  HostedBrowserSessionCloseResponse,
  HostedBrowserSessionResponse,
  HostedBrowserSessionsResponse,
  HostedBrowserRunActionInput,
  HostedBrowserRunActionResponse,
  HostedBrowserSnapshotActionResponse,
  HostedBrowserRunRequest,
  HostedBrowserRunResponse,
  HostedArtifactReceipt,
  HostedErrorResponse,
  HostedExecution,
  HostedExecuteResponse,
  HostedPrepareExecutionResponse,
  HostedProfilesResponse,
  HostedUploadArtifactResponse,
  HostedManifest,
  HostedMarketplaceInstallation,
  HostedMarketplaceInstallationRow,
  HostedMarketplaceSearchResult,
  HostedSiteMemoryArtifact,
  HostedAdapterOverrideResponse,
  HostedAdapterSourceWriteResponse,
  HostedTraceReceipt,
} from './types.js';

export interface HostedClientOptions {
  apiBaseUrl: string;
  apiKey: string;
  workspace?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resolves the active workspace from CLI flags/env, precedence: --workspace flag > WEBCMD_WORKSPACE env > undefined.
 */
export function resolveWorkspace(argv: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  const idx = argv.indexOf('--workspace');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  const equalsForm = argv.find(arg => arg.startsWith('--workspace='));
  if (equalsForm !== undefined) {
    const value = equalsForm.slice('--workspace='.length).trim();
    if (value) return value;
  }
  const fromEnv = env.WEBCMD_WORKSPACE?.trim();
  return fromEnv ? fromEnv : undefined;
}

export class HostedClientError extends CliError {
  readonly execution?: HostedExecution;
  readonly trace?: HostedTraceReceipt;

  constructor(
    code: string,
    message: string,
    help?: string,
    exitCode: ExitCode = EXIT_CODES.GENERIC_ERROR,
    metadata: { execution?: HostedExecution; trace?: HostedTraceReceipt } = {},
  ) {
    super(code, message, help, exitCode);
    this.execution = metadata.execution;
    this.trace = metadata.trace;
    if (metadata.trace) attachTraceReceipt(this, metadata.trace);
  }
}

export class HostedClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly workspace: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HostedClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.workspace = options.workspace;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getMe(): Promise<unknown> {
    return this.request('/v1/me');
  }

  async getManifest(): Promise<HostedManifest> {
    const body = await this.request('/v1/manifest');
    const manifestMetadata = isRecord(body)
      && isRecord(body.manifest)
      && isRecord(body.manifest.metadata)
      ? body.manifest.metadata
      : undefined;
    const sessionProtocolVersion = manifestMetadata?.sessionProtocolVersion;
    if (
      manifestMetadata
      && (
        sessionProtocolVersion === undefined
        || (
          typeof sessionProtocolVersion === 'number'
          && Number.isInteger(sessionProtocolVersion)
          && sessionProtocolVersion > 0
          && sessionProtocolVersion !== HOSTED_SESSION_PROTOCOL_VERSION
        )
      )
    ) {
      throw new HostedClientError(
        'HOSTED_CONTRACT_MISMATCH',
        'Webcmd Cloud manifest does not match this installed Webcmd hosted contract.',
        'Upgrade Webcmd or use a compatible Webcmd Cloud endpoint.',
        EXIT_CODES.CONFIG_ERROR,
      );
    }
    if (!hasExactKeys(body, ['ok', 'manifest']) || !isHostedManifest(body.manifest)) {
      throw protocolError('Webcmd Cloud returned an invalid manifest.');
    }
    return body.manifest;
  }

  async listProfiles(): Promise<HostedProfilesResponse> {
    const body = await this.request('/v1/profiles');
    if (!isHostedProfilesResponse(body)) {
      throw protocolError('Webcmd Cloud returned an invalid profiles response.');
    }
    return body;
  }

  async deleteProfile(profileId: string): Promise<{ ok: true; deleted: true }> {
    const body = await this.request(`/v1/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    if (!hasExactKeys(body, ['ok', 'deleted']) || body.ok !== true || body.deleted !== true) {
      throw protocolError('Webcmd Cloud returned an invalid profile deletion response.');
    }
    return { ok: true, deleted: true };
  }

  async createBrowserSession(profile?: string): Promise<HostedBrowserSessionResponse> {
    const body = await this.request('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(profile !== undefined ? { profile } : {}),
    });
    if (!isHostedBrowserSessionResponse(body)) {
      throw protocolError('Webcmd Cloud returned an invalid browser session response.');
    }
    return body;
  }

  async listBrowserSessions(profile?: string, limit?: number): Promise<HostedBrowserSessionsResponse> {
    const body = await this.request(`/v1/sessions${sessionListQuery(profile, limit)}`);
    if (!isHostedBrowserSessionsResponse(body)) {
      throw protocolError('Webcmd Cloud returned an invalid browser session list.');
    }
    return body;
  }

  async closeBrowserSession(session: string, profile?: string, force = false): Promise<HostedBrowserSessionCloseResponse> {
    const body = await this.request(`/v1/sessions/${encodeURIComponent(session)}/close${profileQuery(profile)}`, {
      method: 'POST',
      body: JSON.stringify(force ? { force: true } : {}),
    });
    if (!isHostedBrowserSessionCloseResponse(body)) {
      throw protocolError('Webcmd Cloud returned an invalid browser session close response.');
    }
    return body;
  }

  async searchMarketplacePlugins(query?: string): Promise<HostedMarketplaceSearchResult> {
    const params = new URLSearchParams();
    if (query !== undefined) params.set('query', query);
    const body = await this.request(`/v1/marketplace/plugins${params.size ? `?${params}` : ''}`);
    if (!hasExactKeys(body, ['ok', 'result']) || body.ok !== true || !isHostedMarketplaceSearchResult(body.result)) {
      throw protocolError('Webcmd Cloud returned an invalid marketplace search response.');
    }
    return body.result;
  }

  async installMarketplacePlugin(installSource: string): Promise<HostedMarketplaceInstallation> {
    const body = await this.request('/v1/marketplace/installations', {
      method: 'POST',
      body: JSON.stringify({ installSource }),
    });
    if (!hasExactKeys(body, ['ok', 'result']) || body.ok !== true || !isHostedMarketplaceInstallation(body.result)) {
      throw protocolError('Webcmd Cloud returned an invalid marketplace installation response.');
    }
    return body.result;
  }

  async listMarketplaceInstallations(): Promise<HostedMarketplaceInstallationRow[]> {
    const body = await this.request('/v1/marketplace/installations');
    if (!hasExactKeys(body, ['ok', 'result']) || body.ok !== true
      || !isRecord(body.result) || !Array.isArray(body.result.installations)
      || !body.result.installations.every(isHostedMarketplaceInstallationRow)) {
      throw protocolError('Webcmd Cloud returned an invalid marketplace installation list.');
    }
    return body.result.installations;
  }

  async uninstallMarketplacePlugin(name: string): Promise<{ uninstalled: true }> {
    const body = await this.request(`/v1/marketplace/installations/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!hasExactKeys(body, ['ok', 'result']) || body.ok !== true
      || !isRecord(body.result) || body.result.uninstalled !== true) {
      throw protocolError('Webcmd Cloud returned an invalid marketplace uninstall response.');
    }
    return { uninstalled: true };
  }

  async updateMarketplacePlugin(name: string): Promise<HostedMarketplaceUpdateResult> {
    const body = await this.request(`/v1/marketplace/installations/${encodeURIComponent(name)}/update`, { method: 'POST' });
    if (!hasExactKeys(body, ['ok', 'result']) || body.ok !== true
      || !isHostedMarketplaceUpdateResult(body.result)) {
      throw protocolError('Webcmd Cloud returned an invalid marketplace update response.');
    }
    return body.result;
  }

  async listSiteMemory(site: string): Promise<HostedSiteMemoryArtifact[]> {
    const body = await this.request(`/v1/sites/${encodeURIComponent(site)}/memory`);
    if (!isHostedSiteMemoryListResponse(body)) throw protocolError('Webcmd Cloud returned an invalid site memory list.');
    return body.artifacts;
  }

  async readSiteMemory(site: string, path: string): Promise<string> {
    return this.requestText(`/v1/sites/${encodeURIComponent(site)}/memory/${encodePath(path)}`);
  }

  async writeSiteMemory(site: string, path: string, body: string, contentType = 'application/json'): Promise<void> {
    const result = await this.request(`/v1/sites/${encodeURIComponent(site)}/memory/${encodePath(path)}`, {
      method: 'PUT', headers: { 'content-type': contentType }, body,
    });
    if (!isHostedOkResponse(result)) throw protocolError('Webcmd Cloud returned an invalid site memory write response.');
  }

  async deleteSiteMemory(site: string, path: string, body?: string): Promise<void> {
    const result = await this.request(`/v1/sites/${encodeURIComponent(site)}/memory/${encodePath(path)}`, {
      method: 'DELETE', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
    });
    if (!isHostedSiteMemoryDeletionResponse(result)) throw protocolError('Webcmd Cloud returned an invalid site memory deletion response.');
  }

  async readAdapterSource(packageId: string, sourcePath: string): Promise<string> {
    return this.requestText(`/v1/adapters/${encodeURIComponent(packageId)}/source/${encodePath(sourcePath)}`);
  }

  async writeAdapterSource(packageId: string, sourcePath: string, body: string): Promise<HostedAdapterSourceWriteResponse> {
    const result = await this.request(`/v1/adapters/${encodeURIComponent(packageId)}/source/${encodePath(sourcePath)}`, {
      method: 'PUT', headers: { 'content-type': 'text/javascript; charset=utf-8' }, body,
    });
    if (!isHostedAdapterSourceWriteResponse(result)) throw protocolError('Webcmd Cloud returned an invalid adapter source write response.');
    return { packageId: result.package.id, storagePath: result.package.storagePath, commands: result.commands };
  }

  /** Hosted `adapter override`: fork an installed system command into a private package. */
  async overrideAdapter(commandKey: string): Promise<HostedAdapterOverrideResponse> {
    const result = await this.request('/v1/adapters/override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: commandKey }),
    });
    if (!isHostedAdapterOverrideResponse(result)) throw protocolError('Webcmd Cloud returned an invalid adapter override response.');
    return {
      command: result.command,
      packageId: result.package.id,
      packageName: result.package.name,
      sourceFile: result.sourceFile,
    };
  }

  async execute(input: {
    command: string;
    args: Record<string, unknown>;
    format?: string;
    trace?: string;
    profile?: string;
    session?: string;
  }): Promise<HostedExecuteResponse> {
    const traceMode = normalizeTraceMode(input.trace);
    const body = await this.request('/v1/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    }, { command: input.command, traceMode });
    if (!isHostedExecuteResponse(body, input.command, traceMode)) {
      throw protocolError('Webcmd Cloud returned an invalid execution response.');
    }
    return body;
  }

  async prepareExecution(input: {
    command: string;
    profile?: string;
    session?: string;
    executionScope?: 'profile' | 'stateless';
  }): Promise<HostedPrepareExecutionResponse> {
    const body = await this.request('/v1/executions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedPrepareExecutionResponse(body, input.command)) {
      throw protocolError('Webcmd Cloud returned an invalid prepared execution response.');
    }
    return body;
  }

  async uploadExecutionArtifact(input: {
    executionId: string;
    argument: string;
    filename: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<HostedUploadArtifactResponse> {
    const body = await this.request(`/v1/executions/${encodeURIComponent(input.executionId)}/artifacts/${encodeURIComponent(input.argument)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-webcmd-filename': input.filename,
        'x-webcmd-content-type': input.contentType,
      },
      body: input.body as BodyInit,
    });
    if (!isHostedUploadArtifactResponse(body, input.argument)) {
      throw protocolError('Webcmd Cloud returned an invalid artifact upload response.');
    }
    return body;
  }

  async runPreparedExecution(input: {
    executionId: string;
    command: string;
    args: Record<string, unknown>;
    format?: string;
    trace?: string;
    profile?: string;
    session?: string;
  }): Promise<HostedExecuteResponse> {
    const traceMode = normalizeTraceMode(input.trace);
    const body = await this.request(`/v1/executions/${encodeURIComponent(input.executionId)}/run`, {
      method: 'POST',
      body: JSON.stringify({
        command: input.command,
        args: input.args,
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.trace !== undefined ? { trace: input.trace } : {}),
        ...(input.profile !== undefined ? { profile: input.profile } : {}),
        ...(input.session !== undefined ? { session: input.session } : {}),
      }),
    }, { command: input.command, traceMode });
    if (!isHostedExecuteResponse(body, input.command, traceMode)) {
      throw protocolError('Webcmd Cloud returned an invalid execution response.');
    }
    return body;
  }

  async downloadExecutionArtifact(input: {
    executionId: string;
    artifactId: string;
  }): Promise<Uint8Array> {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/executions/${encodeURIComponent(input.executionId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
      {
        headers: {
          accept: 'application/octet-stream',
          authorization: `Bearer ${this.apiKey}`,
          ...(this.workspace ? { 'x-webcmd-workspace': this.workspace } : {}),
        },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      const body = text ? parseJson(text) : {};
      if (!isHostedError(body)) throw protocolError('Webcmd Cloud returned an invalid artifact download failure.');
      const error = body.error;
      throw new HostedClientError(
        error.code,
        error.message,
        error.help,
        normalizeExitCode(error.exitCode, response.status === 401 ? EXIT_CODES.NOPERM : EXIT_CODES.GENERIC_ERROR),
        {
          ...(body.execution ? { execution: body.execution } : {}),
          ...(body.trace ? { trace: body.trace } : {}),
        },
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async startBrowserRun(session: string, input: HostedBrowserRunRequest): Promise<HostedBrowserRunResponse> {
    const body = await this.request(`/v1/browser/${encodeURIComponent(session)}/runs`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedBrowserRunResponse(body, session)) {
      throw protocolError('Webcmd Cloud returned an invalid browser run response.');
    }
    return body;
  }

  async browserAction(
    session: string,
    executionId: string,
    input: HostedBrowserActionRequest,
  ): Promise<HostedBrowserActionResponse> {
    const body = await this.request(`/v1/browser/${encodeURIComponent(session)}/runs/${encodeURIComponent(executionId)}/actions`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedBrowserActionResponse(body)) {
      throw protocolError('Webcmd Cloud returned an invalid browser action response.');
    }
    return body;
  }

  async finishBrowserRun(
    session: string,
    executionId: string,
    input: HostedBrowserFinishRequest,
  ): Promise<HostedBrowserFinishResponse> {
    const body = await this.request(`/v1/browser/${encodeURIComponent(session)}/runs/${encodeURIComponent(executionId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedBrowserFinishResponse(body, executionId, input.status)) {
      throw protocolError('Webcmd Cloud returned an invalid browser finish response.');
    }
    return body;
  }

  async runBrowserAction(session: string, input: HostedBrowserRunActionInput): Promise<HostedBrowserRunActionResponse | HostedBrowserSnapshotActionResponse> {
    return this.executeBrowserCommand(session, input);
  }

  async executeBrowserCommand(session: string, input: HostedBrowserRunActionInput): Promise<HostedBrowserRunActionResponse | HostedBrowserSnapshotActionResponse> {
    const body = await this.request(`/v1/browser/${encodeURIComponent(session)}/commands`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedBrowserRunActionResponse(body, session) && !(input.action === 'snapshot' && isHostedBrowserSnapshotActionResponse(body, session))) {
      throw protocolError('Webcmd Cloud returned an invalid browser action response.');
    }
    return body;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    executionExpectation?: ExecutionExpectation,
  ): Promise<unknown> {
    const response = await this.authenticatedFetch(path, init);
    const text = await response.text();
    const body = text ? parseJson(text) : {};
    if (!isRecord(body) || (body.ok !== true && body.ok !== false)) {
      throw protocolError('Webcmd Cloud returned an invalid response envelope.');
    }
    if (body.ok === false) {
      if (!isHostedError(body)) throw protocolError('Webcmd Cloud returned an invalid failure response.');
      if (body.execution && !isValidExecutedFailure(body, executionExpectation)) {
        throw protocolError('Webcmd Cloud returned an invalid executed failure response.');
      }
      const error = body.error;
      throw new HostedClientError(
        error.code,
        error.message,
        error.help,
        normalizeExitCode(
          error.exitCode,
          response.status === 401 ? EXIT_CODES.NOPERM : EXIT_CODES.GENERIC_ERROR,
        ),
        {
          ...(body.execution ? { execution: body.execution } : {}),
          ...(body.trace ? { trace: body.trace } : {}),
        },
      );
    }
    if (!response.ok) throw protocolError('Webcmd Cloud returned a success envelope with an HTTP error status.');
    return body;
  }

  private authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'x-webcmd-session-protocol-version': String(HOSTED_SESSION_PROTOCOL_VERSION),
        'x-webcmd-client-capabilities': 'hosted-live-view-v1',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.workspace ? { 'x-webcmd-workspace': this.workspace } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  private async requestText(path: string): Promise<string> {
    const response = await this.authenticatedFetch(path, { headers: { accept: 'text/plain, application/json' } });
    const text = await response.text();
    if (response.ok) return text;
    const body = text ? parseJson(text) : {};
    if (!isHostedError(body)) throw protocolError('Webcmd Cloud returned an invalid raw response failure.');
    throw new HostedClientError(
      body.error.code,
      body.error.message,
      body.error.help,
      normalizeExitCode(body.error.exitCode, response.status === 401 ? EXIT_CODES.NOPERM : EXIT_CODES.GENERIC_ERROR),
      { ...(body.execution ? { execution: body.execution } : {}), ...(body.trace ? { trace: body.trace } : {}) },
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw protocolError('Webcmd Cloud returned non-JSON response.');
  }
}

function encodePath(value: string): string {
  const parts = value.split('/');
  if (!value || value.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) {
    throw protocolError('Webcmd Cloud received an invalid storage path.');
  }
  return parts.map(encodeURIComponent).join('/');
}

function isHostedOkResponse(value: unknown): value is { ok: true } {
  return hasExactKeys(value, ['ok']) && value.ok === true;
}

function isHostedSiteMemoryDeletionResponse(value: unknown): value is { ok: true } {
  return isHostedOkResponse(value)
    || (hasExactKeys(value, ['ok', 'stale']) && value.ok === true && value.stale === true)
    || (hasExactKeys(value, ['ok', 'deleted']) && value.ok === true && value.deleted === true);
}

function isHostedSiteMemoryListResponse(value: unknown): value is { ok: true; artifacts: HostedSiteMemoryArtifact[] } {
  return hasExactKeys(value, ['ok', 'artifacts'])
    && value.ok === true
    && Array.isArray(value.artifacts)
    && value.artifacts.every(artifact => isRecord(artifact)
      && hasExactKeys(artifact, ['path', 'kind', 'contentType', 'sha256', 'byteSize', 'updatedAt'])
      && typeof artifact.path === 'string' && typeof artifact.kind === 'string' && typeof artifact.contentType === 'string'
      && typeof artifact.sha256 === 'string' && typeof artifact.byteSize === 'number' && typeof artifact.updatedAt === 'string');
}

function isHostedAdapterSourceWriteResponse(value: unknown): value is { ok: true; package: { id: string; storagePath: string }; commands: string[] } {
  return hasExactKeys(value, ['ok', 'package', 'commands'])
    && value.ok === true
    && isRecord(value.package)
    && hasExactKeys(value.package, ['id', 'storagePath'])
    && typeof value.package.id === 'string'
    && typeof value.package.storagePath === 'string'
    && Array.isArray(value.commands)
    && value.commands.every(command => typeof command === 'string');
}

function isHostedAdapterOverrideResponse(value: unknown): value is {
  ok: true;
  command: string;
  package: { id: string; name: string; visibility: string };
  installation: { id: string };
  sourceFile: string | null;
} {
  return hasExactKeys(value, ['ok', 'command', 'package', 'installation', 'sourceFile'])
    && value.ok === true
    && typeof value.command === 'string'
    && isRecord(value.package)
    && hasExactKeys(value.package, ['id', 'name', 'visibility'])
    && typeof value.package.id === 'string'
    && typeof value.package.name === 'string'
    && typeof value.package.visibility === 'string'
    && isRecord(value.installation)
    && hasExactKeys(value.installation, ['id'])
    && typeof value.installation.id === 'string'
    && (value.sourceFile === null || typeof value.sourceFile === 'string');
}

function isHostedError(value: unknown): value is HostedErrorResponse {
  if (!hasOnlyKeys(value, ['ok', 'error', 'execution', 'trace']) || value.ok !== false || !isRecord(value.error)) return false;
  if (!hasOnlyKeys(value.error, ['code', 'message', 'help', 'exitCode'])) return false;
  if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') return false;
  if (value.error.exitCode !== undefined
    && (typeof value.error.exitCode !== 'number' || !isAllowedExitCode(value.error.exitCode))) return false;
  if (value.error.help !== undefined && typeof value.error.help !== 'string') return false;
  if (value.execution !== undefined && !isHostedExecution(value.execution)) return false;
  if (value.trace !== undefined && !isHostedTraceReceipt(value.trace)) return false;
  if (value.execution?.status === 'succeeded') return false;
  if (value.trace && (!value.execution || value.trace.executionId !== value.execution.id)) return false;
  return true;
}

function isHostedManifest(value: unknown): value is HostedManifest {
  return hasExactKeys(value, ['userId', 'metadata', 'commands'])
    && typeof value.userId === 'string'
    && hasExactKeys(value.metadata, ['contractSchemaVersion', 'sessionProtocolVersion', 'webcmdPackageVersion', 'generatedAt'])
    && typeof value.metadata.contractSchemaVersion === 'number'
    && Number.isInteger(value.metadata.contractSchemaVersion)
    && value.metadata.contractSchemaVersion > 0
    && typeof value.metadata.sessionProtocolVersion === 'number'
    && Number.isInteger(value.metadata.sessionProtocolVersion)
    && value.metadata.sessionProtocolVersion > 0
    && typeof value.metadata.webcmdPackageVersion === 'string'
    && typeof value.metadata.generatedAt === 'string'
    && Array.isArray(value.commands)
    && value.commands.every(isHostedManifestCommand);
}

function isHostedExecuteResponse(
  value: unknown,
  requestedCommand: string,
  traceMode: HostedTraceMode,
): value is HostedExecuteResponse {
  if (!hasOnlyKeys(value, ['ok', 'result', 'columns', 'footerExtra', 'execution', 'trace', 'artifacts'])
    || value.ok !== true
    || !Object.prototype.hasOwnProperty.call(value, 'result')) return false;
  if (!isHostedExecution(value.execution) || value.execution.status !== 'succeeded') return false;
  if (value.execution.command !== requestedCommand) return false;
  if (value.columns !== undefined && (!Array.isArray(value.columns) || !value.columns.every(column => typeof column === 'string'))) {
    return false;
  }
  if (value.footerExtra !== undefined && typeof value.footerExtra !== 'string') return false;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || !value.artifacts.every(isHostedArtifactReceipt))) return false;
  if (value.trace !== undefined && !isHostedTraceReceipt(value.trace)) return false;
  if (value.trace && value.trace.executionId !== value.execution.id) return false;
  if (traceMode === 'on' ? !value.trace : value.trace !== undefined) return false;
  return true;
}

function isHostedPrepareExecutionResponse(
  value: unknown,
  requestedCommand: string,
): value is HostedPrepareExecutionResponse {
  return hasOnlyKeys(value, ['ok', 'execution', 'fileArguments', 'liveViewUrl'])
    && value.ok === true
    && hasExactKeys(value.execution, ['id', 'command', 'status'])
    && typeof value.execution.id === 'string'
    && value.execution.command === requestedCommand
    && value.execution.status === 'queued'
    && Array.isArray(value.fileArguments)
    && value.fileArguments.every(isHostedFileArgument)
    && (value.liveViewUrl === undefined || typeof value.liveViewUrl === 'string');
}

function isHostedUploadArtifactResponse(
  value: unknown,
  argument: string,
): value is HostedUploadArtifactResponse {
  if (!hasExactKeys(value, ['ok', 'artifact', 'reference']) || value.ok !== true) return false;
  const artifact = value.artifact;
  if (!isHostedArtifactReceipt(artifact)) return false;
  if (artifact.argument !== argument) return false;
  if (!hasExactKeys(value.reference, ['$webcmdArtifact'])) return false;
  const reference = value.reference.$webcmdArtifact;
  return hasOnlyKeys(reference, ['id', 'direction', 'filename', 'contentType'])
    && typeof reference.id === 'string'
    && (reference.direction === undefined || reference.direction === 'input');
}

function isHostedProfilesResponse(value: unknown): value is HostedProfilesResponse {
  return hasExactKeys(value, ['ok', 'profiles'])
    && value.ok === true
    && Array.isArray(value.profiles)
    && value.profiles.every(isHostedPublicProfile);
}

function isHostedBrowserSessionResponse(value: unknown): value is HostedBrowserSessionResponse {
  return hasExactKeys(value, ['ok', 'session'])
    && value.ok === true
    && isHostedCreatedBrowserSession(value.session);
}

function isHostedBrowserSessionsResponse(value: unknown): value is HostedBrowserSessionsResponse {
  return hasExactKeys(value, ['ok', 'sessions'])
    && value.ok === true
    && Array.isArray(value.sessions)
    && value.sessions.every(isHostedBrowserSession);
}

function isHostedBrowserSessionCloseResponse(value: unknown): value is HostedBrowserSessionCloseResponse {
  return hasOnlyKeys(value, ['ok', 'closed', 'alreadyIdle', 'session', 'displaced'])
    && value.ok === true
    && typeof value.closed === 'boolean'
    && typeof value.alreadyIdle === 'boolean'
    && typeof value.session === 'string'
    && (value.displaced === undefined || isHostedSessionDisplacement(value.displaced));
}

function isHostedBrowserSession(value: unknown): boolean {
  return hasExactKeys(value, ['id', 'kind', 'profileId', 'runtimeState', 'handoff', 'createdAt', 'updatedAt', 'lastUsedAt'])
    && typeof value.id === 'string'
    && (value.kind === 'explicit' || value.kind === 'adapter-default')
    && typeof value.profileId === 'string'
    && (value.runtimeState === 'active' || value.runtimeState === 'idle')
    && isHostedSessionHandoff(value.handoff)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.lastUsedAt === 'string';
}

function isHostedCreatedBrowserSession(value: unknown): boolean {
  if (!isRecord(value) || typeof value.liveViewUrl !== 'string') return false;
  const { liveViewUrl: _liveViewUrl, ...session } = value;
  return isHostedBrowserSession(session);
}

function isHostedSessionHandoff(value: unknown): boolean {
  return value === null
    || (hasExactKeys(value, ['site', 'expiresAt'])
      && typeof value.site === 'string'
      && typeof value.expiresAt === 'string');
}

function isHostedSessionDisplacement(value: unknown): boolean {
  return hasOnlyKeys(value, ['executionId', 'handoffSite'])
    && (value.executionId === undefined || typeof value.executionId === 'string')
    && (value.handoffSite === undefined || typeof value.handoffSite === 'string');
}

function profileQuery(profile: string | undefined): string {
  if (profile === undefined) return '';
  const params = new URLSearchParams({ profile });
  return `?${params}`;
}

function sessionListQuery(profile: string | undefined, limit: number | undefined): string {
  const params = new URLSearchParams();
  if (profile !== undefined) params.set('profile', profile);
  if (limit !== undefined) params.set('limit', String(limit));
  return params.size ? `?${params}` : '';
}

function isHostedMarketplaceSearchResult(value: unknown): value is HostedMarketplaceSearchResult {
  return hasExactKeys(value, ['plugins', 'errors'])
    && Array.isArray(value.plugins)
    && value.plugins.every(isHostedMarketplacePlugin)
    && Array.isArray(value.errors)
    && value.errors.every(isHostedMarketplaceSearchError);
}

function isHostedMarketplacePlugin(value: unknown): boolean {
  return hasOnlyKeys(value, ['name', 'description', 'version', 'sourceId', 'installSource', 'webcmd', 'availability', 'excludedCommands'])
    && typeof value.name === 'string'
    && typeof value.sourceId === 'string'
    && typeof value.installSource === 'string'
    && (value.availability === 'hosted' || value.availability === 'mixed' || value.availability === 'local-only')
    && Array.isArray(value.excludedCommands)
    && value.excludedCommands.every(command => typeof command === 'string')
    && (value.description === undefined || typeof value.description === 'string')
    && (value.version === undefined || typeof value.version === 'string')
    && (value.webcmd === undefined || typeof value.webcmd === 'string');
}

function isHostedMarketplaceSearchError(value: unknown): boolean {
  return hasExactKeys(value, ['sourceId', 'manifestUrl', 'message'])
    && typeof value.sourceId === 'string'
    && typeof value.manifestUrl === 'string'
    && typeof value.message === 'string';
}

function isHostedMarketplaceInstallation(value: unknown): value is HostedMarketplaceInstallation {
  return hasExactKeys(value, ['installationId', 'name', 'version', 'installSource'])
    && typeof value.installationId === 'string'
    && typeof value.name === 'string'
    && typeof value.version === 'string'
    && typeof value.installSource === 'string';
}

function isHostedMarketplaceInstallationRow(value: unknown): value is HostedMarketplaceInstallationRow {
  return hasExactKeys(value, ['name', 'version', 'installSource', 'sourceCommit', 'installedAt', 'updateAvailable'])
    && typeof value.name === 'string'
    && typeof value.version === 'string'
    && typeof value.installSource === 'string'
    && (value.sourceCommit === null || typeof value.sourceCommit === 'string')
    && typeof value.installedAt === 'string'
    && typeof value.updateAvailable === 'boolean';
}

// `delisted` is optional and appears ONLY when true (installed plugin whose catalog
// entry was delisted — nothing to update to, a normal outcome not an error). hasExactKeys
// would reject either the 3-key or 4-key shape depending on which list you pass it, so
// check the base 3 keys with hasOnlyKeys (permits the optional 4th) and validate `delisted`
// separately when present.
export type HostedMarketplaceUpdateResult =
  | { updated: boolean; name: string; version: string }
  | { updated: boolean; name: string; version: string; delisted: true };

function isHostedMarketplaceUpdateResult(value: unknown): value is HostedMarketplaceUpdateResult {
  return hasOnlyKeys(value, ['updated', 'name', 'version', 'delisted'])
    && typeof value.updated === 'boolean'
    && typeof value.name === 'string'
    && typeof value.version === 'string'
    && (value.delisted === undefined || value.delisted === true);
}

function isHostedPublicProfile(value: unknown): boolean {
  return hasExactKeys(value, [
    'id', 'name', 'workspace', 'default', 'status',
    'createdAt', 'updatedAt', 'lastUsedAt',
  ])
    && typeof value.id === 'string'
    && (value.name === null || typeof value.name === 'string')
    && (value.workspace === null || typeof value.workspace === 'string')
    && typeof value.default === 'boolean'
    && (value.status === 'pending' || value.status === 'available')
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.lastUsedAt === 'string';
}

function isHostedManifestCommand(value: unknown): boolean {
  if (!hasOnlyKeys(value, [
    'site', 'name', 'aliases', 'command', 'description', 'access', 'example', 'domain', 'strategy', 'browser',
    'args', 'columns', 'tags', 'keywords', 'pipeline', 'defaultFormat', 'type', 'modulePath', 'sourceFile', 'navigateBefore',
    'siteSession', 'freshPage', 'adapterPackageId', 'adapterPackageName', 'adapterPackageVersion',
  ])) return false;
  if (typeof value.site !== 'string' || typeof value.name !== 'string' || typeof value.command !== 'string') return false;
  if (typeof value.description !== 'string' || typeof value.access !== 'string' || typeof value.strategy !== 'string') return false;
  if (typeof value.browser !== 'boolean' || !Array.isArray(value.args) || !value.args.every(isHostedManifestArg)) return false;
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || !value.aliases.every(item => typeof item === 'string'))) return false;
  if (!Array.isArray(value.columns) || !value.columns.every(item => typeof item === 'string')) return false;
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(item => typeof item === 'string'))) return false;
  if (value.keywords !== undefined && (!Array.isArray(value.keywords) || !value.keywords.every(item => typeof item === 'string'))) return false;
  if (value.domain !== undefined && value.domain !== null && typeof value.domain !== 'string') return false;
  if (value.defaultFormat !== undefined && value.defaultFormat !== null && typeof value.defaultFormat !== 'string') return false;
  if (value.example !== undefined && typeof value.example !== 'string') return false;
  if (value.pipeline !== undefined && (!Array.isArray(value.pipeline) || !value.pipeline.every(isRecord))) return false;
  for (const key of ['type', 'modulePath', 'sourceFile', 'siteSession', 'adapterPackageId', 'adapterPackageName', 'adapterPackageVersion']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  if (value.freshPage !== undefined && typeof value.freshPage !== 'boolean') return false;
  return value.navigateBefore === undefined || typeof value.navigateBefore === 'boolean' || typeof value.navigateBefore === 'string';
}

function isHostedManifestArg(value: unknown): boolean {
  if (!hasOnlyKeys(value, ['name', 'type', 'required', 'default', 'valueRequired', 'positional', 'help', 'choices', 'file'])) return false;
  if (typeof value.name !== 'string') return false;
  if (value.type !== undefined && typeof value.type !== 'string') return false;
  for (const key of ['required', 'valueRequired', 'positional']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return false;
  }
  if (value.help !== undefined && typeof value.help !== 'string') return false;
  if (value.file !== undefined && !isHostedArgFileMetadata(value.file)) return false;
  return value.choices === undefined
    || (Array.isArray(value.choices) && value.choices.every(choice => typeof choice === 'string'));
}

function isHostedArgFileMetadata(value: unknown): boolean {
  return hasOnlyKeys(value, ['direction', 'pathKind', 'multiple', 'separator', 'contentTypes', 'contentType', 'maxBytes', 'defaultPath'])
    && (value.direction === 'input' || value.direction === 'output' || value.direction === 'input-output')
    && (value.pathKind === 'file' || value.pathKind === 'directory')
    && typeof value.multiple === 'boolean'
    && (value.separator === undefined || value.separator === ',')
    && (value.contentTypes === undefined || (Array.isArray(value.contentTypes) && value.contentTypes.every(item => typeof item === 'string')))
    && (value.contentType === undefined || typeof value.contentType === 'string')
    && (value.maxBytes === undefined || (typeof value.maxBytes === 'number' && Number.isFinite(value.maxBytes) && value.maxBytes > 0))
    && (value.defaultPath === undefined || typeof value.defaultPath === 'string');
}

function isHostedFileArgument(value: unknown): boolean {
  return hasOnlyKeys(value, ['name', 'direction', 'pathKind', 'multiple', 'required', 'separator', 'contentTypes', 'contentType', 'maxBytes', 'defaultPath'])
    && typeof value.name === 'string'
    && (value.direction === 'input' || value.direction === 'output' || value.direction === 'input-output')
    && (value.pathKind === 'file' || value.pathKind === 'directory')
    && typeof value.multiple === 'boolean'
    && typeof value.required === 'boolean'
    && (value.separator === undefined || value.separator === ',')
    && (value.contentTypes === undefined || (Array.isArray(value.contentTypes) && value.contentTypes.every(item => typeof item === 'string')))
    && (value.contentType === undefined || typeof value.contentType === 'string')
    && (value.maxBytes === undefined || (typeof value.maxBytes === 'number' && Number.isFinite(value.maxBytes) && value.maxBytes > 0))
    && (value.defaultPath === undefined || typeof value.defaultPath === 'string');
}

function isHostedArtifactReceipt(value: unknown): value is HostedArtifactReceipt {
  return hasOnlyKeys(value, [
    'artifactId', 'argument', 'direction', 'pathKind', 'filename', 'contentType',
    'byteSize', 'sha256', 'relativePath', 'expiresAt',
  ])
    && typeof value.artifactId === 'string'
    && typeof value.argument === 'string'
    && (value.direction === 'input' || value.direction === 'output')
    && (value.pathKind === 'file' || value.pathKind === 'directory')
    && typeof value.filename === 'string'
    && typeof value.contentType === 'string'
    && typeof value.byteSize === 'number'
    && Number.isInteger(value.byteSize)
    && value.byteSize >= 0
    && (value.sha256 === undefined || typeof value.sha256 === 'string')
    && (value.relativePath === undefined || isSafeRelativeArtifactPath(value.relativePath))
    && typeof value.expiresAt === 'string';
}

function isSafeRelativeArtifactPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'));
}

function isHostedBrowserRunResponse(value: unknown, requestedSession: string): value is HostedBrowserRunResponse {
  return hasExactKeys(value, ['ok', 'run']) && value.ok === true && isHostedBrowserRunPayload(value.run, requestedSession);
}

function isHostedBrowserRunPayload(value: unknown, requestedSession: string): value is HostedBrowserRunResponse['run'] {
  const run = value;
  if (!hasOnlyKeys(run, ['executionId', 'session', 'profile', 'liveViewUrl', 'expiresAt'])) return false;
  if (typeof run.executionId !== 'string' || run.session !== requestedSession) return false;
  if (!hasExactKeys(run.profile, ['id', 'displayName'])) return false;
  if (typeof run.profile.id !== 'string' || typeof run.profile.displayName !== 'string') return false;
  if (run.liveViewUrl !== undefined && typeof run.liveViewUrl !== 'string') return false;
  return run.expiresAt === undefined || typeof run.expiresAt === 'string';
}

function isHostedBrowserActionResponse(value: unknown): value is HostedBrowserActionResponse {
  if (!hasExactKeys(value, ['ok', 'result', 'columns', 'trace']) || value.ok !== true) return false;
  if (!Array.isArray(value.columns) || !value.columns.every(column => typeof column === 'string')) return false;
  return value.trace === null || isHostedBrowserActionTrace(value.trace);
}

function isHostedBrowserRunActionResponse(value: unknown, requestedSession: string): value is HostedBrowserRunActionResponse {
  if (!hasExactKeys(value, ['ok', 'result', 'columns', 'trace', 'run', 'execution']) || value.ok !== true) return false;
  if (!Array.isArray(value.columns) || !value.columns.every(column => typeof column === 'string')) return false;
  if (value.trace !== null && !isHostedBrowserActionTrace(value.trace)) return false;
  if (!isHostedBrowserRunPayload(value.run, requestedSession)) return false;
  return hasExactKeys(value.execution, ['id', 'status'])
    && typeof value.execution.id === 'string'
    && value.execution.id === value.run.executionId
    && (value.execution.status === 'succeeded' || value.execution.status === 'failed' || value.execution.status === 'timed_out');
}

function isHostedBrowserSnapshotActionResponse(value: unknown, requestedSession: string): value is HostedBrowserSnapshotActionResponse {
  return hasExactKeys(value, ['ok', 'run', 'result'])
    && value.ok === true
    && isHostedBrowserRunPayload(value.run, requestedSession);
}

function isHostedBrowserActionTrace(value: unknown): boolean {
  if (!hasOnlyKeys(value, ['id', 'receipt', 'kind', 'contentType', 'byteSize', 'storagePath'])) return false;
  if (typeof value.id !== 'string' || typeof value.receipt !== 'string' || typeof value.kind !== 'string') return false;
  if (value.contentType !== undefined && typeof value.contentType !== 'string') return false;
  if (value.byteSize !== undefined
    && (typeof value.byteSize !== 'number' || !Number.isInteger(value.byteSize) || value.byteSize < 0)) return false;
  return value.storagePath === undefined || typeof value.storagePath === 'string';
}

function isHostedBrowserFinishResponse(
  value: unknown,
  executionId: string,
  status: HostedBrowserFinishRequest['status'],
): value is HostedBrowserFinishResponse {
  return hasExactKeys(value, ['ok', 'execution'])
    && value.ok === true
    && hasExactKeys(value.execution, ['id', 'status'])
    && value.execution.id === executionId
    && value.execution.status === status;
}

function isHostedExecution(value: unknown): value is HostedExecution {
  return hasExactKeys(value, ['id', 'command', 'status'])
    && typeof value.id === 'string'
    && typeof value.command === 'string'
    && (value.status === 'succeeded' || value.status === 'failed' || value.status === 'timed_out');
}

function isHostedTraceReceipt(value: unknown): value is HostedTraceReceipt {
  if (!hasOnlyKeys(value, ['receipt', 'executionId', 'artifactsUrl', 'liveViewUrl', 'replayUrl'])
    || !isSafeReceiptToken(value.receipt)
    || !isSafeReceiptToken(value.executionId)) return false;
  const executionBase = publicExecutionBase(value.executionId);
  if (!executionBase) return false;
  return optionalExactPath(value.artifactsUrl, `${executionBase}/artifacts`)
    && optionalExactPath(value.liveViewUrl, `${executionBase}/live`)
    && optionalExactPath(value.replayUrl, `${executionBase}/replay`);
}

function publicExecutionBase(executionId: string): string | undefined {
  try {
    const encoded = encodeURIComponent(executionId);
    if (encoded === '.' || encoded === '..') return undefined;
    return `/v1/executions/${encoded}`;
  } catch {
    return undefined;
  }
}

function optionalExactPath(value: unknown, expected: string): boolean {
  return value === undefined || value === expected;
}

function isSafeReceiptToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys<T extends readonly string[]>(value: unknown, allowed: T): value is Record<T[number], unknown> {
  return isRecord(value) && Object.keys(value).every(key => allowed.includes(key));
}

function hasExactKeys<T extends readonly string[]>(value: unknown, expected: T): value is Record<T[number], unknown> {
  return hasOnlyKeys(value, expected) && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isAllowedExitCode(value: number): boolean {
  return (Object.values(EXIT_CODES) as number[]).includes(value);
}

function normalizeExitCode(value: number | undefined, fallback: ExitCode): ExitCode {
  return value !== undefined && isAllowedExitCode(value) ? value as ExitCode : fallback;
}

function protocolError(message: string): HostedClientError {
  return new HostedClientError('HOSTED_PROTOCOL', message);
}

type HostedTraceMode = 'off' | 'on' | 'retain-on-failure';

interface ExecutionExpectation {
  command: string;
  traceMode: HostedTraceMode;
}

function normalizeTraceMode(value: string | undefined): HostedTraceMode {
  return value === 'on' || value === 'retain-on-failure' ? value : 'off';
}

function isValidExecutedFailure(
  value: HostedErrorResponse,
  expectation: ExecutionExpectation | undefined,
): boolean {
  if (!value.execution || !expectation || value.error.exitCode === undefined) return false;
  if (value.execution.command !== expectation.command) return false;
  const traceRequired = expectation.traceMode === 'on' || expectation.traceMode === 'retain-on-failure';
  return traceRequired ? value.trace !== undefined : value.trace === undefined;
}
