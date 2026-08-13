import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAdapterOverride } from './adapter-override.js';
import { getBaseCopyPath, readOverrideRecords, fileSha256 } from './override-provenance.js';
import type { LockEntry } from './plugin.js';
import { createProgram } from './cli.js';

let home: string;
let pluginFile: string;

// Seeds the temp home's own lock file — never the real ~/.webcmd/plugins.lock.json,
// so these tests don't depend on (or corrupt) whatever plugins are actually
// installed on the machine running them.
function seedLock(entries: Record<string, LockEntry>): void {
  const lockPath = path.join(home, '.webcmd', 'plugins.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(entries, null, 2));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  pluginFile = path.join(home, '.webcmd', 'plugins', 'linkedin', 'search.js');
  fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
  fs.writeFileSync(pluginFile, '// linkedin search plugin\nmodule.exports = {};\n');
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('createAdapterOverride', () => {
  it('copies the plugin command into clis and records provenance', () => {
    seedLock({
      linkedin: {
        source: { kind: 'local', path: path.resolve(home) },
        commitHash: 'a'.repeat(40),
        installedAt: new Date().toISOString(),
      },
    });

    const result = createAdapterOverride('linkedin/search', { homeDir: home });

    expect(fs.readFileSync(result.overridePath, 'utf-8')).toBe(fs.readFileSync(pluginFile, 'utf-8'));
    expect(fs.readFileSync(result.basePath, 'utf-8')).toBe(fs.readFileSync(pluginFile, 'utf-8'));
    const record = readOverrideRecords(home)['linkedin/search']!;
    expect(record).toMatchObject({ plugin: 'linkedin', commitHash: 'a'.repeat(40) });
    expect(record.sourceSha256).toBe(fileSha256(pluginFile));
  });

  it('refuses a command that comes from no installed plugin', () => {
    expect(() => createAdapterOverride('nosuch/cmd', { homeDir: home }))
      .toThrow(/not provided by an installed plugin/i);
  });

  it('refuses when a clis copy already exists', () => {
    createAdapterOverride('linkedin/search', { homeDir: home });
    expect(() => createAdapterOverride('linkedin/search', { homeDir: home }))
      .toThrow(/already/i);
  });

  it('records commitHash null when the plugin has no lock entry', () => {
    // Deliberately no seedLock() call: this temp home's lock file does not
    // exist at all, regardless of what's in the real ~/.webcmd/plugins.lock.json.
    createAdapterOverride('linkedin/search', { homeDir: home });
    const record = readOverrideRecords(home)['linkedin/search']!;
    expect(record.commitHash).toBeNull();
    expect(record.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('adapter reset removes the clis copy, the provenance record, and the base copy', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    try {
      seedLock({
        linkedin: {
          source: { kind: 'local', path: path.resolve(home) },
          commitHash: 'a'.repeat(40),
          installedAt: new Date().toISOString(),
        },
      });
      createAdapterOverride('linkedin/search', { homeDir: home });

      await createProgram('', path.join(home, '.webcmd', 'clis'))
        .parseAsync(['node', 'webcmd', 'adapter', 'reset', 'linkedin']);

      expect(fs.existsSync(path.join(home, '.webcmd', 'clis', 'linkedin'))).toBe(false);
      expect(fs.existsSync(getBaseCopyPath('linkedin/search', home))).toBe(false);
      expect(readOverrideRecords(home)).toEqual({});
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
