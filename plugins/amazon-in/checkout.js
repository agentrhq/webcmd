import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  buildProductUrl,
  normalizeCheckoutReview,
  totalsAreConsistent,
  validateCheckoutArgs,
} from './parsers.js';
import { assertUsablePage, gotoAmazon, SITE } from './shared.js';

const VERIFY_COMMAND = 'webcmd amazon-in checkout-status';

function handoffRow({ status = 'action_required', asin, title, size, colour, quantity, payment, action }) {
  return {
    status,
    asin,
    title,
    size,
    colour,
    quantity,
    item_price: null,
    total: null,
    payment_method: payment,
    delivery_date: '',
    action,
    verify_command: VERIFY_COMMAND,
  };
}

async function selectVariant(page, dimension, requested) {
  if (!requested) return '';
  const result = await page.evaluateWithArgs(`
    (() => {
      const current = (document.querySelector(
        '#inline-twister-expanded-dimension-text-' + dimension + '_name, ' +
        '#variation_' + dimension + '_name .selection'
      )?.textContent || '').trim();
      if (current.toLowerCase() === requested.toLowerCase()) return { current, changed: false };
      const options = [...document.querySelectorAll(
        '#inline-twister-expander-content-' + dimension + '_name span[id^="' + dimension + '_name_"]:not([id$="-announce"])'
      )].filter((node) => !node.classList.contains('aok-hidden'));
      const matches = options.filter((node) => {
        const label = dimension === 'color'
          ? (node.querySelector('img')?.alt || '')
          : (node.textContent || '').trim();
        return label.toLowerCase() === requested.toLowerCase();
      });
      if (matches.length !== 1) return { current, changed: false, matches: matches.length };
      (matches[0].querySelector('input') || matches[0]).click();
      return { current, changed: true, matches: 1 };
    })()
  `, { dimension, requested });
  if (!result?.changed && result?.current?.toLowerCase() !== requested.toLowerCase()) {
    throw new ArgumentError(
      `${dimension === 'color' ? 'colour' : dimension} "${requested}" is not uniquely available`,
    );
  }
  if (result.changed) await page.sleep(2);
  const selected = await page.evaluateWithArgs(`
    (() => (document.querySelector(
      '#inline-twister-expanded-dimension-text-' + dimension + '_name, ' +
      '#variation_' + dimension + '_name .selection'
    )?.textContent || '').trim())()
  `, { dimension });
  if (selected.toLowerCase() !== requested.toLowerCase()) {
    throw new CommandExecutionError(`Amazon did not select ${dimension} "${requested}"`);
  }
  return selected;
}

async function readProductSelection(page) {
  return page.evaluate(`
    (() => ({
      asin: (location.pathname.match(/\\/dp\\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('#ASIN')?.value || '').toUpperCase(),
      title: (document.querySelector('#productTitle')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      size: (document.querySelector('#inline-twister-expanded-dimension-text-size_name, #variation_size_name .selection')?.textContent || '').trim(),
      colour: (document.querySelector('#inline-twister-expanded-dimension-text-color_name, #variation_color_name .selection')?.textContent || '').trim(),
    }))()
  `);
}

async function selectPayment(page, options) {
  return page.evaluateWithArgs(`
    (() => {
      const radios = [...document.querySelectorAll('input[type="radio"]')];
      radios.forEach((radio) => radio.removeAttribute('data-webcmd-payment-target'));
      let matches = [];
      if (payment === 'upi') {
        matches = radios.filter((radio) => /paymentMethod=UnifiedPaymentsInterface/i.test(radio.value));
      } else if (payment === 'cod') {
        matches = radios.filter((radio) => /paymentMethod=COD/i.test(radio.value));
      } else if (payment === 'new-card') {
        matches = radios.filter((radio) => radio.value === 'SelectableAddCreditCard');
      } else {
        matches = radios.filter((radio) => {
          const label = radio.closest('label')?.innerText || radio.parentElement?.innerText || '';
          return new RegExp('ending in\\\\s+' + cardLast4 + '\\\\b', 'i').test(label);
        });
      }
      if (matches.length !== 1) return { matches: matches.length };
      matches[0].setAttribute('data-webcmd-payment-target', 'true');
      return { matches: 1 };
    })()
  `, options);
}

