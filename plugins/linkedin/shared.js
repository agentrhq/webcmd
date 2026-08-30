import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const LINKEDIN_DOMAIN = 'www.linkedin.com';

export function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeHttpUrl(value, base) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    const parsed = base ? new URL(raw, base) : new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function compactRepeatedText(value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length % 2 === 0) {
    const half = text.length / 2;
    const left = text.slice(0, half);
    if (left === text.slice(half)) return left;
  }
  const words = text.split(' ');
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(' ');
    if (left === words.slice(half).join(' ')) return left;
  }
  return text;
}

export function looksLinkedInAuthWall(value) {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) return false;
  return /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(text)
    || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(text)
    || /(Please log in|Log in to LinkedIn|security verification)/.test(text);
}

export function assertSafeLinkedinUrl(value, label, fallbackPath = '/') {
  const raw = normalizeWhitespace(value || `https://www.linkedin.com${fallbackPath}`);
  let parsed;
  try {
    parsed = new URL(raw, 'https://www.linkedin.com');
  } catch {
    throw new ArgumentError(`${label} must be a LinkedIn URL`);
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new ArgumentError(`${label} must be an https LinkedIn URL without credentials or port`);
  }
  if (host !== 'linkedin.com' && host !== 'www.linkedin.com') {
    throw new ArgumentError(`${label} must point to linkedin.com`);
  }
  return parsed.toString();
}

export function requireStringArg(args, key, label = key) {
  const value = normalizeWhitespace(args?.[key]);
  if (!value) throw new ArgumentError(`${label} is required`);
  return value;
}

export function parseLimit(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export async function requireLinkedInCookie(page, context) {
  let cookies;
  try {
    cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
  } catch (error) {
    throw new CommandExecutionError(`LinkedIn cookie lookup failed: ${error?.message || error}`);
  }
  if (!Array.isArray(cookies)) {
    throw new CommandExecutionError('LinkedIn cookie lookup returned malformed payload');
  }
  const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
  if (!jsession) {
    throw new AuthRequiredError(LINKEDIN_DOMAIN, `${context} requires an active signed-in LinkedIn browser session.`);
  }
  return jsession.replace(/^"|"$/g, '');
}

export function buildAuthProbeScript() {
  return String.raw`(() => {
    const text = [
      window.location.href || '',
      document.title || '',
      document.body ? (document.body.innerText || '').slice(0, 4000) : '',
    ].join('\n');
    return /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(text)
      || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(text)
      || /(Please log in|Log in to LinkedIn|security verification)/.test(text);
  })()`;
}

export async function assertLinkedInAuthenticated(page, context) {
  const authRequired = unwrapEvaluateResult(await page.evaluate(buildAuthProbeScript()));
  if (authRequired) {
    throw new AuthRequiredError(LINKEDIN_DOMAIN, `${context} requires an active signed-in LinkedIn browser session.`);
  }
}

export function splitVisibleLines(text) {
  return String(text || '').split(/\n+/).map(normalizeWhitespace).filter(Boolean);
}

/**
 * Step the element that actually scrolls the current LinkedIn layout.
 *
 * `page.autoScroll()` drives `window.scrollTo`, but the current profile UI
 * scrolls inside `main#workspace`, so the window scroller never moves and the
 * lazy loaders for later sections (Experience, Education, ...) never fire. This
 * script advances the real scroll container — falling back to the window
 * scroller on older layouts — and reports which of the requested section
 * headings are present so the caller can stop as soon as they have loaded.
 */
export function buildSectionScrollScript(headings) {
  const wanted = JSON.stringify((headings || []).map((value) => String(value).toLowerCase()));
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const wanted = ${wanted};
    const seen = Array.from(document.querySelectorAll('main h2, main h3, section h2, section h3'))
      .map((el) => clean(el.innerText || el.textContent || '').toLowerCase())
      .filter(Boolean);
    const found = wanted.filter((name) => seen.includes(name));
    const scrollable = (el) => {
      if (!el) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      const overflowY = (window.getComputedStyle ? window.getComputedStyle(el).overflowY : '') || '';
      return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    };
    const findScroller = () => {
      const workspace = document.querySelector('main#workspace') || document.querySelector('#workspace');
      if (workspace && workspace.scrollHeight > workspace.clientHeight + 1) return workspace;
      let node = document.querySelector('main');
      while (node && node !== document.body && node !== document.documentElement) {
        if (scrollable(node)) return node;
        node = node.parentElement;
      }
      return null;
    };
    const scroller = findScroller();
    if (scroller) {
      const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(scroller.clientHeight || 0, 400);
      scroller.scrollTop = Math.min(bottom, scroller.scrollTop + step);
      return {
        found,
        atEnd: scroller.scrollTop >= bottom - 2,
        container: scroller.id ? '#' + scroller.id : String(scroller.tagName || '').toLowerCase(),
      };
    }
    const doc = document.documentElement;
    const bottom = Math.max(0, doc.scrollHeight - window.innerHeight);
    const step = Math.max(window.innerHeight || 0, 400);
    window.scrollTo(0, Math.min(bottom, (window.scrollY || 0) + step));
    return {
      found,
      atEnd: (window.scrollY || 0) >= bottom - 2,
      container: 'window',
    };
  })()`;
}

/**
 * Scroll until every requested section heading is loaded, the container stops
 * growing, or `rounds` is exhausted. One `atEnd` round is not the end: LinkedIn
 * lazy-loads on reaching the bottom, so the container grows and the next round
 * has further to travel. Two consecutive `atEnd` rounds with no newly found
 * section mean the content really is exhausted.
 *
 * Never throws — a layout this helper cannot scroll is not itself a command
 * failure, only a reason the extraction below it may see fewer sections.
 */
export async function scrollToSections(page, headings, options = {}) {
  const rounds = options.rounds ?? 8;
  const waitSeconds = options.waitSeconds ?? 1;
  const targets = (headings || []).map((value) => String(value).toLowerCase());
  let last = { found: [], atEnd: false, container: '' };
  let foundCount = 0;
  let endRounds = 0;
  for (let round = 0; round < rounds; round++) {
    let payload;
    try {
      payload = unwrapEvaluateResult(await page.evaluate(buildSectionScrollScript(targets)));
    } catch {
      return last;
    }
    if (payload && typeof payload === 'object') last = payload;
    const found = Array.isArray(last.found) ? last.found : [];
    if (targets.every((name) => found.includes(name))) return last;
    endRounds = last.atEnd === true && found.length === foundCount ? endRounds + 1 : 0;
    foundCount = found.length;
    if (endRounds >= 2) return last;
    await page.wait(waitSeconds);
  }
  return last;
}
