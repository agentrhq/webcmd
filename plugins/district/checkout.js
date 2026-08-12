import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@agentrhq/webcmd/errors';
import {
  BookingClosedError,
  openSeatMap,
  profileProbe,
  refreshShowSession,
  resolveSeatTarget,
  validateTimeout,
  waitFor,
} from './_lib.js';

const DEFAULT_TIMEOUT_SECONDS = 45;
const PAYMENT_MODES = new Set(['upi-qr', 'review']);

function parsePaymentMode(raw) {
  const mode = String(raw || 'upi-qr').trim().toLowerCase();
  if (!PAYMENT_MODES.has(mode)) throw new ArgumentError('payment must be one of: upi-qr, review');
  return mode;
}

function parseSeatList(raw) {
  const seats = String(raw || '')
    .split(',')
    .map((seat) => seat.trim().toUpperCase())
    .filter(Boolean);
  if (!seats.length) throw new ArgumentError('seats is required, for example --seats I22,I21');
  if (seats.length > 10) throw new ArgumentError('seats must contain 10 seats or fewer');
  for (const seat of seats) {
    if (!/^[A-Z]+[0-9]+$/.test(seat)) throw new ArgumentError(`invalid seat "${seat}"; use row+number like I22`);
  }
  if (new Set(seats).size !== seats.length) throw new ArgumentError('seats must not contain duplicates');
  return seats;
}

async function dismissSeatDrawer(page) {
  await page.evaluate(`
    (() => {
      const controls = [...document.querySelectorAll('button,[role="button"],[data-testid="close-icon"]')];
      const continueButton = controls.find((el) => /continue booking/i.test(el.innerText || el.getAttribute('aria-label') || ''));
      if (continueButton) {
        continueButton.click();
        return true;
      }
      return false;
    })()
  `);
  await page.wait(0.5);
}

async function selectRequestedSeats(page, requestedSeats, timeout) {
  const selected = [];
  for (const seat of requestedSeats) {
    const result = await page.evaluate(`
      (() => {
        const wanted = ${JSON.stringify(seat)};
        const parse = (el) => {
          const aria = el.getAttribute('aria-label') || '';
          const row = ((aria.match(/row\\s+([^,\\s]+)/i) || [])[1] || '').trim().toUpperCase();
          const number = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, '').trim();
          const seatState = /selected/i.test(aria)
            ? 'selected'
            : (/available/i.test(aria) ? 'available' : 'unavailable');
          return { label: row && number ? row + number : '', seatState };
        };
        const candidates = [...document.querySelectorAll('#available-seat,[id="selected-seat"] span,[aria-label*="seat"]')];
        const target = candidates.map((el) => ({ el, parsed: parse(el) })).find((item) => item.parsed.label === wanted);
        if (!target) {
          const text = document.body?.innerText || '';
          const hiddenCount = Number((text.match(/Selected\\s+(\\d+)\\s+Seats?/i) || [])[1] || 0);
          const proceedVisible = [...document.querySelectorAll('button,[role="button"],a')]
            .some((el) => /^Proceed$/i.test(((el.innerText || el.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim()));
          if (hiddenCount > 0 && proceedVisible) return { ok: true, action: 'hidden_selection' };
          return { ok: false, code: 'not_found', message: wanted + ' was not found in the rendered seat map' };
        }
        if (target.parsed.seatState === 'selected') return { ok: true, action: 'already_selected' };
        if (target.parsed.seatState !== 'available') return { ok: false, code: 'unavailable', message: wanted + ' is not available' };
        target.el.click();
        return { ok: true, action: 'clicked' };
      })()
    `);
    if (!result?.ok) {
      if (result?.code === 'not_found') throw new EmptyResultError('district checkout', result.message);
      throw new CommandExecutionError(result?.message || `Could not select ${seat}`);
    }

    await waitFor(page, 'district checkout seat selection', timeout, `
      (() => {
        const wanted = ${JSON.stringify(seat)};
        const selectedSeats = [...document.querySelectorAll('#selected-seat span,[aria-label^="selected class"]')].map((el) => {
          const aria = el.getAttribute('aria-label') || '';
          const row = ((aria.match(/row\\s+([^,\\s]+)/i) || [])[1] || '').trim().toUpperCase();
          const number = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, '').trim();
          return row && number ? row + number : '';
        }).filter(Boolean);
        const bodyText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '';
        const hiddenCount = Number((bodyText.match(/Selected\\s+(\\d+)\\s+Seats?/i) || [])[1] || 0);
        const proceedVisible = [...document.querySelectorAll('button,[role="button"],a')]
          .some((el) => /^Proceed$/i.test(((el.innerText || el.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim()));
        return {
          ok: selectedSeats.includes(wanted) || (hiddenCount > 0 && proceedVisible),
          message: bodyText.slice(0, 240)
        };
      })()
    `);
    selected.push(seat);
  }
  return selected;
}

