/**
 * Resolve the relative-import closure of an adapter file.
 *
 * `webcmd adapter override` forks a single command file out of an installed
 * plugin. Most plugin commands are not single files: 510 of the 871 adapter
 * files shipped in this repo import a sibling helper (`./shared.js`,
 * `./_shared/protocol-capture.js`, ...). Copying the command alone produces
 * an override that throws `Cannot find module` on load, so command resolution
 * silently falls back to the plugin copy while `adapter status` still reports
 * the override as tracked — the user edits a file that never runs.
 *
 * This module walks the transitive relative-import graph so the fork can copy
 * everything the command actually needs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Relative specifiers in `import`/`export`/`require` position.
 *
 * Covers every form the adapter corpus and hand-written private adapters use:
 *   import x from './a.js'      export { x } from './a.js'
 *   import './a.js'             export * from './a.js'
 *   await import('./a.js')      require('./a.js')
 *
 * Comments are deliberately not stripped first. A commented-out import can
 * only ever make the closure copy one file too many — harmless, since the
 * copy is tracked and removed by `adapter reset`. Comment-stripping, by
 * contrast, can drop a *real* import when it trips over a string, which
 * silently reintroduces the broken override this module exists to prevent.
 */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\brequire\s*)\(?\s*(['"])(\.[^'"]*)\1/g;

/** Every relative specifier appearing in `source`, in order of appearance. */
function readRelativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
    const specifier = match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/** Path relative to `rootDir`, normalised to forward slashes for storage. */
function toPosixRelative(rootDir: string, target: string): string {
  return path.relative(rootDir, target).split(path.sep).join('/');
}

function escapesRoot(rootDir: string, target: string): boolean {
  const relative = path.relative(rootDir, target);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

/**
 * Every file `entryFile` imports transitively through relative specifiers,
 * as paths relative to `rootDir` and sorted for a stable provenance record.
 * `entryFile` itself is not included.
 *
 * A specifier that resolves outside `rootDir` throws: the fork cannot be made
 * loadable by copying inside the plugin directory, and a half-copied override
 * is exactly the silent breakage this closure exists to prevent. A specifier
 * pointing at a file that does not exist is skipped — the plugin is already
 * broken in that case, and the override should fail the same way the plugin
 * does rather than blame the fork.
 */
export function collectRelativeImportClosure(entryFile: string, rootDir: string): string[] {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedEntry = path.resolve(entryFile);
  const closure = new Set<string>();
  const visited = new Set<string>([resolvedEntry]);
  const queue: string[] = [resolvedEntry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let source: string;
    try {
      source = fs.readFileSync(current, 'utf-8');
    } catch {
      continue;
    }

    for (const specifier of readRelativeSpecifiers(source)) {
      const target = path.resolve(path.dirname(current), specifier);
      if (escapesRoot(resolvedRoot, target)) {
        throw new Error(
          `${toPosixRelative(resolvedRoot, current) || path.basename(current)} imports "${specifier}", ` +
          `which resolves outside the plugin directory ${resolvedRoot}. ` +
          'An override can only copy files from inside the plugin, so this adapter cannot be forked as-is.',
        );
      }
      if (visited.has(target)) continue;
      visited.add(target);
      if (!fs.existsSync(target)) continue;
      closure.add(toPosixRelative(resolvedRoot, target));
      queue.push(target);
    }
  }

  return [...closure].sort();
}
