import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  generateOpenAIReview,
  loadDocumentation,
  loadPullRequestContext,
  runDocsSyncReview,
  upsertReviewComment,
  type RunDependencies,
} from '../scripts/docs-sync-review.js';
import {
  MAX_DIFF_CHARACTERS,
  REVIEW_COMMENT_MARKER,
  type PullRequestReviewContext,
} from './docs-sync-review.js';

function context(overrides: Partial<PullRequestReviewContext> = {}): PullRequestReviewContext {
  return {
    number: 72,
    title: 'Add profile option',
    body: null,
    draft: false,
    headSha: 'abc123',
    labels: [],
    files: [{
      path: 'src/cli.ts',
      status: 'modified',
      patch: '+  .option("--profile <name>")',
    }],
    ...overrides,
  };
}

function createIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      writeStdout(chunk: string) { stdout += chunk; },
      writeStderr(chunk: string) { stderr += chunk; },
    },
    read: () => ({ stdout, stderr }),
  };
}

function baseDependencies(pr = context()) {
  return {
    loadContext: vi.fn(async () => pr),
    loadDocumentation: vi.fn(() => [{ path: 'docs/cli-reference.mdx', content: 'CLI reference' }]),
    generateReview: vi.fn(async (_prompt: string, _model: string, _apiKey: string) => ({
      verdict: 'likely_missing',
      summary: 'The profile option is undocumented.',
      findings: [{
        surface: 'docs',
        behaviorChange: 'The CLI accepts a profile name.',
        changedPath: 'src/cli.ts',
        evidence: '.option("--profile <name>")',
        suggestedPath: 'docs/cli-reference.mdx',
        reason: 'The supplied reference omits the option.',
      }],
    })),
    upsertComment: vi.fn(async (
      _repository: string,
      _number: number,
      _token: string,
      _body: string,
    ) => undefined),
    writeSummary: vi.fn(),
  } satisfies RunDependencies;
}

const ENV = {
  GITHUB_REPOSITORY: 'acme/webcmd',
  GH_TOKEN: 'github-token',
  OPENAI_API_KEY: 'openai-key',
  GITHUB_STEP_SUMMARY: '/tmp/summary.md',
};