async function readSelectedSeats(page) {
  const seats = await page.evaluate(`
    (() => {
      const parseSeat = (el) => {
        const aria = el.getAttribute('aria-label') || '';
        const row = ((aria.match(/row\\s+([^,\\s]+)/i) || [])[1] || '').trim().toUpperCase();
        const number = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, '').trim();
        return row && number ? row + number : '';
      };
      const explicit = [...document.querySelectorAll('#selected-seat span,[aria-label^="selected class"]')]
        .map(parseSeat)
        .filter(Boolean);
      if (explicit.length) return explicit;

      // District can keep a previously selected seat held in the current order
      // while rendering it as unavailable in the map and only exposing
      // "Selected 1 Seat" plus the Proceed affordance. In that case the exact
      // seat is verified later on the order-review page; returning [] here
      // would make checkout toggle unrelated food/add controls or time out.
      const text = document.body?.innerText || '';
      const selectedCount = Number((text.match(/Selected\\s+(\\d+)\\s+Seats?/i) || [])[1] || 0);
      return selectedCount ? { selectedCount, labelsHidden: true } : [];
    })()
  `);
  if (Array.isArray(seats)) return seats;
  if (seats && seats.labelsHidden) return seats;
  return [];
}

async function toggleSeat(page, seat) {
  const result = await page.evaluate(`
    (() => {
      const wanted = ${JSON.stringify(seat)};
      const candidates = [...document.querySelectorAll('#available-seat,[id="selected-seat"] span,[aria-label*="seat"]')];
      const parse = (el) => {
        const aria = el.getAttribute('aria-label') || '';
        const row = ((aria.match(/row\\s+([^,\\s]+)/i) || [])[1] || '').trim().toUpperCase();
        const number = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, '').trim();
        return row && number ? row + number : '';
      };
      const target = candidates.find((el) => parse(el) === wanted);
      if (!target) return { ok: false, message: wanted + ' was not found in the seat map' };
      target.click();
      return { ok: true };
    })()
  `);
  if (!result?.ok) throw new CommandExecutionError(result?.message || `Could not toggle ${seat}`);
}

/**
 * District remembers the last ticket quantity per profile and auto-selects
 * that many adjacent seats on the first click, so the selection can contain
 * seats nobody asked for. Deselect extras, reselect anything knocked out,
 * and refuse to proceed until the selection matches the request exactly.
 */
async function reconcileSelection(page, requestedSeats, timeout) {
  const wanted = new Set(requestedSeats);
  const deadline = Date.now() + timeout * 1000;
  let selected = await readSelectedSeats(page);
  while (Date.now() < deadline) {
    if (selected?.labelsHidden) {
      if (selected.selectedCount === requestedSeats.length) return;
      throw new CommandExecutionError(
        `District reports ${selected.selectedCount} selected seat(s) but ${requestedSeats.length} were requested; open the browser tab and correct the order before paying`,
      );
    }
    const extras = selected.filter((seat) => !wanted.has(seat));
    const missing = requestedSeats.filter((seat) => !selected.includes(seat));
    if (!extras.length && !missing.length) return;
    for (const seat of [...extras, ...missing]) await toggleSeat(page, seat);
    await page.wait(0.5);
    selected = await readSelectedSeats(page);
  }
  const selectedLabel = selected?.labelsHidden
    ? `${selected.selectedCount} hidden selected seat(s)`
    : (selected.join(', ') || 'no seats');
  throw new CommandExecutionError(
    `District kept the selection at ${selectedLabel} while ${requestedSeats.join(', ')} was requested; a pending booking or sticky ticket count may be interfering — open the browser tab to inspect`,
  );
}

