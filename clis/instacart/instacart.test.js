import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './stores.js';
import './storefront.js';
import { extractProductCards, extractStoreCards, normalizeRetailer, parseLimit } from './utils.js';

const storesCommand = getRegistry().get('instacart/stores');
const storefrontCommand = getRegistry().get('instacart/storefront');

function createPage(evaluateResults) {
    const results = [...evaluateResults];
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async () => results.shift()),
    };
}

describe('instacart command metadata', () => {
    it('registers stores and storefront as persistent browser commands', () => {
        expect(storesCommand).toMatchObject({
            site: 'instacart',
            name: 'stores',
            access: 'read',
            browser: true,
            strategy: 'ui',
            siteSession: 'persistent',
        });
        expect(storefrontCommand).toMatchObject({
            site: 'instacart',
            name: 'storefront',
            access: 'read',
            browser: true,
            strategy: 'ui',
            siteSession: 'persistent',
        });
    });
});

describe('instacart helper validation', () => {
    it('validates limit and retailer slugs without silent clamp', () => {
        expect(parseLimit(undefined)).toBe(10);
        expect(parseLimit('30')).toBe(30);
        expect(() => parseLimit(0)).toThrow('--limit must be between 1 and 30');
        expect(() => parseLimit(31)).toThrow('--limit must be between 1 and 30');
        expect(() => parseLimit('many')).toThrow('--limit must be an integer');

        expect(normalizeRetailer(' Sprouts ')).toBe('sprouts');
        expect(() => normalizeRetailer('sprouts/storefront')).toThrow('retailer must be an Instacart retailer slug');
    });
});

describe('instacart DOM extraction', () => {
    it('extracts visible store cards from linked storefronts', () => {
        const dom = new JSDOM(`
          <a href="/store/safeway/storefront">
            <span>Safeway</span>
            <div>Delivery by 5:30am</div>
            <div>Pickup available</div>
            <span>EBT</span>
            <span>Lots of deals</span>
          </a>
          <a href="/store/safeway/storefront"><span>Safeway duplicate</span></a>
          <a href="/store/sprouts/storefront">
            <span>Sprouts Farmers Market</span>
            <div>Delivery by 8:45am</div>
            <span>$15 off</span>
            <span>No markups</span>
          </a>
        `, { url: 'https://www.instacart.com/' });

        expect(extractStoreCards(dom.window.document, 10)).toEqual([
            {
                rank: 1,
                slug: 'safeway',
                name: 'Safeway',
                delivery: 'Delivery by 5:30am',
                pickup: 'Pickup available',
                tags: 'EBT, Lots of deals',
                url: 'https://www.instacart.com/store/safeway/storefront',
            },
            {
                rank: 2,
                slug: 'sprouts',
                name: 'Sprouts Farmers Market',
                delivery: 'Delivery by 8:45am',
                pickup: null,
                tags: '$15 off, No markups',
                url: 'https://www.instacart.com/store/sprouts/storefront',
            },
        ]);
    });

    it('extracts product cards from visible storefront links', () => {
        const dom = new JSDOM(`
          <a href="/products/16616932-organic-asparagus-each?retailerSlug=sprouts">
            <span>Organic</span>
            <div>Current price: $3.86 each (estimated)</div>
            <span>$386</span>
            <div>Original Price: $5.81 each (estimated)</div>
            <span>$5.81</span>
            <span>34% off</span>
            <span>Organic Asparagus</span>
            <span>$3.98 / lb</span>
            <span>About 0.97 lb each</span>
            <span>Many in stock</span>
          </a>
        `, { url: 'https://www.instacart.com/store/sprouts/storefront' });

        expect(extractProductCards(dom.window.document, 10)).toEqual([{
            rank: 1,
            productId: '16616932',
            title: 'Organic Asparagus',
            priceText: '$3.86',
            originalPriceText: '$5.81',
            discount: '34% off',
            size: null,
            stock: 'Many in stock',
            url: 'https://www.instacart.com/products/16616932-organic-asparagus-each?retailerSlug=sprouts',
        }]);
    });
});

describe('instacart command execution', () => {
    it('stores returns extracted rows', async () => {
        const page = createPage([
            [{ rank: 1, slug: 'safeway', name: 'Safeway', url: 'https://www.instacart.com/store/safeway/storefront' }],
            'All stores in San Francisco Bay Area',
        ]);

        await expect(storesCommand.func(page, { limit: 1 })).resolves.toEqual([
            { rank: 1, slug: 'safeway', name: 'Safeway', url: 'https://www.instacart.com/store/safeway/storefront' },
        ]);
    });

    it('storefront returns extracted product rows', async () => {
        const page = createPage([
            [{ rank: 1, productId: '16616932', title: 'Organic Asparagus', priceText: '$3.86' }],
            'Sprouts Farmers Market Organic Asparagus',
        ]);

        await expect(storefrontCommand.func(page, { retailer: 'sprouts', limit: 1 })).resolves.toEqual([
            { rank: 1, productId: '16616932', title: 'Organic Asparagus', priceText: '$3.86' },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.instacart.com/store/sprouts/storefront', { waitUntil: 'load', settleMs: 2500 });
    });

    it('throws typed auth and empty errors', async () => {
        await expect(storesCommand.func(createPage([[], 'verify you are human']), { limit: 1 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        await expect(storefrontCommand.func(createPage([[], 'Sprouts Farmers Market']), { retailer: 'sprouts', limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
