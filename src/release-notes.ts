export const RELEASE_NOTE_SECTIONS = ['Highlights', 'Improvements', 'Fixes', 'Contributors', 'Reverts'] as const;

export type ReleaseNoteSection = typeof RELEASE_NOTE_SECTIONS[number];

export interface PullRequestLabel {
  name: string;
}

export interface PullRequestFile {
  path: string;
}

export interface PullRequestAuthor {
  login: string;
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body?: string | null;
  author?: PullRequestAuthor | null;
  labels: PullRequestLabel[];
  files: PullRequestFile[];
  diff?: string;
  url: string;
  mergedAt?: string | null;
}

export interface ReleaseContext {
  tag: string;
  previousTag: string;
  currentRef: string;
  pullRequests: PullRequestDetails[];
}

export interface CompareCommit {
  sha: string;
  message: string;
  author?: string | null;
}

export type GitRunner = (args: readonly string[]) => Promise<string>;

const SQUASH_MERGE_PR_NUMBER_PATTERN = /\(#(?<number>\d+)\)\s*$/;
const MERGE_COMMIT_PR_NUMBER_PATTERN = /^Merge pull request #(?<number>\d+) /;
const RELEASE_PLEASE_TITLE_PATTERN = /^chore(?:\([^)]+\))?: release(?:\s|$)/;

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

function uniqueSortedHandles(handles: string[]): string[] {
  return [...new Set(handles.map(normalizeHandle).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function formatSectionContent(content: string | undefined): string {
  const trimmed = content?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'None.';
}

export function extractPullRequestNumber(message: string): number | null {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? message;
  const squashMatch = firstLine.match(SQUASH_MERGE_PR_NUMBER_PATTERN);
  if (squashMatch?.groups?.number) {
    return Number(squashMatch.groups.number);
  }

  const mergeMatch = firstLine.match(MERGE_COMMIT_PR_NUMBER_PATTERN);
  if (mergeMatch?.groups?.number) {
    return Number(mergeMatch.groups.number);
  }

  return null;
}

export function filterReleasePullRequests(prs: PullRequestDetails[]): PullRequestDetails[] {
  return prs.filter((pr) => {
    const title = pr.title.trim().toLowerCase();
    if (title.startsWith('release:')) return false;
    if (RELEASE_PLEASE_TITLE_PATTERN.test(title)) return false;

    return !pr.labels.some((label) => {
      const name = label.name.trim().toLowerCase();
      return name === 'release' || name === 'skip-changelog';
    });
  });
}

function parseReleaseNoteSections(raw: string): Partial<Record<ReleaseNoteSection, string[]>> {
  const sections: Partial<Record<ReleaseNoteSection, string[]>> = {};
  let currentSection: ReleaseNoteSection | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      const section = RELEASE_NOTE_SECTIONS.find((candidate) => candidate.toLowerCase() === headingMatch[1].toLowerCase()) ?? null;
      currentSection = section;
      if (currentSection) sections[currentSection] = sections[currentSection] ?? [];
      continue;
    }

    if (currentSection) {
      sections[currentSection] ??= [];
      sections[currentSection]!.push(line);
    }
  }

  return sections;
}

export function normalizeReleaseNotes(raw: string, contributors: string[]): string {
  const sections = parseReleaseNoteSections(raw);
  const normalizedContributors = uniqueSortedHandles(contributors).map((handle) => `- @${handle}`);

  return RELEASE_NOTE_SECTIONS.map((section) => {
    if (section === 'Contributors') {
      const content = normalizedContributors.length > 0 ? normalizedContributors.join('\n') : 'None.';
      return `## ${section}\n${content}`;
    }

    const content = formatSectionContent(sections[section]?.join('\n'));
    return `## ${section}\n${content}`;
  }).join('\n\n');
}

function formatPullRequest(pr: PullRequestDetails): string {
  const author = pr.author?.login ?? 'unknown';
  const labels = pr.labels.length > 0 ? pr.labels.map((label) => label.name).join(', ') : 'None';
  const files = pr.files.length > 0 ? pr.files.map((file) => file.path).join('\n') : 'None';
  const body = pr.body?.trim() ? pr.body.trim() : 'None';
  const diff = pr.diff?.trim() ? pr.diff.trim() : 'None';

  return [
    `PR #${pr.number}: ${pr.title}`,
    `Author: @${author}`,
    `Labels: ${labels}`,
    `Files:\n${files}`,
    `Body:\n${body}`,
    `Diff:\n${diff}`,
  ].join('\n');
}

export function buildReleaseNotesPrompt(context: ReleaseContext): string {
  const prSummaries = context.pullRequests.map(formatPullRequest).join('\n\n');

  return [
    `Write user-facing release notes for ${context.tag}.`,
    `Release range: ${context.previousTag}...${context.currentRef}.`,
    'Use only the supplied pull requests below. Do not invent changes or pull in information from elsewhere.',
    `Required sections: ${RELEASE_NOTE_SECTIONS.map((section) => `## ${section}`).join(', ')}.`,
    'Each section must be present in the final notes.',
    '',
    `Pull requests included for this release:`,
    prSummaries,
  ].join('\n');
}
