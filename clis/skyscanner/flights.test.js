import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './flights.js';
import { __test__ } from './flights.js';

const command = getRegistry().get('skyscanner/flights');

function createPage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('skyscanner flights command metadata', () => {
    it('registers the browser-backed flights command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('skyscanner');
        expect(command.name).toBe('flights');
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.strategy).toBe('ui');
        expect(command.columns).toEqual([
            'rank',
            'priceText',
            'airlines',
            'outboundTime',
            'outboundRoute',
            'outboundDuration',
            'outboundStops',
            'returnTime',
            'returnRoute',
            'returnDuration',
            'returnStops',
            'url',
        ]);
    });
});

describe('skyscanner flights helpers', () => {
    it('builds the observed route URL from Skyscanner route codes and ISO dates', () => {
        expect(__test__.buildFlightsUrl({
            origin: 'NYCA',
            destination: 'lond',
            departDate: '2026-08-01',
            returnDate: '2026-08-08',
        })).toBe('https://www.skyscanner.com/transport/flights/nyca/lond/260801/260808/');
    });

    it('rejects bad dates and limits without silent clamp', () => {
        expect(() => __test__.buildFlightsUrl({
            origin: 'nyca',
            destination: 'lond',
            departDate: '2026-02-30',
            returnDate: '2026-08-08',
        })).toThrow('--depart-date is not a valid calendar date');
        expect(() => __test__.parseLimit(0)).toThrow('--limit must be between 1 and 30, got 0');
        expect(() => __test__.parseLimit(31)).toThrow('--limit must be between 1 and 30, got 31');
        expect(() => __test__.parseLimit('abc')).toThrow('--limit must be an integer');
    });

    it('extracts visible flight cards from Skyscanner ticket DOM', () => {
        const dom = new JSDOM(`
          <a href="/transport_deeplink/4.0/US/en-US/USD/british-airways/example">
            <div data-testid="ticket">
              <img alt="British Airways" src="//www.skyscanner.net/images/airlines/small/BA.png">
              <span>9:25 PM</span><span>9:25 PM</span><span>EWR</span><span>EWR</span>
              <span>7h 05</span><span>Direct</span>
              <span>9:30 AM</span><span>9:30 AM</span><span>LHR</span><span>LHR</span>
              <img alt="British Airways" src="//www.skyscanner.net/images/airlines/small/BA.png">
              <span>4:35 PM</span><span>4:35 PM</span><span>LHR</span><span>LHR</span>
              <span>7h 50</span><span>Direct</span>
              <span>7:25 PM</span><span>7:25 PM</span><span>EWR</span><span>EWR</span>
              <span>12 deals from</span><span>$892</span>
            </div>
          </a>
        `, { url: 'https://www.skyscanner.com/transport/flights/nyca/lond/260801/260808/' });

        expect(__test__.extractFlightsFromDocument(dom.window.document, 10)).toEqual({
            blocked: false,
            rows: [{
                rank: 1,
                priceText: '$892',
                airlines: 'British Airways',
                outboundTime: '9:25 PM-9:30 AM',
                outboundRoute: 'EWR-LHR',
                outboundDuration: '7h 05',
                outboundStops: 'Direct',
                returnTime: '4:35 PM-7:25 PM',
                returnRoute: 'LHR-EWR',
                returnDuration: '7h 50',
                returnStops: 'Direct',
                url: 'https://www.skyscanner.com/transport_deeplink/4.0/US/en-US/USD/british-airways/example',
            }],
        });
    });

    it('detects captcha pages as blocked instead of returning empty rows', () => {
        const dom = new JSDOM('<body>Verify you are human to continue</body>', {
            url: 'https://www.skyscanner.com/sttc/px/captcha-v2/index.html',
        });
        expect(__test__.extractFlightsFromDocument(dom.window.document, 10)).toEqual({ blocked: true, rows: [] });
    });
});

describe('skyscanner flights execution', () => {
    it('navigates to the constructed route and returns rows from the extractor', async () => {
        const page = createPage({
            blocked: false,
            rows: [{ rank: 1, priceText: '$892', airlines: 'British Airways' }],
        });

        await expect(command.func(page, {
            origin: 'nyca',
            destination: 'lond',
            'depart-date': '2026-08-01',
            'return-date': '2026-08-08',
            limit: 1,
        })).resolves.toEqual([{ rank: 1, priceText: '$892', airlines: 'British Airways' }]);
        expect(page.goto).toHaveBeenCalledWith(
            'https://www.skyscanner.com/transport/flights/nyca/lond/260801/260808/',
            { waitUntil: 'load', settleMs: 2000 },
        );
    });

    it('throws auth-required for Skyscanner verification pages', async () => {
        const page = createPage({ blocked: true, rows: [] });
        await expect(command.func(page, {
            origin: 'nyca',
            destination: 'lond',
            'depart-date': '2026-08-01',
            'return-date': '2026-08-08',
        })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws empty-result when the visible page has no flight cards', async () => {
        const page = createPage({ blocked: false, rows: [] });
        await expect(command.func(page, {
            origin: 'nyca',
            destination: 'lond',
            'depart-date': '2026-08-01',
            'return-date': '2026-08-08',
        })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
