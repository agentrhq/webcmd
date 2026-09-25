import {
  IBrowserManager,
  IBrowserSession,
  IErrorHandler,
  StandardResult,
} from '../core/types.js';
import { HitlGuard } from '../core/hitl-guard.js';

export interface TravelSearchInput {
  origin: string;
  destination: string;
  date: string;
  trainClass?: string;
  quota?: string;
  portalUrl?: string;
}

export interface TrainOption {
  trainNumber: string;
  trainName: string;
  departureTime: string;
  arrivalTime: string;
  availableSeats: number;
  status: 'AVAILABLE' | 'RAC' | 'WL';
  fare: number;
}

export interface TravelAvailabilityData {
  origin: string;
  destination: string;
  date: string;
  trains: TrainOption[];
}

export class TravelAdapter {
  constructor(
    private browserManager: IBrowserManager,
    private errorHandler: IErrorHandler,
    private hitlGuard: HitlGuard = new HitlGuard(),
  ) {}

  async checkAvailability(
    input: TravelSearchInput,
  ): Promise<StandardResult<TravelAvailabilityData>> {
    const startTime = Date.now();
    let session: IBrowserSession | null = null;
    const portalUrl = input.portalUrl || 'https://irctc.co.in/nget/train-search';

    try {
      session = await this.browserManager.startSession();

      const navGuard = await this.hitlGuard.runWithGuard(session, async () => {
        await session!.navigate(portalUrl);
      });

      if (navGuard.requiresApproval) {
        return {
          success: false,
          status: 'approval_required',
          adapter: 'travel',
          action: 'check_availability',
          data: null,
          metadata: {
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            portal: portalUrl,
            sessionId: session.id,
            hitlReason: navGuard.hitl.reason,
            hitlDetails: navGuard.hitl.details,
          },
        };
      }

      // Mock IRCTC extraction
      const sampleTrains: TrainOption[] = [
        {
          trainNumber: '12424',
          trainName: 'RAJDHANI EXP',
          departureTime: '16:10',
          arrivalTime: '06:00',
          availableSeats: 34,
          status: 'AVAILABLE',
          fare: 1850,
        },
        {
          trainNumber: '22436',
          trainName: 'VANDE BHARAT EXP',
          departureTime: '06:00',
          arrivalTime: '14:00',
          availableSeats: 12,
          status: 'AVAILABLE',
          fare: 1750,
        },
      ];

      await this.browserManager.closeSession(session.id);
      session = null;

      return {
        success: true,
        status: 'completed',
        adapter: 'travel',
        action: 'check_availability',
        data: {
          origin: input.origin,
          destination: input.destination,
          date: input.date,
          trains: sampleTrains,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          portal: portalUrl,
        },
      };
    } catch (err) {
      if (session) {
        await this.browserManager.closeSession(session.id).catch(() => {});
      }
      const classified = this.errorHandler.classify(err);
      return {
        success: false,
        status: 'failed',
        adapter: 'travel',
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
          details: err,
        },
      };
    }
  }
}
