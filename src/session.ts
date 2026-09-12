import { BrowserManager, type BrowserSession } from './adapters/core/browser_manager.js';

export class WebcmdSessionManager {
  constructor(private readonly browser: BrowserManager) {}

  async create(name?: string): Promise<BrowserSession> {
    return this.browser.startSession(name);
  }

  pauseForApproval(session: BrowserSession): void {
    this.browser.pauseSession(session);
  }

  resumeAfterApproval(session: BrowserSession): void {
    this.browser.resumeSession(session);
  }

  async cleanup(session: BrowserSession): Promise<void> {
    await this.browser.closeSession(session);
  }
}
