import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function productionTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(target);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [target] : [];
  });
}

describe('local SLAB dependency boundary', () => {
  it('has no production imports of the retired cloakbrowser runtime', () => {
    const retiredImports = productionTypeScriptFiles(SOURCE_ROOT)
      .filter(file => /(?:from|import)\s*\(?\s*['"]cloakbrowser['"]|import\.meta\.resolve\(\s*['"]cloakbrowser['"]/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(SOURCE_ROOT, file));

    expect(retiredImports).toEqual([]);
  });

  it('has no production routing through local-cloak', () => {
    const staleRoutes = productionTypeScriptFiles(SOURCE_ROOT)
      .filter(file => fs.readFileSync(file, 'utf8').includes('runtime/local-cloak'))
      .map(file => path.relative(SOURCE_ROOT, file));

    expect(staleRoutes).toEqual([]);
  });

  it('keeps npm and Bun lockfiles free of the retired dependency', () => {
    for (const lockfile of ['package-lock.json', 'bun.lock']) {
      expect(fs.readFileSync(path.join(REPOSITORY_ROOT, lockfile), 'utf8')).not.toContain('cloakbrowser');
    }
  });
});
