import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE = 'https://www.district.in';
const SECTIONS = new Map([
  ['home', '/'],
  ['for-you', '/'],
  ['movies', '/movies/'],
  ['events', '/events/'],
]);

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return '';
  }
}

function validateLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArgumentError('limit must be an integer from 1 to 100');
  }
  return limit;
}

function buildUrl(input) {
  const value = String(input || 'home').trim();
  const sectionPath = SECTIONS.get(value.toLowerCase());
  if (sectionPath) return `${BASE}${sectionPath}`;

  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    if (!/(^|\.)district\.in$/i.test(parsed.hostname)) {
      throw new ArgumentError('input URL must be on district.in');
    }
    return parsed.toString();
  }

  if (value.startsWith('/')) return absoluteUrl(value);

  throw new ArgumentError('input must be one of home, movies, events, a district.in URL, or a District path');
}

function inferCategory(url) {
  if (url.includes('/movies/')) return 'movie';
  if (url.includes('/events/')) return 'event';
  if (url.includes('/dining/')) return 'dining';
  return 'listing';
}

function isBookableListingUrl(url) {
  return /\/movies\/[^/]+-movie-tickets-/i.test(url)
    || /\/events\/[^/]+(?:buy-tickets|ipl-ticket-booking)/i.test(url)
    || /\/dining\//i.test(url);
}

function parseListings(html, limit) {
  const rows = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(?=[\s\S]*?<div[^>]+class=["'][^"']*\bitem-cards\b)[\s\S]*?<\/a>/gi;

  for (const match of html.matchAll(anchorRe)) {
    const block = match[0];
    const url = absoluteUrl(match[1]);
    if (!url || !isBookableListingUrl(url)) continue;

    const titleMatch = block.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i);
    const title = decodeHtml(titleMatch?.[1]);
    if (!title) continue;

    const spanValues = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((span) => decodeHtml(span[1]))
      .filter(Boolean);

    const nonOfferSpans = spanValues.filter((text) => !/\boff\b|cashback|discount|coupon/i.test(text));
    rows.push({
      rank: rows.length + 1,
      title,
      category: inferCategory(url),
      date: nonOfferSpans[0] || '',
      venue: nonOfferSpans[1] || '',
      price: nonOfferSpans[2] || '',
      url,
    });

    if (rows.length >= limit) break;
  }

  return rows;
}

cli({
  site: 'district',
  name: 'listings',
  aliases: ['ls'],
  access: 'read',
  description: 'List public District by Zomato movies, events, and nearby going-out cards',
  domain: 'www.district.in',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'input',
      positional: true,
      required: false,
      default: 'home',
      help: 'home, movies, events, a district.in URL, or a District path',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: 'Maximum rows to return (1-100)',
    },
  ],
  columns: ['rank', 'title', 'category', 'date', 'venue', 'price', 'url'],
  func: async (args) => {
    const limit = validateLimit(args.limit);
    const url = buildUrl(args.input);

    const resp = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36',
      },
    });

    if (!resp.ok) {
      throw new CommandExecutionError(`district listings request failed: HTTP ${resp.status}`);
    }

    const html = await resp.text();
    if (!/<html[\s>]/i.test(html)) {
      throw new CommandExecutionError('district listings expected HTML but received a different response');
    }

    const rows = parseListings(html, limit);
    if (!rows.length) {
      throw new EmptyResultError('district listings', 'No listing cards found on the District page');
    }
    return rows;
  },
});
