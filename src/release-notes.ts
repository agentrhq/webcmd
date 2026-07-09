export const RELEASE_NOTE_SECTIONS = [
  'Highlights',
  'Improvements',
  'Fixes',
  'Adapters',
  'Reverts',
] as const;

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

function isNoChangeContent(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, '').replace(/[.。]+$/, '').trim().toLowerCase())
    .filter(Boolean);

  if (lines.length === 0) return true;

  return lines.every((line) => (
    line === 'none'
    || line === 'n/a'
    || line === 'not applicable'
    || /^no .*?(?:changes|updates|reverts|fixes|improvements|adapters|highlights)(?: in this release)?$/.test(line)
    || /^there (?:are|were) no .*?(?:changes|updates|reverts|fixes|improvements|adapters|highlights)(?: in this release)?$/.test(line)
  ));
}

function normalizeSectionContent(content: string | undefined): string | null {
  const trimmed = content?.trim();
  if (!trimmed || isNoChangeContent(trimmed)) return null;

  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatReleaseNotesForChangelog(notes: string): string {
  const trimmed = notes.trim();
  if (!trimmed) return '';

  return trimmed.replace(/^##\s+/gm, '### ');
}

export function releaseVersionFromTag(tag: string): string {
  const value = tag.trim();
  if (value.startsWith('webcmd-v')) return value.slice('webcmd-v'.length);
  if (value.startsWith('v')) return value.slice(1);

  return value;
}

export function replaceChangelogReleaseNotes(changelog: string, tag: string, notes: string): string {
  const version = releaseVersionFromTag(tag);
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\]\\([^\\n]+\\) \\([^\\n]+\\)\\s*$`, 'm');
  const headingMatch = headingPattern.exec(changelog);
  if (!headingMatch) {
    throw new Error(`Could not find CHANGELOG.md entry for ${version}`);
  }

  const headingEnd = headingMatch.index + headingMatch[0].length;
  const remaining = changelog.slice(headingEnd);
  const nextReleaseMatch = /\n## \[/.exec(remaining);
  const releaseEnd = nextReleaseMatch ? headingEnd + nextReleaseMatch.index : changelog.length;
  const before = changelog.slice(0, headingEnd).trimEnd();
  const after = changelog.slice(releaseEnd);
  const suffix = after ? after.replace(/^\n+/, '\n\n') : '\n';

  return `${before}\n\n${formatReleaseNotesForChangelog(notes)}${suffix}`;
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

export function normalizeReleaseNotes(raw: string): string {
  const sections = parseReleaseNoteSections(raw);

  return RELEASE_NOTE_SECTIONS.flatMap((section) => {
    const content = normalizeSectionContent(sections[section]?.join('\n'));
    return content ? [`## ${section}\n${content}`] : [];
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
    `Allowed sections: ${RELEASE_NOTE_SECTIONS.map((section) => `## ${section}`).join(', ')}.`,
    'Include only sections that have user-visible changes. Omit empty sections entirely; do not write "None", "N/A", or similar placeholder text.',
    'Do not include a Contributors section.',
    'In this project, CLI commands and adapters are the same thing. Treat any PR that adds, removes, or changes files under clis/** as an adapter change, even if the PR title says "CLI" instead of "adapter".',
    'Put new site adapters/CLIs, adapter promotions, adapter hardening, adapter output changes, selector/API updates, and site-specific workflow improvements in ## Adapters.',
    'Use ## Improvements for non-adapter product, runtime, CLI, docs, or workflow improvements.',
    'Use ## Reverts only when the release includes actual reverted changes.',
    '',
    `Pull requests included for this release:`,
    prSummaries,
  ].join('\n');
}
