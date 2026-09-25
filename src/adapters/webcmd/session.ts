import type { IPage } from '../../types.js';
import type { IBrowserFactory } from '../../runtime.js';
import { generateSessionSuffix, normalizeSessionBase } from '../../browser/session-identifiers.js';
import { type IWebcmdClient, type WebcmdHandoffDetails, WebcmdBrowserClient } from './client.js';

export interface WebcmdSessionHandle {
  page?: IPage;
  factory?: IBrowserFactory;
}

export interface WebcmdSession {
  readonly id: string;
  readonly name?: string;
  handle: WebcmdSessionHandle;
  page?: IPage;
  factory?: IBrowserFactory;
  isClosed: boolean;
  isPaused: boolean;
  currentUrl?: string;
  createdAt: string;
  pausedAt?: string;
  pauseReason?: string;
  handoff?: WebcmdHandoffDetails;
}

export type ManagedWebcmdSession = WebcmdSession;

export interface WebcmdSessionManagerOptions {
  client?: IWebcmdClient;
  defaultHandoffTtlMs?: number;
}

const DEFAULT_HANDOFF_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * WebcmdSessionManager manages session lifecycle, cleanups, and human handoff pause behavior.
 */
export class WebcmdSessionManager {
  private readonly client: IWebcmdClient;
  private readonly defaultHandoffTtlMs: number;
  private readonly activeSessions = new Map<string, WebcmdSession>();

  constructor(clientOrOptions?: IWebcmdClient | WebcmdSessionManagerOptions) {
    if (clientOrOptions && 'connect' in clientOrOptions) {
      this.client = clientOrOptions;
      this.defaultHandoffTtlMs = DEFAULT_HANDOFF_TTL_MS;
    } else {
      this.client = clientOrOptions?.client ?? new WebcmdBrowserClient();
      this.defaultHandoffTtlMs = clientOrOptions?.defaultHandoffTtlMs ?? DEFAULT_HANDOFF_TTL_MS;
    }
  }

  getClient(): IWebcmdClient {
    return this.client;
  }

  /**
   * Starts a new session by human-readable or system name.
   */
  async start(name?: string, profile?: string): Promise<WebcmdSession> {
    return this.startSession({ sessionName: name, profile });
  }

  /**
   * Starts a new Webcmd browser session and connects to the browser runtime.
   */
  async startSession(options?: {
    sessionId?: string;
    sessionName?: string;
    profile?: string;
    surface?: 'adapter' | 'browser';
  }): Promise<WebcmdSession> {
    const requestedName = options?.sessionId ?? options?.sessionName ?? 'webcmd-session';
    const base = normalizeSessionBase(requestedName) || 'webcmd-session';
    const sessionId = `${base}-${generateSessionSuffix()}`;

    let page: IPage | undefined;
    let factory: IBrowserFactory | undefined;

    try {
      const connected = await this.client.connect({
        session: sessionId,
        surface: options?.surface ?? 'adapter',
        contextId: options?.profile,
      });
      page = connected.page;
      factory = connected.factory;
    } catch {
      // In isolated mock/test environments, page/factory can be attached or stubbed
    }

    const session: WebcmdSession = {
      id: sessionId,
      name: options?.sessionName ?? sessionId,
      handle: { page, factory },
      page,
      factory,
      isClosed: false,
      isPaused: false,
      currentUrl: 'about:blank',
      createdAt: new Date().toISOString(),
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Pauses the session and preserves it for human handoff.
   * Leaves the browser session running and registers handoff status.
   */
  async pauseSession(session: WebcmdSession, reason?: string): Promise<void> {
    if (session.isClosed) {
      throw new Error(`Cannot pause closed session: ${session.id}`);
    }

    session.isPaused = true;
    session.pausedAt = new Date().toISOString();
    session.pauseReason = reason ?? 'Human-in-the-loop handoff required';

    const expiresAt = new Date(Date.now() + this.defaultHandoffTtlMs).toISOString();
    session.handoff = {
      site: session.currentUrl ?? 'adapter',
      expiresAt,
      reason: session.pauseReason,
    };

    // Mark session in Webcmd handoff store so human can take over
    await this.client.markHandoff(session.id, session.handoff);
  }

  async pause(session: WebcmdSession, reason?: string): Promise<void> {
    return this.pauseSession(session, reason);
  }

  /**
   * Resumes a paused session.
   */
  async resume(session: WebcmdSession): Promise<void> {
    if (session.isClosed) {
      throw new Error(`Cannot resume closed session: ${session.id}`);
    }
    session.isPaused = false;
  }

  /**
   * Closes the browser session, releases browser windows/leases, and clears handoffs.
   */
  async closeSession(session: WebcmdSession): Promise<void> {
    session.isClosed = true;

    if (session.handoff) {
      await this.client.clearHandoff(session.id).catch(() => {});
    }

    const page = session.page ?? session.handle?.page;
    const factory = session.factory ?? session.handle?.factory;
    await this.client.close(page, factory).catch(() => {});
    this.activeSessions.delete(session.id);
  }

  async close(session: WebcmdSession): Promise<void> {
    return this.closeSession(session);
  }

  /**
   * Enforces cleanup on completed or failed safe runs.
   */
  async cleanupSession(session: WebcmdSession, outcome?: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    if (session.isClosed) {
      return;
    }

    // Completed or failed safe runs must clean up sessions
    await this.closeSession(session);
  }

  /**
   * Validates that the session is usable for operations (neither closed nor paused).
   */
  assertUsable(session: WebcmdSession): void {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot navigate.`);
    }
    if (session.isPaused) {
      throw new Error(`Session ${session.id} is paused. Resume before navigating.`);
    }
  }

  getSession(sessionId: string): WebcmdSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  listActiveSessions(): WebcmdSession[] {
    return Array.from(this.activeSessions.values());
  }
}
