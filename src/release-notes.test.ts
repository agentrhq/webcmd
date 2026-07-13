import { describe, expect, it } from 'vitest';
import {
  RELEASE_NOTE_SECTIONS,
  buildReleaseNotesPrompt,
  extractPullRequestNumber,
  filterReleasePullRequests,
  isMajorRelease,
  normalizeReleaseNotes,
  releaseContributorHandles,
  replaceChangelogReleaseNotes,
  type ReleaseContext,
} from './release-notes.js';

describe('release notes helpers', () => {
  it('extracts PR numbers from squash and merge commit messages', () => {
    expect(extractPullRequestNumber('feat: add release notes (#123)')).toBe(123);
    expect(extractPullRequestNumber('feat: add release notes (#124)\n\nExpanded body')).toBe(124);
    expect(extractPullRequestNumber('Merge pull request #456 from agentrhq/example')).toBe(456);
    expect(extractPullRequestNumber('docs: plain commit without pr')).toBeNull();
  });

  it('filters release and skip-changelog pull requests', () => {
    const prs = [
      { number: 1, title: 'feat: browser polish', author: { login: 'alice' }, labels: [], files: [], url: 'https://example.com/1' },
      { number: 2, title: 'release: 0.2.0', author: { login: 'bot' }, labels: [], files: [], url: 'https://example.com/2' },
      { number: 3, title: 'chore: generated updates', author: { login: 'ci' }, labels: [{ name: 'skip-changelog' }], files: [], url: 'https://example.com/3' },
      { number: 4, title: 'chore: release prep', author: { login: 'ci' }, labels: [{ name: 'release' }], files: [], url: 'https://example.com/4' },
      { number: 5, title: 'chore(main): release webcmd 0.2.0', author: { login: 'release-please' }, labels: [], files: [], url: 'https://example.com/5' },
    ];

    expect(filterReleasePullRequests(prs).map((pr) => pr.number)).toEqual([1]);
  });

  it('detects major releases from semver tag ranges', () => {
    expect(isMajorRelease({ tag: 'webcmd-v2.0.0', previousTag: 'webcmd-v1.9.9' })).toBe(true);
    expect(isMajorRelease({ tag: 'v3.1.0', previousTag: 'v2.9.9' })).toBe(true);
    expect(isMajorRelease({ tag: 'webcmd-v0.3.0', previousTag: 'webcmd-v0.2.5' })).toBe(true);
    expect(isMajorRelease({ tag: 'webcmd-v0.1.0', previousTag: 'webcmd-v0.0.9' })).toBe(true);
    expect(isMajorRelease({ tag: 'webcmd-v2.1.0', previousTag: 'webcmd-v2.0.0' })).toBe(false);
    expect(isMajorRelease({ tag: 'webcmd-v0.3.1', previousTag: 'webcmd-v0.3.0' })).toBe(false);
    expect(isMajorRelease({ tag: 'webcmd-v0.0.1', previousTag: 'webcmd-v0.0.0' })).toBe(false);
  });

  it('deduplicates PR author contributors and excludes service accounts', () => {
    const prs = [
      { number: 1, title: 'feat: browser polish', author: { login: 'alice' }, labels: [], files: [], url: 'https://example.com/1' },
      { number: 2, title: 'feat: docs polish', author: { login: '@alice' }, labels: [], files: [], url: 'https://example.com/2' },
      { number: 3, title: 'chore: release', author: { login: 'github-actions[bot]' }, labels: [], files: [], url: 'https://example.com/3' },
      { number: 4, title: 'feat: adapter polish', author: { login: 'bob' }, labels: [], files: [], url: 'https://example.com/4' },
      { number: 5, title: 'chore: release notes', author: { login: 'release-please' }, labels: [], files: [], url: 'https://example.com/5' },
    ];

    expect(releaseContributorHandles(prs)).toEqual(['alice', 'bob']);
  });

  it('normalizes only sections with real release-note content', () => {
    const raw = [
      '## Highlights',
      '- Better release notes.',
      '',
      '## Improvements',
      'No improvements.',
      '',
      '## Adapters',
      'No adapter changes.',
      '',
      '## Fixes',
      '- Fixed release fallback.',
      '',
      '## Contributors',
      '- @alice',
      '',
      '## Reverts',
      'There are no reverts in this release.',
    ].join('\n');

    const normalized = normalizeReleaseNotes(raw);

    expect(RELEASE_NOTE_SECTIONS).toEqual(['Highlights', 'Improvements', 'Fixes', 'Adapters', 'Reverts']);
    expect(normalized).toBe([
      '## Highlights',
      '- Better release notes.',
      '',
      '## Fixes',
      '- Fixed release fallback.',
    ].join('\n'));
    expect(normalized).not.toContain('## Improvements');
    expect(normalized).not.toContain('## Contributors');
    expect(normalized).not.toContain('## Reverts');
    expect(normalized).not.toContain('None.');
  });

  it('adds an elegant major release title and visual contributor credits', () => {
    const context: ReleaseContext = {
      tag: 'webcmd-v2.0.0',
      previousTag: 'webcmd-v1.9.9',
      currentRef: 'webcmd-v2.0.0',
      pullRequests: [
        {
          number: 42,
          title: 'feat: expand browser adapter coverage',
          author: { login: 'alice' },
          labels: [{ name: 'feature' }],
          files: [{ path: 'clis/github/auth.js' }],
          url: 'https://github.com/agentrhq/webcmd/pull/42',
        },
        {
          number: 43,
          title: 'chore: release automation',
          author: { login: 'github-actions[bot]' },
          labels: [],
          files: [{ path: '.github/workflows/release.yml' }],
          url: 'https://github.com/agentrhq/webcmd/pull/43',
        },
      ],
    };
    const raw = [
      '# webcmd v2.0.0: The Command Surface Opens',
      '',
      '## Highlights',
      '- Broader adapter authoring workflows.',
    ].join('\n');

    const normalized = normalizeReleaseNotes(raw, { context });

    expect(normalized).toContain('# webcmd v2.0.0: The Command Surface Opens');
    expect(normalized).toContain('## Contributors');
    expect(normalized).toContain('<img src="https://github.com/alice.png?size=64" width="64" height="64" alt="@alice" />');
    expect(normalized).toContain('[@alice](https://github.com/alice)');
    expect(normalized).not.toContain('github-actions');
  });

  it('uses a deterministic major release title fallback when the model omits one', () => {
    const context: ReleaseContext = {
      tag: 'webcmd-v0.3.0',
      previousTag: 'webcmd-v0.2.5',
      currentRef: 'webcmd-v0.3.0',
      pullRequests: [
        {
          number: 42,
          title: 'feat: add github adapter',
          author: { login: 'alice' },
          labels: [{ name: 'feature' }],
          files: [{ path: 'clis/github/auth.js' }],
          url: 'https://github.com/agentrhq/webcmd/pull/42',
        },
      ],
    };

    const normalized = normalizeReleaseNotes('## Highlights\n- Added a GitHub adapter.', { context });

    expect(normalized).toContain('# webcmd v0.3.0: The Command Surface Expands');
  });

  it('does not add major release title treatment to minor releases', () => {
    const context: ReleaseContext = {
      tag: 'webcmd-v2.1.0',
      previousTag: 'webcmd-v2.0.0',
      currentRef: 'webcmd-v2.1.0',
      pullRequests: [
        {
          number: 42,
          title: 'feat: improve release notes',
          author: { login: 'alice' },
          labels: [{ name: 'feature' }],
          files: [{ path: 'src/release-notes.ts' }],
          url: 'https://github.com/agentrhq/webcmd/pull/42',
        },
      ],
    };

    const normalized = normalizeReleaseNotes('# The Polished Edition\n\n## Highlights\n- Better notes.', { context });

    expect(normalized).not.toContain('# webcmd v2.1.0');
    expect(normalized).toContain('## Highlights\n- Better notes.');
    expect(normalized).toContain('## Contributors');
  });

  it('replaces a matching changelog release entry with generated notes', () => {
    const changelog = [
      '# Changelog',
      '',
      '## [0.2.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.2...webcmd-v0.2.3) (2026-07-09)',
      '',
      '',
      '### Features',
      '',
      '* release-please generated note',
      '',
      '## [0.2.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.1...webcmd-v0.2.2) (2026-07-08)',
      '',
      '### Bug Fixes',
      '',
      '* older note',
      '',
    ].join('\n');
    const notes = [
      '# webcmd v2.0.0: The Command Surface Expands',
      '',
      '## Highlights',
      '- Better release notes.',
      '',
      '## Adapters',
      '- Improved district checkout.',
      '',
      '## Contributors',
      '<a href="https://github.com/alice" title="@alice"><img src="https://github.com/alice.png?size=64" width="64" height="64" alt="@alice" /></a>',
      '',
      '[@alice](https://github.com/alice)',
    ].join('\n');

    const updated = replaceChangelogReleaseNotes(changelog, 'webcmd-v0.2.3', notes);

    expect(updated).toContain('## [0.2.3]');
    expect(updated).toContain('_webcmd v2.0.0: The Command Surface Expands_');
    expect(updated).toContain('### Highlights\n- Better release notes.');
    expect(updated).toContain('### Adapters\n- Improved district checkout.');
    expect(updated).toContain('### Contributors\n[@alice](https://github.com/alice)');
    expect(updated).not.toContain('<img');
    expect(updated).not.toContain('release-please generated note');
    expect(updated).toContain('## [0.2.2]');
    expect(updated).toContain('* older note');
  });

  it('builds a prompt grounded in the exact release range and PR list', () => {
    const context: ReleaseContext = {
      tag: 'v0.2.1',
      previousTag: 'v0.2.0',
      currentRef: 'abc123',
      pullRequests: [
        {
          number: 42,
          title: 'feat: add docs scaffold',
          body: 'Adds docs structure.',
          author: { login: 'alice' },
          labels: [{ name: 'feature' }],
          files: [{ path: 'docs/docs.json' }],
          diff: 'diff --git a/docs/docs.json b/docs/docs.json',
          url: 'https://github.com/agentrhq/webcmd/pull/42',
        },
      ],
    };

    const prompt = buildReleaseNotesPrompt(context);
    expect(prompt).toContain('v0.2.0...abc123');
    expect(prompt).toContain('PR #42: feat: add docs scaffold');
    expect(prompt).toContain('docs/docs.json');
    expect(prompt).toContain('## Highlights');
    expect(prompt).toContain('## Adapters');
    expect(prompt).not.toContain('## Contributors');
    expect(prompt).toContain('Do not include a top-level release title');
    expect(prompt).toContain('Omit empty sections entirely');
    expect(prompt).toContain('Do not include a Contributors section');
    expect(prompt).toContain('CLI commands and adapters are the same thing');
    expect(prompt).toContain('files under clis/** as an adapter change');
    expect(prompt).toContain('Put new site adapters/CLIs, adapter promotions, adapter hardening');
    expect(prompt).toContain('## Reverts');
  });

  it('asks for a tasteful H1 title only when building major release notes', () => {
    const context: ReleaseContext = {
      tag: 'webcmd-v0.3.0',
      previousTag: 'webcmd-v0.2.5',
      currentRef: 'webcmd-v0.3.0',
      pullRequests: [
        {
          number: 42,
          title: 'feat: expand adapter authoring',
          body: 'Adds richer authoring workflows.',
          author: { login: 'alice' },
          labels: [{ name: 'feature' }],
          files: [{ path: 'skills/webcmd-adapter-author/SKILL.md' }],
          diff: 'diff --git a/skills/webcmd-adapter-author/SKILL.md b/skills/webcmd-adapter-author/SKILL.md',
          url: 'https://github.com/agentrhq/webcmd/pull/42',
        },
      ],
    };

    const prompt = buildReleaseNotesPrompt(context);

    expect(prompt).toContain('This is a major release');
    expect(prompt).toContain('# webcmd v0.3.0: <Elegant Release Title>');
    expect(prompt).toContain('grand enough to feel memorable, but polished rather than loud');
  });
});