async function clickProceed(page, timeout) {
  const result = await page.evaluate(`
    (() => {
      const controls = [...document.querySelectorAll('button,[role="button"],a')];
      const proceed = controls.find((el) => {
        const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        const label = el.getAttribute('aria-label') || '';
        return /^Proceed$/i.test(text) || /^Proceed$/i.test(label);
      });
      if (!proceed) return { ok: false, message: 'Proceed button was not visible after selecting seats' };
      proceed.click();
      return { ok: true };
    })()
  `);
  if (!result?.ok) throw new CommandExecutionError(result?.message || 'Could not click Proceed');

  // District often interposes a food-and-drinks upsell drawer between seat
  // selection and the review page; skip it while waiting.
  await waitFor(page, 'district checkout review page', timeout, `
    (() => {
      const href = location.href;
      const text = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '';
      if (!/\\/movies\\/order-review\\//.test(href) && /order food and drinks/i.test(text)) {
        const skip = [...document.querySelectorAll('button,[role="button"]')]
          .find((el) => /^skip$/i.test((el.innerText || '').trim()));
        if (skip) skip.click();
      }
      return {
        ok: /\\/movies\\/order-review\\//.test(href) && /Pay now|Payment summary|Review your booking/i.test(text),
        message: text.slice(0, 240)
      };
    })()
  `);
}

// The order-review page paints the amounts after the header, so a single-shot
// read can catch loading skeletons; poll until the payable total is visible.
async function extractReview(page, target, seats, timeout) {
  const result = await waitFor(page, 'district checkout payment summary', timeout, `
    (() => {
      const showId = ${JSON.stringify(target.showId)};
      const seats = ${JSON.stringify(seats.join(','))};
      const lines = (document.body?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
      const amountAfter = (label) => {
        const index = lines.findIndex((line) => line.toLowerCase().includes(label.toLowerCase()));
        if (index < 0) return '';
        const amount = lines.slice(index + 1, index + 5).find((line) => /^₹\\s*[0-9,.]+/.test(line));
        return amount || '';
      };
      const movie = [...document.querySelectorAll('h1')]
        .map((el) => el.innerText.trim())
        .find((text) => text && !/review your booking/i.test(text)) || '';
      const ticketCount = lines.find((line) => /^\\d+ tickets?$/i.test(line)) || String(${JSON.stringify(seats.length)});
      const seatLine = lines.find((line) => / - [A-Z]+\\d+(?:\\s*,\\s*[A-Z]+\\d+)*/.test(line)) || '';
      const cinema = lines.find((line) => /,/.test(line) && !/^₹/.test(line) && !/District|Booking|GST|approx/i.test(line)) || '';
      const date = lines.find((line) => /today|tomorrow|\\b\\d{1,2}\\s+[A-Z][a-z]{2}\\b/i.test(line)) || '';
      const time = lines.find((line) => /\\b\\d{1,2}:\\d{2}\\s*[AP]M\\b.*\\b\\d{1,2}:\\d{2}\\s*[AP]M\\b/i.test(line)) || '';
      const review = {
        status: 'ready_for_payment',
        movie,
        cinema,
        date,
        time,
        seats: seatLine ? seatLine.replace(/^.*? - /, '').trim() : seats,
        ticketCount,
        orderAmount: amountAfter('Order amount'),
        bookingCharge: amountAfter('Booking charge'),
        total: amountAfter('To be paid') || amountAfter('TOTAL'),
        paymentMethod: '',
        paymentState: 'order_review_visible',
        upiQrVisible: 'false',
        paymentAmount: '',
        paymentUrl: location.href,
        showId,
      };
      return {
        ok: Boolean(review.total && review.paymentUrl),
        message: lines.slice(0, 12).join(' | ').slice(0, 240),
        review,
      };
    })()
  `);
  return result.review;
}

