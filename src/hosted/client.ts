import { attachTraceReceipt, CliError, EXIT_CODES, type ExitCode } from '../errors.js';
import type {
  HostedBrowserActionRequest,
  HostedBrowserActionResponse,
  HostedBrowserFinishRequest,
  HostedBrowserFinishResponse,
  HostedBrowserRunActionInput,
  HostedBrowserRunActionResponse,
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
  HostedTraceReceipt,
} from './types.js';

export interface HostedClientOptions {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
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
  private readonly fetchImpl: typeof fetch;

  constructor(options: HostedClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getMe(): Promise<unknown> {
    return this.request('/v1/me');
  }

  async getManifest(): Promise<HostedManifest> {
    const body = await this.request('/v1/manifest');
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

  async execute(input: {
    command: string;
    args: Record<string, unknown>;
    format?: string;
    trace?: string;
    profile?: string;
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

  async prepareExecution(input: { command: string }): Promise<HostedPrepareExecutionResponse> {
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

  async runBrowserAction(session: string, input: HostedBrowserRunActionInput): Promise<HostedBrowserRunActionResponse> {
    return this.executeBrowserCommand(session, input);
  }

  async executeBrowserCommand(session: string, input: HostedBrowserRunActionInput): Promise<HostedBrowserRunActionResponse> {
    const body = await this.request(`/v1/browser/${encodeURIComponent(session)}/commands`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isHostedBrowserRunActionResponse(body, session)) {
      throw protocolError('Webcmd Cloud returned an invalid browser action response.');
    }
    return body;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    executionExpectation?: ExecutionExpectation,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    });
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
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw protocolError('Webcmd Cloud returned non-JSON response.');
  }
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
    && hasExactKeys(value.metadata, ['contractSchemaVersion', 'webcmdPackageVersion', 'generatedAt'])
    && typeof value.metadata.contractSchemaVersion === 'number'
    && Number.isInteger(value.metadata.contractSchemaVersion)
    && value.metadata.contractSchemaVersion > 0
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
  return hasExactKeys(value, ['ok', 'execution', 'fileArguments'])
    && value.ok === true
    && hasExactKeys(value.execution, ['id', 'command', 'status'])
    && typeof value.execution.id === 'string'
    && value.execution.command === requestedCommand
    && value.execution.status === 'queued'
    && Array.isArray(value.fileArguments)
    && value.fileArguments.every(isHostedFileArgument);
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

function isHostedPublicProfile(value: unknown): boolean {
  return hasExactKeys(value, ['name', 'default', 'status', 'createdAt', 'lastUsedAt'])
    && typeof value.name === 'string'
    && typeof value.default === 'boolean'
    && value.status === 'available'
    && typeof value.createdAt === 'string'
    && typeof value.lastUsedAt === 'string';
}

function isHostedManifestCommand(value: unknown): boolean {
  if (!hasOnlyKeys(value, [
    'site', 'name', 'aliases', 'command', 'description', 'access', 'example', 'domain', 'strategy', 'browser',
    'args', 'columns', 'pipeline', 'defaultFormat', 'type', 'modulePath', 'sourceFile', 'navigateBefore',
    'siteSession', 'freshPage', 'defaultWindowMode', 'adapterPackageId', 'adapterPackageName', 'adapterPackageVersion',
  ])) return false;
  if (typeof value.site !== 'string' || typeof value.name !== 'string' || typeof value.command !== 'string') return false;
  if (typeof value.description !== 'string' || typeof value.access !== 'string' || typeof value.strategy !== 'string') return false;
  if (typeof value.browser !== 'boolean' || !Array.isArray(value.args) || !value.args.every(isHostedManifestArg)) return false;
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || !value.aliases.every(item => typeof item === 'string'))) return false;
  if (!Array.isArray(value.columns) || !value.columns.every(item => typeof item === 'string')) return false;
  if (value.domain !== undefined && value.domain !== null && typeof value.domain !== 'string') return false;
  if (value.defaultFormat !== undefined && value.defaultFormat !== null && typeof value.defaultFormat !== 'string') return false;
  if (value.example !== undefined && typeof value.example !== 'string') return false;
  if (value.pipeline !== undefined && (!Array.isArray(value.pipeline) || !value.pipeline.every(isRecord))) return false;
  for (const key of ['type', 'modulePath', 'sourceFile', 'siteSession', 'defaultWindowMode', 'adapterPackageId', 'adapterPackageName', 'adapterPackageVersion']) {
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
    && (value.direction === 'input' || value.direction === 'output')
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
    && (value.direction === 'input' || value.direction === 'output')
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
  if (!hasOnlyKeys(run, ['executionId', 'session', 'profile', 'liveViewUrl'])) return false;
  if (typeof run.executionId !== 'string' || run.session !== requestedSession) return false;
  if (!hasExactKeys(run.profile, ['id', 'displayName'])) return false;
  if (typeof run.profile.id !== 'string' || typeof run.profile.displayName !== 'string') return false;
  return run.liveViewUrl === undefined || typeof run.liveViewUrl === 'string';
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