async function waitForPaymentUi(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await page.evaluate(`
      (() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden';
        };
        const loaders = [...document.querySelectorAll('[aria-label^="acp-loading"]')];
        return document.querySelectorAll('#checkout-paymentOptionPanel input[type="radio"]').length > 0 &&
          Boolean(document.querySelector('[data-testid="bottom-continue-button"]')) &&
          !loaders.some(visible);
      })()
    `);
    if (ready) return;
    await page.sleep(0.5);
  }
  throw new CommandExecutionError('Amazon payment interface did not finish initializing');
}

async function continueAfterPaymentSelection(page, options, selected, quantity) {
  if (options.payment === 'new-card') {
    return handoffRow({
      ...selected,
      quantity,
      payment: options.payment,
      action: 'Enter the new card details in the opened browser, then run checkout-status.',
    });
  }
  if (options.payment === 'saved-card') {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readiness = await page.evaluate(`
        (() => {
          const button = document.querySelector('[data-testid="bottom-continue-button"]');
          return {
            needsSecret: Boolean(document.querySelector(
              'input[name*="verification"], input[autocomplete="cc-csc"], input[placeholder*="CVV" i]'
            )),
            continueEnabled: Boolean(button && !button.disabled),
          };
        })()
      `);
      if (readiness?.needsSecret) {
        return handoffRow({
          ...selected,
          quantity,
          payment: options.payment,
          action: 'Enter the saved card CVV in the opened browser, then run checkout-status.',
        });
      }
      if (readiness?.continueEnabled) {
        await page.click('[data-testid="bottom-continue-button"]');
        return null;
      }
      await page.sleep(0.25);
    }
    throw new CommandExecutionError('Amazon did not expose the saved-card CVV or enable Continue');
  }
  try {
    await page.wait({
      selector: '[data-testid="bottom-continue-button"]:not([disabled])',
      timeout: 10,
    });
  } catch {
    throw new CommandExecutionError('Amazon did not enable the selected payment method');
  }
  await page.click('[data-testid="bottom-continue-button"]');
  return null;
}

async function waitForUrlChange(page, previousUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if (await page.evaluate('location.href') !== previousUrl) return;
    } catch {
      return;
    }
    await page.sleep(0.25);
  }
}

async function advanceToReview(page) {
  for (let step = 0; step < 4; step += 1) {
    try {
      await page.wait({
        selector: '#placeOrder, #noThanksCtaButtonId a, a[href*="/spc"]',
        timeout: 20,
      });
    } catch {
      throw new CommandExecutionError('Amazon checkout did not expose a review transition');
    }
    const state = await page.evaluate(`
      (() => {
        if (document.querySelector('#placeOrder')) return { kind: 'review' };
        const reviewLinks = [...document.querySelectorAll('a[href*="/spc"]')]
          .filter((link) => (link.textContent || '').trim() === 'Review Order');
        if (reviewLinks.length === 1) return { kind: 'review-link', href: reviewLinks[0].href };
        const decline = document.querySelector('#noThanksCtaButtonId a');
        if (decline && (decline.textContent || '').trim() === 'No Thanks') {
          return { kind: 'decline', url: location.href };
        }
        return { kind: 'unknown' };
      })()
    `);
    if (state.kind === 'review') return;
    if (state.kind === 'review-link') {
      await page.goto(state.href, { waitUntil: 'load' });
      continue;
    }
    if (state.kind === 'decline') {
      await page.click('#noThanksCtaButtonId a');
      await waitForUrlChange(page, state.url);
      continue;
    }
    throw new CommandExecutionError('Amazon checkout exposed an unsupported Prime offer state');
  }
  throw new CommandExecutionError('Amazon checkout did not reach final review');
}

async function waitForReviewUi(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await page.evaluate(`
      (() => {
        const total = [...document.querySelectorAll('#subtotals-marketplace-table li')]
          .find((node) => /^Order Total:/i.test((node.textContent || '').trim()));
        return Boolean(
          document.querySelector('[data-csa-c-item-type="asin"][data-csa-c-item-id*="amzn1.asin."]') &&
          document.querySelector('[data-a-component="stepper"]') &&
          /₹|Rs\\.?/i.test(total?.textContent || '')
        );
      })()
    `);
    if (ready) return;
    await page.sleep(0.5);
  }
  throw new CommandExecutionError('Amazon checkout review details did not finish loading');
}

