import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const NDTV_TOP_STORIES_RSS_URL = 'https://feeds.feedburner.com/ndtvnews-top-stories';
const UA = 'webcmd-ndtv-adapter (+https://github.com/agentrhq/webcmd)';

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => HTML_ENTITIES[m] || m);
}

export function stripHtml(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function extractRssTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cdata = block.match(new RegExp(`<${escaped}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${escaped}>`));
  if (cdata) return cdata[1];
  const plain = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  return plain ? plain[1] : '';
}

export function requireNdtvLimit(value, defaultValue = 5, maxValue = 50) {
  const raw = value ?? defaultValue;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError('ndtv limit must be a positive integer');
  }
  if (n > maxValue) {
    throw new ArgumentError(`ndtv limit must be <= ${maxValue}`);
  }
  return n;
}

export function canonicalizeNdtvUrl(value) {
  const raw = decodeHtmlEntities(value).trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CommandExecutionError(`NDTV feed returned malformed article URL: ${raw}`);
  }
  parsed.hash = '';
  return parsed.toString();
}

export function ndtvIdFromUrl(url, fallback = '') {
  const path = new URL(url).pathname;
  const leaf = path.split('/').filter(Boolean).pop() || '';
  return leaf || fallback;
}

export function parseNdtvTopStoriesRss(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    const block = m[1];
    const title = stripHtml(extractRssTag(block, 'title'));
    const description = stripHtml(extractRssTag(block, 'description'));
    const rawLink = extractRssTag(block, 'link') || extractRssTag(block, 'guid');
    if (!title || !rawLink) {
      throw new CommandExecutionError('NDTV top stories feed returned a malformed item without a title or URL');
    }
    const url = canonicalizeNdtvUrl(rawLink);
    const pubDateRaw = stripHtml(extractRssTag(block, 'pubDate'));
    const date = pubDateRaw ? new Date(pubDateRaw) : null;
    const pubDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
    const guid = stripHtml(extractRssTag(block, 'guid'));
    items.push({
      title,
      description,
      pubDate,
      id: ndtvIdFromUrl(url, guid),
      url,
    });
  }
  return items;
}

export async function ndtvFetchTopStoriesRss() {
  let resp;
  try {
    resp = await fetch(NDTV_TOP_STORIES_RSS_URL, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' },
    });
  } catch (err) {
    throw new CommandExecutionError(
      `NDTV top stories request failed: ${err?.message ?? err}`,
      'Check that feeds.feedburner.com is reachable from this network.',
    );
  }
  if (!resp.ok) {
    throw new CommandExecutionError(`NDTV top stories returned HTTP ${resp.status} (${NDTV_TOP_STORIES_RSS_URL})`);
  }
  return resp.text();
}
