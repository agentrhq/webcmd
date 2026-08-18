import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';
import '../post-comments.js';

const {
  canonicalizePostUrl,
  canonicalizeProfileUrl,
  parseOptionalLimit,
  buildCommentRoundScript,
  normalizeCommentRows,
} = await import('../post-comments.js').then((module) => module.__test__);

const rawComment = (id, handle, name, comment, overrides = {}) => ({
  rawId: `comment-${id}`,
  rawName: name,
  rawHeadline: `${name} headline`,
  rawProfileUrl: `https://www.linkedin.com/in/${handle}/`,
  rawComment: comment,
  rawCommentedAt: '1d',
  ...overrides,
});

const round = (rows, overrides = {}) => ({
  rows,
  authRequired: false,
  commentNodeCount: rows.length,
  expectedCommentCount: rows.length,
  replyControlsClicked: 0,
  atEnd: true,
  url: 'https://www.linkedin.com/posts/source/',
  ...overrides,
});

function makePage(rounds, { authProbe = false, gotoError, evaluateError } = {}) {
  const queue = [authProbe, ...rounds];
  return {
    goto: vi.fn().mockImplementation(async () => {
      if (gotoError) throw gotoError;
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async () => {
      if (evaluateError) throw evaluateError;
      return queue.length > 1 ? queue.shift() : queue[0];
    }),
  };
}

describe('linkedin post-comments', () => {
  it('registers a read-only positional command with the exact row contract', () => {
    const command = getRegistry().get('linkedin/post-comments');
    expect(command).toMatchObject({
      access: 'read',
      browser: true,
      strategy: 'cookie',
      columns: [
        'rank',
        'name',
        'headline',
        'profile_url',
        'comment_count',
        'sample_comment',
        'commented_at',
        'source_post',
      ],
    });
    expect(command.args.find((arg) => arg.name === 'post-url')).toMatchObject({
      positional: true,
      required: true,
    });
    expect(command.args.find((arg) => arg.name === 'limit').default).toBeUndefined();
  });

  it('canonicalizes only exact HTTPS LinkedIn post URLs', () => {
    expect(canonicalizePostUrl('https://linkedin.com/feed/update/urn:li:activity:7489324344997867521/?x=1'))
      .toBe('https://www.linkedin.com/feed/update/urn:li:activity:7489324344997867521/');
    expect(canonicalizePostUrl('https://www.linkedin.com/posts/example_activity-123-abcd'))
      .toBe('https://www.linkedin.com/posts/example_activity-123-abcd/');
    for (const value of [
      'https://evil-linkedin.com/posts/x',
      'http://linkedin.com/posts/x',
      'https://linkedin.com/in/person/',
      'https://user:pass@linkedin.com/posts/x',
    ]) {
      expect(() => canonicalizePostUrl(value)).toThrow(ArgumentError);
    }
  });

  it('keeps limit optional and rejects non-positive integers', () => {
    expect(parseOptionalLimit(undefined)).toBeNull();
    expect(parseOptionalLimit('')).toBeNull();
    expect(parseOptionalLimit(3)).toBe(3);
    for (const value of [0, -1, 1.5, 'x']) {
      expect(() => parseOptionalLimit(value)).toThrow(ArgumentError);
    }
  });

  it('extracts top-level and reply authors without promoting mentioned profiles', () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, '../__fixtures__/post-comments.html'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
    });
    const workspace = dom.window.document.querySelector('#workspace');
    Object.defineProperties(workspace, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 500 },
      scrollTop: { value: 0, writable: true },
    });
    const payload = dom.window.eval(buildCommentRoundScript());

    expect(payload.rows).toEqual([
      {
        rawId: 'replaceableComment_urn:li:comment:(urn:li:activity:1,101)',
        rawName: 'Alice Example',
        rawHeadline: 'CTO at Acme',
        rawProfileUrl: 'https://www.linkedin.com/in/alice-example/',
        rawComment: 'Top-level comment',
        rawCommentedAt: '2d',
      },
      {
        rawId: 'replaceableComment_urn:li:comment:(urn:li:activity:1,102)',
        rawName: 'Bob Builder',
        rawHeadline: 'Founder at BuildCo',
        rawProfileUrl: 'https://www.linkedin.com/in/bob-builder/',
        rawComment: 'Mentioned Person Reply comment',
        rawCommentedAt: '1d',
      },
      {
        rawId: 'replaceableComment_urn:li:comment:(urn:li:activity:1,103)',
        rawName: 'Example Org',
        rawHeadline: '5,000 followers',
        rawProfileUrl: 'https://www.linkedin.com/company/example-org/posts/',
        rawComment: 'Mentioned Person Organization comment',
        rawCommentedAt: '3d',
      },
    ]);
    expect(payload.replyControlsClicked).toBe(1);
    expect(payload.expectedCommentCount).toBe(3);
    expect(payload.atEnd).toBe(true);
  });

  it('deduplicates canonical profiles and counts distinct comments', () => {
    const rows = normalizeCommentRows([
      rawComment(1, 'alice', 'Alice', 'First', {
        rawProfileUrl: 'https://linkedin.com/in/alice/?x=1',
        rawCommentedAt: '2d',
      }),
      rawComment(2, 'alice', 'Alice', 'Second'),
    ], 'https://www.linkedin.com/posts/source/');

    expect(rows).toEqual([{
      rank: 1,
      name: 'Alice',
      headline: 'Alice headline',
      profile_url: 'https://www.linkedin.com/in/alice/',
      comment_count: 2,
      sample_comment: 'First',
      commented_at: '2d',
      source_post: 'https://www.linkedin.com/posts/source/',
    }]);
  });

  it('canonicalizes LinkedIn locale-suffixed person profiles', () => {
    expect(canonicalizeProfileUrl('https://www.linkedin.com/in/brad-choi/en/'))
      .toBe('https://www.linkedin.com/in/brad-choi/');
  });

  it('counts but excludes organization commenters from the people result', () => {
    const rows = normalizeCommentRows([
      rawComment(1, 'alice', 'Alice', 'First'),
      rawComment(2, 'ignored', 'Example Org', 'Company comment', {
        rawProfileUrl: 'https://www.linkedin.com/company/example-org/posts/',
      }),
    ], 'https://www.linkedin.com/posts/source/');

    expect(rows.map((row) => row.profile_url)).toEqual([
      'https://www.linkedin.com/in/alice/',
    ]);
  });

  it('rejects rendered comments without a stable identity', () => {
    expect(() => normalizeCommentRows([
      rawComment(1, 'alice', '', 'Missing name', { rawProfileUrl: '' }),
    ], 'https://www.linkedin.com/posts/source/')).toThrow(CommandExecutionError);
    expect(() => normalizeCommentRows({}, 'https://www.linkedin.com/posts/source/'))
      .toThrow(CommandExecutionError);
  });

  it('continues without a limit until two exhausted rounds are stable', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const alice = rawComment(1, 'alice', 'Alice', 'First');
    const bob = rawComment(2, 'bob', 'Bob', 'Reply');
    const page = makePage([
      round([alice], { replyControlsClicked: 1, atEnd: false }),
      round([alice, bob]),
      round([alice, bob]),
      round([alice, bob]),
    ]);

    const rows = await command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' });

    expect(rows.map((row) => row.profile_url)).toEqual([
      'https://www.linkedin.com/in/alice/',
      'https://www.linkedin.com/in/bob/',
    ]);
    expect(page.evaluate).toHaveBeenCalledTimes(5);
  });

  it('does not report a partial result while the advertised comment count is higher', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const alice = rawComment(1, 'alice', 'Alice', 'First');
    const bob = rawComment(2, 'bob', 'Bob', 'Second');
    const carol = rawComment(3, 'carol', 'Carol', 'Third');
    const page = makePage([
      round([alice, bob], { expectedCommentCount: 3 }),
      round([alice, bob], { expectedCommentCount: 3 }),
      round([alice, bob], { expectedCommentCount: 3 }),
      round([alice, bob, carol], { expectedCommentCount: 3 }),
      round([alice, bob, carol], { expectedCommentCount: 3 }),
      round([alice, bob, carol], { expectedCommentCount: 3 }),
    ]);

    const rows = await command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' });

    expect(rows.map((row) => row.profile_url)).toEqual([
      'https://www.linkedin.com/in/alice/',
      'https://www.linkedin.com/in/bob/',
      'https://www.linkedin.com/in/carol/',
    ]);
  });

  it('returns visible people after a longer stable wait when the count includes an unavailable comment', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const alice = rawComment(1, 'alice', 'Alice', 'First');
    const bob = rawComment(2, 'bob', 'Bob', 'Second');
    const page = makePage([round([alice, bob], { expectedCommentCount: 3 })]);

    const rows = await command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' });

    expect(rows).toHaveLength(2);
    expect(page.evaluate).toHaveBeenCalledTimes(12);
  });

  it('stops as soon as the optional unique-profile limit is reached', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const page = makePage([round([
      rawComment(1, 'alice', 'Alice', 'First'),
      rawComment(2, 'bob', 'Bob', 'Second'),
    ], { replyControlsClicked: 1, atEnd: false })]);

    const rows = await command.func(page, {
      'post-url': 'https://www.linkedin.com/posts/source/',
      limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].profile_url).toBe('https://www.linkedin.com/in/alice/');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('maps authentication walls to AuthRequiredError', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const page = makePage([round([], { authRequired: true })]);
    await expect(command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('returns EmptyResultError only after a stable empty page', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const page = makePage([round([]), round([])]);
    await expect(command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
      .rejects.toBeInstanceOf(EmptyResultError);
  });

  it('fails closed for malformed extraction payloads', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    for (const payload of [null, {}, { rows: {}, replyControlsClicked: 0, atEnd: true }]) {
      const page = makePage([payload]);
      await expect(command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
        .rejects.toBeInstanceOf(CommandExecutionError);
    }
  });

  it('fails closed when LinkedIn lands on a different post', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const page = makePage([round([], { url: 'https://www.linkedin.com/posts/different/' })]);
    await expect(command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
      .rejects.toThrow('post URL mismatch');
  });

  it('requires a browser session', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    await expect(command.func(null, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('fails instead of looping forever when the page never exhausts', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    const page = makePage([round([
      rawComment(1, 'alice', 'Alice', 'First'),
    ], { atEnd: false })]);
    await expect(command.func(page, { 'post-url': 'https://www.linkedin.com/posts/source/' }))
      .rejects.toThrow('did not reach a stable end after 200 rounds');
  });

  it('wraps navigation and extraction failures as CommandExecutionError', async () => {
    const command = getRegistry().get('linkedin/post-comments');
    await expect(command.func(
      makePage([], { gotoError: new Error('navigation failed') }),
      { 'post-url': 'https://www.linkedin.com/posts/source/' },
    )).rejects.toBeInstanceOf(CommandExecutionError);
    await expect(command.func(
      makePage([], { evaluateError: new Error('evaluate failed') }),
      { 'post-url': 'https://www.linkedin.com/posts/source/' },
    )).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
