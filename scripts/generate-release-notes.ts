import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  buildReleaseNotesPrompt,
  extractPullRequestNumber,
  filterReleasePullRequests,
  normalizeReleaseNotes,
  replaceChangelogReleaseNotes,
  type PullRequestDetails,
  type ReleaseContext,
} from '../src/release-notes.js';

interface ReleaseSummary {
  tag_name: string;
}

interface CompareCommitResponse {
  sha: string;
  commit?: {
    message?: string;
  };
  author?: {
    login?: string;
  } | null;
}

interface CompareResponse {
  commits: CompareCommitResponse[];
}

interface PullRequestResponse {
  number: number;
  title: string;
  body?: string | null;
  user?: {
    login?: string;
  } | null;
  labels?: Array<{
    name?: string;
  }>;
  html_url: string;
  merged_at?: string | null;
}

interface PullRequestFileResponse {
  filename: string;
}

interface Io {
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
}

interface RunDependencies {
  loadContext?: (tag: string, env: NodeJS.ProcessEnv) => Promise<ReleaseContext>;
  generateText?: (prompt: string, model: string, apiKey: string) => Promise<string>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type GhRunner = (args: readonly string[]) => string;

interface LoadReleaseContextOptions {
  gh?: GhRunner;
  maxDiffCharacters?: number;
}

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_MAX_DIFF_CHARACTERS = 24_000;
const DEFAULT_IO: Io = {
  writeStdout: (chunk) => process.stdout.write(chunk),
  writeStderr: (chunk) => process.stderr.write(chunk),
};

function execGh(args: readonly string[]): string {
  return execFileSync('gh', [...args], {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function ghJson<T>(args: readonly string[], gh: GhRunner = execGh): T {
  return JSON.parse(gh(args)) as T;
}

function normalizeTag(tag: string): string {
  const value = tag.trim();
  if (!value) {
    throw new Error('Release tag is empty');
  }

  return value;
}

function resolveRepository(env: NodeJS.ProcessEnv, gh: GhRunner = execGh): string {
  const repository = env.GITHUB_REPOSITORY?.trim();
  if (repository) return repository;

  const fallback = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!fallback) {
    throw new Error('Unable to determine GitHub repository');
  }

  return fallback;
}

function getPreviousTag(repository: string, tag: string, gh: GhRunner = execGh): string {
  const releases = ghJson<ReleaseSummary[]>(['api', `repos/${repository}/releases?per_page=100`], gh);
  const currentIndex = releases.findIndex((release) => release.tag_name === tag);
  if (currentIndex === -1) {
    throw new Error(`Could not find GitHub release for tag ${tag}`);
  }

  const previousTag = releases.slice(currentIndex + 1).find((release) => release.tag_name !== tag)?.tag_name;
  if (!previousTag) {
    throw new Error(`Could not determine previous release tag for ${tag}`);
  }

  return previousTag;
}

function collectPullRequestNumbers(commits: CompareCommitResponse[]): number[] {
  return [...new Set(
    commits
      .map((commit) => extractPullRequestNumber(commit.commit?.message ?? ''))
      .filter((value): value is number => value !== null),
  )];
}

function truncateDiff(diff: string, maxCharacters: number): string {
  const trimmed = diff.trim();
  if (trimmed.length <= maxCharacters) return trimmed;

  return `${trimmed.slice(0, maxCharacters).trimEnd()}\n[diff truncated]`;
}

function loadPullRequestDiff(repository: string, number: number, gh: GhRunner, maxCharacters: number): string {
  try {
    return truncateDiff(gh(['pr', 'diff', String(number), '--repo', repository]), maxCharacters);
  } catch {
    return '';
  }
}

function loadPullRequest(repository: string, number: number, gh: GhRunner = execGh, maxDiffCharacters = DEFAULT_MAX_DIFF_CHARACTERS): PullRequestDetails {
  const details = ghJson<PullRequestResponse>(['api', `repos/${repository}/pulls/${number}`], gh);
  const files = ghJson<PullRequestFileResponse[]>(['api', `repos/${repository}/pulls/${number}/files?per_page=100`], gh);
  const diff = loadPullRequestDiff(repository, number, gh, maxDiffCharacters);

  return {
    number: details.number,
    title: details.title,
    body: details.body ?? null,
    author: details.user?.login ? { login: details.user.login } : null,
    labels: (details.labels ?? []).flatMap((label) => (label.name ? [{ name: label.name }] : [])),
    files: files.map((file) => ({ path: file.filename })),
    diff,
    url: details.html_url,
    mergedAt: details.merged_at ?? null,
  };
}

export async function loadReleaseContext(tag: string, env: NodeJS.ProcessEnv, options: LoadReleaseContextOptions = {}): Promise<ReleaseContext> {
  const gh = options.gh ?? execGh;
  const normalizedTag = normalizeTag(tag);
  const repository = resolveRepository(env, gh);
  const previousTag = getPreviousTag(repository, normalizedTag, gh);
  const compare = ghJson<CompareResponse>(['api', `repos/${repository}/compare/${previousTag}...${normalizedTag}`], gh);
  const pullRequests = filterReleasePullRequests(
    collectPullRequestNumbers(compare.commits).map((number) => loadPullRequest(repository, number, gh, options.maxDiffCharacters)),
  );

  return {
    tag: normalizedTag,
    previousTag,
    currentRef: normalizedTag,
    pullRequests,
  };
}

export async function generateOpenAIReleaseNotes(
  prompt: string,
  model: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(`OpenAI request failed with HTTP ${response.status}: ${detail}`);
  }
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenAI returned empty content');
  }

  return text;
}

function updateChangelog(tag: string | undefined, notesPath: string | undefined, changelogPath: string | undefined, io: Io): number {
  if (!tag || !notesPath) {
    io.writeStderr('Usage: generate-release-notes --update-changelog <tag> <notes-file> [changelog-file]\n');
    return 1;
  }

  const targetChangelogPath = changelogPath ?? 'CHANGELOG.md';

  try {
    const notes = readFileSync(notesPath, 'utf8');
    const changelog = readFileSync(targetChangelogPath, 'utf8');
    const updated = replaceChangelogReleaseNotes(changelog, tag, notes);
    if (updated !== changelog) {
      writeFileSync(targetChangelogPath, updated);
    }

    io.writeStdout(`Updated ${targetChangelogPath} for ${tag}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`CHANGELOG.md update failed: ${message}\n`);
    return 1;
  }
}

export async function runGenerateReleaseNotes(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  deps: RunDependencies = {},
  io: Io = DEFAULT_IO,
): Promise<number> {
  if (argv[2] === '--update-changelog') {
    return updateChangelog(argv[3], argv[4], argv[5], io);
  }

  const tag = argv[2];
  if (!tag) {
    io.writeStderr('Usage: generate-release-notes <tag>\n');
    return 1;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    io.writeStderr('OPENAI_API_KEY is required to generate release notes.\n');
    return 1;
  }

  try {
    const context = await (deps.loadContext ?? loadReleaseContext)(tag, env);
    const model = env.OPENAI_RELEASE_NOTES_MODEL || DEFAULT_MODEL;
    const prompt = buildReleaseNotesPrompt(context);
    const raw = await (deps.generateText ?? generateOpenAIReleaseNotes)(prompt, model, apiKey);
    const normalized = normalizeReleaseNotes(raw, { context });
    if (!normalized) throw new Error('OpenAI returned no usable release notes.');
    io.writeStdout(`${normalized}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`OpenAI release notes failed: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runGenerateReleaseNotes();
  process.exit(exitCode);
}
