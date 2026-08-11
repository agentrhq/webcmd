// Matched only against the response body: CDN *names* (e.g. "server: cloudflare") are not
// evidence of a challenge, since most of the web sits behind one on perfectly good responses.
const bodyChallengeMarkers = /cf-chl|datadome|perimeterx|px-captcha|akamai.*captcha|captcha|just a moment|checking your browser|verify you are human|attention required/i;
// Header *names* that only ever appear when a challenge actually fired.
const challengeHeaderNames = ['cf-mitigated', 'x-datadome-captcha', 'x-px-block'];

export function isChallengeResponse(status: number, headers: Record<string, string>, body: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503 && status !== 200) return false;
  const bodyHit = bodyChallengeMarkers.test(body.slice(0, 20_000));
  // A 200 is only a challenge if the body itself shows one; generic CDN headers on a normal
  // 200 (the common case for any Cloudflare-fronted site) must not trip this.
  if (status === 200) return bodyHit;
  const headerHit = challengeHeaderNames.some(name => headers[name] !== undefined);
  return bodyHit || headerHit;
}

export function isJavaScriptShell(body: string): boolean {
  return /<(?:div|main)[^>]+(?:id|data-[^=]+)=["'](?:root|app)["']/i.test(body)
    && (body.match(/<script\b/gi)?.length ?? 0) >= 1
    && body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim().length < 500;
}
