import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateSessionSuffix,
  normalizeSessionBase,
  requireSessionIdShape,
  requireSessionName,
} from './session-identifiers.js';

const normalizationCases = JSON.parse(
  fs.readFileSync(new URL('./session-normalization.fixtures.json', import.meta.url), 'utf8'),
) as Array<{ input: string; base?: string; error?: string }>;

describe('session identifiers', () => {
  it.each(normalizationCases)('normalizes $input', ({ input, base, error }) => {
    if (base !== undefined) {
      expect(normalizeSessionBase(input)).toBe(base);
      expect(requireSessionName(input)).toBe(base);
    } else {
      expect(() => requireSessionName(input)).toThrowError(expect.objectContaining({ code: error }));
    }
  });

  it('uses readable random suffixes', () => {
    expect(generateSessionSuffix(() => 0)).toBe('22');
    expect(generateSessionSuffix(() => 31)).toBe('zz');
  });

  it('accepts only readable session selectors', () => {
    expect(() => requireSessionIdShape('a-k7')).not.toThrow();
    expect(() => requireSessionIdShape('adapter-default')).not.toThrow();
    expect(() => requireSessionIdShape('a-k7m4q2')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR' }),
    );
  });

  it.each([
    'work--k7',
    'a--zz',
    'work-project--k7',
    '-work-k7',
    'work-k7-',
  ])('rejects malformed selector segments: %s', (sessionId) => {
    expect(() => requireSessionIdShape(sessionId)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR' }),
    );
  });
});
