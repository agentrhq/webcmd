export const RELEASE_NOTE_SECTIONS = [
  'Highlights',
  'Improvements',
  'Fixes',
  'Adapters',
  'Reverts',
] as const;

export type ReleaseNoteSection = typeof RELEASE_NOTE_SECTIONS[number];

export interface NormalizeReleaseNotesOptions {
  context?: ReleaseContext;
}

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
const CONTRIBUTOR_AVATAR_SIZE = 40;
const SERVICE_ACCOUNT_HANDLES = new Set([
  'allcontributors',
  'copilot-pull-request-reviewer',
  'dependabot',
  'github-actions',
  'release-please',
  'renovate',
  'semantic-release-bot',
  'snyk-bot',
  'web-flow',
]);

interface ReleaseSemver {
  major: number;
  minor: number;
  patch: number;
}

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

function uniqueSortedHandles(handles: string[]): string[] {
  return [...new Set(handles.map(normalizeHandle).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

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

  const lines = trimmed.split(/\r?\n/);
  if (lines[0]?.startsWith('# ')) {
    lines[0] = `_${lines[0].replace(/^#\s+/, '').trim()}_`;
  }

  return stripContributorAvatarLines(lines.join('\n')).replace(/^##\s+/gm, '### ');
}

export function releaseVersionFromTag(tag: string): string {
  const value = tag.trim();
  if (value.startsWith('webcmd-v')) return value.slice('webcmd-v'.length);
  if (value.startsWith('v')) return value.slice(1);

  return value;
}

function releaseDisplayVersionFromTag(tag: string): string {
  const version = releaseVersionFromTag(tag);
  return version.startsWith('v') ? version : `v${version}`;
}

function parseReleaseSemver(tag: string): ReleaseSemver | null {
  const match = releaseVersionFromTag(tag).match(/^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:[-+].*)?$/);
  if (!match?.groups) return null;

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

export function isMajorRelease(context: Pick<ReleaseContext, 'tag' | 'previousTag'>): boolean {
  const current = parseReleaseSemver(context.tag);
  if (!current) return false;

  const previous = parseReleaseSemver(context.previousTag);
  if (current.major === 0) {
    if (current.minor === 0 || current.patch !== 0) return false;
    if (!previous) return true;

    return previous.major === 0 && current.minor > previous.minor;
  }

  if (!previous) return current.minor === 0 && current.patch === 0;

  return current.major > previous.major;
}

function isServiceAccount(handle: string): boolean {
  const normalized = normalizeHandle(handle).toLowerCase();
  return SERVICE_ACCOUNT_HANDLES.has(normalized)
    || normalized.endsWith('[bot]')
    || normalized.endsWith('-bot');
}

export function releaseContributorHandles(pullRequests: PullRequestDetails[]): string[] {
  return uniqueSortedHandles(
    pullRequests.flatMap((pr) => (pr.author?.login ? [pr.author.login] : [])),
  ).filter((handle) => !isServiceAccount(handle));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function githubHandleUrl(handle: string): string {
  return `https://github.com/${encodeURIComponent(handle)}`;
}

function formatContributorAvatar(handle: string): string {
  const escapedHandle = escapeHtml(handle);
  const encodedHandle = encodeURIComponent(handle);

  return `<a href="${githubHandleUrl(handle)}" title="@${escapedHandle}"><img src="https://github.com/${encodedHandle}.png?size=${CONTRIBUTOR_AVATAR_SIZE}" width="${CONTRIBUTOR_AVATAR_SIZE}" height="${CONTRIBUTOR_AVATAR_SIZE}" alt="@${escapedHandle}" /></a>`;
}

function formatContributorLink(handle: string): string {
  return `[@${handle}](${githubHandleUrl(handle)})`;
}

function formatContributorsSection(handles: string[]): string | null {
  if (handles.length === 0) return null;

  return [
    '## Contributors',
    handles.map(formatContributorAvatar).join(' '),
    '',
    handles.map(formatContributorLink).join(' | '),
  ].join('\n');
}

function stripContributorAvatarLines(notes: string): string {
  return notes
    .split(/\r?\n/)
    .filter((line) => !(/<img\b/i.test(line) && /https:\/\/github\.com\/[^"'\s>]+\.png\?size=\d+/.test(line)))
    .join('\n')
    .replace(/(^|\n)(## Contributors)\n\n/g, '$1$2\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMajorReleaseTitle(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const titleMatch = line.match(/^#\s+(.+?)\s*$/);
    if (titleMatch) return titleMatch[1];
    if (/^##\s+/.test(line)) return null;
  }

  return null;
}

function fallbackMajorReleaseTitle(context: ReleaseContext): string {
  const releaseText = context.pullRequests.map((pr) => [
    pr.title,
    ...pr.labels.map((label) => label.name),
    ...pr.files.map((file) => file.path),
  ].join('\n')).join('\n').toLowerCase();

  if (/\bclis\//.test(releaseText) || /\badapter\b/.test(releaseText) || /\bcli\b/.test(releaseText)) {
    return 'The Command Surface Expands';
  }
  if (/\bbrowser\b|\bcloak\b|\bdaemon\b/.test(releaseText)) {
    return 'The Browser Runtime Matures';
  }
  if (/\bskills?\b/.test(releaseText)) {
    return 'The Agent Authoring Edition';
  }
  if (/\bdocs?\b|\breadme\b/.test(releaseText)) {
    return 'The Documentation Edition';
  }
  if (/\bplugins?\b/.test(releaseText)) {
    return 'The Plugin System Opens Up';
  }

  return 'A New Command Surface';
}

function normalizeMajorReleaseTitle(rawTitle: string | null, context: ReleaseContext): string {
  const title = (rawTitle ?? '')
    .replace(/^webcmd[-\s]+v?\d+\.\d+\.\d+(?:[-+][^:\s]+)?\s*:\s*/i, '')
    .replace(/^webcmd\s*:\s*/i, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[#:\-\s]+/, '')
    .replace(/[.!]+$/, '')
    .trim();
  const lowerTitle = title.toLowerCase();

  if (
    !title
    || title.length > 80
    || lowerTitle === 'none'
    || lowerTitle === 'n/a'
    || lowerTitle === 'release notes'
    || lowerTitle === 'webcmd'
    || lowerTitle === 'webcmd release'
  ) {
    return fallbackMajorReleaseTitle(context);
  }

  return title;
}

function formatMajorReleaseHeading(raw: string, context: ReleaseContext): string {
  return `# webcmd ${releaseDisplayVersionFromTag(context.tag)}: ${normalizeMajorReleaseTitle(parseMajorReleaseTitle(raw), context)}`;
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

export function normalizeReleaseNotes(raw: string, options: NormalizeReleaseNotesOptions = {}): string {
  const sections = parseReleaseNoteSections(raw);
  const sectionBlocks = RELEASE_NOTE_SECTIONS.flatMap((section) => {
    const content = normalizeSectionContent(sections[section]?.join('\n'));
    return content ? [`## ${section}\n${content}`] : [];
  });

  if (sectionBlocks.length === 0) return '';

  const blocks: string[] = [];
  if (options.context && isMajorRelease(options.context)) {
    blocks.push(formatMajorReleaseHeading(raw, options.context));
  }

  blocks.push(...sectionBlocks);

  const contributors = options.context ? releaseContributorHandles(options.context.pullRequests) : [];
  const contributorsSection = formatContributorsSection(contributors);
  if (contributorsSection) blocks.push(contributorsSection);

  return blocks.join('\n\n');
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
  const majorReleaseInstructions = isMajorRelease(context)
    ? [
      `This is a major release. Start with exactly one H1: # webcmd ${releaseDisplayVersionFromTag(context.tag)}: <Elegant Release Title>.`,
      'Make the title grand enough to feel memorable, but polished rather than loud. Keep it short, specific to the supplied PRs, and avoid hype words.',
    ]
    : [
      'Do not include a top-level release title.',
    ];

  return [
    `Write user-facing release notes for ${context.tag}.`,
    `Release range: ${context.previousTag}...${context.currentRef}.`,
    'Use only the supplied pull requests below. Do not invent changes or pull in information from elsewhere.',
    `Allowed sections: ${RELEASE_NOTE_SECTIONS.map((section) => `## ${section}`).join(', ')}.`,
    ...majorReleaseInstructions,
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
