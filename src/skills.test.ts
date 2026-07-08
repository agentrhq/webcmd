import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from './errors.js';
import { installWebcmdSkill, listWebcmdSkills, updateWebcmdSkill } from './skills.js';

function makePackageRoot(label = 'current'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `webcmd-skills-${label}-`));
  fs.mkdirSync(path.join(root, 'skills', 'webcmd-browser'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'webcmd-autofix'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'smart-search'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@agentrhq/webcmd"}\n');
  fs.writeFileSync(path.join(root, 'skills', 'webcmd-browser', 'SKILL.md'), [
    '---',
    'name: webcmd-browser',
    `description: Browser control skill ${label}`,
    'version: 1.2.3',
    '---',
    '',
    '# Browser',
    '',
    'Body.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skills', 'webcmd-autofix', 'SKILL.md'), [
    '---',
    'name: webcmd-autofix',
    'description: Fix adapters: keep scope narrow',
    '---',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skills', 'smart-search', 'SKILL.md'), [
    '---',
    'name: smart-search',
    'description: Search skill',
    '---',
    '',
  ].join('\n'));
  return root;
}

function real(filePath: string): string {
  return fs.realpathSync(filePath);
}

describe('webcmd skills content', () => {
  it('keeps bundled skill frontmatter valid yaml', () => {
    const skillsRoot = path.join(process.cwd(), 'skills');
    const skillNames = fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const name of skillNames) {
      const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
      const end = content.indexOf('\n---', 4);
      expect(end, name).toBeGreaterThan(0);
      expect(() => yaml.load(content.slice(4, end)), name).not.toThrow();
    }
  });

  it('lists bundled skills', () => {
    const root = makePackageRoot();

    expect(listWebcmdSkills(root).map((skill) => skill.name)).toEqual([
      'smart-search',
      'webcmd-autofix',
      'webcmd-browser',
    ]);
    expect(listWebcmdSkills(root).find((skill) => skill.name === 'webcmd-autofix')?.description)
      .toBe('Fix adapters: keep scope narrow');
  });

  it('keeps the expected installable skill set', () => {
    const skills = fs.readdirSync(path.join(process.cwd(), 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(skills).toEqual([
      'smart-search',
      'webcmd-adapter-author',
      'webcmd-autofix',
      'webcmd-browser',
      'webcmd-browser-sitemap',
      'webcmd-sitemap-author',
      'webcmd-usage',
    ]);
  });

  it('installs bundled skills once and refreshes them after package updates', () => {
    const firstRoot = makePackageRoot('first');
    const secondRoot = makePackageRoot('second');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-project-'));

    const installed = installWebcmdSkill({ packageRoot: firstRoot, homeDir, cwd, provider: 'codex', scope: 'project' });

    expect(installed).toMatchObject({
      provider: 'codex',
      scope: 'project',
    });
    expect(installed.skills.map((skill) => skill.name)).toEqual(['smart-search', 'webcmd-autofix', 'webcmd-browser']);
    for (const skill of installed.skills) {
      expect(skill.source).toBe(path.join(firstRoot, 'skills', skill.name));
      expect(skill.stableLink).toBe(path.join(homeDir, '.webcmd', 'skills', skill.name));
      expect(skill.destination).toBe(path.join(cwd, '.codex', 'skills', skill.name));
      expect(real(skill.destination!)).toBe(real(skill.source));
    }

    const updated = updateWebcmdSkill({ packageRoot: secondRoot, homeDir });

    expect(updated.skills.every((skill) => skill.destination === undefined)).toBe(true);
    for (const skill of installed.skills) {
      expect(real(skill.destination!)).toBe(real(path.join(secondRoot, 'skills', skill.name)));
    }
  });

  it('installs bundled skills into a custom skills directory', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const customPath = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-custom-skills-'));

    const installed = installWebcmdSkill({ packageRoot, homeDir, customPath });

    expect(installed.provider).toBeUndefined();
    expect(installed.skills.map((skill) => skill.destination)).toEqual([
      path.join(customPath, 'smart-search'),
      path.join(customPath, 'webcmd-autofix'),
      path.join(customPath, 'webcmd-browser'),
    ]);
    for (const skill of installed.skills) {
      expect(real(skill.destination!)).toBe(real(skill.source));
    }
  });

  it('refuses to replace real files or directories', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const stablePath = path.join(homeDir, '.webcmd', 'skills', 'smart-search');
    fs.mkdirSync(stablePath, { recursive: true });

    expect(() => updateWebcmdSkill({ packageRoot, homeDir })).toThrow(ArgumentError);
  });
});
