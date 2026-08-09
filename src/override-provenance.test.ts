import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fileSha256, getBaseCopyPath, readOverrideRecords, removeOverrideRecords, writeOverrideRecords,
} from './override-provenance.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ovr-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('override provenance store', () => {
  it('round-trips a record', () => {
    writeOverrideRecords({
      'linkedin/search': {
        plugin: 'linkedin', commitHash: 'a'.repeat(40),
        sourcePath: 'plugins/linkedin/search.js',
        sourceSha256: 'b'.repeat(64),
        basePath: '.base/linkedin/search.js',
        createdAt: '2026-08-07T00:00:00.000Z',
      },
    }, home);
    expect(readOverrideRecords(home)['linkedin/search']!.plugin).toBe('linkedin');
  });

  it('returns an empty map when no store exists', () => {
    expect(readOverrideRecords(home)).toEqual({});
  });

  it('throws on a malformed store rather than silently returning empty', () => {
    mkdirSync(join(home, '.webcmd'), { recursive: true });
    writeFileSync(join(home, '.webcmd', 'override-provenance.json'), '{ not json', 'utf-8');
    expect(() => readOverrideRecords(home)).toThrow(/malformed/i);
  });

  it('hashes file content', () => {
    const f = join(home, 'x.js');
    writeFileSync(f, 'hello', 'utf-8');
    const first = fileSha256(f);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(f, 'hello2', 'utf-8');
    const second = fileSha256(f);
    expect(second).not.toBe(first);
    writeFileSync(f, 'hello', 'utf-8');
    expect(fileSha256(f)).toBe(first);
  });

  it('throws on a structurally valid store with a garbage record', () => {
    mkdirSync(join(home, '.webcmd'), { recursive: true });
    writeFileSync(
      join(home, '.webcmd', 'override-provenance.json'),
      JSON.stringify({ 'linkedin/search': 'not-a-record' }),
      'utf-8',
    );
    expect(() => readOverrideRecords(home)).toThrow(/malformed/i);
    expect(() => readOverrideRecords(home)).toThrow(/linkedin\/search/);
  });

  it('removes every record and base copy for a site', () => {
    const base = getBaseCopyPath('linkedin/search', home);
    mkdirSync(join(base, '..'), { recursive: true });
    writeFileSync(base, 'orig', 'utf-8');
    writeOverrideRecords({
      'linkedin/search': {
        plugin: 'linkedin', commitHash: null, sourcePath: 'plugins/linkedin/search.js',
        sourceSha256: 'c'.repeat(64), basePath: '.base/linkedin/search.js',
        createdAt: '2026-08-07T00:00:00.000Z',
      },
      'other/cmd': {
        plugin: 'other', commitHash: null, sourcePath: 'plugins/other/cmd.js',
        sourceSha256: 'd'.repeat(64), basePath: '.base/other/cmd.js',
        createdAt: '2026-08-07T00:00:00.000Z',
      },
    }, home);

    expect(removeOverrideRecords('linkedin', home)).toEqual(['linkedin/search']);
    expect(existsSync(base)).toBe(false);
    expect(Object.keys(readOverrideRecords(home))).toEqual(['other/cmd']);
  });
});
