import { CliError, EXIT_CODES, type ExitCode } from '../errors.js';
import type {
  HostedBrowserActionRequest,
  HostedBrowserActionResponse,
  HostedBrowserFinishRequest,
  HostedBrowserFinishResponse,
  HostedBrowserRunActionInput,
  HostedBrowserRunActionResponse,
  HostedBrowserRunRequest,
  HostedBrowserRunResponse,
  HostedErrorResponse,
  HostedExecuteResponse,
  HostedManifest,
} from './types.js';

export interface HostedClientOptions {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class HostedClientError extends CliError {
  constructor(code: string, message: string, help?: string, exitCode: ExitCode = EXIT_CODES.GENERIC_ERROR) {
    super(code, message, help, exitCode);
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
    const body = await this.request('/v1/manifest') as { manifest?: HostedManifest };
    if (!body.manifest || !Array.isArray(body.manifest.commands)) {
      throw new HostedClientError('HOSTED_PROTOCOL', 'Webcmd Cloud returned an invalid manifest.');
    }
    return body.manifest;
  }

  async execute(input: {
    command: string;
    args: Record<string, unknown>;
    format?: string;
    trace?: string;
    profile?: string;
  }): Promise<HostedExecuteResponse> {
    return this.request('/v1/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<HostedExecuteResponse>;
  }

  async startBrowserRun(session: string, input: HostedBrowserRunRequest): Promise<HostedBrowserRunResponse> {
    return this.request(`/v1/browser/${encodeURIComponent(session)}/runs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<HostedBrowserRunResponse>;
  }

  async browserAction(
    session: string,
    executionId: string,
    input: HostedBrowserActionRequest,
  ): Promise<HostedBrowserActionResponse> {
    return this.request(`/v1/browser/${encodeURIComponent(session)}/runs/${encodeURIComponent(executionId)}/actions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<HostedBrowserActionResponse>;
  }

  async finishBrowserRun(
    session: string,
    executionId: string,
    input: HostedBrowserFinishRequest,
  ): Promise<HostedBrowserFinishResponse> {
    return this.request(`/v1/browser/${encodeURIComponent(session)}/runs/${encodeURIComponent(executionId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<HostedBrowserFinishResponse>;
  }

  async runBrowserAction(session: string, input: HostedBrowserRunActionInput): Promise<HostedBrowserRunActionResponse> {
    const { command, trace, windowMode, action, profile, args } = input;
    const run = await this.startBrowserRun(session, {
      command,
      args,
      ...(profile !== undefined ? { profile } : {}),
      ...(windowMode !== undefined ? { windowMode } : {}),
      ...(trace !== undefined ? { trace } : {}),
    });
    try {
      const actionResponse = await this.browserAction(session, run.run.executionId, {
        action,
        args,
        ...(profile !== undefined ? { profile } : {}),
      });
      const finished = await this.finishBrowserRun(session, run.run.executionId, {
        status: 'succeeded',
        ...(profile !== undefined ? { profile } : {}),
      });
      return {
        ...actionResponse,
        run: run.run,
        execution: finished.execution,
      };
    } catch (error) {
      await this.finishBrowserRun(session, run.run.executionId, {
        status: 'failed',
        errorCode: error instanceof HostedClientError ? error.code : 'HOSTED_BROWSER_ACTION_FAILED',
        ...(profile !== undefined ? { profile } : {}),
      }).catch(() => undefined);
      throw error;
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
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
    if (!response.ok || isHostedError(body)) {
      const error = isHostedError(body)
        ? body.error
        : { code: `HTTP_${response.status}`, message: `Webcmd Cloud request failed with HTTP ${response.status}.` };
      throw new HostedClientError(
        error.code || `HTTP_${response.status}`,
        error.message || `Webcmd Cloud request failed with HTTP ${response.status}.`,
        error.help ?? error.hint,
        normalizeExitCode(error.exitCode, response.status === 401 ? EXIT_CODES.NOPERM : EXIT_CODES.GENERIC_ERROR),
      );
    }
    return body;
  }
}

function normalizeExitCode(value: number | undefined, fallback: ExitCode): ExitCode {
  const allowed = new Set<number>(Object.values(EXIT_CODES));
  return value !== undefined && allowed.has(value) ? value as ExitCode : fallback;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HostedClientError('HOSTED_PROTOCOL', 'Webcmd Cloud returned non-JSON response.');
  }
}

function isHostedError(value: unknown): value is HostedErrorResponse {
  return !!value
    && typeof value === 'object'
    && (value as { ok?: unknown }).ok === false
    && typeof (value as { error?: unknown }).error === 'object';
}
