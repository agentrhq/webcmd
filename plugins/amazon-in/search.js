import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  buildSearchUrl,
  cleanText,
  normalizeSearchCards,
  validatePositiveInteger,
  validatePriceBounds,
} from './parsers.js';
import { argumentValue, gotoAmazon, SITE } from './shared.js';

cli({
  site: SITE,
  name: 'search',
  tags: ['search'],
  access: 'read',
  description: 'Search Amazon.in products with inclusive INR price bounds and images',
  domain: 'amazon.in',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'query', required: true, positional: true, help: 'Product search query' },
    { name: 'min-price', type: 'number', help: 'Inclusive minimum price in rupees' },
    { name: 'max-price', type: 'number', help: 'Inclusive maximum price in rupees' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum results (1-50)' },
  ],
  columns: [
    'rank', 'asin', 'title', 'price', 'mrp', 'rating',
    'review_count', 'image_url', 'product_url', 'is_sponsored',
  ],
  func: async (page, args) => {
    const query = cleanText(args.query);
    if (!query) throw new ArgumentError('query must not be empty');
    const bounds = argumentValue(() => validatePriceBounds(args['min-price'], args['max-price']));
    const limit = argumentValue(() => validatePositiveInteger(args.limit ?? 20, 'limit', 50));
    await gotoAmazon(page, buildSearchUrl(query, bounds), 'product search');

    const payload = await page.evaluate(`
      (() => {
        const text = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
        const cards = [...document.querySelectorAll('[data-component-type="s-search-result"]')]
          .map((card) => ({
            cardAsin: (card.getAttribute('data-asin') || '').trim().toUpperCase(),
            cardTitle: text(card.querySelector('a.a-text-normal.s-line-clamp-2')),
            cardPriceText: text(card.querySelector('.a-price:not(.a-text-price) .a-offscreen, .a-price .a-offscreen')),
            cardMrpText: text(card.querySelector('.a-price.a-text-price .a-offscreen')),
            cardRatingText: text(card.querySelector('[aria-label*="out of 5 stars"], .a-icon-alt')),
            cardReviewText: text(card.querySelector('a[href*="#customerReviews"], [aria-label*="ratings"]')),
            cardImageUrl: card.querySelector('img.s-image')?.currentSrc || card.querySelector('img.s-image')?.src || '',
            cardSponsored: /sponsored/i.test(text(card.querySelector('.puis-sponsored-label-text, [data-component-type="sp-sponsored-result"]'))),
          }));
        return {
          cards,
          noResults: /no results for|did not match any products/i.test(document.body?.innerText || ''),
        };
      })()
    `);
    if (!payload || !Array.isArray(payload.cards)) {
      throw new CommandExecutionError('Amazon.in search returned an unsupported page shape');
    }
    const rows = normalizeSearchCards(payload.cards, { ...bounds, limit });
    if (rows.length === 0) {
      if (payload.noResults || payload.cards.length > 0) throw new EmptyResultError('amazon-in search');
      throw new CommandExecutionError(
        'Amazon.in search exposed no result cards',
        'The page layout may have changed or a robot challenge may be visible.',
      );
    }
    return rows;
  },
});
