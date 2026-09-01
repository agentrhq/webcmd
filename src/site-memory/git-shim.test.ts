import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { installGitShim } from './git-shim.js';

const run = promisify(execFile);
const tempDirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('installGitShim', () => {
  it('installs a platform git wrapper and prepends PATH with path.delimiter', async () => {
    const { dir, restore } = await installGitShim((realGit) => `
if (process.argv.includes('--shim-probe')) {
  process.stdout.write(${JSON.stringify(realGit)});
  process.exit(0);
}
process.exit(1);
`);
    tempDirs.push(dir);

    expect(process.env.PATH?.split(delimiter)[0]).toBe(dir);

    if (process.platform === 'win32') {
      const cmd = await readFile(join(dir, 'git.cmd'), 'utf8');
      expect(cmd).toContain(process.execPath);
      expect(cmd).toMatch(/%\*/);
      await access(join(dir, 'git.cjs'));
    } else {
      const body = await readFile(join(dir, 'git'), 'utf8');
      expect(body.startsWith('#!/usr/bin/env node')).toBe(true);
      await access(join(dir, 'git'), constants.X_OK);
    }

    const { stdout } = await run('git', ['--shim-probe'], { encoding: 'utf8' });
    expect(stdout.length).toBeGreaterThan(0);
    await access(stdout);

    restore();
    expect(process.env.PATH).toBe(originalPath);
  });
});
