import {
  IBrowserManager,
  IBrowserSession,
  IErrorHandler,
  StandardResult,
} from '../core/types.js';
import { HitlGuard } from '../core/hitl-guard.js';

export interface HotelSearchInput {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  rooms?: number;
  portalUrl?: string;
}

export interface HotelOption {
  hotelId: string;
  name: string;
  rating: number;
  distanceFromTempleKm: number;
  pricePerNight: number;
  roomType: string;
  isAvailable: boolean;
}

export interface HotelAvailabilityData {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  hotels: HotelOption[];
}

export class HotelAdapter {
  constructor(
    private browserManager: IBrowserManager,
    private errorHandler: IErrorHandler,
    private hitlGuard: HitlGuard = new HitlGuard(),
  ) {}

  async checkAvailability(
    input: HotelSearchInput,
  ): Promise<StandardResult<HotelAvailabilityData>> {
    const startTime = Date.now();
    let session: IBrowserSession | null = null;
    const portalUrl = input.portalUrl || 'https://booking.com/searchresults.html';

    try {
      session = await this.browserManager.startSession();

      const navGuard = await this.hitlGuard.runWithGuard(session, async () => {
        await session!.navigate(portalUrl);
      });

      if (navGuard.requiresApproval) {
        return {
          success: false,
          status: 'approval_required',
          adapter: 'hotel',
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

      const sampleHotels: HotelOption[] = [
        {
          hotelId: 'h-101',
          name: 'Temple View Residency',
          rating: 4.6,
          distanceFromTempleKm: 0.4,
          pricePerNight: 2400,
          roomType: 'Deluxe AC Room',
          isAvailable: true,
        },
        {
          hotelId: 'h-102',
          name: 'Pilgrim Ashray Bhavan',
          rating: 4.2,
          distanceFromTempleKm: 1.1,
          pricePerNight: 1200,
          roomType: 'Standard Non-AC Room',
          isAvailable: true,
        },
      ];

      await this.browserManager.closeSession(session.id);
      session = null;

      return {
        success: true,
        status: 'completed',
        adapter: 'hotel',
        action: 'check_availability',
        data: {
          destination: input.destination,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          hotels: sampleHotels,
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
        adapter: 'hotel',
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
