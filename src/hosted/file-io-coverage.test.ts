import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

function sourceOf(file: string): string {
  return readFileSync(path.join(here, file), 'utf8');
}

describe('hosted dispatch filesystem coverage', () => {
  it('runner.ts performs no direct user-file reads or writes', () => {
    const source = sourceOf('runner.ts');
    // The one permitted read is the package's own committed hosted contract.
    const reads = [...source.matchAll(/readFileSync\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(reads.filter((arg) => !arg.includes('hosted-contract.json'))).toEqual([]);
    expect(source).not.toMatch(/\bwriteFileSync\(/);
    expect(source).not.toMatch(/\bmkdirSync\(/);
  });

  it('files.ts imports no filesystem module directly', () => {
    const source = sourceOf('files.ts');
    expect(source).not.toMatch(/from 'node:fs'/);
    expect(source).not.toMatch(/from 'node:fs\/promises'/);
  });
});
