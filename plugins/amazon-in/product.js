import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildProductUrl, normalizeProductSnapshot } from './parsers.js';
import { gotoAmazon, SITE } from './shared.js';

cli({
  site: SITE,
  name: 'product',
  access: 'read',
  description: 'Fetch the current Amazon.in price and selected product variant',
  domain: 'amazon.in',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: 'Amazon.in product URL or ASIN',
    },
  ],
  columns: [
    'asin', 'title', 'price', 'mrp', 'discount', 'availability',
    'size', 'colour', 'available_sizes', 'available_colours', 'image_url', 'product_url',
  ],
  func: async (page, args) => {
    let url;
    try {
      url = buildProductUrl(args.input);
    } catch (error) {
      throw new ArgumentError(error.message);
    }
    await gotoAmazon(page, url, 'product page');
    try {
      await page.wait({ selector: '#productTitle', timeout: 15 });
    } catch {
      throw new CommandExecutionError(
        'Amazon.in product title did not appear',
        'The product may be unavailable or the page layout may have changed.',
      );
    }
    const snapshot = await page.evaluate(`
      (() => {
        const text = (selector) => (document.querySelector(selector)?.textContent || '')
          .replace(/\\s+/g, ' ').trim();
        const image = document.querySelector('#landingImage');
        const labels = (selector, colour) => [...document.querySelectorAll(selector)]
          .filter((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !node.classList.contains('aok-hidden');
          })
          .map((node) => (colour ? (node.querySelector('img')?.alt || '') : node.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index);
        const snapshot = {
          href: location.href,
          title: text('#productTitle'),
          priceText: text('#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen, #priceblock_ourprice, #priceblock_dealprice'),
          mrpText: text('#corePrice_feature_div .a-price.a-text-price .a-offscreen, .basisPrice .a-offscreen'),
          discountText: text('#corePrice_feature_div .savingsPercentage, .savingsPercentage'),
          availabilityText: text('#availability'),
          sizeText: text('#inline-twister-expanded-dimension-text-size_name, #variation_size_name .selection, #variation_size_name li.swatchSelect .a-button-text'),
          colourText: text('#inline-twister-expanded-dimension-text-color_name, #variation_color_name .selection, #variation_color_name li.swatchSelect .a-button-text'),
          availableSizes: labels('#inline-twister-expander-content-size_name span[id^="size_name_"]:not([id$="-announce"])', false),
          availableColours: labels('#inline-twister-expander-content-color_name span[id^="color_name_"]:not([id$="-announce"])', true),
          imageUrl: image?.getAttribute('data-old-hires') || image?.currentSrc || image?.src || '',
        };
        return snapshot;
      })()
    `);
    try {
      return [normalizeProductSnapshot(snapshot)];
    } catch (error) {
      throw new CommandExecutionError(
        `Amazon.in product details could not be normalized: ${error.message}`,
        'Check the visible product page for an unavailable item or changed layout.',
      );
    }
  },
});
