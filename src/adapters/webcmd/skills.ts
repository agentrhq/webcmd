import type { IWebcmdClient } from './client.js';
import type { WebcmdSession, WebcmdSessionManager } from './session.js';

export interface SafePageState {
  url: string;
  title: string;
  content: string; // safe text snippet, not full raw DOM
  content_found?: boolean;
  isSensitive: boolean;
  sensitiveReason?: string;
  isPaused: boolean;
}

export interface SensitiveInspectionResult {
  isSensitive: boolean;
  reason?: string;
}

const FORBIDDEN_AUTOMATION_KEYWORDS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'turnstile',
  'login',
  'signin',
  'password',
  'otp',
  '2fa',
  'two-factor',
  'payment',
  'checkout',
  'pay now',
  'cvv',
  'card number',
  'upi pin',
  'final-submit',
  'final submit',
  'confirmation',
  'confirm and pay',
  'complete booking',
  'authorize transaction',
];

/**
 * Enforces policy: Never automate CAPTCHA, login, OTP, payment, checkout, final-submit, or confirmation actions.
 */
export function assertSafeAction(actionDescription: string): void {
  const normalized = actionDescription.toLowerCase();
  for (const keyword of FORBIDDEN_AUTOMATION_KEYWORDS) {
    if (normalized.includes(keyword)) {
      throw new Error(
        `Safety Guard: Action "${actionDescription}" is forbidden. ` +
        `Never automate CAPTCHA, login, OTP, payment, checkout, final-submit, or confirmation actions.`
      );
    }
  }
}

/**
 * Inspects page URL, title, and visible text for sensitive checkpoints
 * such as payment gateways, OTP verification walls, credentials, or captchas.
 * Domain-agnostic: strictly no temple, travel, or hotel specific selectors.
 */
