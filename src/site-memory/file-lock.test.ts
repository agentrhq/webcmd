import { spawnSync } from 'node:child_process';
import { mkdtemp, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockPathFor, withFileLock } from './file-lock.js';

const tempDirs: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('site memory file lock', () => {
  it('runs overlapping critical sections one at a time', async () => {
    const target = await tempTarget();
    let inside = 0;
    let overlapped = false;

    await Promise.all([1, 2, 3, 4].map(() => withFileLock(target, async () => {
      inside += 1;
      if (inside > 1) overlapped = true;
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      inside -= 1;
    })));

    expect(overlapped).toBe(false);
    await expect(exists(lockPathFor(target))).resolves.toBe(false);
  });

  it('does not break a live holder\'s lock even when its critical section outlives staleMs', async () => {
    const target = await tempTarget();
    const staleMs = 40;
    let inside = 0;
    let overlapped = false;

    async function worker(holdMs: number) {
      await withFileLock(target, async () => {
        inside += 1;
        if (inside > 1) overlapped = true;
        await new Promise((resolve) => { setTimeout(resolve, holdMs); });
        inside -= 1;
      }, { staleMs, timeoutMs: 5_000 });
    }

    // Worker A's critical section (150ms) runs well past staleMs (40ms).
    // Without a heartbeat refreshing the lock's mtime, worker B would see
    // the lock as abandoned and break it out from under A.
    const a = worker(150);
    await new Promise((resolve) => { setTimeout(resolve, 80); });
    const b = worker(20);
    await Promise.all([a, b]);

    expect(overlapped).toBe(false);
    await expect(exists(lockPathFor(target))).resolves.toBe(false);
  });

  it('retries a transient Windows EPERM when creating the lock', async () => {
    const target = await tempTarget();
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error('transient Windows lock'), { code: 'EPERM' }),
    );
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    await expect(withFileLock(target, async () => 'written')).resolves.toBe('written');
    await expect(exists(lockPathFor(target))).resolves.toBe(false);
  });

  it('releases the lock when the critical section throws', async () => {
    const target = await tempTarget();

    await expect(withFileLock(target, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    await expect(exists(lockPathFor(target))).resolves.toBe(false);
  });

  it('breaks a lock left behind by a process that is gone', async () => {
    const target = await tempTarget();
    await writeFile(lockPathFor(target), `${JSON.stringify({ pid: deadPid(), host: hostname(), token: 'stale' })}\n`);

    await expect(withFileLock(target, async () => 'written', { staleMs: 60_000, timeoutMs: 1_000 }))
      .resolves.toBe('written');
  });

  it('breaks a lock older than the stale window even when the owner is unknown', async () => {
    const target = await tempTarget();
    const lockPath = lockPathFor(target);
    await writeFile(lockPath, 'not json\n');
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    await expect(withFileLock(target, async () => 'written', { staleMs: 10_000, timeoutMs: 1_000 }))
      .resolves.toBe('written');
  });

  it('reports a live holder as SITE_MEMORY_BUSY instead of writing anyway', async () => {
    const target = await tempTarget();
    await writeFile(lockPathFor(target), `${JSON.stringify({ pid: process.pid, host: hostname(), token: 'held' })}\n`);
    let ran = false;

    await expect(withFileLock(target, async () => { ran = true; }, { staleMs: 60_000, timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'SITE_MEMORY_BUSY', exitCode: 75 });

    expect(ran).toBe(false);
    await expect(readFile(lockPathFor(target), 'utf8')).resolves.toContain('held');
  });

  it('does not delete a lock that was broken and taken over by someone else', async () => {
    const target = await tempTarget();
    const lockPath = lockPathFor(target);

    await withFileLock(target, async () => {
      await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, host: hostname(), token: 'other' })}\n`);
    });

    await expect(readFile(lockPath, 'utf8')).resolves.toContain('other');
  });
});

async function tempTarget() {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-file-lock-'));
  tempDirs.push(dir);
  return join(dir, 'notes.md');
}

/** A pid that has certainly exited: spawnSync reaps the child before returning. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (typeof child.pid !== 'number') throw new Error('could not spawn a child to retire');
  return child.pid;
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}
