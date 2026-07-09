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
        if (!target) return { ok: false, code: 'not_found', message: wanted + ' was not found in the rendered seat map' };
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
        const bodyText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : '';
        return { ok: selectedSeats.includes(wanted), message: bodyText };
      })()
    `);
    selected.push(seat);
  }
  return selected;
}

async function readSelectedSeats(page) {
  const seats = await page.evaluate(`
    (() => {
      return [...document.querySelectorAll('#selected-seat span,[aria-label^="selected class"]')].map((el) => {
        const aria = el.getAttribute('aria-label') || '';
        const row = ((aria.match(/row\\s+([^,\\s]+)/i) || [])[1] || '').trim().toUpperCase();
        const number = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, '').trim();
        return row && number ? row + number : '';
      }).filter(Boolean);
    })()
  `);
  return Array.isArray(seats) ? seats : [];
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
    const extras = selected.filter((seat) => !wanted.has(seat));
    const missing = requestedSeats.filter((seat) => !selected.includes(seat));
    if (!extras.length && !missing.length) return;
    for (const seat of [...extras, ...missing]) await toggleSeat(page, seat);
    await page.wait(0.5);
    selected = await readSelectedSeats(page);
  }
  throw new CommandExecutionError(
    `District kept the selection at ${selected.join(', ') || 'no seats'} while ${requestedSeats.join(', ')} was requested; a pending booking or sticky ticket count may be interfering — open the browser tab to inspect`,
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
  description: 'Select District movie seats and stop at the payment handoff page',
  domain: 'www.district.in',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
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
      help: 'Maximum seconds to wait for selection and review page',
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
    'paymentUrl',
    'showId',
  ],
  func: async (page, args) => {
    const seats = parseSeatList(args.seats);
    const timeout = validateTimeout(args.timeout, { def: DEFAULT_TIMEOUT_SECONDS, min: 10, max: 180 });

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
    return review;
  },
});
