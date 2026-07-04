/**
 * E2E tests for login-required browser commands.
 * These commands REQUIRE authentication (cookie/session).
 * In CI (headless, no login), they should fail gracefully — NOT crash.
 *
 * These tests verify the error handling path, not the data extraction.
 */

import { describe, it } from 'vitest';
import { expectGracefulAuthFailure } from './browser-auth-helpers.js';

describe('login-required commands — graceful failure', () => {
  // ── twitter (requires login) ──
  it('twitter bookmarks fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'bookmarks', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('twitter timeline fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'timeline', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('twitter notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'notifications', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── pixiv (requires login) ──
  it('pixiv ranking fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'ranking', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv search fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'search', 'miku', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv user fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'user', '11', '-f', 'json']);
  }, 60_000);

  it('pixiv illusts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'illusts', '11', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv detail fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'detail', '123456', '-f', 'json']);
  }, 60_000);

  it('pixiv download fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'download', '123456', '--output', '/tmp/pixiv-e2e-test', '-f', 'json']);
  }, 60_000);

  // ── yollomi (requires login session) ──
  it('yollomi generate fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'generate', 'a cute cat', '--no-download', '-f', 'json']);
  }, 60_000);

  it('yollomi video fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'video', 'a sunset over the ocean', '--no-download', '-f', 'json']);
  }, 60_000);
});
