import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LOCAL_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../browser/runtime/local-slab/__fixtures__');
const FIXTURE_FILES = [
  'hello.response.json',
  'attach.response.json',
  'release.response.json',
  'errors.json',
] as const;
const CONNECTION_ID = '00000000-0000-4000-8000-000000000000';
const PROFILE_ID = 'default';
const ENDPOINT = `/Users/test/.slab/run/attachments/${CONNECTION_ID}.sock`;
const CREDENTIAL = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const STABLE_ERRORS = [
  'INVALID_REQUEST',
  'INCOMPATIBLE_PROTOCOL',
  'PROFILE_NOT_FOUND',
  'ATTACH_FAILED',
  'AUTHENTICATION_FAILED',
  'CONNECTION_NOT_FOUND',
] as const;

function keysOf(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

function findSiblingFixtures(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const parent = dirname(dir);
    const candidate = join(parent, 'slab-browser/.worktrees/slab-macos-first-alpha/protocol/fixtures');
    if (existsSync(join(candidate, 'hello.response.json'))) return candidate;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadLocal(name: (typeof FIXTURE_FILES)[number]): Promise<{ bytes: Buffer; parsed: unknown }> {
  const bytes = await readFile(join(LOCAL_FIXTURES, name));
  return { bytes, parsed: JSON.parse(bytes.toString('utf8')) };
}

describe('SLAB protocol fixture parity', () => {
  it('validates committed local copies against the frozen contract', async () => {
    const hello = await loadLocal('hello.response.json');
    const attach = await loadLocal('attach.response.json');
    const release = await loadLocal('release.response.json');
    const errors = await loadLocal('errors.json');

    expect(keysOf(hello.parsed)).toEqual(['request', 'response']);
    const helloDoc = hello.parsed as {
      request: { id: string; method: string; params: { protocolVersion: { min: number; max: number }; clientVersion: string } };
      response: {
        id: string;
        ok: boolean;
        result: {
          protocolVersion: number;
          browserVersion: string;
          browserPid: number;
          profiles: Array<{ id: string; displayName: string }>;
        };
      };
    };
    expect(helloDoc.request.method).toBe('hello');
    expect(helloDoc.request.params.protocolVersion).toEqual({ min: 1, max: 1 });
    expect(helloDoc.response.id).toBe(helloDoc.request.id);
    expect(helloDoc.response.ok).toBe(true);
    expect(keysOf(helloDoc.response.result)).toEqual(['browserPid', 'browserVersion', 'profiles', 'protocolVersion']);
    expect(helloDoc.response.result.protocolVersion).toBe(1);
    expect(helloDoc.response.result.profiles).toEqual([{ id: PROFILE_ID, displayName: 'Default' }]);

    const attachDoc = attach.parsed as {
      request: { id: string; params: { profileId: string } };
      response: {
        id: string;
        result: {
          connectionId: string;
          profile: { id: string; displayName: string };
          transport: { kind: string; endpoint: string; credential: string };
          expiresAt?: unknown;
          cdpUrl?: unknown;
        };
      };
    };
    expect(attachDoc.request.params.profileId).toBe(PROFILE_ID);
    expect(attachDoc.response.id).toBe(attachDoc.request.id);
    expect(attachDoc.response.result.connectionId).toBe(CONNECTION_ID);
    expect(attachDoc.response.result.expiresAt).toBeUndefined();
    expect(attachDoc.response.result.cdpUrl).toBeUndefined();
    expect(attachDoc.response.result.transport).toEqual({
      kind: 'cdp-ipc',
      endpoint: ENDPOINT,
      credential: CREDENTIAL,
    });
    expect(attachDoc.response.result.transport.credential).toHaveLength(43);
    expect(Buffer.byteLength(`${JSON.stringify(attachDoc.response)}\n`)).toBeLessThanOrEqual(64 * 1024);

    const releaseDoc = release.parsed as {
      request: { params: { connectionId: string } };
      response: { result: unknown };
      alreadyRevoked: { response: { result: unknown } };
    };
    expect(releaseDoc.request.params.connectionId).toBe(CONNECTION_ID);
    expect(releaseDoc.response.result).toBeNull();
    expect(releaseDoc.alreadyRevoked.response.result).toBeNull();

    const errorDoc = errors.parsed as Record<string, { response: { error: { code: string; message: string } } }>;
    expect(Object.keys(errorDoc).sort()).toEqual([...STABLE_ERRORS].sort());
    for (const code of STABLE_ERRORS) {
      expect(errorDoc[code].response.error.code).toBe(code);
      expect(errorDoc[code].response.error.message).not.toContain(CREDENTIAL);
    }
  });

  it('matches sibling fixture bytes and parsed values when the worktree is present', async () => {
    const sibling = findSiblingFixtures();
    for (const name of FIXTURE_FILES) {
      const local = await loadLocal(name);
      const localHash = createHash('sha256').update(local.bytes).digest('hex');
      expect(localHash).toMatch(/^[0-9a-f]{64}$/);
      if (!sibling) continue;
      const remoteBytes = await readFile(join(sibling, name));
      expect(createHash('sha256').update(remoteBytes).digest('hex'), name).toBe(localHash);
      expect(JSON.parse(remoteBytes.toString('utf8')), name).toEqual(local.parsed);
    }
    if (sibling) expect(existsSync(sibling)).toBe(true);
  });
});
