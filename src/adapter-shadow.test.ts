import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findShadowedUserAdapters, formatAdapterShadowIssue } from './adapter-shadow.js';

function withTempDirs(fn: (dirs: { root: string; userClisDir: string; pluginsDir: string; homeDir: string }) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-adapter-shadow-'));
  try {
    fn({
      root,
      userClisDir: path.join(root, 'user-clis'),
      pluginsDir: path.join(root, 'plugins'),
      homeDir: path.join(root, 'home'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('adapter shadow detection', () => {
  it('detects a clis command that shadows an installed plugin command', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, 'linkedin'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'linkedin'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, 'linkedin', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(pluginsDir, 'linkedin', 'search.js'), '', 'utf-8');

      const shadows = findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir });
      expect(shadows).toEqual([{
        name: 'linkedin/search',
        userPath: path.join(userClisDir, 'linkedin', 'search.js'),
        pluginPath: path.join(pluginsDir, 'linkedin', 'search.js'),
        plugin: 'linkedin',
        hasProvenance: false,
      }]);
    });
  });

  it('ignores a clis command with no matching plugin command', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, 'mysite'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, 'mysite', 'run.js'), '', 'utf-8');

      expect(findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir })).toEqual([]);
    });
  });

  it('ignores .base copies', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, '.base', 'linkedin'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'linkedin'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, '.base', 'linkedin', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(pluginsDir, 'linkedin', 'search.js'), '', 'utf-8');

      expect(findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir })).toEqual([]);
    });
  });

  it('reports hasProvenance true when an override record exists for the command', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, 'linkedin'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'linkedin'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, 'linkedin', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(pluginsDir, 'linkedin', 'search.js'), '', 'utf-8');
      fs.mkdirSync(path.join(homeDir, '.webcmd'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.webcmd', 'override-provenance.json'),
        JSON.stringify({
          'linkedin/search': {
            plugin: 'linkedin',
            commitHash: null,
            sourcePath: path.join(userClisDir, 'linkedin', 'search.js'),
            sourceSha256: 'abc',
            basePath: path.join(userClisDir, '.base', 'linkedin', 'search.js'),
            createdAt: new Date().toISOString(),
          },
        }),
        'utf-8',
      );

      const shadows = findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir });
      expect(shadows).toEqual([{
        name: 'linkedin/search',
        userPath: path.join(userClisDir, 'linkedin', 'search.js'),
        pluginPath: path.join(pluginsDir, 'linkedin', 'search.js'),
        plugin: 'linkedin',
        hasProvenance: true,
      }]);
    });
  });

  it('does not report a file the override itself copied to stay loadable', () => {
    // Forking a command copies its import closure into clis/. Reporting those
    // copies as unexplained local adapters would make doctor tell the user to
    // reset the override they just created.
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, 'linkedin'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'linkedin'), { recursive: true });
      for (const dir of [path.join(userClisDir, 'linkedin'), path.join(pluginsDir, 'linkedin')]) {
        fs.writeFileSync(path.join(dir, 'search.js'), '', 'utf-8');
        fs.writeFileSync(path.join(dir, 'shared.js'), '', 'utf-8');
      }
      fs.mkdirSync(path.join(homeDir, '.webcmd'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.webcmd', 'override-provenance.json'),
        JSON.stringify({
          'linkedin/search': {
            plugin: 'linkedin',
            commitHash: null,
            sourcePath: path.join(pluginsDir, 'linkedin', 'search.js'),
            sourceSha256: 'abc',
            basePath: path.join(userClisDir, '.base', 'linkedin', 'search.js'),
            createdAt: new Date().toISOString(),
            dependencies: [{ path: 'shared.js', sha256: 'def' }],
          },
        }),
        'utf-8',
      );

      expect(findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir }).map((s) => s.name))
        .toEqual(['linkedin/search']);
    });
  });

  it('still reports a local file that merely shares a name with another override dependency', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(path.join(userClisDir, 'twitter'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'twitter'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, 'twitter', 'shared.js'), '', 'utf-8');
      fs.writeFileSync(path.join(pluginsDir, 'twitter', 'shared.js'), '', 'utf-8');
      fs.mkdirSync(path.join(homeDir, '.webcmd'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.webcmd', 'override-provenance.json'),
        JSON.stringify({
          'linkedin/search': {
            plugin: 'linkedin',
            commitHash: null,
            sourcePath: path.join(pluginsDir, 'linkedin', 'search.js'),
            sourceSha256: 'abc',
            basePath: path.join(userClisDir, '.base', 'linkedin', 'search.js'),
            createdAt: new Date().toISOString(),
            dependencies: [{ path: 'shared.js', sha256: 'def' }],
          },
        }),
        'utf-8',
      );

      expect(findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir }).map((s) => s.name))
        .toEqual(['twitter/shared']);
    });
  });

  it('yields no shadows when the plugins dir does not exist yet (no plugins installed)', () => {
    withTempDirs(({ userClisDir, pluginsDir, homeDir }) => {
      fs.mkdirSync(userClisDir, { recursive: true });
      expect(findShadowedUserAdapters({ userClisDir, pluginsDir, homeDir })).toEqual([]);
    });
  });

  it('throws rather than reporting no shadows when the plugins dir is unreadable', () => {
    withTempDirs(({ userClisDir, homeDir }) => {
      fs.mkdirSync(userClisDir, { recursive: true });
      expect(() => findShadowedUserAdapters({
        userClisDir,
        pluginsDir: path.join(userClisDir, 'nope', 'deep'),
        homeDir,
      })).toThrow();
    });
  });

  it('throws when the plugins dir path exists but is a file, not a directory', () => {
    withTempDirs(({ userClisDir, root, homeDir }) => {
      fs.mkdirSync(userClisDir, { recursive: true });
      const notADir = path.join(root, 'plugins-file');
      fs.writeFileSync(notADir, '', 'utf-8');
      expect(() => findShadowedUserAdapters({ userClisDir, pluginsDir: notADir, homeDir })).toThrow();
    });
  });

  it('would fail if detection reverted to comparing against a packaged clis dir', () => {
    // Regression guard for the exact bug this task fixes: a plugin install directory,
    // not a bundled "clis" directory shipped with the package, must be what's compared.
    withTempDirs(({ userClisDir, root, homeDir }) => {
      const packagedClisDir = path.join(root, 'clis'); // stand-in for the removed packageRoot/clis
      fs.mkdirSync(path.join(userClisDir, 'linkedin'), { recursive: true });
      fs.mkdirSync(path.join(packagedClisDir, 'linkedin'), { recursive: true });
      fs.writeFileSync(path.join(userClisDir, 'linkedin', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(packagedClisDir, 'linkedin', 'search.js'), '', 'utf-8');

      // pluginsDir has nothing installed, so a correct implementation reports no shadow,
      // even though a "packagedClisDir" comparison would have found one.
      expect(findShadowedUserAdapters({
        userClisDir,
        pluginsDir: path.join(root, 'plugins'),
        homeDir,
      })).toEqual([]);
    });
  });

  it('formats a concise doctor issue', () => {
    const issue = formatAdapterShadowIssue([
      {
        name: 'linkedin/search',
        userPath: '/home/me/.webcmd/clis/linkedin/search.js',
        pluginPath: '/home/me/.webcmd/plugins/linkedin/search.js',
        plugin: 'linkedin',
        hasProvenance: false,
      },
    ]);

    expect(issue).toContain('linkedin/search');
    expect(issue).not.toContain('packaged');
    expect(issue).toContain('adapter override');
    expect(issue).toContain('adapter reset <site>');
  });
});
