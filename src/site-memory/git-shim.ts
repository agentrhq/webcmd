import { execFile } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function resolveRealGit(): Promise<string> {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const { stdout } = await run(command, ['git'], { encoding: 'utf8' });
  const git = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!git) throw new Error('git not found');
  return git;
}

export async function installGitShim(source: (realGit: string) => string): Promise<{
  dir: string;
  restore: () => void;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-git-shim-'));
  const body = source(await resolveRealGit());
  if (process.platform === 'win32') {
    await writeFile(join(dir, 'git.cjs'), body);
    await writeFile(join(dir, 'git.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0git.cjs" %*\r\n`);
  } else {
    await writeFile(join(dir, 'git'), `#!/usr/bin/env node\n${body}`);
    await chmod(join(dir, 'git'), 0o755);
  }
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${dir}${delimiter}${originalPath}`;
  return { dir, restore: () => { process.env.PATH = originalPath; } };
}