describe('runDocsSyncReview', () => {
  it('returns usage error when the pull request number is missing', async () => {
    const { io, read } = createIo();

    const exitCode = await runDocsSyncReview(['node', 'script'], {}, {}, io);

    expect(exitCode).toBe(1);
    expect(read().stderr).toContain('Usage: docs-sync-review <pull-request-number>');
  });

  it('defers draft pull requests without loading docs or calling Gemini', async () => {
    const deps = baseDependencies(context({ draft: true }));

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    expect(deps.loadDocumentation).not.toHaveBeenCalled();
    expect(deps.generateReview).not.toHaveBeenCalled();
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('deferred until this draft'),
    );
  });

  it('honors docs-not-needed before calling Gemini', async () => {
    const deps = baseDependencies(context({ labels: ['docs-not-needed'] }));

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    expect(deps.generateReview).not.toHaveBeenCalled();
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('maintainer applied the docs-not-needed override'),
    );
  });

  it('posts deterministic green without Gemini for resolved changes', async () => {
    const deps = baseDependencies(context({
      files: [{ path: 'src/cli.test.ts', status: 'modified', patch: '+test' }],
    }));

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    expect(deps.generateReview).not.toHaveBeenCalled();
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('🟢 No documentation gap found'),
    );
  });

  it('posts unavailable orange without an OpenAI key', async () => {
    const deps = baseDependencies();
    const { OPENAI_API_KEY: _key, ...env } = ENV;

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], env, deps);

    expect(exitCode).toBe(0);
    expect(deps.generateReview).not.toHaveBeenCalled();
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('Automated semantic review could not be completed'),
    );
  });

  it('posts a validated OpenAI review', async () => {
    const deps = baseDependencies();

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    expect(deps.generateReview).toHaveBeenCalledOnce();
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('🔴 Documentation update likely missing'),
    );
  });

  it('turns provider errors into a neutral non-blocking orange comment', async () => {
    const deps = baseDependencies();
    deps.generateReview.mockRejectedValueOnce(new Error('OpenAI quota exceeded'));

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    const body = deps.upsertComment.mock.calls[0]![3];
    expect(body).toContain('Automated semantic review could not be completed.');
    expect(body).not.toMatch(/gemini/i);
  });

  it('reviews every bounded chunk of a large pull request', async () => {
    const deps = baseDependencies(context({
      files: [
        { path: 'src/cli.ts', status: 'modified', patch: `+${'x'.repeat(MAX_DIFF_CHARACTERS)}` },
        { path: 'src/types.ts', status: 'modified', patch: '+export interface LaterChange {}' },
      ],
    }));
    deps.generateReview.mockResolvedValue({
      verdict: 'no_update_needed',
      summary: 'Covered.',
      findings: [],
    });

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps);

    expect(exitCode).toBe(0);
    expect(deps.generateReview.mock.calls.length).toBeGreaterThan(1);
    expect(deps.generateReview.mock.calls.map((call) => call[0]).join('\n')).toContain('src/types.ts');
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd', 72, 'github-token', expect.stringContaining('🟢 No documentation gap found'),
    );
  });

  it('writes the rendered review to the job summary when commenting fails', async () => {
    const deps = baseDependencies();
    deps.upsertComment.mockRejectedValueOnce(new Error('comments disabled'));
    const { io, read } = createIo();

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps, io);

    expect(exitCode).toBe(0);
    expect(deps.writeSummary).toHaveBeenCalledWith(
      expect.stringContaining('Documentation update likely missing'),
      '/tmp/summary.md',
    );
    expect(read().stderr).toContain('Unable to update the pull request comment: comments disabled');
  });

  it('posts an unavailable advisory when pull request loading fails', async () => {
    const deps = baseDependencies();
    deps.loadContext.mockRejectedValueOnce(new Error('GitHub temporarily unavailable'));
    const { io, read } = createIo();

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps, io);

    expect(exitCode).toBe(0);
    expect(deps.upsertComment).toHaveBeenCalledWith(
      'acme/webcmd',
      72,
      'github-token',
      expect.stringContaining('Automated semantic review could not be completed'),
    );
    expect(read().stderr).toContain('GitHub temporarily unavailable');
  });

  it('keeps the review non-blocking when both comment and summary writes fail', async () => {
    const deps = baseDependencies();
    deps.upsertComment.mockRejectedValueOnce(new Error('comments disabled'));
    deps.writeSummary.mockImplementationOnce(() => { throw new Error('summary unavailable'); });
    const { io, read } = createIo();

    const exitCode = await runDocsSyncReview(['node', 'script', '72'], ENV, deps, io);

    expect(exitCode).toBe(0);
    expect(read().stderr).toContain('Unable to write the workflow summary: summary unavailable');
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub API boundaries', () => {
  it('loads pull request metadata and paginates changed files', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: 'modified',
      patch: `+change ${index}`,
    }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        number: 72,
        title: 'Feature',
        body: 'Description',
        draft: false,
        head: { sha: 'abc123' },
        labels: [{ name: 'enhancement' }],
      }))
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([{ filename: 'src/final.ts', status: 'added' }]));

    const result = await loadPullRequestContext('acme/webcmd', 72, 'secret-token', fetchImpl);

    expect(result).toMatchObject({
      number: 72,
      title: 'Feature',
      body: 'Description',
      draft: false,
      headSha: 'abc123',
      labels: ['enhancement'],
    });
    expect(result.files).toHaveLength(101);
    expect(result.files.at(-1)).toEqual({ path: 'src/final.ts', status: 'added', patch: undefined });
    expect(fetchImpl.mock.calls[2]![0]).toContain('page=2');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
    });
  });

  it('updates an existing bot-owned sticky comment', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: 123,
        body: `${REVIEW_COMMENT_MARKER}\nOld`,
        user: { login: 'github-actions[bot]' },
      }]))
      .mockResolvedValueOnce(jsonResponse({ id: 123 }));

    await upsertReviewComment('acme/webcmd', 72, 'token', 'New body', fetchImpl);

    expect(fetchImpl.mock.calls[1]![0]).toContain('/issues/comments/123');
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ body: 'New body' }) });
  });

  it('ignores a contributor marker and creates a bot comment', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: 456,
        body: `${REVIEW_COMMENT_MARKER}\nFake`,
        user: { login: 'contributor' },
      }]))
      .mockResolvedValueOnce(jsonResponse({ id: 789 }, 201));

    await upsertReviewComment('acme/webcmd', 72, 'token', 'New body', fetchImpl);

    expect(fetchImpl.mock.calls[1]![0]).toContain('/issues/72/comments');
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
  });

  it('finds an older sticky comment by paginating issue comments', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: 'Unrelated',
      user: { login: 'someone' },
    }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([{
        id: 321,
        body: `${REVIEW_COMMENT_MARKER}\nOld`,
        user: { login: 'github-actions[bot]' },
      }]))
      .mockResolvedValueOnce(jsonResponse({ id: 321 }));

    await upsertReviewComment('acme/webcmd', 72, 'token', 'New body', fetchImpl);

    expect(fetchImpl.mock.calls[1]![0]).toContain('page=2');
    expect(fetchImpl.mock.calls[2]![0]).toContain('/issues/comments/321');
    expect(fetchImpl.mock.calls[2]![1]).toMatchObject({ method: 'PATCH' });
  });

  it('reports bounded GitHub errors without leaking the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'x'.repeat(5_000) }, 500));

    const error = await loadPullRequestContext('acme/webcmd', 72, 'top-secret', fetchImpl).catch((value) => value);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('GitHub API 500');
    expect(error.message).not.toContain('top-secret');
    expect(error.message.length).toBeLessThan(800);
  });
});

