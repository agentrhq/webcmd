/**
 * Headers that describe *this* response. Everything else is excluded on
 * purpose: `content-security-policy`, `report-to` and `link` are allow-lists of
 * third parties a page may load, so a CSP naming `cdnjs.cloudflare.com` or
 * `google.com/recaptcha` proves nothing about who served the bytes (#264).
 */
const CHALLENGE_HEADERS = /^(?:server|cf-mitigated|cf-chl-[\w-]+|x-datadome[\w-]*|set-cookie)$/i;

/**
 * Markers that do not legitimately appear outside an actual challenge, so they
 * decide on their own at any status — including the managed-challenge
 * interstitial Cloudflare serves with a 200.
 */
const DECISIVE_MARKERS = /cf-chl|cf-mitigated|__cf_bm|datadome|perimeterx|px-captcha|just a moment|verify you are human|checking your browser|enable javascript and cookies/i;

/**
 * Markers that appear constantly on healthy pages: a CDN name in `server:`,
 * or a reCAPTCHA widget embedded in an ordinary login form. These only
 * corroborate a status that already looks like a block, never decide alone —
 * that is the difference between a real block and the false positive in #283.
 */
const CORROBORATING_MARKERS = /cloudflare|akamai|captcha/i;

const BLOCKED_STATUSES = new Set([403, 429, 503]);

export function isChallengeResponse(status: number, headers: Record<string, string>, body: string): boolean {
  const evidence = [
    ...Object.entries(headers)
      .filter(([key]) => CHALLENGE_HEADERS.test(key))
      .map(([key, value]) => `${key}:${value}`),
    body.slice(0, 20_000),
  ].join('\n');
  if (DECISIVE_MARKERS.test(evidence)) return true;
  return BLOCKED_STATUSES.has(status) && CORROBORATING_MARKERS.test(evidence);
}

export function isJavaScriptShell(body: string): boolean {
  return /<(?:div|main)[^>]+(?:id|data-[^=]+)=["'](?:root|app)["']/i.test(body)
    && (body.match(/<script\b/gi)?.length ?? 0) >= 1
    && body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim().length < 500;
}
