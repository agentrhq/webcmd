import { describe, it, expect, beforeEach } from 'vitest';
import { MockBrowserManager, MockErrorHandler, MockBrowserSession } from '../core/core-mock.js';
import { HitlGuard } from '../core/hitl-guard.js';
import { TempleAdapter } from './temple-adapter.js';
import { TempleAvailabilityExtractor } from './availability.js';
import { CrowdEstimator } from './crowd-estimator.js';
import { TravelAdapter } from '../travel/travel-adapter.js';
import { HotelAdapter } from '../hotel/hotel-adapter.js';

describe('PRAVAAH Adapters Layer', () => {
  let browserManager: MockBrowserManager;
  let errorHandler: MockErrorHandler;
  let hitlGuard: HitlGuard;
  let extractor: TempleAvailabilityExtractor;
  let crowdEstimator: CrowdEstimator;
  let templeAdapter: TempleAdapter;

  beforeEach(() => {
    browserManager = new MockBrowserManager();
    errorHandler = new MockErrorHandler();
    hitlGuard = new HitlGuard();
    extractor = new TempleAvailabilityExtractor();
    crowdEstimator = new CrowdEstimator();

    templeAdapter = new TempleAdapter(
      browserManager,
      errorHandler,
      hitlGuard,
      extractor,
      crowdEstimator,
      2, // maxRetries
    );
  });

  describe('TempleAdapter', () => {
    it('Rule 1: Returns StandardResult shape on successful flow (status: completed)', async () => {
      // Mock page with slot elements
      browserManager.configureNextSession((session: MockBrowserSession) => {
        session.setPageContent(`
          <html>
            <body>
              <div class="slot-card" data-slot-id="slot-morning" data-time="06:00 - 08:00" data-available="85" data-capacity="100"></div>
              <div class="slot-card" data-slot-id="slot-noon" data-time="12:00 - 14:00" data-available="5" data-capacity="150"></div>
            </body>
          </html>
        `);
      });

      const result = await templeAdapter.checkAvailability({
        destination: 'Tirupati',
        date: '2026-10-15',
        pilgrims: 2,
        darshanType: 'special_entry',
      });

      // Strict StandardResult verification
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('status', 'completed');
      expect(result).toHaveProperty('adapter', 'temple');
      expect(result).toHaveProperty('action', 'check_availability');
      expect(result.data).not.toBeNull();
      expect(result.metadata).toHaveProperty('timestamp');
      expect(result.metadata).toHaveProperty('portal');

      // Domain data verification
      const data = result.data!;
      expect(data.destination).toBe('Tirupati');
      expect(data.slots).toHaveLength(2);
      expect(data.slots[0].slotId).toBe('slot-morning');
      expect(data.slots[0].availableSeats).toBe(85);

      // Crowd estimator insight verification
      expect(data.crowdInsight).toBeDefined();
      expect(data.crowdInsight.lowCrowdWindow).toBe('06:00 - 08:00');
      expect(data.crowdInsight.crowdLevel).toBe('low');
      expect(data.crowdInsight.queueEstimateMinutes).toBeLessThan(40);
    });

    it('Rule 3: Cross-cutting HITL detection triggers approval_required on payment URL', async () => {
      // Configure next session to navigate to /pay gateway
      const paymentPortalUrl = 'https://temple-darshan.gov.in/tirupati/pay';

      const result = await templeAdapter.checkAvailability({
        destination: 'Tirupati',
        date: '2026-10-15',
        pilgrims: 2,
        portalUrl: paymentPortalUrl,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('approval_required');
      expect(result.adapter).toBe('temple');
      expect(result.data).toBeNull();
      expect(result.metadata.hitlReason).toBe('payment_page');
    });

    it('Rule 3: Cross-cutting HITL detection triggers approval_required on OTP prompt in DOM', async () => {
      browserManager.configureNextSession((session: MockBrowserSession) => {
        session.setPageContent(`
          <html>
            <body>
              <h2>Verify Identity</h2>
              <p>Enter OTP sent to your registered mobile number</p>
              <input type="text" name="otp" autocomplete="one-time-code" />
              <button>Verify OTP</button>
            </body>
          </html>
        `);
      });

      const result = await templeAdapter.checkAvailability({
        destination: 'Kedarnath',
        date: '2026-10-15',
        pilgrims: 1,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('approval_required');
      expect(result.metadata.hitlReason).toBe('otp_verification');
    });

    it('Retries transient network error and succeeds on subsequent attempt', async () => {
      let attemptsCount = 0;

      // Custom extractor that fails once with a retryable error, then succeeds
      const flakyExtractor = {
        async extractSlots(session: any, input: any) {
          attemptsCount++;
          if (attemptsCount === 1) {
            const err = new Error('Gateway Timeout');
            (err as any).code = 'ETIMEDOUT';
            throw err;
          }
          return [
            {
              slotId: 'slot-1',
              timeWindow: '07:00 - 09:00',
              totalCapacity: 100,
              availableSeats: 50,
              pricePerPerson: 300,
              isSpecialEntry: true,
            },
          ];
        },
      };

      const retryingAdapter = new TempleAdapter(
        browserManager,
        errorHandler,
        hitlGuard,
        flakyExtractor as any,
        crowdEstimator,
        2,
      );

      const result = await retryingAdapter.checkAvailability({
        destination: 'Varanasi',
        date: '2026-10-15',
        pilgrims: 2,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.metadata.attempts).toBe(2);
      expect(result.data?.slots).toHaveLength(1);
    });

    it('Fails gracefully with classified error when error is fatal / unretryable', async () => {
      const failingExtractor = {
        async extractSlots() {
          const err = new Error('Portal undergoing scheduled database maintenance');
          (err as any).code = 'PORTAL_MAINTENANCE';
          throw err;
        },
      };

      const failingAdapter = new TempleAdapter(
        browserManager,
        errorHandler,
        hitlGuard,
        failingExtractor as any,
        crowdEstimator,
        1,
      );

      const result = await failingAdapter.checkAvailability({
        destination: 'Somnath',
        date: '2026-10-15',
        pilgrims: 4,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('PORTAL_MAINTENANCE');
      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('CrowdEstimator', () => {
    it('identifies morning slots as lower crowd compared to afternoon peak rush', () => {
      const slots = [
        {
          slotId: 's-noon',
          timeWindow: '12:00 - 14:00',
          totalCapacity: 100,
          availableSeats: 50,
          pricePerPerson: 300,
          isSpecialEntry: true,
        },
        {
          slotId: 's-morning',
          timeWindow: '06:00 - 08:00',
          totalCapacity: 100,
          availableSeats: 50,
          pricePerPerson: 300,
          isSpecialEntry: true,
        },
      ];

      const insight = crowdEstimator.estimateCrowd(slots, 2);
      expect(insight.lowCrowdWindow).toBe('06:00 - 08:00');
      expect(insight.bestSlotId).toBe('s-morning');
    });
  });

  describe('Travel & Hotel Adapters', () => {
    it('TravelAdapter conforms to StandardResult format', async () => {
      const travelAdapter = new TravelAdapter(browserManager, errorHandler, hitlGuard);
      const result = await travelAdapter.checkAvailability({
        origin: 'NDLS',
        destination: 'BGM',
        date: '2026-10-20',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.adapter).toBe('travel');
      expect(result.data?.trains.length).toBeGreaterThan(0);
    });

    it('HotelAdapter conforms to StandardResult format', async () => {
      const hotelAdapter = new HotelAdapter(browserManager, errorHandler, hitlGuard);
      const result = await hotelAdapter.checkAvailability({
        destination: 'Tirupati',
        checkInDate: '2026-10-15',
        checkOutDate: '2026-10-16',
        guests: 2,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.adapter).toBe('hotel');
      expect(result.data?.hotels.length).toBeGreaterThan(0);
    });
  });
});
