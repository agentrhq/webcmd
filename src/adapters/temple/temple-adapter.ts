import {
  IBrowserManager,
  IBrowserSession,
  IErrorHandler,
  StandardResult,
} from '../core/types.js';
import { HitlGuard } from '../core/hitl-guard.js';
import { TempleAvailabilityExtractor } from './availability.js';
import { CrowdEstimator } from './crowd-estimator.js';
import { TempleInput, TempleAvailabilityData } from './types.js';

export class TempleAdapter {
  constructor(
    private browserManager: IBrowserManager,
    private errorHandler: IErrorHandler,
    private hitlGuard: HitlGuard = new HitlGuard(),
    private availabilityExtractor: TempleAvailabilityExtractor = new TempleAvailabilityExtractor(),
    private crowdEstimator: CrowdEstimator = new CrowdEstimator(),
    private maxRetries: number = 2,
  ) {}

  /**
   * Orchestrates the complete slot availability check flow:
   * 1. Receive input (destination, date, pilgrims)
   * 2. Ask BrowserManager to start a session
   * 3. Navigate to the portal
   * 4. Extract availability data (retry on transient errors)
   * 5. Stop and return 'approval_required' if payment/OTP/final-submit page is reached
   * 6. Close (or pause) session cleanly
   */
  async checkAvailability(
    input: TempleInput,
  ): Promise<StandardResult<TempleAvailabilityData>> {
    const startTime = Date.now();
    let session: IBrowserSession | null = null;
    const portalUrl =
      input.portalUrl ||
      `https://temple-darshan.gov.in/${encodeURIComponent(input.destination.toLowerCase())}/availability`;

    try {
      // 1. Start browser session
      session = await this.browserManager.startSession();
      const activeSession = session;

      // 2. Navigate to portal with HITL guard wrapped
      const navGuard = await this.hitlGuard.runWithGuard(activeSession, async () => {
        await activeSession.navigate(portalUrl);
      });

      if (navGuard.requiresApproval) {
        // Keep session paused for human resolution
        return {
          success: false,
          status: 'approval_required',
          adapter: 'temple',
          action: 'check_availability',
          data: null,
          metadata: {
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            portal: portalUrl,
            sessionId: activeSession.id,
            hitlReason: navGuard.hitl.reason,
            hitlDetails: navGuard.hitl.details,
          },
        };
      }

      // 3. Extraction loop with retry on transient/retryable errors
      let attempt = 0;
      let lastError: unknown = null;

      while (attempt <= this.maxRetries) {
        try {
          const extractGuard = await this.hitlGuard.runWithGuard(
            activeSession,
            async () => {
              return await this.availabilityExtractor.extractSlots(
                activeSession,
                input,
              );
            },
          );

          if (extractGuard.requiresApproval) {
            return {
              success: false,
              status: 'approval_required',
              adapter: 'temple',
              action: 'check_availability',
              data: null,
              metadata: {
                timestamp: new Date().toISOString(),
                durationMs: Date.now() - startTime,
                portal: portalUrl,
                sessionId: activeSession.id,
                hitlReason: extractGuard.hitl.reason,
                hitlDetails: extractGuard.hitl.details,
              },
            };
          }

          const slots = extractGuard.result;
          const crowdInsight = this.crowdEstimator.estimateCrowd(
            slots,
            input.pilgrims,
          );

          const availabilityData: TempleAvailabilityData = {
            destination: input.destination,
            date: input.date,
            pilgrims: input.pilgrims,
            slots,
            crowdInsight,
            bookingOpen: slots.length > 0,
          };

          // Session complete - close cleanly
          await this.browserManager.closeSession(activeSession.id);
          session = null;

          return {
            success: true,
            status: 'completed',
            adapter: 'temple',
            action: 'check_availability',
            data: availabilityData,
            metadata: {
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              portal: portalUrl,
              attempts: attempt + 1,
            },
          };
        } catch (err) {
          lastError = err;
          const classified = this.errorHandler.classify(err);
          if (classified.retryable && attempt < this.maxRetries) {
            attempt++;
            await new Promise((r) => setTimeout(r, 50 * attempt));
            continue;
          }
          break;
        }
      }

      // 4. Failure after exhausting retries or non-retryable error
      const classified = this.errorHandler.classify(lastError);
      if (session) {
        await this.browserManager.closeSession(session.id).catch(() => {});
        session = null;
      }

      return {
        success: false,
        status: 'failed',
        adapter: 'temple',
        action: 'check_availability',
        data: null,
        metadata: {
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          portal: portalUrl,
          attempts: attempt + 1,
        },
        error: {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          details: classified.originalError,
        },
      };
    } catch (fatalErr) {
      if (session) {
        await this.browserManager.closeSession(session.id).catch(() => {});
      }
      const classified = this.errorHandler.classify(fatalErr);
      return {
        success: false,
        status: 'failed',
        adapter: 'temple',
        action: 'check_availability',
        data: null,
        metadata: {
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          portal: portalUrl,
        },
        error: {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          details: fatalErr,
        },
      };
    }
  }
}
