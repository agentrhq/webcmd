import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('runtime copy', () => {
  it('does not keep legacy browser runtime setup copy in runtime source', () => {
    const files = [
      'src/browser/errors.ts',
      'src/browser/daemon-lifecycle.ts',
      'src/commands/daemon.ts',
      'src/cli.ts',
      'README.md',
    ];
    const phrase = (...parts: string[]) => parts.join('');
    const forbiddenUserFacingCopy = [
      phrase('Browser ', 'Bridge'),
      phrase('chrome://', 'extensions'),
      phrase('Load ', 'unpacked'),
      phrase('extension', 'Connected'),
      phrase('extension', 'Version'),
      phrase('extension', 'CompatRange'),
    ];
    const offenders = files.flatMap((file) => {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      const matches = forbiddenUserFacingCopy.filter((phrase) => text.includes(phrase));
      return matches.length > 0 ? [{ file, matches }] : [];
    });
    expect(offenders).toEqual([]);
  });
});
