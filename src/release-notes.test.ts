import { describe, expect, it } from 'vitest';
import {
  RELEASE_NOTE_SECTIONS,
  buildReleaseNotesPrompt,
  extractPullRequestNumber,
  filterReleasePullRequests,
  normalizeReleaseNotes,
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
      '## Highlights',
      '- Better release notes.',
      '',
      '## Adapters',
      '- Improved district checkout.',
    ].join('\n');

    const updated = replaceChangelogReleaseNotes(changelog, 'webcmd-v0.2.3', notes);

    expect(updated).toContain('## [0.2.3]');
    expect(updated).toContain('### Highlights\n- Better release notes.');
    expect(updated).toContain('### Adapters\n- Improved district checkout.');
    expect(updated).not.toContain('release-please generated note');
    expect(updated).toContain('## [0.2.2]');
    expect(updated).toContain('* older note');
  });

  it('builds a prompt grounded in the exact release range and PR list', () => {
    const context: ReleaseContext = {
      tag: 'v0.2.0',
      previousTag: 'v0.1.1',
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
    expect(prompt).toContain('v0.1.1...abc123');
    expect(prompt).toContain('PR #42: feat: add docs scaffold');
    expect(prompt).toContain('docs/docs.json');
    expect(prompt).toContain('## Highlights');
    expect(prompt).toContain('## Adapters');
    expect(prompt).not.toContain('## Contributors');
    expect(prompt).toContain('Omit empty sections entirely');
    expect(prompt).toContain('Do not include a Contributors section');
    expect(prompt).toContain('CLI commands and adapters are the same thing');
    expect(prompt).toContain('files under clis/** as an adapter change');
    expect(prompt).toContain('Put new site adapters/CLIs, adapter promotions, adapter hardening');
    expect(prompt).toContain('## Reverts');
  });
});
