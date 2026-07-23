import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from './errors.js';
import { addWebcmdSkills, listWebcmdSkills, removeWebcmdSkills, updateWebcmdSkill } from './skills.js';

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

function bundledSkill(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'skills', name, 'SKILL.md'), 'utf8');
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

  it('enforces mode-neutral authentication and human handoff policy', () => {
    const browser = bundledSkill('webcmd-browser');
    const usage = bundledSkill('webcmd-usage');
    const autofix = bundledSkill('webcmd-autofix');
    const author = bundledSkill('webcmd-adapter-author');
    const skills = [browser, usage, autofix, author];
    const handoffSkills = [browser, usage, autofix];
    const autofixAuthRequired = autofix.match(/^- \*\*`AUTH_REQUIRED`\*\*[\s\S]*?(?=\n- \*\*)/m)?.[0] ?? '';
    const autofixAuthRequiredRow = autofix.split('\n')
      .find((line) => line.startsWith('| AUTH_REQUIRED |')) ?? '';

    expect(browser).toContain('webcmd <site> login');
    expect(browser).toContain('webcmd <site> whoami');
    expect(browser).toContain('CAPTCHA');
    expect(browser).toContain('fresh browser state');
    expect(browser).not.toContain('hunter2');
    expect(browser).not.toMatch(/browser login type/i);
    expect(usage).toContain('AUTH_REQUIRED');
    expect(usage).toContain('action_required');
    expect(autofix).toContain('webcmd <site> login');
    expect(author).toContain('registerSiteAuthCommands');
    for (const skill of handoffSkills) {
      expect(skill).toContain('handoff.status');
      expect(skill).toContain('handoff.viewUrl');
      expect(skill).toContain('handoff.verifyCommand');
      expect(skill).toContain('Webcmd browser:');
      expect(skill).not.toMatch(/\bhosted\b|\bKernel\b|\blocal mode\b|\blocally\b/i);
    }
    for (const skill of [browser, usage]) {
      expect(skill).toContain('already_logged_in');
      expect(skill).toContain('in_progress');
      expect(skill).toContain('action_url');
      expect(skill).toContain('view_url');
      expect(skill).toMatch(/in_progress[^\n]*(?:do not ask the user|do not wait for user confirmation)/i);
      expect(skill).toMatch(/(?:action_url|view_url|handoff\.viewUrl|Webcmd browser:)[\s\S]{0,300}user/i);
    }
    for (const skill of skills) {
      expect(skill).toContain('action_required');
      expect(skill).toContain('verify_command');
      expect(skill).toMatch(/verify_command[\s\S]{0,250}verification must succeed[\s\S]{0,250}retry/i);
      expect(skill).toMatch(/verify_command[\s\S]{0,250}user[\s\S]{0,250}(?:done|complet)/i);
      expect(skill).toMatch(/CAPTCHA[\s\S]{0,250}(?:human handoff|stop(?:s)? automation)/i);
      expect(skill).toMatch(/(?:must not|never).*?(?:password|secret|credential)/i);
    }
    for (const skill of [browser, usage, autofix]) {
      expect(skill).toMatch(/(?:no (?:site )?login command|without a verifier)[\s\S]{0,500}fresh browser state[\s\S]{0,500}(?:identity check|post-action state)[\s\S]{0,250}before (?:any )?retry/i);
    }
    expect(autofixAuthRequired).toMatch(/if (?:a|the) site login command exists[\s\S]*webcmd <site> login[\s\S]*returned `verify_command`[\s\S]*verification must succeed[\s\S]*retry/i);
    expect(autofixAuthRequired).toMatch(/no site login command[\s\S]*stop (?:browser )?writes[\s\S]*visible browser[\s\S]*fresh browser state[\s\S]*(?:identity check|post-action state)[\s\S]*before retry[\s\S]*report alone is not verification/i);
    expect(autofixAuthRequiredRow).toMatch(/conditional[^|]*Safety Boundaries|no site login command/i);
    expect(autofix).toMatch(/CAPTCHA[\s\S]{0,250}stop automation[\s\S]{0,250}verification must succeed/i);
  });

  it('adds bundled skills once and refreshes them after package updates', () => {
    const firstRoot = makePackageRoot('first');
    const secondRoot = makePackageRoot('second');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-project-'));

    const added = addWebcmdSkills({ packageRoot: firstRoot, homeDir, cwd, provider: 'codex', scope: 'project' });

    expect(added).toMatchObject({
      provider: 'codex',
      scope: 'project',
    });
    expect(added.skills.map((skill) => skill.name)).toEqual(['smart-search', 'webcmd-autofix', 'webcmd-browser']);
    for (const skill of added.skills) {
      expect(skill.source).toBe(path.join(firstRoot, 'skills', skill.name));
      expect(skill.stableLink).toBe(path.join(homeDir, '.webcmd', 'skills', skill.name));
      expect(skill.destination).toBe(path.join(cwd, '.codex', 'skills', skill.name));
      expect(real(skill.destination!)).toBe(real(skill.source));
    }

    const updated = updateWebcmdSkill({ packageRoot: secondRoot, homeDir });

    expect(updated.skills.every((skill) => skill.destination === undefined)).toBe(true);
    for (const skill of added.skills) {
      expect(real(skill.destination!)).toBe(real(path.join(secondRoot, 'skills', skill.name)));
    }
  });

  it('adds bundled skills into a custom skills directory', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const customPath = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-custom-skills-'));

    const added = addWebcmdSkills({ packageRoot, homeDir, customPath });

    expect(added.provider).toBeUndefined();
    expect(added.skills.map((skill) => skill.destination)).toEqual([
      path.join(customPath, 'smart-search'),
      path.join(customPath, 'webcmd-autofix'),
      path.join(customPath, 'webcmd-browser'),
    ]);
    for (const skill of added.skills) {
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

  it('removes bundled skill links from every supported location', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-project-'));
    const customPath = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-custom-skills-'));

    for (const provider of ['agents', 'codex', 'claude']) {
      addWebcmdSkills({ packageRoot, homeDir, cwd, provider, scope: 'user' });
      addWebcmdSkills({ packageRoot, homeDir, cwd, provider, scope: 'project' });
    }
    addWebcmdSkills({ packageRoot, homeDir, cwd, customPath });

    const result = removeWebcmdSkills({ packageRoot, homeDir, cwd, customPath });

    expect(result.removed).toHaveLength(24);
    for (const linkPath of result.removed) {
      expect(() => fs.lstatSync(linkPath)).toThrow();
    }
    expect(removeWebcmdSkills({ packageRoot, homeDir, cwd, customPath })).toEqual({ removed: [] });
  });

  it('refuses removal before deleting any links when a destination is not a symlink', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-project-'));
    const added = addWebcmdSkills({ packageRoot, homeDir, cwd, provider: 'agents', scope: 'user' });
    const blocker = path.join(cwd, '.codex', 'skills', 'smart-search');
    fs.mkdirSync(blocker, { recursive: true });

    expect(() => removeWebcmdSkills({ packageRoot, homeDir, cwd })).toThrow(ArgumentError);
    expect(fs.lstatSync(added.skills[0].destination!).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(blocker).isDirectory()).toBe(true);
  });
});