async function openUpiQrScanner(page, review, timeout) {
  const clickTarget = await page.evaluate(`
    (() => {
      const exactText = (el) => ((el.innerText || el.textContent || el.getAttribute?.('aria-label') || '')
        .replace(/\\s+/g, ' ')
        .trim());
      const chooseTarget = () => {
        const paymentCheckout = document.querySelector('payment-checkout');
        if (paymentCheckout) return { el: paymentCheckout, action: 'payment_checkout' };
        const controls = [...document.querySelectorAll('button,[role="button"],a,span,div')];
        const payNow = controls.find((el) => /^Pay now$/i.test(exactText(el)));
        return payNow ? { el: payNow, action: 'pay_now' } : null;
      };
      const target = chooseTarget();
      if (!target) return { ok: false, message: 'Pay now button was not visible on District order review' };
      target.el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = target.el.getBoundingClientRect();
      return {
        ok: true,
        action: target.action,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()
  `);
  if (!clickTarget?.ok) throw new CommandExecutionError(clickTarget?.message || 'Could not find District payment handoff');
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(clickTarget.x, clickTarget.y);
  } else {
    await page.evaluate(`
      (() => {
        const el = document.querySelector('payment-checkout');
        if (el) el.click();
      })()
    `);
  }

  const qrTarget = await waitFor(page, 'district UPI QR payment option', timeout, `
    (() => {
      const exactText = (el) => ((el.innerText || el.textContent || el.getAttribute?.('aria-label') || '')
        .replace(/\\s+/g, ' ')
        .trim());
      const find = (root) => {
        const target = [...root.querySelectorAll('label,button,[role="button"]')]
          .find((el) => /^Scan QR to pay$/i.test(exactText(el)));
        if (target) return target;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const nested = find(el.shadowRoot);
            if (nested) return nested;
          }
        }
        return null;
      };
      const target = find(document);
      const message = document.body
        ? (document.body.innerText || document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240)
        : '';
      if (!target) return { ok: false, message };
      target.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = target.getBoundingClientRect();
      return {
        ok: true,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()
  `);
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(qrTarget.x, qrTarget.y);
  } else {
    await page.evaluate(`
      (() => {
        const exactText = (el) => ((el.innerText || el.textContent || el.getAttribute?.('aria-label') || '')
          .replace(/\\s+/g, ' ')
          .trim());
        const find = (root) => {
          const target = [...root.querySelectorAll('label,button,[role="button"]')]
            .find((el) => /^Scan QR to pay$/i.test(exactText(el)));
          if (target) return target;
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) {
              const nested = find(el.shadowRoot);
              if (nested) return nested;
            }
          }
          return null;
        };
        find(document)?.click();
      })()
    `);
  }

  const result = await waitFor(page, 'district UPI QR scanner', timeout, `
    (() => {
      const collect = (root, rows = []) => {
        for (const el of root.querySelectorAll('*')) {
          const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
          const aria = el.getAttribute?.('aria-label') || '';
          const alt = el.getAttribute?.('alt') || '';
          const haystack = [text, aria, alt].join(' ');
          if (/UPI|QR|Scan|To pay|Pay now/i.test(haystack)) {
            rows.push({ tag: el.tagName, text, aria, alt, src: (el.getAttribute?.('src') || '').slice(0, 120) });
          }
          if (el.shadowRoot) collect(el.shadowRoot, rows);
        }
        return rows;
      };
      const rows = collect(document);
      const joined = rows.map((row) => [row.text, row.aria, row.alt].filter(Boolean).join(' ')).join(' | ');
      const qrImage = rows.find((row) => /UPI QR Code/i.test(row.alt) || (/QR/i.test(row.alt) && /upi/i.test(joined)));
      const amount = (joined.match(/To pay:\\s*(₹\\s*[0-9,.]+)/i) || joined.match(/(₹\\s*[0-9,.]+)\\s+TOTAL/i) || [])[1] || '';
      return {
        ok: /UPI QR/i.test(joined) && /Scan the QR using any UPI App/i.test(joined) && Boolean(qrImage),
        message: joined.slice(0, 240),
        payment: {
          status: 'upi_qr_ready',
          paymentMethod: 'UPI QR',
          paymentState: 'qr_scanner_visible',
          upiQrVisible: Boolean(qrImage),
          paymentAmount: amount,
          paymentUrl: location.href,
        },
      };
    })()
  `);

  return {
    ...review,
    status: result.payment.status,
    paymentMethod: result.payment.paymentMethod,
    paymentState: result.payment.paymentState,
    upiQrVisible: String(result.payment.upiQrVisible),
    paymentAmount: result.payment.paymentAmount || review.total,
    paymentUrl: result.payment.paymentUrl || review.paymentUrl,
  };
}

