import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAdapterOverride } from './adapter-override.js';
import {
  getBaseCopyPath,
  getBaseDependencyPath,
  readOverrideRecords,
  fileSha256,
  removeOverrideRecords,
} from './override-provenance.js';
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

describe('createAdapterOverride import closure', () => {
  const pluginDir = () => path.join(home, '.webcmd', 'plugins', 'linkedin');
  const clisDir = () => path.join(home, '.webcmd', 'clis', 'linkedin');

  function writePluginFile(relPath: string, source: string): string {
    const filePath = path.join(pluginDir(), relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
    return filePath;
  }

  it('copies a sibling import so the override can actually load', () => {
    // The bug: only search.js was copied, so the override threw
    // "Cannot find module .../clis/linkedin/shared.js" on load and command
    // resolution silently fell back to the plugin copy.
    fs.writeFileSync(pluginFile, "import { parseLimit } from './shared.js';\n");
    writePluginFile('shared.js', 'export const parseLimit = () => 1;\n');

    const result = createAdapterOverride('linkedin/search', { homeDir: home });

    const copied = path.join(clisDir(), 'shared.js');
    expect(fs.existsSync(copied)).toBe(true);
    expect(fs.readFileSync(copied, 'utf-8')).toBe('export const parseLimit = () => 1;\n');
    expect(result.dependencies).toEqual(['shared.js']);
  });

  it('copies the transitive closure, preserving nested directories', () => {
    fs.writeFileSync(pluginFile, "import { a } from './posts-core.js';\n");
    writePluginFile('posts-core.js', "import { b } from './_shared/util.js';\n");
    writePluginFile('_shared/util.js', 'export const b = 1;\n');

    const result = createAdapterOverride('linkedin/search', { homeDir: home });

    expect(result.dependencies).toEqual(['_shared/util.js', 'posts-core.js']);
    expect(fs.existsSync(path.join(clisDir(), 'posts-core.js'))).toBe(true);
    expect(fs.existsSync(path.join(clisDir(), '_shared', 'util.js'))).toBe(true);
  });

  it('keeps a fork-time base copy of every copied file', () => {
    fs.writeFileSync(pluginFile, "import { s } from './shared.js';\n");
    writePluginFile('shared.js', 'export const s = 1;\n');

    createAdapterOverride('linkedin/search', { homeDir: home });

    const baseCopy = getBaseDependencyPath('linkedin', 'shared.js', home);
    expect(fs.readFileSync(baseCopy, 'utf-8')).toBe('export const s = 1;\n');
  });

  it('records each copied file with the sha256 of the copy the override loads', () => {
    fs.writeFileSync(pluginFile, "import { s } from './shared.js';\n");
    const sharedPlugin = writePluginFile('shared.js', 'export const s = 1;\n');

    createAdapterOverride('linkedin/search', { homeDir: home });

    const record = readOverrideRecords(home)['linkedin/search']!;
    expect(record.dependencies).toEqual([
      { path: 'shared.js', sha256: fileSha256(sharedPlugin) },
    ]);
  });

  it('omits the dependencies key entirely for a single-file adapter', () => {
    createAdapterOverride('linkedin/search', { homeDir: home });
    expect(readOverrideRecords(home)['linkedin/search']!.dependencies).toBeUndefined();
  });

  it('removes the base copies of copied files when the override is dropped', () => {
    fs.writeFileSync(pluginFile, "import { s } from './shared.js';\n");
    writePluginFile('shared.js', 'export const s = 1;\n');
    createAdapterOverride('linkedin/search', { homeDir: home });
    const baseCopy = getBaseDependencyPath('linkedin', 'shared.js', home);
    expect(fs.existsSync(baseCopy)).toBe(true);

    removeOverrideRecords('linkedin', home);

    expect(fs.existsSync(baseCopy)).toBe(false);
  });

  it('never overwrites a copied file the user has already edited', () => {
    fs.writeFileSync(pluginFile, "import { s } from './shared.js';\n");
    writePluginFile('shared.js', 'export const s = 1;\n');
    writePluginFile('other.js', "import { s } from './shared.js';\n");

    createAdapterOverride('linkedin/search', { homeDir: home });
    const copied = path.join(clisDir(), 'shared.js');
    fs.writeFileSync(copied, 'export const s = 42; // my fix\n');

    createAdapterOverride('linkedin/other', { homeDir: home });

    expect(fs.readFileSync(copied, 'utf-8')).toBe('export const s = 42; // my fix\n');
  });

  it('adopts a file an earlier fork copied instead of refusing as "already exists"', () => {
    // linkedin/salesnav-thread imports ./salesnav-inbox.js, which is itself a
    // command: forking the first puts the second command's file in clis/, and
    // overriding it must not be blocked by webcmd's own copy.
    fs.writeFileSync(pluginFile, "import { list } from './inbox.js';\n");
    writePluginFile('inbox.js', 'export const list = () => [];\n');
    createAdapterOverride('linkedin/search', { homeDir: home });

    const result = createAdapterOverride('linkedin/inbox', { homeDir: home });

    expect(result.overridePath).toBe(path.join(clisDir(), 'inbox.js'));
    const record = readOverrideRecords(home)['linkedin/inbox']!;
    expect(record.plugin).toBe('linkedin');
    expect(fs.existsSync(getBaseCopyPath('linkedin/inbox', home))).toBe(true);
  });

  it('adopting an existing copy does not discard edits already made to it', () => {
    fs.writeFileSync(pluginFile, "import { list } from './inbox.js';\n");
    writePluginFile('inbox.js', 'export const list = () => [];\n');
    createAdapterOverride('linkedin/search', { homeDir: home });
    const copied = path.join(clisDir(), 'inbox.js');
    fs.writeFileSync(copied, 'export const list = () => [1]; // mine\n');

    createAdapterOverride('linkedin/inbox', { homeDir: home });

    expect(fs.readFileSync(copied, 'utf-8')).toBe('export const list = () => [1]; // mine\n');
  });

  it('still refuses a second override of the same command', () => {
    fs.writeFileSync(pluginFile, "import { s } from './shared.js';\n");
    writePluginFile('shared.js', 'export const s = 1;\n');
    createAdapterOverride('linkedin/search', { homeDir: home });

    expect(() => createAdapterOverride('linkedin/search', { homeDir: home }))
      .toThrow(/already/i);
  });

  it('writes nothing when an import cannot be copied from inside the plugin', () => {
    fs.writeFileSync(pluginFile, "import { x } from '../outside.js';\n");
    fs.writeFileSync(path.join(home, '.webcmd', 'plugins', 'outside.js'), 'export const x = 1;\n');

    expect(() => createAdapterOverride('linkedin/search', { homeDir: home }))
      .toThrow(/resolves outside the plugin directory/i);

    expect(fs.existsSync(path.join(clisDir(), 'search.js'))).toBe(false);
    expect(fs.existsSync(getBaseCopyPath('linkedin/search', home))).toBe(false);
    expect(readOverrideRecords(home)['linkedin/search']).toBeUndefined();
  });
});
