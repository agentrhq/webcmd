const challengeMarkers = /cloudflare|cf-chl|datadome|perimeterx|px-captcha|akamai|captcha|just a moment|verify you are human/i;
// Headers a bot-mitigation product sets *because it challenged this request*. The evidence is in
// the name — values are opaque tokens — so these are decisive on their own, whatever the status.
// https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
const decisiveHeaders = /^(?:cf-chl-[\w-]+|x-datadome[\w-]*)$/i;
// Provider branding: present on every response the provider proxies, challenge or not. It can
// support an already-blocked status but must never turn a served 200 into a challenge.
const weakHeaders = /^(?:server|set-cookie)$/i;
// CSP/report-to/link are allow-lists of third parties (cdnjs.cloudflare.com, google.com/recaptcha)
// and are evidence of nothing — they are in neither list.

export function isChallengeResponse(status: number, headers: Record<string, string>, body: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503 && status !== 200) return false;
  if (challengeMarkers.test(body.slice(0, 20_000))) return true;
  const entries = Object.entries(headers).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  if (entries.some(([key, value]) => decisiveHeaders.test(key) || (key === 'cf-mitigated' && /challenge/i.test(value)))) return true;
  // A 200 with a real body is a served page; branding alone (server: cloudflare) never proves otherwise.
  if (status === 200) return false;
  return entries.some(([key, value]) => weakHeaders.test(key) && challengeMarkers.test(value));
}

export function isJavaScriptShell(body: string): boolean {
  return /<(?:div|main)[^>]+(?:id|data-[^=]+)=["'](?:root|app)["']/i.test(body)
    && (body.match(/<script\b/gi)?.length ?? 0) >= 1
    && body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim().length < 500;
}
