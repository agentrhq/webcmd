/**
 * Shared support for the site memory tests that drive real `git`.
 *
 * These tests run git subprocesses against a throwaway home directory. Two
 * things about that are hostile to Windows, and both surfaced as intermittent
 * CI failures rather than as anything the tests actually assert.
 */
import { rm } from 'node:fs/promises';

/**
 * Per-test budget for a file that drives real git.
 *
 * A single test here spawns a handful of git processes and commits through
 * them. That costs a second or two on an idle machine and several times more
 * under a parallel suite on Windows, where process creation is expensive — well
 * past vitest's 5s default, which then fails the test on the clock rather than
 * on its assertions. The slowest tests in these files already opted into this
 * same budget individually; applying it per file makes the whole class honest.
 *
 * This does not hide a hang: a test that never finishes still fails, at 20s.
 */
export const GIT_TEST_TIMEOUT_MS = 20_000;

/**
 * Drain a list of throwaway directories a test created, removing each one.
 *
 * On Windows a git child's handles on `.git` outlive its exit by a few
 * milliseconds, and a test that vitest aborts on timeout leaves one running
 * outright, so a plain recursive remove intermittently fails the suite during
 * cleanup with:
 *
 *     EBUSY: resource busy or locked, rmdir '…\.webcmd\sites'
 *
 * `rm` retries exactly that family of errors when asked to; it just does not by
 * default (`maxRetries` is 0). Retrying here keeps a slow or aborted test from
 * turning into a second, unrelated-looking failure.
 */
export async function removeTempDirs(dirs: string[]): Promise<void> {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  })));
}
