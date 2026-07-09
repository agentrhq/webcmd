import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
  makeSeatUrl,
  openSeatMap,
  resolveSeatTarget,
  validateTimeout,
} from './_lib.js';

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_LIMIT = 100;

function validateLimit(raw) {
  const limit = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) {
    throw new ArgumentError('limit must be an integer from 1 to 300');
  }
  return limit;
}

function validateCount(raw) {
  if (raw == null || raw === '') return 0;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new ArgumentError('count must be an integer from 1 to 10');
  }
  return count;
}

function validateMoney(raw, name) {
  if (raw == null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new ArgumentError(`${name} must be a positive number`);
  return value;
}

function normalizeClass(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateBoolean(raw, name) {
  if (raw == null || raw === '' || raw === false) return false;
  if (raw === true) return true;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  throw new ArgumentError(`${name} must be a boolean flag`);
}

async function extractSeats(page, target, url) {
  return page.evaluate(`
    (() => {
      const showId = ${JSON.stringify(target.showId)};
      const formatId = ${JSON.stringify(target.formatId)};
      const url = ${JSON.stringify(url)};
      const parseAria = (aria) => {
        const seatClass = (aria.match(/class\\s+(.+?),\\s+row/i) || [])[1] || '';
        const row = (aria.match(/row\\s+([^,]+),\\s+column/i) || [])[1] || '';
        const column = Number((aria.match(/column\\s+(\\d+)/i) || [])[1] || 0);
        const price = Number((aria.match(/price\\s+(\\d+)/i) || [])[1] || 0);
        const flags = [];
        if (/disabled friendly/i.test(aria)) flags.push('disabled_friendly');
        if (/wheel\\s*companion|wheelCompanion/i.test(aria)) flags.push('wheel_companion');
        return { seatClass: seatClass.trim(), row: row.trim(), column, price, flags };
      };

      return [...document.querySelectorAll('#available-seat')].map((el, index) => {
        const aria = el.getAttribute('aria-label') || '';
        const label = (el.querySelector('label')?.innerText || el.innerText || '').replace(/\\s+/g, ' ').trim();
        const parsed = parseAria(aria);
        return {
          rank: index + 1,
          seat: parsed.row && label ? parsed.row + label : label,
          row: parsed.row,
          number: label,
          column: parsed.column,
          seatClass: parsed.seatClass,
          price: parsed.price,
          status: 'available',
          flags: parsed.flags.join(','),
          showId,
          formatId,
          url,
        };
      }).filter((seat) => seat.seat && seat.row && seat.number && seat.seatClass);
    })()
  `);
}

function applyFilters(rows, { seatClass, maxPrice }) {
  return rows.filter((row) => {
    if (seatClass && !normalizeClass(row.seatClass).includes(seatClass)) return false;
    if (maxPrice && Number(row.price) > maxPrice) return false;
    return true;
  });
}

function groupKey(row) {
  return [row.row, row.seatClass, row.price].join('|');
}

function consecutiveWindow(rows, count) {
  const sorted = [...rows].sort((a, b) => a.column - b.column);
  for (let start = 0; start <= sorted.length - count; start += 1) {
    const window = sorted.slice(start, start + count);
    const consecutive = window.every((row, index) => index === 0 || row.column === window[index - 1].column + 1);
    if (consecutive) return window;
  }
  return [];
}

function chooseSeats(rows, { count, together }) {
  if (!count) return rows;
  if (!together) return rows.slice(0, count);

  const grouped = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  for (const group of grouped.values()) {
    const picked = consecutiveWindow(group, count);
    if (picked.length) return picked;
  }
  return [];
}

cli({
  site: 'district',
  name: 'seats',
  access: 'read',
  description: 'List available seats for a District movie showtime',
  domain: 'www.district.in',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    {
      name: 'show',
      positional: true,
      required: true,
      help: 'District seat-layout URL or showId from district showtimes',
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
      name: 'class',
      help: 'Optional seat class filter, e.g. premium, premium xl, or recliner',
    },
    {
      name: 'count',
      type: 'int',
      help: 'Number of seats to choose (1-10); without count, seats are listed normally',
    },
    {
      name: 'together',
      help: 'Require selected seats to be adjacent when count is provided',
    },
    {
      name: 'max-price',
      type: 'float',
      help: 'Maximum price per seat',
    },
    {
      name: 'limit',
      type: 'int',
      default: DEFAULT_LIMIT,
      help: 'Maximum seats to return (1-300)',
    },
    {
      name: 'timeout',
      type: 'int',
      default: DEFAULT_TIMEOUT_SECONDS,
      help: 'Maximum seconds to wait for the seat map to render',
    },
  ],
  columns: [
    'rank',
    'seat',
    'row',
    'number',
    'column',
    'seatClass',
    'price',
    'status',
    'flags',
    'showId',
    'formatId',
    'url',
  ],
  func: async (page, args) => {
    const target = resolveSeatTarget(args);
    const limit = validateLimit(args.limit);
    const count = validateCount(args.count);
    const timeout = validateTimeout(args.timeout, { def: DEFAULT_TIMEOUT_SECONDS, min: 5, max: 180 });
    const seatClass = normalizeClass(args.class);
    const together = validateBoolean(args.together, 'together');
    const maxPrice = validateMoney(args['max-price'], 'max-price');
    const url = makeSeatUrl(target);

    await openSeatMap(page, target, timeout);

    let rows = await extractSeats(page, target, url);
    rows = applyFilters(rows, { seatClass, maxPrice });
    rows = chooseSeats(rows, { count, together }).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));

    if (!rows.length) {
      const constraints = [
        seatClass ? `class matching "${seatClass}"` : '',
        maxPrice ? `price <= ${maxPrice}` : '',
        count ? `${count} seat${count === 1 ? '' : 's'}` : '',
        together ? 'together' : '',
      ].filter(Boolean).join(', ');
      const detail = constraints ? `No available seats found for ${constraints}` : 'No available seats found';
      throw new EmptyResultError('district seats', detail);
    }
    return rows;
  },
});
