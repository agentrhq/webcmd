import { describe, expect, it } from 'vitest';
import {
  RELEASE_NOTE_SECTIONS,
  buildReleaseNotesPrompt,
  extractPullRequestNumber,
  filterReleasePullRequests,
  normalizeReleaseNotes,
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

  it('normalizes all required sections and fills empty sections with None', () => {
    const raw = [
      '## Highlights',
      '- Better release notes.',
      '',
      '## Fixes',
      '- Fixed release fallback.',
    ].join('\n');

    const normalized = normalizeReleaseNotes(raw, ['alice', 'bob']);
    for (const section of RELEASE_NOTE_SECTIONS) {
      expect(normalized).toContain(`## ${section}`);
    }
    expect(normalized).toContain('## Adapter Additions and Improvements\nNone.');
    expect(normalized).toContain('## Improvements\nNone.');
    expect(normalized).toContain('## Contributors\n- @alice\n- @bob');
    expect(normalized).toContain('## Reverts\nNone.');
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
    expect(prompt).toContain('## Adapter Additions and Improvements');
    expect(prompt).toContain('Put new site adapters, adapter promotions, adapter hardening');
    expect(prompt).toContain('## Reverts');
  });
});