export function inspectSensitiveContent(
  url: string,
  title: string,
  content: string,
): SensitiveInspectionResult {
  const lowerUrl = url.toLowerCase();
  const lowerText = `${title} ${content}`.toLowerCase();

  // 1. Payment & checkout
  if (
    /\/pay(\/|$|\?)/i.test(lowerUrl) ||
    /\/checkout(\/|$|\?)/i.test(lowerUrl) ||
    /\/gateway(\/|$|\?)/i.test(lowerUrl) ||
    /razorpay|billdesk|paytm|ccavenue|stripe/i.test(lowerUrl)
  ) {
    return { isSensitive: true, reason: 'Payment gateway or checkout URL detected' };
  }
  if (
    /\b(enter card number|card expiration|cvv|cvv\/cvc|upi pin|upi qr|net banking|amount payable)\b/i.test(
      lowerText,
    )
  ) {
    return { isSensitive: true, reason: 'Payment form elements detected' };
  }

  // 2. OTP & 2FA
  if (/\/otp(\/|$|\?)/i.test(lowerUrl) || /\/verify(-otp)?(\/|$|\?)/i.test(lowerUrl) || /\/2fa(\/|$|\?)/i.test(lowerUrl)) {
    return { isSensitive: true, reason: 'OTP verification URL detected' };
  }
  if (/\b(enter otp|one-time password|verify otp|resend otp|enter verification code)\b/i.test(lowerText)) {
    return { isSensitive: true, reason: 'OTP input detected in page content' };
  }

  // 3. Final submit / Payment commitment
  if (
    /\b(pay now|confirm and pay|confirm & pay|complete booking|authorize transaction|place order)\b/i.test(
      lowerText,
    )
  ) {
    return { isSensitive: true, reason: 'Final commitment/payment button detected' };
  }

  // 4. Captcha challenges
  if (
    /\/captcha/i.test(lowerUrl) ||
    /\b(i'm not a robot|verify you are human|recaptcha|hcaptcha|cloudflare challenge)\b/i.test(lowerText)
  ) {
    return { isSensitive: true, reason: 'Captcha challenge detected' };
  }

  // 5. Login / Authentication credential walls
  if (
    /\/login(\/|$|\?)/i.test(lowerUrl) ||
    /\/signin(\/|$|\?)/i.test(lowerUrl)
  ) {
    return { isSensitive: true, reason: 'Login authentication URL detected' };
  }
  if (/\b(enter password|sign in with password|log in to your account)\b/i.test(lowerText)) {
    return { isSensitive: true, reason: 'Login credential wall detected' };
  }

  return { isSensitive: false };
}

/**
 * Reusable safe browser operations.
 * Strictly domain-neutral: no temple, travel, or hotel selectors.
 */
export const skills = {
  /**
   * Navigates the session safely to target URL, evaluates title and safe text preview,
   * inspects for sensitive walls, and automatically pauses the session for human handoff if sensitive.
   */
  async navigate(
    session: WebcmdSession,
    url: string,
    sessionManager?: WebcmdSessionManager,
  ): Promise<SafePageState> {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot navigate to ${url}`);
    }
    if (session.isPaused) {
      throw new Error(`Session ${session.id} is paused. Resume before navigating.`);
    }

    session.currentUrl = url;

    let title = '';
    let content = '';

    const page = session.page ?? session.handle?.page;
    if (page) {
      await page.goto(url, { waitUntil: 'load' });

      try {
        title = await page.evaluate(() => document.title || '');
      } catch {
        title = '';
      }

      try {
        content = await page.evaluate(() => {
          if (!document.body) return '';
          return document.body.innerText ? document.body.innerText.slice(0, 2000) : '';
        });
      } catch {
        content = '';
      }
    }

    const inspection = inspectSensitiveContent(url, title, content);

    const pageState: SafePageState = {
      url,
      title,
      content,
      content_found: content.trim().length > 0,
      isSensitive: inspection.isSensitive,
      sensitiveReason: inspection.reason,
      isPaused: session.isPaused,
    };

    // If sensitive page detected, immediately pause session for human handoff
    if (pageState.isSensitive) {
      if (sessionManager) {
        await sessionManager.pauseSession(session, inspection.reason);
      } else {
        session.isPaused = true;
      }
      pageState.isPaused = true;
    }

    return pageState;
  },

  /**
   * Safely reads current page state without modifying session or navigation.
   */
  async readPageState(session: WebcmdSession): Promise<SafePageState> {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot read page state.`);
    }

    const url = session.currentUrl ?? 'about:blank';
    let title = '';
    let content = '';

    const page = session.page ?? session.handle?.page;
    if (page) {
      try {
        title = await page.evaluate(() => document.title || '');
      } catch {
        title = '';
      }

      try {
        content = await page.evaluate(() => {
          if (!document.body) return '';
          return document.body.innerText ? document.body.innerText.slice(0, 2000) : '';
        });
      } catch {
        content = '';
      }
    }

    const inspection = inspectSensitiveContent(url, title, content);

    return {
      url,
      title,
      content,
      content_found: content.trim().length > 0,
      isSensitive: inspection.isSensitive,
      sensitiveReason: inspection.reason,
      isPaused: session.isPaused,
    };
  },

  /**
   * Extracts visible text from page or selected safe container.
   * Strictly forbids selectors that target sensitive credential/payment fields.
   */
  async extractVisibleText(
    session: WebcmdSession,
    selector?: string,
    maxLength = 4000,
  ): Promise<string> {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot extract text.`);
    }

    if (selector) {
      const lowerSel = selector.toLowerCase();
      if (
        lowerSel.includes('password') ||
        lowerSel.includes('otp') ||
        lowerSel.includes('cvv') ||
        lowerSel.includes('card') ||
        lowerSel.includes('pin')
      ) {
        throw new Error(`Safety Guard: Selector "${selector}" targets sensitive controls and is rejected.`);
      }
    }

    const page = session.page ?? session.handle?.page;
    if (!page) {
      return '';
    }

    try {
      const rawText = await page.evaluate((sel: string | undefined) => {
        if (sel) {
          const el = document.querySelector(sel);
          return el && (el as HTMLElement).innerText ? (el as HTMLElement).innerText : '';
        }
        return document.body && document.body.innerText ? document.body.innerText : '';
      }, selector);

      return typeof rawText === 'string' ? rawText.slice(0, maxLength) : '';
    } catch {
      return '';
    }
  },

  /**
   * Safely pauses execution for specified milliseconds.
   */
  async wait(session: WebcmdSession, ms: number): Promise<void> {
    if (session.isClosed) {
      throw new Error(`Session ${session.id} is closed. Cannot wait.`);
    }

    const page = session.page ?? session.handle?.page;
    if (page && typeof page.wait === 'function') {
      await page.wait(ms);
    } else {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  },

  /**
   * Takes a safe text/metadata snapshot of the current page.
   */
  async snapshot(session: WebcmdSession): Promise<SafePageState> {
    return skills.readPageState(session);
  },
};

/**
 * Class-based wrapper around safe skills for dependency injection and delegation.
 */
export class WebcmdSkills {
  constructor(private readonly client?: IWebcmdClient) {}

  async navigate(session: WebcmdSession, url: string, sessionManager?: WebcmdSessionManager): Promise<SafePageState> {
    return skills.navigate(session, url, sessionManager);
  }

  async readPage(session: WebcmdSession): Promise<SafePageState> {
    return skills.readPageState(session);
  }

  async readPageState(session: WebcmdSession): Promise<SafePageState> {
    return skills.readPageState(session);
  }

  async extractVisibleText(session: WebcmdSession, selector?: string, maxLength?: number): Promise<string> {
    return skills.extractVisibleText(session, selector, maxLength);
  }

  async wait(session: WebcmdSession, ms: number): Promise<void> {
    return skills.wait(session, ms);
  }

  async snapshot(session: WebcmdSession): Promise<SafePageState> {
    return skills.snapshot(session);
  }
}
