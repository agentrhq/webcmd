import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DOC_ROOTS = ['README.md', 'docs', 'skills'];

describe('Session documentation sync', () => {
  it('does not call adapter siteSession modes browser Sessions', () => {
    const offenders = walkDocs()
      .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
      .filter(({ text }) => /persistent sessions/i.test(text));

    expect(offenders.map(({ file }) => path.relative(ROOT, file))).toEqual([]);
  });

  it('keeps removed Session syntaxes out of docs and skills', () => {
    const offenders = walkDocs()
      .flatMap((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return [
          [/\bwebcmd browser <session/i, 'positional browser session'],
          [/\bwebcmd browser [A-Za-z0-9_-]+ (?:run|tabs|snapshot|state)\b/i, 'positional browser command'],
          [/\bbrowser --session\b/i, 'browser-local session selector'],
          [/\btruncated (?:session )?ids?\b/i, 'truncated session ids'],
        ].filter(([pattern]) => (pattern as RegExp).test(text))
          .map(([, label]) => `${path.relative(ROOT, file)}: ${label}`);
      });

    expect(offenders).toEqual([]);
  });
});

function walkDocs(): string[] {
  const files: string[] = [];
  for (const root of DOC_ROOTS) {
    const absolute = path.join(ROOT, root);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) files.push(absolute);
    else collect(absolute, files);
  }
  return files.filter((file) => !file.includes(`${path.sep}docs${path.sep}superpowers${path.sep}`));
}

function collect(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(absolute, files);
    else if (/\.(md|mdx)$/u.test(entry.name)) files.push(absolute);
  }
}
