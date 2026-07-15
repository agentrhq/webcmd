import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import {
  REVIEW_COMMENT_MARKER,
  REVIEW_JSON_SCHEMA,
  buildReviewPrompts,
  classifyPullRequest,
  createDeferredResult,
  createOverrideResult,
  createResolvedResult,
  createUnavailableResult,
  mergeReviewResults,
  renderReviewComment,
  selectDocumentationPaths,
  validateGeminiReview,
  type DocumentationExcerpt,
  type PullRequestReviewContext,
  type ReviewResult,
} from '../src/docs-sync-review.js';

interface Io {
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
}

export interface RunDependencies {
  loadContext?: (repository: string, number: number, token: string) => Promise<PullRequestReviewContext>;
  loadDocumentation?: (paths: string[]) => DocumentationExcerpt[];
  generateReview?: (prompt: string, model: string, apiKey: string) => Promise<unknown>;
  upsertComment?: (repository: string, number: number, token: string, body: string) => Promise<void>;
  writeSummary?: (body: string, summaryPath: string | undefined) => void;
}

const DEFAULT_IO: Io = {
  writeStdout: (chunk) => process.stdout.write(chunk),
  writeStderr: (chunk) => process.stderr.write(chunk),
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface PullRequestResponse {
  number: number;
  title: string;
  body?: string | null;
  draft?: boolean;
  head?: { sha?: string };
  labels?: Array<{ name?: string }>;
}

interface PullRequestFileResponse {
  filename: string;
  status: string;
  patch?: string;
}

interface IssueCommentResponse {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
}

interface GeminiClientLike {
  models: {
    generateContent: (request: {
      model: string;
      contents: string;
      config: {
        responseMimeType: string;
        responseJsonSchema: unknown;
        temperature: number;
        abortSignal: AbortSignal;
      };
    }) => Promise<{ text?: string }>;
  };
}

export type GeminiClientFactory = (apiKey: string) => GeminiClientLike;

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

async function githubRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const response = await fetchImpl(`${GITHUB_API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function loadPullRequestContext(
  repository: string,
  number: number,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<PullRequestReviewContext> {
  const details = await githubRequest<PullRequestResponse>(
    `/repos/${repository}/pulls/${number}`,
    token,
    {},
    fetchImpl,
  );
  const files: PullRequestFileResponse[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest<PullRequestFileResponse[]>(
      `/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`,
      token,
      {},
      fetchImpl,
    );
    files.push(...batch);
    if (batch.length < 100) break;
  }

  return {
    number: details.number,
    title: details.title,
    body: details.body ?? null,
    draft: details.draft ?? false,
    headSha: details.head?.sha ?? '',
    labels: (details.labels ?? []).flatMap((label) => label.name ? [label.name] : []),
    files: files.map((file) => ({
      path: file.filename,
      status: file.status,
      patch: file.patch,
    })),
  };
}

export async function upsertReviewComment(
  repository: string,
  number: number,
  token: string,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const comments: IssueCommentResponse[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest<IssueCommentResponse[]>(
      `/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      token,
      {},
      fetchImpl,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const existing = comments.find((comment) => comment.user?.login === 'github-actions[bot]'
    && comment.body?.includes(REVIEW_COMMENT_MARKER));
  const path = existing
    ? `/repos/${repository}/issues/comments/${existing.id}`
    : `/repos/${repository}/issues/${number}/comments`;
  await githubRequest(
    path,
    token,
    {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify({ body }),
    },
    fetchImpl,
  );
}

export function loadDocumentation(
  paths: string[],
  root = process.cwd(),
): DocumentationExcerpt[] {
  const rootPath = resolve(root);
  const rootPrefix = `${rootPath}${sep}`;
  const excerpts: DocumentationExcerpt[] = [];
  for (const path of paths) {
    if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) continue;
    const absolutePath = resolve(rootPath, path);
    if (!absolutePath.startsWith(rootPrefix)) continue;
    try {
      const stat = lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      excerpts.push({ path, content: readFileSync(absolutePath, 'utf8') });
    } catch {
      // Missing optional context is represented by its absence.
    }
  }
  return excerpts;
}

