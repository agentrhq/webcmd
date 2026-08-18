/**
 * Regression tests for package exports.
 *
 * Ensures no adapter tree sneaks back into the published package and that all
 * declared exports resolve to real files.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, buildManifestArtifacts } from './build-manifest.js';
import { getRegistry } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLIS_DIR = path.join(ROOT, 'clis');
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

/** Recursively collect all JS adapter files in a directory. */
function collectAdapterFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectAdapterFiles(full));
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.d.js')) results.push(full);
  }
  return results;
}

describe('adapter packaging', () => {
  // The `web` site used to live in clis/web. It is core TypeScript under
  // src/fetch now, so import hygiene is enforced by tsc rather than by scanning
  // adapter sources — but the packaging boundary below still needs asserting.
  it('ships no bundled adapter tree', () => {
    expect(collectAdapterFiles(CLIS_DIR)).toEqual([]);
  });

  it('excludes adapters from package files and the install lifecycle', () => {
    const files = pkgJson.files as string[];

    expect(files.some(file => /^(?:clis|plugins)(?:\/|$)/.test(file))).toBe(false);
    expect(pkgJson.scripts.postinstall).not.toMatch(/fetch-adapters/);
  });

  // packageExport supports package discovery and import verification for
  // core-owned commands; it does not make them Cloud-executable.
  it('every manifest entry is resolvable: a clis/ path or a real package export', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli-manifest.json'), 'utf-8')) as Array<Record<string, string>>;
    const exports = pkgJson.exports as Record<string, string>;

    expect(manifest.length).toBeGreaterThan(0);
    for (const entry of manifest) {
      const command = `${entry.site}/${entry.name}`;
      if (entry.modulePath) continue;
      expect(entry.packageExport, `${command} has neither modulePath nor packageExport`).toBeTruthy();
      expect(exports[entry.packageExport!], `${command} declares a packageExport missing from package.json exports`).toBeTruthy();
      const source = exports[entry.packageExport!]!.replace(/^\.\/dist\//, './').replace(/\.js$/, '.ts');
      expect(fs.existsSync(path.join(ROOT, source)), `${command} export has no source file`).toBe(true);
    }
  });

  it('maps web/fetch to its source and built package export', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli-manifest.json'), 'utf-8')) as Array<Record<string, string>>;
    const command = manifest.find(entry => entry.site === 'web' && entry.name === 'fetch');

    expect(command).toMatchObject({ packageExport: './fetch/command' });
    expect(fs.existsSync(path.join(ROOT, 'src/fetch/command.ts'))).toBe(true);
    expect((pkgJson.exports as Record<string, string>)['./fetch/command'])
      .toBe('./dist/src/fetch/command.js');
  });

  it('generates only web/fetch and its command package export', async () => {
    const { entries } = await buildManifest();
    const webCommands = entries
      .filter(entry => entry.site === 'web')
      .map(entry => `${entry.site}/${entry.name}`);
    const registeredWebCommands = [...getRegistry().values()]
      .filter(command => command.site === 'web')
      .map(command => `${command.site}/${command.name}`)
      .sort();
    const fetchExports = Object.keys(pkgJson.exports as Record<string, string>)
      .filter(exportPath => exportPath.startsWith('./fetch/'));

    expect(webCommands).toEqual(['web/fetch']);
    expect(registeredWebCommands).toEqual(['web/fetch']);
    expect(fetchExports).toEqual(['./fetch/command']);
  });

  it('publishes only client-owned web/fetch in generated artifacts', async () => {
    const { entries } = await buildManifest();
    const artifacts = buildManifestArtifacts(entries, String(pkgJson.version), []);
    const manifest = JSON.parse(artifacts.manifestJson) as Array<Record<string, unknown>>;
    const contract = JSON.parse(artifacts.hostedContractJson) as {
      commands: Array<Record<string, unknown>>;
    };
    const manifestEntries = manifest.filter(entry => entry.site === 'web');
    const contractEntries = contract.commands.filter(entry => entry.site === 'web');

    expect(manifestEntries).toEqual([expect.objectContaining({
      name: 'fetch', clientOwned: true, packageExport: './fetch/command',
    })]);
    expect(manifestEntries[0]).not.toHaveProperty('modulePath');
    expect(manifestEntries[0]).not.toHaveProperty('sourceFile');
    expect(contractEntries).toEqual([expect.objectContaining({
      name: 'fetch',
      sessionPolicy: 'local-only',
      availability: { mode: 'local-only', reason: 'client-owned' },
    })]);
  });
});

describe('package.json exports resolve to real files', () => {
  const exports = pkgJson.exports as Record<string, string>;

  it('has exports defined', () => {
    expect(Object.keys(exports).length).toBeGreaterThan(5);
  });

  for (const [exportPath, target] of Object.entries(exports)) {
    it(`export "${exportPath}" → ${target} has a source file`, () => {
      // Export targets point to dist/ (compiled). Verify the source .ts exists.
      // dist/src/foo.js → src/foo.ts
      const sourcePath = target
        .replace(/^\.\/dist\//, './')
        .replace(/\.js$/, '.ts');
      const fullPath = path.join(ROOT, sourcePath);
      expect(fs.existsSync(fullPath), `Missing source: ${sourcePath}`).toBe(true);
    });
  }
});
