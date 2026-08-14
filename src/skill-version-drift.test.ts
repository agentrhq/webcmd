import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findSkillVersionDrift, formatSkillVersionDriftIssue } from './skill-version-drift.js';

function withTempDirs(fn: (dirs: { root: string; homeDir: string; cwd: string }) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-skill-drift-'));
  try {
    const homeDir = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fn({ root, homeDir, cwd });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedPluginCache(homeDir: string, version: string): void {
  fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'cache', 'webcmd', 'webcmd', version), { recursive: true });
}

function seedSymlinkedSkills(homeDir: string): void {
  const skillsDir = path.join(homeDir, '.webcmd', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const target = path.join(homeDir, '.webcmd', 'skills-target');
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, path.join(skillsDir, 'webcmd-usage'), 'dir');
}

describe('skill version drift detection', () => {
  it('reports drift when the plugin cache is pinned behind the running CLI and symlinked skills exist too', () => {
    withTempDirs(({ homeDir, cwd }) => {
      seedPluginCache(homeDir, '0.6.0');
      seedSymlinkedSkills(homeDir);

      const drift = findSkillVersionDrift('0.6.1', { homeDir, cwd });
      expect(drift).toEqual({
        cliVersion: '0.6.1',
        pluginCacheVersion: '0.6.0',
        pluginCachePath: path.join(homeDir, '.claude', 'plugins', 'cache', 'webcmd', 'webcmd', '0.6.0'),
      });
    });
  });

  it('picks the highest installed plugin-cache version when several are present', () => {
    withTempDirs(({ homeDir, cwd }) => {
      seedPluginCache(homeDir, '0.5.3');
      seedPluginCache(homeDir, '0.6.0');
      seedPluginCache(homeDir, '0.10.0');
      seedSymlinkedSkills(homeDir);

      const drift = findSkillVersionDrift('0.10.1', { homeDir, cwd });
      expect(drift?.pluginCacheVersion).toBe('0.10.0');
    });
  });

  it('reports no drift when the plugin cache version matches the CLI', () => {
    withTempDirs(({ homeDir, cwd }) => {
      seedPluginCache(homeDir, '0.6.1');
      seedSymlinkedSkills(homeDir);

      expect(findSkillVersionDrift('0.6.1', { homeDir, cwd })).toBeNull();
    });
  });

  it('reports no drift when only the Claude Code plugin channel is installed', () => {
    withTempDirs(({ homeDir, cwd }) => {
      seedPluginCache(homeDir, '0.6.0');

      expect(findSkillVersionDrift('0.6.1', { homeDir, cwd })).toBeNull();
    });
  });

  it('reports no drift when only the npm symlink channel is installed', () => {
    withTempDirs(({ homeDir, cwd }) => {
      seedSymlinkedSkills(homeDir);

      expect(findSkillVersionDrift('0.6.1', { homeDir, cwd })).toBeNull();
    });
  });

  it('reports no drift when neither channel is installed', () => {
    withTempDirs(({ homeDir, cwd }) => {
      expect(findSkillVersionDrift('0.6.1', { homeDir, cwd })).toBeNull();
    });
  });

  it('formats a doctor issue naming both versions and the fix command', () => {
    const issue = formatSkillVersionDriftIssue({
      cliVersion: '0.6.1',
      pluginCacheVersion: '0.6.0',
      pluginCachePath: '/home/me/.claude/plugins/cache/webcmd/webcmd/0.6.0',
    });

    expect(issue).toContain('0.6.0');
    expect(issue).toContain('0.6.1');
    expect(issue).toContain('claude plugin update webcmd@webcmd');
  });
});
