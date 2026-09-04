import { describe, expect, it } from 'vitest';
import { parseAttachResult, parseControlResponse, parseCreateProfileResult, parseHelloResult } from './protocol.js';

describe('SLAB revision 2 protocol', () => {
  it('accepts a negotiated revision in the supported range', () => {
    expect(parseHelloResult({ protocolVersion: 2, browserVersion: '152', browserPid: 7, profiles: [] }, { min: 1, max: 2 }).protocolVersion).toBe(2);
  });

  it('rejects a negotiated revision outside the supported range', () => {
    expect(() => parseHelloResult({ protocolVersion: 3, browserVersion: '152', browserPid: 7, profiles: [] }, { min: 1, max: 2 })).toThrow(/revision|version|range/i);
  });

  it('strictly parses createProfile results', () => {
    expect(parseCreateProfileResult({ profile: { id: 'Profile 1', displayName: 'Work' }, created: true })).toEqual({
      profile: { id: 'Profile 1', displayName: 'Work' },
      created: true,
    });
    expect(() => parseCreateProfileResult({ profile: { id: 'Profile 1', displayName: 'Work' }, created: true, extra: 1 })).toThrow(/unknown fields/);
  });

  it.each([
    { id: '', displayName: 'Work' },
    { id: 'Profile 1', displayName: '' },
  ])('rejects empty profile identity fields: %j', (profile) => {
    expect(() => parseHelloResult({
      protocolVersion: 2, browserVersion: '152', browserPid: 7, profiles: [profile],
    })).toThrow(/unknown fields/);
    expect(() => parseCreateProfileResult({ profile, created: true })).toThrow(/unknown fields/);
    expect(() => parseAttachResult({
      connectionId: 'lease-1',
      profile,
      transport: { kind: 'cdp-ipc', endpoint: '/tmp/slab.sock', credential: 'secret' },
    })).toThrow(/unknown fields/);
  });

  it('rejects an empty attachment connection id', () => {
    expect(() => parseAttachResult({
      connectionId: '',
      profile: { id: 'Profile 1', displayName: 'Work' },
      transport: { kind: 'cdp-ipc', endpoint: '/tmp/slab.sock', credential: 'secret' },
    })).toThrow(/unknown fields/);
  });

  it.each(['PROFILE_CREATE_FAILED', 'PROFILE_GONE', 'PROFILE_REPAIR_REQUIRED'] as const)(
    'accepts revision 2 error code %s',
    (code) => {
      expect(parseControlResponse(JSON.stringify({
        id: '2', ok: false, error: { code, message: 'stable message' },
      }))).toMatchObject({ error: { code } });
    },
  );
});
