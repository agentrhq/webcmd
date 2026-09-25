import type { IPage } from '../../types.js';
import type { IBrowserFactory } from '../../runtime.js';
import {
  type StandardResult,
  createSuccessResult,
  createFailureResult,
} from './result_schema.js';
import {
  WebcmdBrowserClient,
  type IWebcmdClient,
  type WebcmdClientApi,
} from '../webcmd/client.js';
import {
  WebcmdSessionManager,
  type WebcmdSession,
} from '../webcmd/session.js';
import {
  WebcmdSkills,
  inspectSensitiveContent,
} from '../webcmd/skills.js';

export interface PageState {
  url: string;
  title: string;
  content: string; // safe text snippet, not full raw DOM
  content_found?: boolean;
  isSensitive: boolean;
  sensitiveReason?: string;
  isPaused: boolean;
}

export interface BrowserSession extends WebcmdSession {
  readonly id: string;
  page?: IPage;
  factory?: IBrowserFactory;
  isClosed: boolean;
  isPaused: boolean;
  currentUrl?: string;
}

export interface BrowserManagerOptions {
  client?: IWebcmdClient;
  api?: WebcmdClientApi;
  factory?: IBrowserFactory;
  sessionManager?: WebcmdSessionManager;
  profile?: string;
  sessionTimeoutMs?: number;
}

/**
 * BrowserManager drives browser sessions using Webcmd's browser infrastructure.
 * Delegates startSession, navigate, closeSession, and pauseSession directly to the Webcmd adapter layer.
 */
export class BrowserManager {
  private readonly sessions: WebcmdSessionManager;
  private readonly skills: WebcmdSkills;
  private readonly profile?: string;

  constructor(options: BrowserManagerOptions = {}) {
    if (options.sessionManager) {
      this.sessions = options.sessionManager;
      this.skills = new WebcmdSkills(this.sessions.getClient());
    } else {
      const client = options.client ?? new WebcmdBrowserClient({ api: options.api, factory: options.factory });
      this.sessions = new WebcmdSessionManager(client);
      this.skills = new WebcmdSkills(client);
    }
    this.profile = options.profile;
  }

  /**
   * Starts a new browser session via Webcmd client layer.
   */
  async startSession(name?: string): Promise<BrowserSession> {
    const session = await this.sessions.startSession({
      sessionName: name,
      profile: this.profile,
    });
    return session as BrowserSession;
  }

  /**
   * Navigates the given session to the target URL and returns safe PageState.
   * Auto-pauses session for human handoff if sensitive checkpoints are detected.
   */
  async navigate(session: BrowserSession, url: string): Promise<PageState> {
    this.sessions.assertUsable(session);
    return this.skills.navigate(session, url, this.sessions);
  }

  /**
   * Safely reads current page state without navigation.
   */
  async readPage(session: BrowserSession): Promise<PageState> {
    this.sessions.assertUsable(session);
    return this.skills.readPage(session);
  }

  /**
   * Pauses the given session to preserve state for Human-In-The-Loop.
   * Leaves the browser session running and registers human handoff status.
   */
  async pauseSession(session: BrowserSession, reason?: string): Promise<void> {
    await this.sessions.pauseSession(session, reason);
  }

  /**
   * Resumes a paused session.
   */
  async resumeSession(session: BrowserSession): Promise<void> {
    await this.sessions.resume(session);
  }

  async closeSession(session: BrowserSession): Promise<void> {
    await this.sessions.closeSession(session);
  }

  /**
   * Enforces cleanup on completed or failed safe runs.
   */
  async cleanupSession(session: BrowserSession, outcome?: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    await this.sessions.cleanupSession(session, outcome);
  }

  /**
   * Runs a self-contained smoke test navigating to target URL and returning StandardResult-compatible JSON.
   */
  async runSmokeTest(url = 'https://example.com'): Promise<StandardResult<PageState>> {
    let session: BrowserSession | undefined;
    try {
      session = await this.startSession('pilgrim-os-smoke');
      const data = await this.navigate(session, url);
      return createSuccessResult<PageState>(
        'website',
        'smoke_test',
        data,
        'webcmd',
        { sessionId: session.id },
      );
    } catch (error) {
      return createFailureResult(
        'website',
        'smoke_test',
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : String(error),
        'webcmd',
      ) as unknown as StandardResult<PageState>;
    } finally {
      if (session) {
        await this.closeSession(session).catch(() => {});
      }
    }
  }

  /**
   * Helper to inspect if a page has sensitive indicators.
   */
  private inspectForSensitiveControls(
    url: string,
    title: string,
    content: string,
  ): { isSensitive: boolean; sensitiveReason?: string } {
    const res = inspectSensitiveContent(url, title, content);
    return { isSensitive: res.isSensitive, sensitiveReason: res.reason };
  }
}
