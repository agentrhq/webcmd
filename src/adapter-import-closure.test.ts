import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectRelativeImportClosure } from './adapter-import-closure.js';

let root: string;

function write(relPath: string, source: string): string {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  return filePath;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('collectRelativeImportClosure', () => {
  it('returns nothing for an adapter with no relative imports', () => {
    const entry = write('search.js', "import { cli } from '@agentrhq/webcmd/registry';\n");
    expect(collectRelativeImportClosure(entry, root)).toEqual([]);
  });

  it('collects a sibling import', () => {
    const entry = write('search.js', "import { parseLimit } from './shared.js';\n");
    write('shared.js', 'export const parseLimit = () => 1;\n');
    expect(collectRelativeImportClosure(entry, root)).toEqual(['shared.js']);
  });

  it('follows the graph transitively', () => {
    const entry = write('timeline.js', "import { a } from './posts-core.js';\n");
    write('posts-core.js', "import { b } from './shared.js';\n");
    write('shared.js', "import { c } from './_utils.js';\n");
    write('_utils.js', 'export const c = 1;\n');
    expect(collectRelativeImportClosure(entry, root)).toEqual([
      '_utils.js', 'posts-core.js', 'shared.js',
    ]);
  });

  it('preserves nested directories in the returned paths', () => {
    const entry = write('publish.js', "import { p } from './_shared/private-publish.js';\n");
    write('_shared/private-publish.js', "import { r } from './runtime-info.js';\n");
    write('_shared/runtime-info.js', 'export const r = 1;\n');
    expect(collectRelativeImportClosure(entry, root)).toEqual([
      '_shared/private-publish.js', '_shared/runtime-info.js',
    ]);
  });

  it('terminates on an import cycle', () => {
    const entry = write('a.js', "import { b } from './b.js';\n");
    write('b.js', "import { a } from './a.js';\nexport const b = 1;\n");
    expect(collectRelativeImportClosure(entry, root)).toEqual(['b.js']);
  });

  it('recognises re-exports, side-effect imports, dynamic imports, require, and double quotes', () => {
    const entry = write('mixed.js', [
      "export { helper } from './reexport.js';",
      "export * from './star.js';",
      "import './side-effect.js';",
      "const late = await import('./dynamic.js');",
      "const legacy = require('./legacy.js');",
      'import { quoted } from "./double-quoted.js";',
    ].join('\n'));
    for (const name of ['reexport', 'star', 'side-effect', 'dynamic', 'legacy', 'double-quoted']) {
      write(`${name}.js`, 'export const x = 1;\n');
    }
    expect(collectRelativeImportClosure(entry, root)).toEqual([
      'double-quoted.js', 'dynamic.js', 'legacy.js', 'reexport.js', 'side-effect.js', 'star.js',
    ]);
  });

  it('ignores bare package specifiers', () => {
    const entry = write('search.js', [
      "import { cli } from '@agentrhq/webcmd/registry';",
      "import * as path from 'node:path';",
      "import { local } from './shared.js';",
    ].join('\n'));
    write('shared.js', 'export const local = 1;\n');
    expect(collectRelativeImportClosure(entry, root)).toEqual(['shared.js']);
  });

  it('skips a relative import whose target does not exist', () => {
    // The plugin itself is already broken here; the override should fail the
    // same way the plugin does rather than refuse to be created.
    const entry = write('search.js', "import { gone } from './missing.js';\n");
    expect(collectRelativeImportClosure(entry, root)).toEqual([]);
  });

  it('refuses a specifier that escapes the plugin directory', () => {
    const entry = write('plugin/search.js', "import { outside } from '../outside.js';\n");
    write('outside.js', 'export const outside = 1;\n');
    expect(() => collectRelativeImportClosure(entry, path.join(root, 'plugin')))
      .toThrow(/resolves outside the plugin directory/i);
  });

  it('refuses an escaping specifier reached transitively', () => {
    const entry = write('plugin/search.js', "import { s } from './shared.js';\n");
    write('plugin/shared.js', "import { outside } from '../../escape.js';\n");
    write('escape.js', 'export const outside = 1;\n');
    expect(() => collectRelativeImportClosure(entry, path.join(root, 'plugin')))
      .toThrow(/shared\.js imports "\.\.\/\.\.\/escape\.js"/);
  });
});
