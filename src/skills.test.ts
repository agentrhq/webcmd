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
  it('keeps smart search on live discovery and explicit browser Sessions', () => {
    const skill = bundledSkill('smart-search');
    const browser = bundledSkill('webcmd-browser');
    const skills = [skill, browser];
    const sessionId = 'session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45';
    const sessionWorkflow = [
      'webcmd --profile work session create',
      `webcmd --profile work --session ${sessionId} browser run --stdin`,
      `webcmd --profile work --session ${sessionId} browser snapshot --snapshot-mode read`,
      `webcmd --profile work session close ${sessionId}`,
    ];
    expect(skill).toContain('webcmd list --tag search -f json');
    expect(skill).toContain('webcmd plugin search');
    expect(skill).toContain('webcmd plugin install');
    expect(skill).toContain('webcmd web fetch --url');
    expect(skill).toContain('first-choice Webcmd fetch path');
    expect(skill).toContain('FETCH_BLOCKED');
    expect(skill).toContain('FETCH_REQUIRES_BROWSER');
    for (const guide of skills) {
      const normalizedGuide = guide.replaceAll(/\\\n\s*/g, ' ').replaceAll(/ {2,}/g, ' ');
      for (const command of sessionWorkflow) {
        expect(normalizedGuide).toContain(command);
      }
      expect(guide).toMatch(/web fetch.*(?:remains|runs).*local/i);
      expect(guide).toMatch(/web fetch.*never opens a browser/i);
      expect(guide).toMatch(/local.*Cloak[\s\S]{0,160}hosted.*Webcmd Cloud.*Browser Use/i);
      expect(guide).not.toMatch(/fetch-browser|web read|--browser/i);
    }
    expect(skill).toContain('Search Summary');
    expect(skill).toMatch(/at most three.*plugin/i);
    expect(skill).toMatch(/up to five.*candidate/i);
    expect(skill).toMatch(/three.*URL.*default/i);
    expect(skill).toMatch(/two.*browser.*Session/i);
    expect(skill).toContain('## Site-named fast path');
    expect(skill).toMatch(/cost order is mandatory when the request does not name a site/i);
    expect(skill).not.toContain('references/sources-');
    for (const name of ['ai', 'info', 'media', 'other', 'shopping', 'social', 'tech', 'travel']) {
      expect(fs.existsSync(path.join(process.cwd(), 'skills', 'smart-search', 'references', `sources-${name}.md`))).toBe(false);
    }
  });
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
    const usage = bundledSkill('webcmd-usage');
    const autofix = bundledSkill('webcmd-autofix');
    const author = bundledSkill('webcmd-adapter-author');
    const skills = [usage, autofix, author];
    const handoffSkills = [usage, autofix];
    const autofixAuthRequired = autofix.match(/^- \*\*`AUTH_REQUIRED`\*\*[\s\S]*?(?=\n- \*\*)/m)?.[0] ?? '';
    const autofixAuthRequiredRow = autofix.split('\n')
      .find((line) => line.startsWith('| AUTH_REQUIRED |')) ?? '';

    expect(usage).toContain('AUTH_REQUIRED');
    expect(usage).toContain('action_required');
    expect(autofix).toContain('webcmd <site> login');
    expect(author).toContain('registerSiteAuthCommands');
    for (const skill of handoffSkills) {
      expect(skill).toContain('handoff.status');
      expect(skill).toContain('handoff.viewUrl');
      expect(skill).toContain('handoff.verifyCommand');
      expect(skill).toContain('Webcmd browser:');
      expect(skill).not.toMatch(/\bhosted\b|\blocal mode\b|\blocally\b/i);
    }
    for (const skill of [usage]) {
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
    for (const skill of [usage, autofix]) {
      expect(skill).toMatch(/(?:no (?:site )?login command|without a verifier)[\s\S]{0,500}fresh browser state[\s\S]{0,500}(?:identity check|post-action state)[\s\S]{0,250}before (?:any )?retry/i);
    }
    expect(autofixAuthRequired).toMatch(/if (?:a|the) site login command exists[\s\S]*webcmd <site> login[\s\S]*returned `verify_command`[\s\S]*verification must succeed[\s\S]*retry/i);
    expect(autofixAuthRequired).toMatch(/no site login command[\s\S]*stop (?:browser )?writes[\s\S]*visible browser[\s\S]*fresh browser state[\s\S]*(?:identity check|post-action state)[\s\S]*before retry[\s\S]*report alone is not verification/i);
    expect(autofixAuthRequiredRow).toMatch(/conditional[^|]*Safety Boundaries|no site login command/i);
    expect(autofix).toMatch(/CAPTCHA[\s\S]{0,250}stop automation[\s\S]{0,250}verification must succeed/i);
  });

  it('teaches the run-first Playwright lifecycle and preserves the adapter API boundary', () => {
    const browser = bundledSkill('webcmd-browser');
    const usage = bundledSkill('webcmd-usage');
    const author = bundledSkill('webcmd-adapter-author');
    const browserRunReference = fs.readFileSync(
      path.join(
        process.cwd(),
        'skills',
        'webcmd-browser',
        'references',
        'browser-run-playwright.md',
      ),
      'utf8',
    );
    const siteReconReference = fs.readFileSync(
      path.join(process.cwd(), 'skills', 'webcmd-adapter-author', 'references', 'site-recon.md'),
      'utf8',
    );
    expect(usage).toMatch(/existing adapter command first[\s\S]{0,220}load `webcmd-browser`[\s\S]{0,120}root `--session <session-id>`/i);
    expect(browser).toMatch(/`tabs`, `bind --page`, `snapshot`, and `run`/i);
    expect(browser).toContain('webcmd --session <session-id> browser tabs');
    expect(browser).toContain('webcmd --session <session-id> browser bind --page');
    expect(browser).toContain('webcmd --session <session-id> browser run --stdin');
    expect(browser).toContain('webcmd session close <session-id>');
    expect(browser).toMatch(/read-only/i);
    expect(browser).toMatch(/explicit(?:ly)? bind/i);
    expect(browser).toMatch(/fresh JavaScript scope/i);
    expect(browser).toMatch(/persistent browser state/i);
    expect(browser).toContain("run --stdin <<'JS'");
    expect(browser).toContain("await page.getByRole('link', { name: 'More information' }).click()");
    expect(browser).toContain('webcmd --session <session-id> browser snapshot');
    expect(browser).toContain('--snapshot-mode act');
    expect(browser).toContain('--snapshot-mode tree');
    expect(browser).toContain('--snapshot-mode read');
    expect(browser).toContain('--no-snapshot-diff');
    expect(browser).not.toContain('page.snapshotForAI()');
    expect(browser).not.toContain('--snapshot-diff');
    expect(browserRunReference).toMatch(/QuickJS/);
    expect(browserRunReference).toMatch(/page\.evaluate/);
    expect(browserRunReference).toMatch(/artifact/i);
    expect(browserRunReference).toContain("writeArtifact(");
    expect(browserRunReference).toMatch(/errors/i);
    expect(browserRunReference).toMatch(/snapshot behavior/i);
    expect(browserRunReference).toContain('--snapshot-mode act|tree');
    expect(browserRunReference).toMatch(/timing/i);
    expect(author).toContain('webcmd browser init');
    expect(author).toContain('webcmd browser verify');
    expect(author).toContain('IPage');
    expect(author).toMatch(/Browser-run’s Playwright-style `page`[\s\S]{0,240}adapter `func\(page,args\)` are different contracts/i);
    expect(browser).not.toContain('browser.currentPage()');
    expect(browser).not.toContain('--observe');
    expect(browser).not.toContain('--tab');
    expect(browser).not.toMatch(/webcmd browser \S+ (?:open|state|click|type|select|find|extract|network)/i);
    expect(browserRunReference).not.toContain('browser.currentPage()');
    expect(browserRunReference).not.toContain('--observe');
    expect(browserRunReference).not.toContain('--tab');
    expect(siteReconReference).toContain("webcmd --session <session-id> browser run --stdin <<'JS'");
    expect(siteReconReference).toContain('page.waitForResponse(');
    expect(siteReconReference).not.toMatch(/webcmd browser \S+ (?:open|state|click|type|select|find|extract|network|wait|eval)/i);
  });

  it('teaches CLI-based hosted adapter authoring', () => {
    const author = bundledSkill('webcmd-adapter-author');
    const adapterTemplate = fs.readFileSync(
      path.join(process.cwd(), 'skills', 'webcmd-adapter-author', 'references', 'adapter-template.md'),
      'utf8',
    );
    const jsdomFixturePattern = fs.readFileSync(
      path.join(process.cwd(), 'skills', 'webcmd-adapter-author', 'references', 'jsdom-fixture-pattern.md'),
      'utf8',
    );

    expect(author).toContain('webcmd site memory');
    expect(author).toContain('webcmd adapter source');
    expect(author).toContain('webcmd browser init');
    expect(author).toContain('webcmd browser verify');
    expect(adapterTemplate).toContain('webcmd site fixture get');
    expect(adapterTemplate).toContain('webcmd site fixture put');
    expect(adapterTemplate).not.toContain('~/.webcmd/');
    expect(jsdomFixturePattern).toContain('webcmd site sample add');
    expect(jsdomFixturePattern).not.toContain('~/.webcmd/');
  });

  it('distinguishes local adapter path lookup from hosted source reads and writes', () => {
    const author = bundledSkill('webcmd-adapter-author');
    const autofix = bundledSkill('webcmd-autofix');
    const community = fs.readFileSync(path.join(process.cwd(), 'docs', 'publish-community-plugin.mdx'), 'utf8');

    for (const instruction of [author, community]) {
      expect(instruction).toMatch(/local(?:ly)?[\s\S]{0,180}adapter path[\s\S]{0,180}(?:edit|patch)/i);
      expect(instruction).toMatch(/hosted[\s\S]{0,180}adapter source get\|put/i);
    }
    expect(autofix).toMatch(/adapter path[\s\S]{0,180}patch that file/i);
    expect(autofix).toMatch(/WebCMD Cloud[\s\S]{0,180}adapter source get[\s\S]{0,180}adapter source put/i);
  });

  it('keeps raw browser and handoff work scoped to explicit Sessions', () => {
    const usage = bundledSkill('webcmd-usage');
    const browser = bundledSkill('webcmd-browser');
    const autofix = bundledSkill('webcmd-autofix');

    expect(usage).toContain('webcmd session create -f json');
    expect(usage).toContain('first-choice Webcmd fetch path');
    expect(usage).toContain('webcmd profile create work');
    expect(usage).toContain('webcmd --session session_abc browser');
    expect(usage).toContain('SESSION_BUSY');
    expect(usage).toContain('SESSION_REQUIRED');
    expect(usage).toMatch(/Adapter commands may omit `--session`[\s\S]{0,200}adapter-default session/i);
    expect(usage).toMatch(/retired positional session form is invalid/i);
    expect(browser).toContain('webcmd profile create work');
    expect(browser).toMatch(/Profiles are cookie jars[\s\S]{0,180}sessions are browser workspaces\/windows/i);
    expect(browser).toMatch(/Parallel agents use separate sessions/i);
    expect(browser).toContain('SESSION_BUSY');
    expect(browser).toContain('SESSION_PAUSED_FOR_HUMAN_HANDOFF');
    expect(browser).toContain('webcmd session close <session-id> --force');
    expect(usage).toMatch(/second `webcmd --session <id>/);
    expect(browser).toContain('Do not implement Session occupancy inside the page');
    for (const skill of [usage, browser, autofix]) {
      expect(skill).toMatch(/handoff is scoped to (?:its|the) Session/i);
      expect(skill).toMatch(/(?:verify_command|handoff\.verifyCommand)[\s\S]{0,200}verbatim[\s\S]{0,120}`--session`/i);
      expect(skill).toMatch(/(?:cannot be closed|close is blocked|do not close)[\s\S]{0,100}handoff|handoff[\s\S]{0,100}(?:cannot be closed|close is blocked|do not close)/i);
    }
  });

  it('keeps browser behavioral policy while pruning removed command instructions', () => {
    const browser = bundledSkill('webcmd-browser');

    for (const heading of [
      '## Adapter fallback gate',
      '## Prerequisites',
      '## Session lifecycle',
      '## Mental model',
      '## Chaining rules',
      '### Authentication and human handoff',
      '## Pitfalls',
      '## Troubleshooting',
    ]) {
      expect(browser).toContain(heading);
    }

    for (const required of [
      'Absence from truncated output never proves that no adapter exists',
      'Create an opaque browser session before raw browser work',
      'fresh JavaScript scope',
      'persistent browser state',
      'Never ask for or type passwords',
      'CAPTCHA',
      "The user's report alone is not verification",
      'Do not submit forms via',
      'Do not reuse observations across a page transition',
      'Screenshots are for humans, not for agents',
      'timeout warns that side effects may have occurred',
    ]) {
      expect(browser).toContain(required);
    }

    expect(browser).not.toMatch(/webcmd browser \S+ (?:open|state|click|type|select|find|extract|network|wait|eval|frames|screenshot|scroll|back|keys)\b/i);
    expect(browser).not.toMatch(/^### (?:Inspect|Get|Interact|Wait|Extract|Network)$/m);
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
