import { describe, expect, it } from 'vitest';
import { isChallengeResponse, isJavaScriptShell } from './classify.js';

describe('fetch classification', () => {
  it('recognizes explicit challenges but not bare forbidden responses', () => {
    expect(isChallengeResponse(403, { server: 'cloudflare' }, 'Just a moment...')).toBe(true);
    expect(isChallengeResponse(403, {}, 'forbidden')).toBe(false);
  });
  it('recognizes script-heavy app shells', () => expect(isJavaScriptShell('<div id="root"></div><script src="/app.js"></script><script>boot()</script>')).toBe(true));
  it('does not flag a Cloudflare-fronted 200 with a normal body', () => {
    expect(isChallengeResponse(200, { server: 'cloudflare', 'cf-cache-status': 'HIT' }, '<html><body>Hello world</body></html>')).toBe(false);
  });
  it('flags a 200 whose body shows an actual challenge page', () => {
    expect(isChallengeResponse(200, { server: 'cloudflare' }, 'Just a moment...')).toBe(true);
  });
  it('flags a challenge header on a non-200 status even without body evidence', () => {
    expect(isChallengeResponse(403, { 'cf-mitigated': 'challenge' }, 'forbidden')).toBe(true);
  });
});
