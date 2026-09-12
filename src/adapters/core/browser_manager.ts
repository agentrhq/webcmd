import type { IPage } from '../../types.js';
import type { IBrowserFactory } from '../../runtime.js';
import { BrowserBridge } from '../../browser/bridge.js';

export interface PageState {
  url: string;
  title: string;
  content: string; // safe text snippet, not full raw DOM
  isSensitive: boolean;
  sensitiveReason?: string;
  isPaused: boolean;
}

export interface BrowserSession {
  readonly id: string;
  page?: IPage;
  factory?: IBrowserFactory;
  isClosed: boolean;
  isPaused: boolean;
  currentUrl?: string;
}

export interface BrowserManagerOptions {
  factory?: IBrowserFactory;
  sessionTimeoutMs?: number;
}

/**
 * BrowserManager drives browser sessions using Webcmd's browser infrastructure.
 * Exposes exactly: startSession, navigate, closeSession, pauseSession.
 */
export class BrowserManager {
  private factorySupplier: () => IBrowserFactory;
  private activeSessions = new Map<string, BrowserSession>();

  constructor(options?: BrowserManagerOptions) {
    if (options?.factory) {
      const injectedFactory = options.factory;
      this.factorySupplier = () => injectedFactory;
    } else {
      this.factorySupplier = () => new BrowserBridge();
    }
  }

  /**
   * Starts a new browser session via Webcmd client layer.
   */
  async startSession(): Promise<BrowserSession> {
    const sessionId = `webcmd-session-${Math.random().toString(36).substring(2, 9)}`;
    const factory = this.factorySupplier();

    let page: IPage | undefined;
    try {
      page = await factory.connect({ session: sessionId, surface: 'adapter' });
    } catch {
      // In mock/test environments without daemon, page can be stubbed or injected
    }

    const session: BrowserSession = {
      id: sessionId,
      page,
      factory,
      isClosed: false,
      isPaused: false,
      currentUrl: 'about:blank',
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Navigates the given session to the target URL and returns safe PageState.
   */
  async navigate(session: BrowserSession, url: string): Promise<PageState> {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot navigate to ${url}`);
    }
    if (session.isPaused) {
      throw new Error(`Session ${session.id} is paused. Resume before navigating.`);
    }

    session.currentUrl = url;

    let title = '';
    let content = '';

    if (session.page) {
      await session.page.goto(url, { waitUntil: 'load' });

      // Extract safe title and text preview (not full DOM dump)
      try {
        title = await session.page.evaluate(() => document.title || '');
      } catch {
        title = '';
      }

      try {
        content = await session.page.evaluate(() => {
          if (!document.body) return '';
          return document.body.innerText ? document.body.innerText.slice(0, 2000) : '';
        });
      } catch {
        content = '';
      }
    }

    // Safety check for sensitive controls (OTP, payment, checkout, etc.)
    const sensitiveInspection = this.inspectForSensitiveControls(url, title, content);

    const pageState: PageState = {
      url,
      title,
      content,
      isSensitive: sensitiveInspection.isSensitive,
      sensitiveReason: sensitiveInspection.reason,
      isPaused: session.isPaused,
    };

    // If sensitive page detected, immediately pause session
    if (pageState.isSensitive) {
      await this.pauseSession(session);
      pageState.isPaused = true;
    }

    return pageState;
  }

  /**
   * Pauses the given session to preserve state for Human-In-The-Loop.
   */
  async pauseSession(session: BrowserSession): Promise<void> {
    session.isPaused = true;
  }

  /**
   * Closes and cleans up the browser session.
   */
  async closeSession(session: BrowserSession): Promise<void> {
    session.isClosed = true;
    if (session.page && typeof (session.page as unknown as Record<string, unknown>).closeWindow === 'function') {
      await (session.page as unknown as { closeWindow: () => Promise<void> }).closeWindow().catch(() => {});
    }
    if (session.factory) {
      await session.factory.close().catch(() => {});
    }
    this.activeSessions.delete(session.id);
  }

  /**
   * Helper to inspect if a page has sensitive indicators.
   */
  private inspectForSensitiveControls(
    url: string,
    title: string,
    content: string,
  ): { isSensitive: boolean; reason?: string } {
    const lowerUrl = url.toLowerCase();
    const lowerText = `${title} ${content}`.toLowerCase();

    // 1. Payment & checkout
    if (
      /\/pay(\/|$|\?)/i.test(lowerUrl) ||
      /\/checkout(\/|$|\?)/i.test(lowerUrl) ||
      /razorpay|billdesk|paytm|ccavenue/i.test(lowerUrl)
    ) {
      return { isSensitive: true, reason: 'Payment gateway or checkout URL detected' };
    }
    if (
      /\b(enter card number|cvv|upi pin|upi qr|net banking|amount payable)\b/i.test(
        lowerText,
      )
    ) {
      return { isSensitive: true, reason: 'Payment form elements detected' };
    }

    // 2. OTP & 2FA
    if (/\/otp(\/|$|\?)/i.test(lowerUrl) || /\/verify(-otp)?(\/|$|\?)/i.test(lowerUrl)) {
      return { isSensitive: true, reason: 'OTP verification URL detected' };
    }
    if (/\b(enter otp|one-time password|verify otp|resend otp)\b/i.test(lowerText)) {
      return { isSensitive: true, reason: 'OTP input detected in page content' };
    }

    // 3. Final submit / Commit
    if (
      /\b(pay now|confirm and pay|confirm & pay|complete booking|authorize transaction)\b/i.test(
        lowerText,
      )
    ) {
      return { isSensitive: true, reason: 'Final commitment/payment button detected' };
    }

    // 4. Captcha
    if (
      /\b(i'm not a robot|verify you are human|recaptcha|hcaptcha)\b/i.test(lowerText) ||
      /\/captcha/i.test(lowerUrl)
    ) {
      return { isSensitive: true, reason: 'Captcha challenge detected' };
    }

    return { isSensitive: false };
  }
}