const defaultGeminiClient: GeminiClientFactory = (apiKey) => {
  const client = new GoogleGenAI({ apiKey });
  return {
    models: {
      generateContent: (request) => client.models.generateContent(request),
    },
  };
};

export async function generateGeminiReview(
  prompt: string,
  model: string,
  apiKey: string,
  createClient: GeminiClientFactory = defaultGeminiClient,
): Promise<unknown> {
  const client = createClient(apiKey);
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: REVIEW_JSON_SCHEMA,
      temperature: 0.1,
      abortSignal: AbortSignal.timeout(60_000),
    },
  });
  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned empty content.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Gemini returned invalid JSON.');
  }
}

function defaultWriteSummary(body: string, summaryPath: string | undefined): void {
  if (!summaryPath) return;
  appendFileSync(summaryPath, body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDocsSyncReview(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  deps: RunDependencies = {},
  io: Io = DEFAULT_IO,
): Promise<number> {
  const pullRequestNumber = Number.parseInt(argv[2] ?? '', 10);
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    io.writeStderr('Usage: docs-sync-review <pull-request-number>\n');
    return 1;
  }

  const repository = env.GITHUB_REPOSITORY?.trim();
  const githubToken = env.GH_TOKEN?.trim();
  if (!repository || !githubToken) {
    io.writeStderr('GITHUB_REPOSITORY and GH_TOKEN are required.\n');
    return 0;
  }

  const loadContext = deps.loadContext ?? loadPullRequestContext;
  const readDocumentation = deps.loadDocumentation ?? loadDocumentation;
  const generateReview = deps.generateReview ?? generateGeminiReview;
  const upsertComment = deps.upsertComment ?? upsertReviewComment;
  const writeSummary = deps.writeSummary ?? defaultWriteSummary;

  let context: PullRequestReviewContext | undefined;
  let result: ReviewResult | undefined;
  try {
    context = await loadContext(repository, pullRequestNumber, githubToken);
  } catch (error) {
    io.writeStderr(`Unable to load pull request context: ${errorMessage(error)}\n`);
    result = createUnavailableResult();
  }

  if (context?.draft) {
    result = createDeferredResult();
  } else if (context?.labels.includes('docs-not-needed')) {
    result = createOverrideResult();
  } else if (context) {
    const routing = classifyPullRequest(context.files);
    if (routing.route === 'resolved') {
      result = createResolvedResult(routing);
    } else {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        io.writeStderr('Semantic review API key is not configured.\n');
        result = createUnavailableResult();
      } else {
        const documentation = readDocumentation(selectDocumentationPaths(context.files));
        const prompts = buildReviewPrompts(context, documentation);
        const reviews: ReviewResult[] = [];
        const model = env.GEMINI_DOCS_REVIEW_MODEL?.trim() || 'gemini-2.5-flash';
        for (const [index, prompt] of prompts.entries()) {
          try {
            const raw = await generateReview(prompt.prompt, model, apiKey);
            reviews.push(validateGeminiReview(raw, context, routing, prompt));
          } catch (error) {
            io.writeStderr(`Semantic review chunk ${index + 1}/${prompts.length} failed: ${errorMessage(error)}\n`);
            reviews.push(createUnavailableResult());
          }
        }
        result = mergeReviewResults(reviews);
      }
    }
  }

  const body = renderReviewComment(result ?? createUnavailableResult());
  try {
    await upsertComment(repository, pullRequestNumber, githubToken, body);
    io.writeStdout(`Documentation sync review updated for #${pullRequestNumber}.\n`);
  } catch (error) {
    io.writeStderr(`Unable to update the pull request comment: ${errorMessage(error)}\n`);
    try {
      writeSummary(body, env.GITHUB_STEP_SUMMARY);
    } catch (summaryError) {
      io.writeStderr(`Unable to write the workflow summary: ${errorMessage(summaryError)}\n`);
    }
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runDocsSyncReview();
  process.exit(exitCode);
}
