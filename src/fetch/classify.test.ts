import { describe, expect, it } from 'vitest';
import { isChallengeResponse, isJavaScriptShell } from './classify.js';

describe('fetch classification', () => {
  it('recognizes explicit challenges but not bare forbidden responses', () => {
    expect(isChallengeResponse(403, { server: 'cloudflare' }, 'Just a moment...')).toBe(true);
    expect(isChallengeResponse(403, {}, 'forbidden')).toBe(false);
    expect(isChallengeResponse(403, { server: 'cloudflare' }, 'forbidden')).toBe(true);
  });
  it('ignores third-party allow-lists in CSP and friends', () => {
    const csp = "default-src 'self'; script-src https://www.google.com/recaptcha/ https://cdnjs.cloudflare.com/";
    expect(isChallengeResponse(200, { 'content-security-policy': csp }, '<html>Hacker News</html>')).toBe(false);
    expect(isChallengeResponse(403, { 'content-security-policy': csp }, 'forbidden')).toBe(false);
  });
  it('does not treat a served 200 as a challenge on headers alone', () => {
    expect(isChallengeResponse(200, { server: 'cloudflare' }, '<html>real page</html>')).toBe(false);
    expect(isChallengeResponse(200, { server: 'cloudflare' }, 'Just a moment...')).toBe(true);
  });
  it('recognizes script-heavy app shells', () => expect(isJavaScriptShell('<div id="root"></div><script src="/app.js"></script><script>boot()</script>')).toBe(true));
});