async function readReview(page, selected, options) {
  const snapshot = await page.evaluate(`
    (() => {
      const text = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const rows = [...document.querySelectorAll('#subtotals-marketplace-table li')];
      const row = (pattern) => text(rows.find((node) => pattern.test(text(node))));
      const amount = (type) => text(
        [...document.querySelectorAll('input[name="subtotalLineType"]')]
          .find((input) => input.value === type)?.parentElement
      );
      const asinMarkers = [...document.querySelectorAll(
        '[data-csa-c-item-type="asin"][data-csa-c-item-id*="amzn1.asin."]'
      )];
      const asinMarker = asinMarkers[0];
      const asin = asinMarker?.getAttribute('data-csa-c-item-id')?.match(/amzn1\\.asin\\.([A-Z0-9]{10})/)?.[1] || '';
      const item = asinMarker?.closest('.product-description-column') || document.querySelector('.product-description-column');
      const snapshot = {
        itemCount: asinMarkers.length,
        asin,
        title: text(item?.querySelector('.lineitem-title-text')),
        itemPriceText: text(item?.querySelector('.a-price .a-offscreen')),
        deliveryFeeText: amount('SHIPPING_TAX_INCLUSIVE'),
        deliveryDiscountText: row(/^Free Delivery/i),
        marketplaceFeeText: amount('MARKETPLACE_FEE_TAX_INCLUSIVE'),
        totalText: row(/^Order Total:/i),
        quantity: Number(document.querySelector('[data-a-component="stepper"]')?.getAttribute('data-steppervalue') || 0),
        deliveryDate: text(document.querySelector('.address-promise-text')),
        bodyText: document.body?.innerText || '',
      };
      return snapshot;
    })()
  `);
  assertSingleLineItem(snapshot, selected, options);
  const totals = readCheckoutTotals(snapshot);
  return {
    status: 'review_ready',
    asin: selected.asin,
    title: snapshot.title || selected.title,
    size: selected.size,
    colour: selected.colour,
    quantity: options.quantity,
    item_price: totals.itemPrice,
    total: totals.total,
    payment_method: options.payment,
    delivery_date: snapshot.deliveryDate,
    action: '',
    verify_command: VERIFY_COMMAND,
  };
}

function assertSingleLineItem(snapshot, selected, options) {
  if (snapshot.itemCount !== 1) {
    throw new CommandExecutionError(
      `Expected exactly one checkout line item; found ${snapshot.itemCount}`,
    );
  }
  if (snapshot.asin !== selected.asin || snapshot.quantity !== options.quantity) {
    throw new CommandExecutionError(
      `Amazon checkout item or quantity mismatch: expected ${selected.asin} × ${options.quantity}, got ${snapshot.asin || '(missing ASIN)'} × ${snapshot.quantity}`,
    );
  }
  if (options.size && !snapshot.title.toLowerCase().includes(options.size.toLowerCase())) {
    throw new CommandExecutionError(`Amazon checkout review does not show size "${options.size}"`);
  }
  if (options.colour && !snapshot.title.toLowerCase().includes(options.colour.toLowerCase())) {
    throw new CommandExecutionError(`Amazon checkout review does not show colour "${options.colour}"`);
  }
  const paymentPatterns = {
    upi: /Pay by scanning the QR code|Pay with UPI/i,
    cod: /Cash on Delivery|Pay on Delivery/i,
    'saved-card': new RegExp(`ending in\\s+${options.cardLast4}\\b`, 'i'),
    'new-card': /credit or debit card/i,
  };
  if (!paymentPatterns[options.payment].test(snapshot.bodyText)) {
    throw new CommandExecutionError('Amazon checkout payment method does not match the requested method');
  }
}

function readCheckoutTotals(snapshot) {
  let totals;
  try {
    totals = normalizeCheckoutReview(snapshot);
  } catch (error) {
    throw new CommandExecutionError(`Amazon checkout totals could not be read: ${error.message}`);
  }
  if (!totalsAreConsistent(totals)) {
    throw new CommandExecutionError('Amazon checkout total is inconsistent with item price and fees');
  }
  return totals;
}