/**
 * Open the seat map, self-healing once when the show session looks stale:
 * openSeatMap already fixes stale modals and city-mismatch; on a remaining
 * closed-booking verdict or a seat map that never renders, one fresh
 * showtimes lookup re-resolves the same cinema session before giving up.
 * Only this phase retries — after seats are selected the flow never
 * restarts, so a held selection is never doubled.
 */
async function openSeatMapWithRefresh(page, target, timeout) {
  try {
    return await openSeatMap(page, target, timeout);
  } catch (error) {
    if (!(error instanceof BookingClosedError) && !(error instanceof TimeoutError)) throw error;
    const fresh = await refreshShowSession(page, target);
    if (!fresh) {
      throw new CommandExecutionError(
        'District no longer offers this show session; re-run webcmd district showtimes and pick a current show',
      );
    }
    return await openSeatMap(page, fresh, timeout);
  }
}

cli({
  site: 'district',
  name: 'checkout',
  access: 'write',
  description: 'Select District movie seats and open the UPI QR payment scanner',
  domain: 'www.district.in',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  // Checkout is the most state-sensitive district command: always start on a
  // clean page so modals/drawers left by earlier commands cannot poison it.
  freshPage: true,
  args: [
    {
      name: 'show',
      positional: true,
      required: true,
      help: 'District seat-layout URL or showId from district showtimes',
    },
    {
      name: 'seats',
      required: true,
      help: 'Comma-separated seat labels to select, e.g. I22,I21',
    },
    {
      name: 'format-id',
      help: 'District formatId from showtimes; required when show is a showId',
    },
    {
      name: 'content-id',
      help: 'District content id; required when show is a showId',
    },
    {
      name: 'timeout',
      type: 'int',
      default: DEFAULT_TIMEOUT_SECONDS,
      help: 'Maximum seconds to wait for selection, review page, and payment handoff',
    },
    {
      name: 'payment',
      default: 'upi-qr',
      help: 'Payment handoff target: upi-qr opens the scanner; review stops on order review',
    },
  ],
  columns: [
    'status',
    'movie',
    'cinema',
    'date',
    'time',
    'seats',
    'ticketCount',
    'orderAmount',
    'bookingCharge',
    'total',
    'paymentMethod',
    'paymentState',
    'upiQrVisible',
    'paymentAmount',
    'paymentUrl',
    'showId',
  ],
  func: async (page, args) => {
    const seats = parseSeatList(args.seats);
    const timeout = validateTimeout(args.timeout, { def: DEFAULT_TIMEOUT_SECONDS, min: 10, max: 180 });
    const paymentMode = parsePaymentMode(args.payment);

    const target = await openSeatMapWithRefresh(page, resolveSeatTarget(args), timeout);

    // Gate on login before touching seats: District bounces Proceed into the
    // OTP flow, which would waste the whole selection.
    try {
      await profileProbe(page);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        throw new AuthRequiredError('www.district.in', 'District login required before checkout. Run: webcmd district login');
      }
      throw error;
    }

    await dismissSeatDrawer(page);
    const selected = await selectRequestedSeats(page, seats, timeout);
    await reconcileSelection(page, seats, timeout);
    await clickProceed(page, timeout);
    const review = await extractReview(page, target, selected, timeout);

    // Final contract check: the review page is the last stop before money
    // moves, so a resumed pending order or re-expanded selection must fail
    // loudly here rather than hand the user the wrong tickets to pay for.
    const reviewSeats = String(review.seats || '').split(/\s*,\s*/).filter(Boolean).sort().join(',');
    const requested = [...seats].sort().join(',');
    if (reviewSeats && reviewSeats !== requested) {
      throw new CommandExecutionError(
        `District review shows seats ${review.seats} but ${seats.join(', ')} was requested; open the browser tab and correct the order before paying`,
      );
    }
    if (paymentMode === 'review') return review;
    return await openUpiQrScanner(page, review, timeout);
  },
});

export const __test__ = { openUpiQrScanner };
