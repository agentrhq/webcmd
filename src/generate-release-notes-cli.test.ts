import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { ReleaseContext } from './release-notes.js';
import { loadReleaseContext, runGenerateReleaseNotes } from '../scripts/generate-release-notes.js';

function createIo() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      writeStdout(chunk: string) {
        stdout += chunk;
      },
      writeStderr(chunk: string) {
        stderr += chunk;
      },
    },
    read() {
      return { stdout, stderr };
    },
  };
}

describe('runGenerateReleaseNotes', () => {
  it('exits 1 with usage text when the tag argument is missing', async () => {
    const { io, read } = createIo();

    const exitCode = await runGenerateReleaseNotes(['node', 'script'], {}, {}, io);

    expect(exitCode).toBe(1);
    expect(read()).toEqual({
      stdout: '',
      stderr: 'Usage: generate-release-notes <tag>\n',
    });
  });

  it('exits 0 and leaves stdout empty when GEMINI_API_KEY is missing', async () => {
    const { io, read } = createIo();

    const exitCode = await runGenerateReleaseNotes(['node', 'script', 'v0.0.0'], {}, {}, io);

    expect(exitCode).toBe(0);
    expect(read()).toEqual({
      stdout: '',
      stderr: 'GEMINI_API_KEY is not set; leaving release-please notes unchanged.\n',
    });
  });

  it('normalizes generated markdown before printing it to stdout', async () => {
    const { io, read } = createIo();
    const context: ReleaseContext = {
      tag: 'v1.2.3',
      previousTag: 'v1.2.2',
      currentRef: 'abcdef1',
      pullRequests: [
        {
          number: 42,
          title: 'feat: improve release notes',
          author: { login: 'alice' },
          labels: [],
          files: [],
          url: 'https://example.com/42',
        },
      ],
    };
    const loadContext = vi.fn(async () => context);
    const generateText = vi.fn(async () => '## Highlights\n- Better summaries.');

    const exitCode = await runGenerateReleaseNotes(
      ['node', 'script', 'v1.2.3'],
      { GEMINI_API_KEY: 'test-key' },
      { loadContext, generateText },
      io,
    );

    expect(exitCode).toBe(0);
    expect(loadContext).toHaveBeenCalledWith('v1.2.3', { GEMINI_API_KEY: 'test-key' });
    expect(generateText).toHaveBeenCalledOnce();
    expect(read()).toEqual({
      stdout: [
        '## Highlights',
        '- Better summaries.',
        '',
        '## Contributors',
        '<a href="https://github.com/alice" title="@alice"><img src="https://github.com/alice.png?size=64" width="64" height="64" alt="@alice" /></a>',
        '',
        '[@alice](https://github.com/alice)',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  it('prints nothing when generated notes only contain empty placeholders', async () => {
    const { io, read } = createIo();
    const context: ReleaseContext = {
      tag: 'v1.2.3',
      previousTag: 'v1.2.2',
      currentRef: 'abcdef1',
      pullRequests: [
        {
          number: 42,
          title: 'chore: no user visible release changes',
          author: { login: 'alice' },
          labels: [],
          files: [],
          url: 'https://example.com/42',
        },
      ],
    };
    const loadContext = vi.fn(async () => context);
    const generateText = vi.fn(async () => [
      '## Highlights',
      'None.',
      '',
      '## Reverts',
      'There are no reverts in this release.',
      '',
      '## Contributors',
      '- @alice',
    ].join('\n'));

    const exitCode = await runGenerateReleaseNotes(
      ['node', 'script', 'v1.2.3'],
      { GEMINI_API_KEY: 'test-key' },
      { loadContext, generateText },
      io,
    );

    expect(exitCode).toBe(0);
    expect(read()).toEqual({
      stdout: '',
      stderr: '',
    });
  });

  it('swallows generator errors and keeps release-please notes intact', async () => {
    const { io, read } = createIo();
    const loadContext = vi.fn(async () => {
      throw new Error('gh timed out');
    });

    const exitCode = await runGenerateReleaseNotes(
      ['node', 'script', 'v1.2.3'],
      { GEMINI_API_KEY: 'test-key' },
      { loadContext },
      io,
    );

    expect(exitCode).toBe(0);
    expect(read()).toEqual({
      stdout: '',
      stderr: 'Gemini release notes failed: gh timed out\n',
    });
  });

  it('updates the matching changelog entry from an existing notes file', async () => {
    const { io, read } = createIo();
    const tempDir = mkdtempSync(join(tmpdir(), 'webcmd-release-notes-'));
    const notesPath = join(tempDir, 'release-notes.md');
    const changelogPath = join(tempDir, 'CHANGELOG.md');

    try {
      writeFileSync(notesPath, [
        '## Highlights',
        '- Better generated notes.',
        '',
        '## Adapters',
        '- Added checkout adapter polish.',
        '',
      ].join('\n'));
      writeFileSync(changelogPath, [
        '# Changelog',
        '',
        '## [0.2.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.2...webcmd-v0.2.3) (2026-07-09)',
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
      ].join('\n'));

      const exitCode = await runGenerateReleaseNotes(
        ['node', 'script', '--update-changelog', 'webcmd-v0.2.3', notesPath, changelogPath],
        {},
        {},
        io,
      );

      expect(exitCode).toBe(0);
      expect(read()).toEqual({
        stdout: `Updated ${changelogPath} for webcmd-v0.2.3\n`,
        stderr: '',
      });
      const changelog = readFileSync(changelogPath, 'utf8');
      expect(changelog).toContain('### Highlights\n- Better generated notes.');
      expect(changelog).toContain('### Adapters\n- Added checkout adapter polish.');
      expect(changelog).not.toContain('release-please generated note');
      expect(changelog).toContain('* older note');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads bounded PR diffs into release context', async () => {
    const gh = vi.fn((args: readonly string[]) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/webcmd/releases?per_page=100') {
        return JSON.stringify([{ tag_name: 'v1.2.3' }, { tag_name: 'v1.2.2' }]);
      }
      if (key === 'api repos/acme/webcmd/compare/v1.2.2...v1.2.3') {
        return JSON.stringify({
          commits: [
            { sha: 'abc123', commit: { message: 'feat: improve releases (#42)\n\nBody' } },
          ],
        });
      }
      if (key === 'api repos/acme/webcmd/pulls/42') {
        return JSON.stringify({
          number: 42,
          title: 'feat: improve releases',
          body: 'Release polish.',
          user: { login: 'alice' },
          labels: [{ name: 'feature' }],
          html_url: 'https://github.com/acme/webcmd/pull/42',
          merged_at: '2026-07-03T00:00:00Z',
        });
      }
      if (key === 'api repos/acme/webcmd/pulls/42/files?per_page=100') {
        return JSON.stringify([{ filename: 'src/release-notes.ts' }]);
      }
      if (key === 'pr diff 42 --repo acme/webcmd') {
        return `diff --git a/src/release-notes.ts b/src/release-notes.ts\n${'x'.repeat(80)}`;
      }

      throw new Error(`unexpected gh call: ${key}`);
    });

    const context = await loadReleaseContext(
      'v1.2.3',
      { GITHUB_REPOSITORY: 'acme/webcmd' },
      { gh, maxDiffCharacters: 40 },
    );

    expect(context.pullRequests).toHaveLength(1);
    expect(context.pullRequests[0]?.diff).toBe('diff --git a/src/release-notes.ts b/src/\n[diff truncated]');
    expect(gh).toHaveBeenCalledWith(['pr', 'diff', '42', '--repo', 'acme/webcmd']);
  });

  it('keeps npm publish unblocked when enhanced release-note editing fails', () => {
    const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow.indexOf('- name: Publish to npm')).toBeLessThan(workflow.indexOf('- name: Update changelog with enhanced release notes'));
    expect(workflow).toContain('npm --silent run generate-release-notes -- --update-changelog');
    expect(workflow).toContain('git push origin "HEAD:${{ github.ref_name }}"');
    expect(workflow).toMatch(/if gh release edit "\$\{\{ steps\.release\.outputs\.tag_name \}\}" --notes-file "\$RUNNER_TEMP\/release-notes\.md"; then/);
    expect(workflow).toMatch(/Enhanced release notes could not be applied; keeping release-please notes\./);
  });
});
