import { ErrorHandler } from './error_handler';
import { createResult, type StandardResult } from './result_schema';
import { RecoveryManager, DEFAULT_RETRY_POLICY } from './recovery';
import { WebcmdClient } from '../webcmd/client';

export interface BrowserSession {
  readonly id: string;
  readonly profile?: string;
  readonly createdAt: string;
  paused: boolean;
  closed: boolean;
}

export interface PageState {
  url: string;
  title: string;
  content: string;
  content_found: boolean;
}

export class BrowserManager {
  constructor(
    private readonly client = new WebcmdClient(),
    private readonly profile?: string,
  ) {}

  async startSession(name = `pilgrimos-${Date.now()}`): Promise<BrowserSession> {
    const created = await this.client.createSession(name, this.profile);
    return {
      id: created.id,
      profile: this.profile,
      createdAt: new Date().toISOString(),
      paused: false,
      closed: false,
    };
  }

  async navigate(session: BrowserSession, url: string): Promise<PageState> {
    this.assertUsable(session);
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid input: URL must start with http:// or https://');

    const run = async () => {
      const result = await this.client.browserRun(
        session.id,
        `
          await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' });
          return {
            url: page.url(),
            title: await page.title(),
            content: await page.locator('body').innerText(),
          };
        `,
        session.profile,
      );
      return normalizePageState(result);
    };

    return RecoveryManager.retry(run, {
      ...DEFAULT_RETRY_POLICY,
      shouldRetry: (error) => ErrorHandler.isRetryable(ErrorHandler.classify(error)),
    });
  }

  async readPage(session: BrowserSession): Promise<PageState> {
    this.assertUsable(session);
    const result = await this.client.browserRun(
      session.id,
      `return {
        url: page.url(),
        title: await page.title(),
        content: await page.locator('body').innerText(),
      };`,
      session.profile,
    );
    return normalizePageState(result);
  }

  async closeSession(session: BrowserSession): Promise<void> {
    if (session.closed) return;
    await this.client.closeSession(session.id, session.profile);
    session.closed = true;
    session.paused = false;
  }

  pauseSession(session: BrowserSession): void {
    if (session.closed) throw new Error('Cannot pause a closed browser session.');
    session.paused = true;
  }

  resumeSession(session: BrowserSession): void {
    if (session.closed) throw new Error('Cannot resume a closed browser session.');
    session.paused = false;
  }

  async runSmokeTest(url = 'https://example.com'): Promise<StandardResult<PageState>> {
    let session: BrowserSession | undefined;
    try {
      session = await this.startSession('pilgrimos-smoke');
      const page = await this.navigate(session, url);
      return createResult({
        success: true,
        status: 'completed',
        adapter: 'website',
        action: 'smoke_test',
        data: page,
        source: 'website',
      });
    } catch (error) {
      const standardError = ErrorHandler.toStandardError(error);
      return createResult({
        success: false,
        status: 'failed',
        adapter: 'website',
        action: 'smoke_test',
        data: {} as PageState,
        source: 'website',
        error: standardError,
      });
    } finally {
      if (session) {
        try { await this.closeSession(session); } catch { /* cleanup is best effort */ }
      }
    }
  }

  private assertUsable(session: BrowserSession): void {
    if (session.closed) throw new Error('Session is closed.');
    if (session.paused) throw new Error('Session is paused for human approval.');
  }
}

function normalizePageState(raw: unknown): PageState {
  const value = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const content = typeof value.content === 'string' ? value.content : '';
  return {
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
    content,
    content_found: content.trim().length > 0,
  };
}