async function submitOrder(page, enabled) {
  if (!enabled) return false;
  const placement = await page.evaluate(`
    (() => {
      window.scrollTo(0, 0);
      const candidates = [...document.querySelectorAll('#placeOrder')]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return !button.disabled && rect.width > 0 && rect.height > 0 &&
            rect.top >= 0 && rect.bottom <= innerHeight &&
            style.display !== 'none' && style.visibility !== 'hidden';
        });
      if (candidates.length !== 1) return { clicked: false, matches: candidates.length };
      candidates[0].click();
      return { clicked: true, matches: 1 };
    })()
  `);
  if (!placement?.clicked) {
    throw new CommandExecutionError(
      `Expected one visible final order control; found ${placement?.matches ?? 0}`,
    );
  }
  return true;
}

cli({
  site: SITE,
  name: 'checkout',
  access: 'write',
  description: 'Prepare a guarded Amazon.in checkout with browser-only payment handoff',
  domain: 'amazon.in',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  freshPage: true,
  args: [
    { name: 'input', required: true, positional: true, help: 'Amazon.in product URL or ASIN' },
    { name: 'quantity', type: 'int', default: 1, help: 'Quantity (1-10)' },
    { name: 'size', help: 'Exact visible size label' },
    { name: 'colour', help: 'Exact visible colour label' },
    {
      name: 'payment',
      required: true,
      choices: ['upi', 'saved-card', 'new-card', 'cod'],
      help: 'Payment method; secrets remain browser-only',
    },
    { name: 'card-last4', help: 'Saved-card selector: exactly four digits' },
    { name: 'place-order', type: 'boolean', default: false, help: 'Submit the final Amazon action once' },
  ],
  columns: [
    'status', 'asin', 'title', 'size', 'colour', 'quantity', 'item_price',
    'total', 'payment_method', 'delivery_date', 'action', 'verify_command',
  ],
  func: async (page, args) => {
    let url;
    let options;
    try {
      url = buildProductUrl(args.input);
      options = validateCheckoutArgs({
        quantity: args.quantity,
        size: args.size,
        colour: args.colour,
        payment: args.payment,
        cardLast4: args['card-last4'],
        placeOrder: args['place-order'],
      });
    } catch (error) {
      throw new ArgumentError(error.message);
    }

    await gotoAmazon(page, url, 'checkout product');
    await page.wait({ selector: '#productTitle', timeout: 15 });
    await selectVariant(page, 'color', options.colour);
    await selectVariant(page, 'size', options.size);
    const selected = await readProductSelection(page);
    if (!selected.asin || !selected.title) {
      throw new CommandExecutionError('Amazon product selection could not be verified');
    }

    const quantitySet = await page.evaluateWithArgs(`
      (() => {
        const select = document.querySelector('#quantity');
        if (!select) return quantity === 1;
        if (![...select.options].some((option) => Number(option.value) === quantity)) return false;
        select.value = String(quantity);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return Number(select.value) === quantity;
      })()
    `, { quantity: options.quantity });
    if (!quantitySet) throw new ArgumentError(`quantity ${options.quantity} is not available`);

    await page.click('#buy-now-button');
    await page.sleep(3);
    await assertUsablePage(page, 'checkout payment page');
    try {
      await page.wait({ selector: '#checkout-paymentOptionPanel input[type="radio"]', timeout: 20 });
    } catch {
      throw new CommandExecutionError('Amazon payment methods did not appear');
    }
    await waitForPaymentUi(page);

    const paymentResult = await selectPayment(page, options);
    if (paymentResult?.matches !== 1) {
      throw new ArgumentError(
        options.payment === 'saved-card'
          ? `card-last4 ${options.cardLast4} did not match exactly one saved card`
          : `${options.payment} is not uniquely available for this checkout`,
      );
    }
    await page.click('input[data-webcmd-payment-target="true"]');
    const handoff = await continueAfterPaymentSelection(page, options, selected, options.quantity);
    if (handoff) return [handoff];
    await advanceToReview(page);
    await waitForReviewUi(page);
    await assertUsablePage(page, 'checkout review');
    const review = await readReview(page, selected, options);
    if (!await submitOrder(page, options.placeOrder)) return [review];
    await page.sleep(3);
    return [{
      ...review,
      status: options.payment === 'cod' ? 'submitted' : 'action_required',
      action: options.payment === 'upi'
        ? 'Scan Amazon’s QR code in the opened browser and approve the UPI payment, then run checkout-status.'
        : options.payment === 'cod'
          ? ''
          : 'Complete the bank verification in the opened browser, then run checkout-status.',
    }];
  },
});

export const __test__ = {
  assertSingleLineItem,
  continueAfterPaymentSelection,
  submitOrder,
};
