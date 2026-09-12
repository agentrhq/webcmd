import {
  IBrowserManager,
  IBrowserSession,
  IErrorHandler,
  ClassifiedError,
  SessionOptions,
} from './types.js';

/**
 * Controllable mock browser session for adapter development and testing.
 * Simulates page content, URL navigation, evaluation, and session states.
 */
export class MockBrowserSession implements IBrowserSession {
  public readonly id: string;
  private _isClosed = false;
  private _isPaused = false;
  private _currentUrl = 'about:blank';
  private _pageContent = '<html><body></body></html>';
  private _evaluateHandler?: <R>(fn: () => R) => R;
  public navigationHistory: string[] = [];

  constructor(id?: string) {
    this.id = id || `mock-session-${Math.random().toString(36).substring(2, 9)}`;
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  public setPageContent(content: string): void {
    this._pageContent = content;
  }

  public setCurrentUrl(url: string): void {
    this._currentUrl = url;
  }

  public setEvaluateHandler(handler: <R>(fn: () => R) => R): void {
    this._evaluateHandler = handler;
  }

  async navigate(url: string): Promise<void> {
    if (this._isClosed) {
      throw new Error(`Session ${this.id} is closed. Cannot navigate to ${url}`);
    }
    this._currentUrl = url;
    this.navigationHistory.push(url);
  }

  async getCurrentUrl(): Promise<string> {
    return this._currentUrl;
  }

  async getPageContent(): Promise<string> {
    return this._pageContent;
  }

  async evaluate<R>(fn: () => R): Promise<R> {
    if (this._isClosed) {
      throw new Error(`Session ${this.id} is closed. Cannot evaluate expression.`);
    }
    if (this._evaluateHandler) {
      return this._evaluateHandler(fn);
    }
    return fn();
  }

  async pause(): Promise<void> {
    this._isPaused = true;
  }

  async resume(): Promise<void> {
    this._isPaused = false;
  }

  async close(): Promise<void> {
    this._isClosed = true;
  }
}

/**
 * Mock browser manager implementing IBrowserManager.
 * Drop-in replacement until PC2A real browser engine is provided.
 */
export class MockBrowserManager implements IBrowserManager {
  private activeSessions = new Map<string, MockBrowserSession>();
  private nextSessionConfigurator?: (session: MockBrowserSession) => void;

  /**
   * Helper to configure the next created session (useful for test setups).
   */
  public configureNextSession(configurator: (session: MockBrowserSession) => void): void {
    this.nextSessionConfigurator = configurator;
  }

  async startSession(options?: SessionOptions): Promise<IBrowserSession> {
    const session = new MockBrowserSession();
    if (this.nextSessionConfigurator) {
      this.nextSessionConfigurator(session);
      this.nextSessionConfigurator = undefined;
    }
    this.activeSessions.set(session.id, session);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      await session.close();
      this.activeSessions.delete(sessionId);
    }
  }

  public getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  public getSession(sessionId: string): MockBrowserSession | undefined {
    return this.activeSessions.get(sessionId);
  }
}

/**
 * Mock error handler implementing IErrorHandler.
 * Classifies errors into retryable (transient network, timeouts) vs fatal.
 */
export class MockErrorHandler implements IErrorHandler {
  classify(error: unknown): ClassifiedError {
    const err = error as Record<string, unknown> | undefined;
    const message = (err && typeof err.message === 'string') ? err.message : String(error);
    const code = (err && typeof err.code === 'string') ? err.code : 'UNKNOWN_ERROR';

    const isTimeout =
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'NETWORK_TIMEOUT' ||
      /timeout|temporarily unavailable|rate limit/i.test(message);

    const isPortalUnavailable =
      code === 'HTTP_503' ||
      code === 'HTTP_502' ||
      /bad gateway|service unavailable/i.test(message);

    const retryable = isTimeout || isPortalUnavailable;

    return {
      code,
      message,
      retryable,
      originalError: error,
    };
  }
}
