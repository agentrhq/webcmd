import { describe, it, expect, vi } from 'vitest';
import {
  StandardResult,
  StandardResultStatus,
  createSuccessResult,
  createApprovalRequiredResult,
  createFailureResult,
} from './result_schema.js';
import { AdapterBase, IAdapterBase } from './adapter_base.js';
import { BrowserManager, BrowserSession, PageState } from './browser_manager.js';
import {
  ErrorHandler,
  ErrorCode,
  NAVIGATION_FAILED,
  TIMEOUT,
  ELEMENT_NOT_FOUND,
  PAGE_CHANGED,
  WEBSITE_UNAVAILABLE,
  RATE_LIMITED,
  LOGIN_REQUIRED,
  CAPTCHA_DETECTED,
  NO_AVAILABILITY,
  INVALID_INPUT,
  UNKNOWN_ERROR,
} from './error_handler.js';
import { RecoveryManager, RetryResult } from './recovery.js';

describe('Milestone 2: Reusable PC2A Core Foundation', () => {
  describe('1. result_schema.ts', () => {
    it('satisfies the exact StandardResult contract', () => {
      const validStatuses: StandardResultStatus[] = [
        'completed',
        'searching',
        'partial',
        'failed',
        'retrying',
        'blocked',
        'approval_required',
      ];

      for (const status of validStatuses) {
        const result: StandardResult<{ query: string }> = {
          success: status === 'completed',
          status,
          adapter: 'travel',
          action: 'search_trains',
          data: status === 'completed' ? { query: 'NDLS to BSB' } : null,
          metadata: {
            source: 'webcmd',
            timestamp: new Date().toISOString(),
          },
          error: status === 'failed' ? { code: 'FAIL', message: 'failed' } : null,
        };

        expect(typeof result.success).toBe('boolean');
        expect(validStatuses).toContain(result.status);
        expect(result.adapter).toBe('travel');
        expect(result.action).toBe('search_trains');
        expect(result.metadata.source).toBe('webcmd');
        expect(typeof result.metadata.timestamp).toBe('string');
      }
    });

    it('creates success results via createSuccessResult helper', () => {
      const data = { trainNo: '12301', seatsAvailable: 42 };
      const res = createSuccessResult('travel', 'check_seats', data);

      expect(res.success).toBe(true);
      expect(res.status).toBe('completed');
      expect(res.adapter).toBe('travel');
      expect(res.action).toBe('check_seats');
      expect(res.data).toEqual(data);
      expect(res.metadata.source).toBe('webcmd');
      expect(res.error).toBeNull();
    });

    it('creates approval_required results via createApprovalRequiredResult helper', () => {
      const res = createApprovalRequiredResult('temple', 'vip_darshan', 'OTP verification wall detected');

      expect(res.success).toBe(false);
      expect(res.status).toBe('approval_required');
      expect(res.adapter).toBe('temple');
      expect(res.action).toBe('vip_darshan');
      expect(res.data).toBeNull();
      expect(res.metadata.approvalReason).toContain('OTP');
      expect(res.error?.code).toBe('APPROVAL_REQUIRED');
    });

    it('creates failure results via createFailureResult helper', () => {
      const res = createFailureResult('hotel', 'search_rooms', 'TIMEOUT', 'Network socket timed out');

      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.adapter).toBe('hotel');
      expect(res.action).toBe('search_rooms');
      expect(res.data).toBeNull();
      expect(res.error?.code).toBe('TIMEOUT');
      expect(res.error?.message).toBe('Network socket timed out');
    });
  });

  describe('2. adapter_base.ts', () => {
    it('allows extending AdapterBase and invoking run(input)', async () => {
      interface TestInput {
        location: string;
      }
      interface TestOutput {
        places: string[];
      }

      class TestAdapter extends AdapterBase<TestInput, TestOutput> {
        readonly adapterName = 'test_explorer';

        async run(input: TestInput): Promise<StandardResult<TestOutput>> {
          return createSuccessResult(this.adapterName, 'explore', {
            places: [`Destination at ${input.location}`],
          });
        }
      }

      const adapter = new TestAdapter();
      const output = await adapter.run({ location: 'Varanasi' });

      expect(output.success).toBe(true);
      expect(output.adapter).toBe('test_explorer');
      expect(output.data?.places).toEqual(['Destination at Varanasi']);
    });

    it('satisfies IAdapterBase interface signature', async () => {
      const mockAdapter: IAdapterBase<{ id: number }, { found: boolean }> = {
        adapterName: 'mock_adapter',
        run: async (input) => createSuccessResult('mock_adapter', 'find', { found: input.id > 0 }),
      };

      const res = await mockAdapter.run({ id: 10 });
      expect(res.success).toBe(true);
      expect(res.data?.found).toBe(true);
    });
  });

  describe('3. browser_manager.ts', () => {
    it('manages sessions using Webcmd client layer mocks: startSession, navigate, pauseSession, closeSession', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes('document.title')) return 'Official Information Portal';
          if (fnStr.includes('innerText')) return 'Welcome to the public portal for darshan and schedules.';
          return '';
        }),
        closeWindow: vi.fn().mockResolvedValue(undefined),
      };

      const mockFactory = {
        connect: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new BrowserManager({ factory: mockFactory as any });

      // 1. startSession
      const session: BrowserSession = await manager.startSession();
      expect(session.id).toMatch(/^webcmd-session-/);
      expect(session.isClosed).toBe(false);
      expect(session.isPaused).toBe(false);
      expect(mockFactory.connect).toHaveBeenCalledWith({ session: session.id, surface: 'adapter' });

      // 2. navigate
      const pageState: PageState = await manager.navigate(session, 'https://temple-darshan.gov.in');
      expect(mockPage.goto).toHaveBeenCalledWith('https://temple-darshan.gov.in', { waitUntil: 'load' });
      expect(pageState.url).toBe('https://temple-darshan.gov.in');
      expect(pageState.title).toBe('Official Information Portal');
      expect(pageState.content).toContain('Welcome to the public portal');
      expect(pageState.isSensitive).toBe(false);
      expect(pageState.isPaused).toBe(false);

      // 3. pauseSession
      await manager.pauseSession(session);
      expect(session.isPaused).toBe(true);

      // Attempting to navigate while paused throws
      await expect(manager.navigate(session, 'https://temple-darshan.gov.in/schedule')).rejects.toThrow(
        /is paused/i,
      );

      // 4. closeSession
      await manager.closeSession(session);
      expect(session.isClosed).toBe(true);
      expect(mockPage.closeWindow).toHaveBeenCalled();
      expect(mockFactory.close).toHaveBeenCalled();

      // Attempting to navigate after close throws
      await expect(manager.navigate(session, 'https://temple-darshan.gov.in')).rejects.toThrow(
        /is closed/i,
      );
    });

    it('detects sensitive payment/checkout/OTP pages and automatically pauses session', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes('document.title')) return 'Payment Gateway - Razorpay';
          if (fnStr.includes('innerText')) return 'Amount Payable: Rs 500. Enter card number and CVV.';
          return '';
        }),
      };

      const mockFactory = {
        connect: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new BrowserManager({ factory: mockFactory as any });
      const session = await manager.startSession();

      const state = await manager.navigate(session, 'https://temple.gov.in/checkout/pay');
      expect(state.isSensitive).toBe(true);
      expect(state.sensitiveReason).toContain('Payment');
      expect(state.isPaused).toBe(true);
      expect(session.isPaused).toBe(true);
    });

    it('detects OTP verification challenges in page text and automatically pauses session', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes('document.title')) return 'Verify Mobile Number';
          if (fnStr.includes('innerText')) return 'Enter OTP sent to your registered mobile number.';
          return '';
        }),
      };

      const mockFactory = {
        connect: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new BrowserManager({ factory: mockFactory as any });
      const session = await manager.startSession();

      const state = await manager.navigate(session, 'https://temple.gov.in/auth/verify-otp');
      expect(state.isSensitive).toBe(true);
      expect(state.sensitiveReason).toContain('OTP');
      expect(session.isPaused).toBe(true);
    });
  });

  describe('4. error_handler.ts', () => {
    it('exports all 11 exact error code constants individually and in ErrorCode map', () => {
      expect(NAVIGATION_FAILED).toBe('NAVIGATION_FAILED');
      expect(TIMEOUT).toBe('TIMEOUT');
      expect(ELEMENT_NOT_FOUND).toBe('ELEMENT_NOT_FOUND');
      expect(PAGE_CHANGED).toBe('PAGE_CHANGED');
      expect(WEBSITE_UNAVAILABLE).toBe('WEBSITE_UNAVAILABLE');
      expect(RATE_LIMITED).toBe('RATE_LIMITED');
      expect(LOGIN_REQUIRED).toBe('LOGIN_REQUIRED');
      expect(CAPTCHA_DETECTED).toBe('CAPTCHA_DETECTED');
      expect(NO_AVAILABILITY).toBe('NO_AVAILABILITY');
      expect(INVALID_INPUT).toBe('INVALID_INPUT');
      expect(UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');

      expect(ErrorCode.NAVIGATION_FAILED).toBe(NAVIGATION_FAILED);
      expect(ErrorCode.TIMEOUT).toBe(TIMEOUT);
      expect(ErrorCode.ELEMENT_NOT_FOUND).toBe(ELEMENT_NOT_FOUND);
      expect(ErrorCode.PAGE_CHANGED).toBe(PAGE_CHANGED);
      expect(ErrorCode.WEBSITE_UNAVAILABLE).toBe(WEBSITE_UNAVAILABLE);
      expect(ErrorCode.RATE_LIMITED).toBe(RATE_LIMITED);
      expect(ErrorCode.LOGIN_REQUIRED).toBe(LOGIN_REQUIRED);
      expect(ErrorCode.CAPTCHA_DETECTED).toBe(CAPTCHA_DETECTED);
      expect(ErrorCode.NO_AVAILABILITY).toBe(NO_AVAILABILITY);
      expect(ErrorCode.INVALID_INPUT).toBe(INVALID_INPUT);
      expect(ErrorCode.UNKNOWN_ERROR).toBe(UNKNOWN_ERROR);
    });

    it('classifies all 11 standard error conditions using ErrorHandler.classify', () => {
      // 1. NAVIGATION_FAILED
      expect(ErrorHandler.classify({ message: 'net::ERR_NAME_NOT_RESOLVED' })).toBe(NAVIGATION_FAILED);
      expect(ErrorHandler.classify(new Error('Navigation failed: cannot navigate to host'))).toBe(NAVIGATION_FAILED);

      // 2. TIMEOUT
      expect(ErrorHandler.classify({ message: 'ETIMEDOUT: connection timed out' })).toBe(TIMEOUT);
      expect(ErrorHandler.classify(new Error('Operation timeout after 15000ms'))).toBe(TIMEOUT);

      // 3. ELEMENT_NOT_FOUND
      expect(ErrorHandler.classify({ message: 'Selector .darshan-slot element not found' })).toBe(ELEMENT_NOT_FOUND);

      // 4. PAGE_CHANGED
      expect(ErrorHandler.classify({ message: 'Unexpected page layout: page changed after update' })).toBe(PAGE_CHANGED);
      expect(ErrorHandler.classify({ message: 'Stale element reference in DOM' })).toBe(PAGE_CHANGED);

      // 5. WEBSITE_UNAVAILABLE
      expect(ErrorHandler.classify({ status: 503, message: 'Service Unavailable' })).toBe(WEBSITE_UNAVAILABLE);
      expect(ErrorHandler.classify({ message: 'ECONNREFUSED 127.0.0.1:443' })).toBe(WEBSITE_UNAVAILABLE);

      // 6. RATE_LIMITED
      expect(ErrorHandler.classify({ statusCode: 429, message: 'Too Many Requests' })).toBe(RATE_LIMITED);
      expect(ErrorHandler.classify({ message: 'Rate limit exceeded, please slow down' })).toBe(RATE_LIMITED);

      // 7. LOGIN_REQUIRED
      expect(ErrorHandler.classify({ status: 401, message: 'Authentication required, please sign in' })).toBe(LOGIN_REQUIRED);
      expect(ErrorHandler.classify({ message: 'Session expired: login required' })).toBe(LOGIN_REQUIRED);

      // 8. CAPTCHA_DETECTED
      expect(ErrorHandler.classify({ message: 'Cloudflare captcha challenge encountered' })).toBe(CAPTCHA_DETECTED);
      expect(ErrorHandler.classify({ message: 'hCaptcha token required' })).toBe(CAPTCHA_DETECTED);

      // 9. NO_AVAILABILITY
      expect(ErrorHandler.classify({ message: 'No availability found for selected date' })).toBe(NO_AVAILABILITY);
      expect(ErrorHandler.classify({ message: 'All slots booked, quota exhausted' })).toBe(NO_AVAILABILITY);

      // 10. INVALID_INPUT
      expect(ErrorHandler.classify({ status: 400, message: 'Invalid input parameter: pilgrim count cannot be 0' })).toBe(INVALID_INPUT);

      // 11. UNKNOWN_ERROR
      expect(ErrorHandler.classify({ message: 'Uncaught internal reference problem' })).toBe(UNKNOWN_ERROR);
      expect(ErrorHandler.classify(null)).toBe(UNKNOWN_ERROR);
      expect(ErrorHandler.classify(undefined)).toBe(UNKNOWN_ERROR);
    });

    it('works as an instance method as well', () => {
      const handler = new ErrorHandler();
      expect(handler.classify(new Error('Connection timed out'))).toBe(TIMEOUT);
    });
  });

  describe('5. recovery.ts', () => {
    it('retries transient failures up to default 3 attempts and succeeds', async () => {
      let attemptsRun = 0;
      const transientFn = vi.fn().mockImplementation(async (attempt: number) => {
        attemptsRun = attempt;
        if (attempt < 3) {
          throw new Error('Temporary gateway hiccup');
        }
        return { darshanDate: '2026-10-15', available: true };
      });

      const res: RetryResult<{ darshanDate: string; available: boolean }> = await RecoveryManager.retry(
        transientFn,
        { backoffMs: 1 },
      );

      expect(res.success).toBe(true);
      expect(res.attempts).toBe(3);
      expect(res.result).toEqual({ darshanDate: '2026-10-15', available: true });
      expect(res.requiresApproval).toBe(false);
      expect(transientFn).toHaveBeenCalledTimes(3);
    });

    it('stops after maximum 3 attempts on persistent failure', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Portal is completely offline'));

      const res = await RecoveryManager.retry(failingFn, { backoffMs: 1 });

      expect(res.success).toBe(false);
      expect(res.attempts).toBe(3);
      expect(res.requiresApproval).toBe(false);
      expect(res.error).toBeDefined();
      expect(failingFn).toHaveBeenCalledTimes(3);
    });

    it('NEVER executes or retries dangerous or protected actions: payment, OTP, final submit, checkout, confirmation', async () => {
      const protectedActionKeywords = [
        'make_payment',
        'pay_gateway',
        'checkout_cart',
        'verify_otp',
        'enter_otp_pin',
        'final_submit_form',
        'final submit',
        'confirm_booking',
        'order_confirmation',
      ];

      for (const action of protectedActionKeywords) {
        const protectedFn = vi.fn().mockResolvedValue('should not run');
        const res = await RecoveryManager.retry(protectedFn, { actionName: action });

        expect(protectedFn).not.toHaveBeenCalled();
        expect(res.success).toBe(false);
        expect(res.attempts).toBe(0);
        expect(res.requiresApproval).toBe(true);
        expect(res.approvalReason).toContain('approval is required');
        expect((res.error as any)?.code).toBe('APPROVAL_REQUIRED');

        // Verify caller can convert into approval_required upstream
        const upstreamResult = createApprovalRequiredResult('temple', action, res.approvalReason!);
        expect(upstreamResult.status).toBe('approval_required');
        expect(upstreamResult.metadata.approvalReason).toBe(res.approvalReason);
      }
    });

    it('respects isProtected policy flag even with arbitrary action name', async () => {
      const protectedFn = vi.fn().mockResolvedValue('blocked');
      const res = await RecoveryManager.retry(protectedFn, {
        actionName: 'harmless_name',
        isProtected: true,
      });

      expect(protectedFn).not.toHaveBeenCalled();
      expect(res.requiresApproval).toBe(true);
    });

    it('halts immediately if execution encounters a protected checkpoint or OTP wall during run', async () => {
      let callCount = 0;
      const fnWithCheckpoint = vi.fn().mockImplementation(async () => {
        callCount++;
        throw new Error('Redirected to OTP verification page');
      });

      const res = await RecoveryManager.retry(fnWithCheckpoint, {
        actionName: 'navigate_booking',
        backoffMs: 1,
      });

      // Crucial: must NOT retry after discovering OTP checkpoint!
      expect(callCount).toBe(1);
      expect(res.success).toBe(false);
      expect(res.requiresApproval).toBe(true);
      expect(res.approvalReason).toContain('OTP verification');
    });

    it('halts immediately if fn returns a result indicating approval_required', async () => {
      let callCount = 0;
      const fnReturningApproval = vi.fn().mockImplementation(async () => {
        callCount++;
        return { status: 'approval_required', reason: 'HITL payment step reached' };
      });

      const res = await RecoveryManager.retry(fnReturningApproval, {
        actionName: 'book_darshan',
        backoffMs: 1,
      });

      expect(callCount).toBe(1);
      expect(res.success).toBe(false);
      expect(res.requiresApproval).toBe(true);
      expect(res.approvalReason).toBe('HITL payment step reached');
    });

    it('supports instance method usage', async () => {
      const manager = new RecoveryManager();
      const res = await manager.retry(async () => 'hello', { backoffMs: 1 });
      expect(res.success).toBe(true);
      expect(res.result).toBe('hello');
    });
  });
});
