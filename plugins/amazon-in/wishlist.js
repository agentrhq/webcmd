import {
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { normalizeWishlistRows } from './parsers.js';
import { gotoAmazon, SITE, WISHLIST_URL } from './shared.js';

cli({
  site: SITE,
  name: 'wishlist',
  access: 'read',
  description: 'Fetch current prices for products in the default Amazon.in wishlist',
  domain: 'amazon.in',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    {
      name: 'filter',
      default: 'unpurchased',
      choices: ['unpurchased', 'all'],
      help: 'Wishlist items to include',
    },
  ],
  columns: [
    'list_name', 'item_id', 'asin', 'title', 'price', 'mrp',
    'availability', 'size', 'colour', 'image_url', 'product_url',
  ],
  func: async (page, args) => {
    const url = new URL(WISHLIST_URL);
    url.searchParams.set('type', 'wishlist');
    url.searchParams.set('filter', args.filter ?? 'unpurchased');
    url.searchParams.set('sort', 'date-added');
    url.searchParams.set('viewType', 'list');
    await gotoAmazon(page, url.href, 'wishlist');

    let reachedEnd = false;
    for (let step = 0; step < 100; step += 1) {
      reachedEnd = await page.evaluate(`
        (() => Boolean(document.querySelector('#endOfListMarker')))()
      `);
      if (reachedEnd) break;
      await page.scroll('down', 700);
      await page.sleep(0.25);
    }
    if (!reachedEnd) {
      throw new TimeoutError(
        'Amazon.in wishlist loading',
        25,
        'Open the wishlist in the Webcmd browser and check whether Amazon is still loading items.',
      );
    }

    const payload = await page.evaluate(`
      (() => {
        const text = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
        const cards = [...document.querySelectorAll('#g-items li.g-item-sortable')].map((card) => {
          const productLinks = [...card.querySelectorAll('a[href*="/dp/"]')];
          const productLink = productLinks.find((link) => link.title) || productLinks[0];
          const variants = [...card.querySelectorAll('#twisterText')].map((node) => text(node));
          return {
            cardItemId: card.getAttribute('data-itemid') || '',
            cardHref: productLink?.href || '',
            cardTitle: productLink?.title || text(productLink),
            cardPriceText: text(card.querySelector('.price-section .a-price .a-offscreen, .a-price .a-offscreen')),
            cardMrpText: text(card.querySelector('.wl-deal-price.a-text-strike, .a-price.a-text-price .a-offscreen')),
            cardAvailabilityText: text(card.querySelector('[id^="availability-"], .itemAvailability, .a-color-price')),
            cardSizeText: variants.find((value) => /^size\\s*:/i.test(value))?.replace(/^size\\s*:\\s*/i, '') || '',
            cardColourText: variants.find((value) => /^colou?r\\s*:/i.test(value))?.replace(/^colou?r\\s*:\\s*/i, '') || '',
            cardImageUrl: card.querySelector('img[alt]')?.currentSrc || card.querySelector('img[alt]')?.src || '',
          };
        });
        return {
          listName: text(document.querySelector('#profile-list-name')),
          cards,
          empty: /no items|this list is empty/i.test(document.body?.innerText || ''),
        };
      })()
    `);
    if (!payload?.listName) {
      throw new CommandExecutionError('Amazon.in wishlist name could not be read');
    }
    if (!payload.cards?.length) {
      if (payload.empty) throw new EmptyResultError('amazon-in wishlist');
      throw new CommandExecutionError('Amazon.in wishlist exposed no item cards');
    }
    try {
      return normalizeWishlistRows(payload.listName, payload.cards);
    } catch (error) {
      throw new CommandExecutionError(
        `Amazon.in wishlist details could not be normalized: ${error.message}`,
      );
    }
  },
});
