import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProgram } from './cli.js';

describe('webcmd plugin create', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('writes author name and GitHub handle supplied as flags', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-create-'));
    fs.rmSync(dir, { recursive: true, force: true });
    createdDirs.push(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram('', '');
    program.exitOverride();
    await program.parseAsync([
      'node',
      'webcmd',
      'plugin',
      'create',
      'weather',
      '--dir',
      dir,
      '--author-name',
      'Rishabh',
      '--author-handle',
      'rishabhraj36',
    ]);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'webcmd-plugin.json'), 'utf-8'));
    expect(manifest.author).toEqual({ name: 'Rishabh', handle: 'rishabhraj36' });
  });
});
