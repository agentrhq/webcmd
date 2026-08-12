import { describe, expect, it } from 'vitest';
import { isChallengeResponse, isJavaScriptShell } from './classify.js';

describe('fetch classification', () => {
  it('recognizes explicit challenges but not bare forbidden responses', () => {
    expect(isChallengeResponse(403, { server: 'cloudflare' }, 'Just a moment...')).toBe(true);
    expect(isChallengeResponse(403, {}, 'forbidden')).toBe(false);
  });

  it('recognizes script-heavy app shells', () => expect(isJavaScriptShell('<div id="root"></div><script src="/app.js"></script><script>boot()</script>')).toBe(true));

  // A CSP allow-list names third parties this page may load; it says nothing
  // about who served the response. news.ycombinator.com returns a healthy 200
  // whose CSP mentions cdnjs.cloudflare.com and google.com/recaptcha (#264).
  it('ignores content-security-policy allow-lists naming a CDN or captcha vendor', () => {
    const csp = "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://cdnjs.cloudflare.com/";
    expect(isChallengeResponse(200, { 'content-security-policy': csp }, '<html><body>Hacker News</body></html>')).toBe(false);
  });

  it('ignores report-to and link headers naming a challenge vendor', () => {
    const headers = { 'report-to': '{"endpoints":[{"url":"https://report.cloudflare.com/"}]}', link: '<https://cdnjs.cloudflare.com>; rel=preconnect' };
    expect(isChallengeResponse(200, headers, '<html><body>Real content</body></html>')).toBe(false);
  });

  // example.com is a plain static page fronted by Cloudflare. `server: cloudflare`
  // on a 200 that was actually served is not a challenge (#283).
  it('does not flag a Cloudflare-fronted 200 whose body is a real page', () => {
    const headers = { server: 'cloudflare', 'cf-cache-status': 'HIT', 'content-type': 'text/html' };
    expect(isChallengeResponse(200, headers, '<html><body><h1>Example Domain</h1></body></html>')).toBe(false);
  });

  it('still flags a managed-challenge interstitial served with a 200', () => {
    const headers = { server: 'cloudflare', 'cf-mitigated': 'challenge' };
    expect(isChallengeResponse(200, headers, '<title>Just a moment...</title>')).toBe(true);
  });

  // cf-mitigated only ever appears on an actual mitigation, so it stands alone
  // even when the body has been withheld.
  it('treats challenge-specific headers as evidence without a body marker', () => {
    expect(isChallengeResponse(403, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
    expect(isChallengeResponse(429, { 'x-datadome': 'protected' }, '')).toBe(true);
    expect(isChallengeResponse(503, { 'cf-chl-bypass': '1' }, '')).toBe(true);
  });

  it('treats a challenge cookie as evidence', () => {
    expect(isChallengeResponse(403, { 'set-cookie': '__cf_bm=abc; Path=/' }, 'blocked')).toBe(true);
    expect(isChallengeResponse(200, { 'set-cookie': 'session=abc; Path=/' }, 'real page')).toBe(false);
  });

  // A bare CDN name corroborates an already-suspicious status, but never decides
  // on its own — that is the difference between #283 and a genuine block.
  it('lets a bare CDN name corroborate a non-200 block', () => {
    expect(isChallengeResponse(403, { server: 'cloudflare' }, 'Access denied')).toBe(true);
    expect(isChallengeResponse(200, { server: 'akamai' }, 'Real page content')).toBe(false);
  });

  it('does not flag a healthy 200 with no challenge evidence anywhere', () => {
    expect(isChallengeResponse(200, { 'content-type': 'text/html' }, '<html><body>Hello</body></html>')).toBe(false);
  });

  it('still catches a body-level captcha wall on a 403', () => {
    expect(isChallengeResponse(403, {}, '<div class="g-recaptcha">verify you are human</div>')).toBe(true);
  });
});
