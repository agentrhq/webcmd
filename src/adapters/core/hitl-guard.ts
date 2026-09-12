import {
  IBrowserSession,
  IHitlDetector,
  HitlCheckResult,
  HitlReason,
} from './types.js';

interface MarkerRule {
  reason: HitlReason;
  urlPatterns: RegExp[];
  contentPatterns: RegExp[];
  description: string;
}

/**
 * Default heuristic rules identifying pages that require Human-In-The-Loop approval.
 */
const DEFAULT_HITL_RULES: MarkerRule[] = [
  {
    reason: 'payment_page',
    urlPatterns: [
      /\/pay(\/|$|\?)/i,
      /\/checkout(\/|$|\?)/i,
      /\/payment(-gateway)?/i,
      /billdesk\.com/i,
      /razorpay\.com/i,
      /paytm\.com/i,
      /ccavenue\.com/i,
      /sbi(e)?pay/i,
    ],
    contentPatterns: [
      /\b(enter card number|cvv|expiry date|valid thru)\b/i,
      /\b(upi id|scan to pay|upi qr)\b/i,
      /\b(net banking|select your bank)\b/i,
      /\b(payment gateway|order summary|amount payable)\b/i,
    ],
    description: 'Payment or checkout gateway detected',
  },
  {
    reason: 'otp_verification',
    urlPatterns: [
      /\/otp(\/|$|\?)/i,
      /\/verify(-otp)?(\/|$|\?)/i,
      /\/two-factor(\/|$|\?)/i,
      /\/2fa(\/|$|\?)/i,
    ],
    contentPatterns: [
      /\b(enter otp|enter one-time password|otp sent to)\b/i,
      /\b(resend otp|verify otp|otp verification)\b/i,
      /autocomplete=["']one-time-code["']/i,
    ],
    description: 'OTP / Two-Factor authentication screen detected',
  },
  {
    reason: 'captcha_challenge',
    urlPatterns: [
      /\/captcha(\/|$|\?)/i,
      /\/challenge(\/|$|\?)/i,
      /recaptcha/i,
      /hcaptcha/i,
    ],
    contentPatterns: [
      /\b(verify you are human|select all squares with|i'm not a robot)\b/i,
      /\b(enter the characters shown|enter captcha)\b/i,
      /class=["'][^"']*(g-recaptcha|h-captcha)[^"']*["']/i,
    ],
    description: 'Captcha challenge detected',
  },
  {
    reason: 'final_submit',
    urlPatterns: [
      /\/confirm(-booking)?(\/|$|\?)/i,
      /\/final-submit(\/|$|\?)/i,
      /\/review-and-pay(\/|$|\?)/i,
    ],
    contentPatterns: [
      /\b(confirm & pay|proceed to pay|pay now|complete booking)\b/i,
      /\b(submit application|authorize transaction)\b/i,
    ],
    description: 'Final submission / irreversible commitment point detected',
  },
];

export class HitlGuard implements IHitlDetector {
  private rules: MarkerRule[];

  constructor(customRules?: MarkerRule[]) {
    this.rules = customRules || DEFAULT_HITL_RULES;
  }

  /**
   * Evaluates the current session state (URL and DOM content) against HITL criteria.
   */
  async check(session: IBrowserSession): Promise<HitlCheckResult> {
    if (session.isClosed) {
      return { requiresApproval: false };
    }

    const currentUrl = await session.getCurrentUrl();
    const content = await session.getPageContent();

    for (const rule of this.rules) {
      // 1. Check URL patterns
      for (const pattern of rule.urlPatterns) {
        if (pattern.test(currentUrl)) {
          return {
            requiresApproval: true,
            reason: rule.reason,
            details: `${rule.description} (matched URL pattern: ${pattern})`,
          };
        }
      }

      // 2. Check DOM content patterns
      for (const pattern of rule.contentPatterns) {
        if (pattern.test(content)) {
          return {
            requiresApproval: true,
            reason: rule.reason,
            details: `${rule.description} (matched content pattern: ${pattern})`,
          };
        }
      }
    }

    return { requiresApproval: false };
  }

  /**
   * Cross-cutting wrapper that checks the HITL guard before and after an operation.
   * If a trigger is detected at any point, the session is paused and approval is flagged.
   */
  async runWithGuard<T>(
    session: IBrowserSession,
    action: () => Promise<T>,
  ): Promise<{ requiresApproval: true; hitl: HitlCheckResult } | { requiresApproval: false; result: T }> {
    // Pre-check
    const preCheck = await this.check(session);
    if (preCheck.requiresApproval) {
      await session.pause();
      return { requiresApproval: true, hitl: preCheck };
    }

    // Execute wrapped action
    const result = await action();

    // Post-check
    const postCheck = await this.check(session);
    if (postCheck.requiresApproval) {
      await session.pause();
      return { requiresApproval: true, hitl: postCheck };
    }

    return { requiresApproval: false, result };
  }
}
