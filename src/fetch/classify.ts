const challengeMarkers = /cloudflare|cf-chl|datadome|perimeterx|px-captcha|akamai|captcha|just a moment|verify you are human/i;
// Headers that say something about *this* response. CSP/report-to/link are allow-lists of third
// parties (cdnjs.cloudflare.com, google.com/recaptcha) and are evidence of nothing.
const signalHeaders = /^(?:server|cf-mitigated|cf-chl-[\w-]+|x-datadome[\w-]*|set-cookie)$/i;

export function isChallengeResponse(status: number, headers: Record<string, string>, body: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503 && status !== 200) return false;
  if (challengeMarkers.test(body.slice(0, 20_000))) return true;
  // A 200 with a real body is a served page; headers alone (server: cloudflare) never prove otherwise.
  if (status === 200) return false;
  return Object.entries(headers).some(([key, value]) => signalHeaders.test(key) && challengeMarkers.test(value));
}

export function isJavaScriptShell(body: string): boolean {
  return /<(?:div|main)[^>]+(?:id|data-[^=]+)=["'](?:root|app)["']/i.test(body)
    && (body.match(/<script\b/gi)?.length ?? 0) >= 1
    && body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim().length < 500;
}
