import type { BrowserSession } from '../core/browser_manager';
import { WebcmdClient } from './client';

export class WebcmdSkills {
  constructor(private readonly client = new WebcmdClient()) {}

  async navigate(session: BrowserSession, url: string): Promise<unknown> {
    return this.client.browserRun(
      session.id,
      `await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' }); return { url: page.url(), title: await page.title() };`,
      session.profile,
    );
  }

  async extractText(session: BrowserSession, selector = 'body'): Promise<string> {
    const result = await this.client.browserRun(
      session.id,
      `return await page.locator(${JSON.stringify(selector)}).innerText();`,
      session.profile,
    );
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  async extractJson<T>(session: BrowserSession, script: string): Promise<T> {
    return (await this.client.browserRun(session.id, script, session.profile)) as T;
  }

  async waitForSelector(session: BrowserSession, selector: string, timeoutMs = 15_000): Promise<void> {
    await this.client.browserRun(
      session.id,
      `await page.locator(${JSON.stringify(selector)}).waitFor({ state: 'visible', timeout: ${timeoutMs} }); return true;`,
      session.profile,
    );
  }
}
