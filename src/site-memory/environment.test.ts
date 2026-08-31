import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectEnvironment } from './environment.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('candidate environment provenance', () => {
  it('includes independently requested fields and omits the rest', async () => {
    const env = await collectEnvironment({
      machine: false,
      localIp: false,
      publicIp: false,
      os: false,
      browserVersion: '1.61.1',
      webcmdVersion: '0.7.11',
    });

    expect(env).toEqual({ browserVersion: '1.61.1', webcmdVersion: '0.7.11' });
  });

  it('collects local provenance from Node OS APIs', async () => {
    const env = await collectEnvironment({ publicIp: false, browserVersion: false, webcmdVersion: false });
    const addresses = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && !entry.internal && entry.family === 'IPv4');

    expect(env.machine).toEqual(expect.any(String));
    expect(env.os).toEqual(expect.any(String));
    if (addresses[0]) expect(env.localIp).toBe(addresses[0].address);
  });

  it('omits fields when OS or public-IP lookup fails', async () => {
    const env = await collectEnvironment({
      localIp: false,
      os: false,
      browserVersion: false,
      webcmdVersion: false,
      hostname: () => {
        throw new Error('no hostname');
      },
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(env).toEqual({});
  });

  it('bounds public-IP lookup and omits the field on timeout', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new Error('aborted'));
      });
    }));

    const started = Date.now();
    const env = await collectEnvironment({
      machine: false,
      localIp: false,
      os: false,
      browserVersion: false,
      webcmdVersion: false,
      fetch,
    });

    expect(env.publicIp).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
