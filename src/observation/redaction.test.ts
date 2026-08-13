import { describe, expect, it } from 'vitest';
import { redactHeaders, redactUrl, redactValue } from './redaction.js';

describe('observation redaction', () => {
  it('redacts sensitive headers by default', () => {
    expect(redactHeaders({
      authorization: 'Bearer secret-token',
      cookie: 'sid=abc',
      'set-cookie': 'sid=abc',
      accept: 'application/json',
    })).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      accept: 'application/json',
    });
  });

  it('redacts sensitive url query params', () => {
    expect(redactUrl('https://x.test/api?token=abc&ok=1&password=secret'))
      .toBe('https://x.test/api?token=[REDACTED]&ok=1&password=[REDACTED]');
  });

  it('redacts sensitive url query params after XML escaping', () => {
    expect(redactUrl('<link href="https://x.test/api?ok=1&amp;key=abc&amp;auth=secret">Next</link>'))
      .toBe('<link href="https://x.test/api?ok=1&amp;key=[REDACTED]&amp;auth=[REDACTED]">Next</link>');
  });

  it('redacts credentials embedded in url authority', () => {
    expect(redactUrl('https://alice:secret@x.test/private?ok=1'))
      .toBe('https://[REDACTED]@x.test/private?ok=1');
  });

  it('redacts password and token fields recursively', () => {
    expect(redactValue({
      user: 'alice',
      password: 'secret',
      nested: { access_token: 'abc123456789', value: 'safe' },
    })).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]', value: 'safe' },
    });
  });
});
