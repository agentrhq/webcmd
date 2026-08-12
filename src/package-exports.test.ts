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

  // webcmd-cloud resolves core-owned commands through `packageExport` rather
  // than a clis/ path. A rename that broke this would only surface as a hosted
  // runtime failure after publish, so assert the contract here.
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
