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
  return root;
}

function real(filePath: string): string {
  return fs.realpathSync(filePath);
}

function bundledSkill(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'skills', name, 'SKILL.md'), 'utf8');
}

function bundledReference(name: string): string {
  const file = path.join(process.cwd(), 'skills', 'webcmd-browser', 'references', name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const RETIRED_SKILLS = [
  'smart-search',
  'webcmd-adapter-author',
  'webcmd-autofix',
  'webcmd-browser-sitemap',
  'webcmd-sitemap-author',
  'webcmd-usage',
] as const;

const PRODUCT_ROOTS = [
  'src',
  'scripts',
  'skills',
  'mcp-skills',
  'skill-src',
  'docs',
  'README.md',
  'PRIVACY.md',
  '.codex-plugin',
  'benchmarks',
  'start.md',
  'Makefile',
];

function productFiles(): string[] {
  const files: string[] = [];
  const collect = (absolute: string) => {
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      if (/\.(?:ts|mjs|js|md|mdx|json|py)$/.test(absolute) || path.basename(absolute) === 'Makefile') files.push(absolute);
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collect(path.join(absolute, entry.name));
    }
  };
  for (const root of PRODUCT_ROOTS) {
    const absolute = path.join(process.cwd(), root);
    if (fs.existsSync(absolute)) collect(absolute);
  }
  return files;
}

function withoutRetiredList(file: string, text: string): string {
  if (file.endsWith(`${path.sep}skills.test.ts`)) {
    return text.replace(/const RETIRED_SKILLS = \[[\s\S]*?\] as const;/, '');
  }
  return text;
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

    expect(listWebcmdSkills(root).map((skill) => skill.name)).toEqual(['webcmd-browser']);
    expect(listWebcmdSkills(root)[0]?.description).toBe('Browser control skill current');
    expect(listWebcmdSkills(process.cwd()).map((skill) => skill.name)).toEqual(['webcmd-browser']);
  });

  it('keeps the expected installable skill set', () => {
    const skills = fs.readdirSync(path.join(process.cwd(), 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(skills).toEqual(['webcmd-browser']);
  });

  it('triggers on live browser tasks and routes detail to exactly four references', () => {
    const browser = bundledSkill('webcmd-browser');
    const end = browser.indexOf('\n---', 4);
    const frontmatter = yaml.load(browser.slice(4, end)) as { description?: string };
    const refs = fs.readdirSync(path.join(process.cwd(), 'skills', 'webcmd-browser', 'references')).sort();

    expect(frontmatter.description).toMatch(/live browser/i);
    expect(frontmatter.description).not.toMatch(/adapter|plugin|search|fetch|repair|router/i);
    expect(refs).toEqual([
      'browser-run-playwright.md',
      'candidate-schema.md',
      'git-lifecycle.md',
      'sitemap-memory.md',
    ]);
    expect(browser).toContain('references/browser-run-playwright.md');
    expect(browser).toContain('references/candidate-schema.md');
    expect(browser).toContain('references/git-lifecycle.md');
    expect(browser).toContain('references/sitemap-memory.md');
    for (const retired of RETIRED_SKILLS) {
      expect(browser).not.toContain(retired);
    }
  });

  it('requires site memory context before any live browser action', () => {
    const browser = bundledSkill('webcmd-browser');
    const contextAt = browser.indexOf('webcmd site memory context');
    const runAt = browser.indexOf('browser run');
    const snapshotAt = browser.indexOf('browser snapshot');
    const tabsAt = browser.indexOf('browser tabs');

    expect(browser).toContain('webcmd site memory context');
    expect(browser).toContain('--task-id');
    expect(contextAt).toBeGreaterThanOrEqual(0);
    expect(contextAt).toBeLessThan(runAt);
    expect(contextAt).toBeLessThan(snapshotAt);
    expect(contextAt).toBeLessThan(tabsAt);
  });

  it('teaches selective candidates, no trivial capture, immediate warnings, and the candidate schema', () => {
    const schema = bundledReference('candidate-schema.md');
    const browser = bundledSkill('webcmd-browser');

    expect(browser).toContain('webcmd site memory candidate add');
    expect(schema).toContain('action_space');
    expect(schema).toContain('better_path');
    expect(schema).toContain('access');
    expect(schema).toContain('high_consequence');
    expect(schema).toContain('repeated_mistake');
    expect(schema).toContain('--claim');
    expect(schema).toContain('--evidence');
    expect(schema).toContain('--consequence');
    expect(schema).toMatch(/high_consequence[\s\S]{0,240}immediate/i);
    expect(schema).toMatch(/trivial|no-op/i);
    expect(schema).toMatch(/do not (?:capture|record)|never (?:capture|record)/i);
    expect(schema).toMatch(/secret/i);
    expect(schema).not.toContain('trivial_success');
  });

  it('teaches post-capture inspection and ingestion judgment', () => {
    const schema = bundledReference('candidate-schema.md');

    expect(schema).toMatch(/after capture[\s\S]{0,120}(?:search|inspect)|(?:search|inspect)[\s\S]{0,120}after capture/i);
    expect(schema).toMatch(/semantically related pending/i);
    expect(schema).toContain('observed_date_utc');
    expect(schema).toMatch(/two distinct/i);
    expect(schema).toMatch(/judgment[\s\S]{0,80}not automatic|not automatic[\s\S]{0,80}judgment/i);
    expect(schema).toMatch(/high_consequence[\s\S]{0,220}silent/i);
    expect(schema).toMatch(/conflict[\s\S]{0,180}later[- ]date/i);
    expect(schema).toContain('direct_correction');
    expect(schema).toMatch(/factual memory[\s\S]{0,80}stale|stale[\s\S]{0,80}factual memory/i);
    expect(schema).toMatch(/inferred[\s\S]{0,80}(?:causal|risk)[\s\S]{0,80}remain candidates/i);
    expect(schema).toContain('evidenceRole');
    expect(schema).toMatch(/supporting[\s\S]{0,60}dissenting|dissenting[\s\S]{0,60}supporting/i);
    expect(schema).toMatch(/reject only/i);
    expect(schema).toMatch(/wrong[\s\S]{0,40}transient[\s\S]{0,40}private[\s\S]{0,40}useless/i);
    expect(schema).toMatch(/unrelated[\s\S]{0,40}pending/i);
  });

  it('keeps normal task output silent about routine memory I/O', () => {
    const browser = bundledSkill('webcmd-browser');
    const body = browser.replace(/^---[\s\S]*?---\s*/, '');

    expect(browser).toMatch(/task-focused/i);
    expect(browser).toMatch(/do not routinely announce/i);
    expect(browser).toMatch(/memory reads|reads, writes, or checkpoints/i);
    expect(browser).toMatch(/request[\s\S]{0,80}verbose[\s\S]{0,80}retention failure|verbose[\s\S]{0,80}retention failure/i);
    expect(body.split(/\s+/).filter(Boolean).length).toBeLessThan(2300);
  });

  it('names per-reference triggers, classify-before-write, and the 500/200 rewrite rule', () => {
    const browser = bundledSkill('webcmd-browser');
    const sitemap = bundledReference('sitemap-memory.md');
    const git = bundledReference('git-lifecycle.md');

    expect(browser).toMatch(/sitemap-memory\.md[\s\S]{0,220}(?:provisional-fallback|classif|draftPath)/i);
    expect(browser).toMatch(/candidate-schema\.md[\s\S]{0,220}(?:qualifying|candidate)/i);
    expect(browser).toMatch(/git-lifecycle\.md[\s\S]{0,220}(?:checkpoint|500)/i);
    expect(browser).toMatch(/browser-run-playwright\.md[\s\S]{0,220}(?:run|QuickJS)/i);
    expect(sitemap).toMatch(/provisional-fallback/);
    expect(sitemap).toMatch(/site memory classify/);
    expect(sitemap).toMatch(/same-product|same product/);
    expect(sitemap).toMatch(/--distinct|distinct product/);
    expect(sitemap).toMatch(/before any write/i);
    expect(sitemap).toMatch(/do not (?:write|edit|touch).*~\/\.webcmd|never (?:write|edit).*~\/\.webcmd/i);
    expect(sitemap).toMatch(/never (?:run |use )?git|do not (?:run |use )?git/i);
    expect(git).toMatch(/500/);
    expect(git).toMatch(/200/);
    expect(git).toMatch(/even if only a reference|reference path was requested/i);
  });

  it('teaches checkpoint lifecycle, one conflict retry, and never direct Git', () => {
    const git = bundledReference('git-lifecycle.md');

    expect(git).toContain('webcmd site memory checkpoint');
    expect(git).toContain('--expected-revision');
    expect(git).toContain('--task-id');
    expect(git).toContain('candidate_ingestion');
    expect(git).toContain('direct_correction');
    expect(git).toContain('major_rewrite');
    expect(git).toContain('SITE_MEMORY_CONFLICT');
    expect(git).toContain('Retry webcmd site memory context, then checkpoint once.');
    expect(git).toMatch(/exactly one retry|checkpoint once/i);
    expect(git).toMatch(/never (?:run |use )?git|do not (?:run |use )?git/i);
    expect(git).not.toMatch(/\bgit add\b|\bgit commit\b/);
  });

  it('teaches rerunning context after capture and before draft edits', () => {
    const git = bundledReference('git-lifecycle.md');

    expect(git).toMatch(/after(?: the)? final candidate|after capture/i);
    expect(git).toMatch(/same task id|same --task-id|--task-id <(?:id|same-id)>/i);
    expect(git).toMatch(/before editing|before you edit|before draft/i);
    expect(git).toMatch(/does not destroy|will not destroy|before any draft edit/i);
    expect(git).toMatch(/reuses the existing draft/i);
    expect(git).toMatch(/did not publish|does not publish|never (?:claim|report).{0,40}published/i);
    expect(git).toContain('webcmd site memory context');
  });

  it('keeps session, profile, auth, CAPTCHA, payment, write, and fresh-state safety', () => {
    const browser = bundledSkill('webcmd-browser');

    expect(browser).toContain('webcmd profile create work');
    expect(browser).toMatch(/Profiles are cookie jars[\s\S]{0,180}sessions are browser workspaces\/windows/i);
    expect(browser).toMatch(/Parallel agents use separate sessions/i);
    expect(browser).toContain('SESSION_BUSY');
    expect(browser).toContain('SESSION_REQUIRED');
    expect(browser).toContain('SESSION_PAUSED_FOR_HUMAN_HANDOFF');
    expect(browser).toContain('webcmd session close <session-id> --force');
    expect(browser).toMatch(/handoff is scoped to (?:its|the) Session/i);
    expect(browser).toMatch(/(?:verify_command|handoff\.verifyCommand)[\s\S]{0,200}verbatim[\s\S]{0,120}`--session`/i);
    expect(browser).toMatch(/(?:cannot be closed|close is blocked|do not close)[\s\S]{0,100}handoff|handoff[\s\S]{0,100}(?:cannot be closed|close is blocked|do not close)/i);
    expect(browser).toContain('Never ask for or type passwords');
    expect(browser).toContain('CAPTCHA');
    expect(browser).toMatch(/payment/i);
    expect(browser).toContain("The user's report alone is not verification");
    expect(browser).toContain('Do not reuse observations across a page transition');
    expect(browser).toContain('timeout warns that side effects may have occurred');
    expect(browser).toMatch(/fresh (?:JavaScript scope|snapshot|browser state)/i);
  });

  it('teaches the run-first Playwright lifecycle and QuickJS guidance', () => {
    const browser = bundledSkill('webcmd-browser');
    const browserRunReference = bundledReference('browser-run-playwright.md');
    const sessionWorkflow = [
      'webcmd --profile work session create "Work Project"',
      'webcmd --profile work --session work-project-k7 browser run --stdin',
      'webcmd --profile work --session work-project-k7 browser snapshot --snapshot-mode read',
      'webcmd --profile work session close work-project-k7',
    ];
    const normalized = browser.replaceAll(/\\\n\s*/g, ' ').replaceAll(/ {2,}/g, ' ');

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
    expect(browser).not.toContain('browser.currentPage()');
    expect(browser).not.toContain('--observe');
    expect(browser).not.toContain('--tab');
    expect(browser).not.toMatch(/webcmd browser \S+ (?:open|state|click|type|select|find|extract|network)/i);
    for (const command of sessionWorkflow) {
      expect(normalized).toContain(command);
    }
    expect(browserRunReference).toMatch(/QuickJS/);
    expect(browserRunReference).toMatch(/page\.evaluate/);
    expect(browserRunReference).toMatch(/artifact/i);
    expect(browserRunReference).toContain('writeArtifact(');
    expect(browserRunReference).toMatch(/errors/i);
    expect(browserRunReference).toMatch(/snapshot behavior/i);
    expect(browserRunReference).toContain('--snapshot-mode act|tree');
    expect(browserRunReference).toMatch(/timing/i);
    expect(browserRunReference).not.toContain('browser.currentPage()');
    expect(browserRunReference).not.toContain('--observe');
    expect(browserRunReference).not.toContain('--tab');
  });

  it('keeps browser behavioral policy while dropping adapter, plugin, search, fetch, and repair language', () => {
    const browser = bundledSkill('webcmd-browser');
    const sitemap = bundledReference('sitemap-memory.md');

    for (const heading of [
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
    expect(browser).not.toContain('## Adapter fallback gate');
    expect(browser).toContain('Create a named browser Session before raw browser work');
    expect(browser).toContain('Do not submit forms via');
    expect(browser).toContain('Screenshots are for humans, not for agents');
    expect(browser).not.toMatch(/webcmd browser \S+ (?:open|state|click|type|select|find|extract|network|wait|eval|frames|screenshot|scroll|back|keys)\b/i);
    expect(browser).not.toMatch(/^### (?:Inspect|Get|Interact|Wait|Extract|Network)$/m);
    expect(browser).not.toMatch(/webcmd (?:list|plugin|web fetch)\b/);
    expect(browser).not.toMatch(/FETCH_BLOCKED|FETCH_REQUIRES_BROWSER|first-choice Webcmd fetch path/i);
    expect(browser).not.toMatch(/adapter first|IPage|registerSiteAuthCommands/i);
    expect(sitemap).toMatch(/prior (?:knowledge|context)|not (?:ground )?truth/i);
    expect(sitemap).toMatch(/trust (?:the )?(?:live )?(?:browser|page|reality)/i);
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
    expect(added.skills.map((skill) => skill.name)).toEqual(['webcmd-browser']);
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
      path.join(customPath, 'webcmd-browser'),
    ]);
    for (const skill of added.skills) {
      expect(real(skill.destination!)).toBe(real(skill.source));
    }
  });

  it('refuses to replace real files or directories', () => {
    const packageRoot = makePackageRoot();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-home-'));
    const stablePath = path.join(homeDir, '.webcmd', 'skills', 'webcmd-browser');
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

    expect(result.removed).toHaveLength(8);
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
    const blocker = path.join(cwd, '.codex', 'skills', 'webcmd-browser');
    fs.mkdirSync(blocker, { recursive: true });

    expect(() => removeWebcmdSkills({ packageRoot, homeDir, cwd })).toThrow(ArgumentError);
    expect(fs.lstatSync(added.skills[0].destination!).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(blocker).isDirectory()).toBe(true);
  });

  it('mentions retired skill names only in RETIRED_SKILLS', () => {
    const hits: string[] = [];
    for (const file of productFiles()) {
      const text = withoutRetiredList(file, fs.readFileSync(file, 'utf8'));
      for (const retired of RETIRED_SKILLS) {
        if (text.includes(retired)) hits.push(`${path.relative(process.cwd(), file)}: ${retired}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('public copy', () => {
  it('describes the bundled install as exactly one skill, webcmd-browser', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
    const skills = fs.readFileSync(path.join(process.cwd(), 'docs', 'skills.mdx'), 'utf8');
    const quickstart = fs.readFileSync(path.join(process.cwd(), 'docs', 'quickstart.mdx'), 'utf8');
    const plugin = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.codex-plugin', 'plugin.json'), 'utf8')) as {
      interface: { longDescription: string };
    };

    expect(readme).toContain('webcmd-browser');
    expect(readme).toMatch(/exactly one skill|one skill/i);
    expect(readme).toMatch(/only for live browser work/i);
    expect(readme).toMatch(/do not require that skill/i);
    expect(skills).toContain('webcmd-browser');
    expect(skills).toMatch(/exactly one skill|one bundled skill/i);
    expect(quickstart).toContain('webcmd-browser');
    expect(quickstart).toMatch(/exactly one skill|one bundled skill/i);
    expect(plugin.interface.longDescription).toMatch(/webcmd-browser|one skill/i);
    const codex = fs.readFileSync(path.join(process.cwd(), 'docs', 'agents', 'codex-cli.md'), 'utf8');
    expect(codex).toMatch(/exactly one (bundled )?skill/i);
    expect(codex).toContain('webcmd-browser');
  });

  it('does not claim seven bundled skills in public copy', () => {
    const stale = /all seven|seven bundled|seven Webcmd skills/i;
    const hits: string[] = [];
    for (const file of productFiles()) {
      if (file.endsWith(`${path.sep}skills.test.ts`)) continue;
      if (stale.test(fs.readFileSync(file, 'utf8'))) hits.push(path.relative(process.cwd(), file));
    }
    expect(hits).toEqual([]);
  });

  it('documents local seed lookup, provenance, clean break, and invisible learning', () => {
    const privacy = fs.readFileSync(path.join(process.cwd(), 'PRIVACY.md'), 'utf8');
    const memory = fs.readFileSync(path.join(process.cwd(), 'docs', 'browser-and-sitemap-memory.mdx'), 'utf8');
    const localCloud = fs.readFileSync(path.join(process.cwd(), 'docs', 'local-or-cloud.mdx'), 'utf8');

    const intro = privacy.slice(0, privacy.indexOf('\n## '));
    expect(intro).toMatch(/page contents/i);
    expect(intro).toMatch(/cookies/i);
    expect(intro).toMatch(/does not send/i);
    expect(intro).toMatch(/except|seed lookup/i);
    expect(privacy).toMatch(/unauthenticated GET/i);
    expect(privacy).toContain('/v1/site-memory/seeds/');
    expect(privacy).toContain('https://api.webcmd.dev');
    expect(privacy).toMatch(/2-second timeout|2 second timeout/i);
    expect(privacy).toMatch(/no retry/i);
    expect(privacy).toContain('WEBCMD_GLOBAL_MEMORY=off');
    expect(privacy).toContain('WEBCMD_GLOBAL_MEMORY_URL');
    expect(privacy).toMatch(/api\.ipify\.org|ipify/i);
    expect(privacy).toContain('WEBCMD_CANDIDATE_PUBLIC_IP=off');
    expect(privacy).toMatch(/no credentials|unauthenticated|without credentials/i);
    expect(privacy).toContain('~/.webcmd/sites');
    expect(privacy).toMatch(/never (?:uploaded|pushed)|is never uploaded/i);
    expect(privacy).toMatch(/never pushes/i);
    expect(privacy).toContain('sitemap/SITE.md');
    expect(memory).toMatch(/invisible|do not routinely announce|normal output/i);
    expect(memory).toMatch(/request|verbose|retention failure/i);
    expect(localCloud).toMatch(/self-learning|site memory/i);
    expect(localCloud).toMatch(/browser-operation-only|browser operation only|browser-only/i);
  });
});