describe('OpenAI and documentation boundaries', () => {
  it('requests JSON from OpenAI with the selected model', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] }) } }],
    }));

    const result = await generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer api-key' }),
        body: expect.stringContaining('"reasoning_effort":"low"'),
      }),
    );
    const calls = fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>;
    expect(calls[0]?.[1].body).not.toContain('temperature');
    expect(result).toEqual({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] });
  });

  it('constrains the response with the strict review schema', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '{"verdict":"no_update_needed","summary":"Covered.","findings":[]}' } }],
    }));

    await generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl);

    const body = JSON.parse((fetchImpl.mock.calls as unknown as Array<[unknown, { body: string }]>)[0][1].body);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'docs_sync_review', strict: true },
    });
    expect(body.response_format.json_schema.schema.properties.verdict.enum)
      .toEqual(['no_update_needed', 'review_suggested', 'likely_missing']);
  });

  it('sends no schema keyword that strict structured output rejects', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '{"verdict":"no_update_needed","summary":"Covered.","findings":[]}' } }],
    }));

    await generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl);

    const body = (fetchImpl.mock.calls as unknown as Array<[unknown, { body: string }]>)[0][1].body;
    expect(body).not.toContain('maxItems');
    expect(body).not.toContain('minItems');
  });

  it('keeps the schema when only low reasoning is rejected', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'unsupported parameter' } }, 400))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"verdict":"no_update_needed","summary":"Covered.","findings":[]}' } }],
      }));

    await expect(generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl))
      .resolves.toEqual({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] });
    const second = (fetchImpl.mock.calls as unknown as Array<[unknown, { body: string }]>)[1][1].body;
    expect(second).not.toContain('reasoning_effort');
    expect(second).toContain('"json_schema"');
  });

  it('drops the schema only after the model also rejects it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'unsupported parameter' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format unsupported' } }, 400))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"verdict":"no_update_needed","summary":"Covered.","findings":[]}' } }],
      }));

    await expect(generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl))
      .resolves.toEqual({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const third = (fetchImpl.mock.calls as unknown as Array<[unknown, { body: string }]>)[2][1].body;
    expect(third).not.toContain('reasoning_effort');
    expect(third).not.toContain('response_format');
  });

  it('stops retrying when the last rung still fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'bad request' } }, 400));

    await expect(generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl))
      .rejects.toThrow('OpenAI request failed with HTTP 400');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('accepts fenced OpenAI JSON output', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '```json\n{"verdict":"no_update_needed","summary":"Covered.","findings":[]}\n```' } }],
    }));

    await expect(generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl))
      .resolves.toEqual({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] });
  });

  it('retries without low reasoning when the selected model rejects it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'unsupported parameter' } }, 400))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"verdict":"no_update_needed","summary":"Covered.","findings":[]}' } }],
      }));

    await expect(generateOpenAIReview('review prompt', 'gpt-test', 'api-key', fetchImpl))
      .resolves.toEqual({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] });
    expect((fetchImpl.mock.calls as unknown as Array<[unknown, { body?: string }]>)[0]?.[1]?.body)
      .toContain('"reasoning_effort":"low"');
    expect((fetchImpl.mock.calls as unknown as Array<[unknown, { body?: string }]>)[1]?.[1]?.body)
      .not.toContain('reasoning_effort');
  });

  it('reports bounded OpenAI API details', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: { message: `unsupported parameter: temperature ${'x'.repeat(800)}` },
    }, 400));

    const error = await generateOpenAIReview('prompt', 'model', 'key', fetchImpl)
      .catch((value: unknown) => value) as Error;

    expect(error.message).toContain('unsupported parameter: temperature');
    expect(error.message.length).toBeLessThan(750);
  });

  it('defaults the docs review model to gpt-5.4-mini', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ verdict: 'no_update_needed', summary: 'Covered.', findings: [] }) } }],
    }));

    await runDocsSyncReview(['node', 'script', '72'], ENV, {
      ...baseDependencies(),
      generateReview: vi.fn(async (prompt: string, model: string, apiKey: string) => {
        return generateOpenAIReview(prompt, model, apiKey, fetchImpl);
      }),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"gpt-5.4-mini"'),
      }),
    );
  });

  it.each([
    ['empty', ''],
    ['invalid JSON', '{not json'],
  ])('rejects %s OpenAI output', async (_name, text) => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: text || null } }],
    }));

    await expect(generateOpenAIReview('prompt', 'model', 'key', fetchImpl)).rejects.toThrow();
  });

  it('reads only regular documentation files inside the repository root', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-sync-review-'));
    const outside = mkdtempSync(join(tmpdir(), 'docs-sync-outside-'));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'README.md'), 'readme');
      writeFileSync(join(root, 'docs', 'guide.mdx'), 'guide');
      writeFileSync(join(outside, 'secret.txt'), 'secret');
      symlinkSync(join(outside, 'secret.txt'), join(root, 'docs', 'linked.mdx'));

      expect(loadDocumentation([
        'README.md',
        'docs/guide.mdx',
        '../secret.txt',
        'docs/linked.mdx',
        '/tmp/absolute.md',
      ], root)).toEqual([
        { path: 'README.md', content: 'readme' },
        { path: 'docs/guide.mdx', content: 'guide' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('documentation sync workflow', () => {
  it('uses trusted base-branch code and least-privilege credentials', () => {
    const workflow = readFileSync('.github/workflows/docs-sync-review.yml', 'utf8');

    expect(workflow).toContain('pull_request_target:');
    for (const event of ['opened', 'reopened', 'synchronize', 'ready_for_review', 'labeled', 'unlabeled']) {
      expect(workflow).toContain(event);
    }
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}');
    expect(workflow).toContain('OPENAI_DOCS_REVIEW_MODEL: ${{ vars.OPENAI_DOCS_REVIEW_MODEL }}');
    expect(workflow).toContain('npm --silent run docs-sync-review -- "${{ github.event.pull_request.number }}"');
    expect(workflow).not.toMatch(/pull_request\.head|head\.sha|github\.head_ref/);
  });
});
