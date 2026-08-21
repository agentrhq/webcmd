import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpSkillsDir = path.join(repoRoot, 'mcp-skills');
const mcpSrcDir = path.join(repoRoot, 'skill-src', 'mcp');
const sharedDir = path.join(repoRoot, 'skill-src', 'shared');

const EXPECTED_SKILLS = [
  'smart-search',
  'webcmd-adapter-author',
  'webcmd-autofix',
  'webcmd-browser',
  'webcmd-browser-sitemap',
  'webcmd-sitemap-author',
  'webcmd-usage',
] as const;

function mcpDocuments(): { name: string; body: string }[] {
  return readdirSync(mcpSkillsDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => ({
      name: entry.replace(/\.md$/, ''),
      body: readFileSync(path.join(mcpSkillsDir, entry), 'utf8'),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

describe('generated MCP skill documents', () => {
  it('publishes exactly one flat document per skill', () => {
    expect(mcpDocuments().map((d) => d.name)).toEqual([...EXPECTED_SKILLS]);
  });

  it('never names a document SKILL.md', () => {
    expect(readdirSync(mcpSkillsDir)).not.toContain('SKILL.md');
  });

  it('has a source for every document and a document for every source', () => {
    const sources = readdirSync(mcpSrcDir)
      .filter((entry) => entry.endsWith('.src.md'))
      .map((entry) => entry.replace(/\.src\.md$/, ''))
      .sort();
    expect(sources).toEqual([...EXPECTED_SKILLS]);
  });

  it.each(EXPECTED_SKILLS)('%s omits CLI-install, daemon, and local-only guidance', (name) => {
    const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
    for (const forbidden of [
      'npm install',
      'npx skills add',
      'webcmd setup',
      'webcmd daemon',
      'webcmd doctor',
      'skills add',
      '~/.webcmd',
    ]) {
      expect(body, `${name}.md must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each(EXPECTED_SKILLS)('%s expresses operations as webcmd_cli_run argv', (name) => {
    const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
    expect(body).toContain('webcmd_cli_run');
  });

  it.each(EXPECTED_SKILLS)('%s puts browser session selectors before the browser command', (name) => {
    const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
    expect(body).not.toMatch(/\[\s*"browser"(?:\s*,\s*"[^"]+")*\s*,\s*"--session"/);
  });

  it.each(EXPECTED_SKILLS)('%s does not use the unsupported browser navigate action', (name) => {
    const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
    expect(body).not.toMatch(/\[\s*"browser"\s*,\s*"navigate"/);
  });

  it.each(['webcmd-adapter-author', 'webcmd-autofix'] as const)(
    '%s uses supported virtual adapter source argv',
    (name) => {
      const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
      expect(body).not.toMatch(/\[\s*"adapter"\s*,\s*"source"\s*,\s*"(?:get|put)"[^\]]*"-f"/);
      expect(body).toMatch(/\[\s*"adapter"\s*,\s*"source"\s*,\s*"get"[^\]]*"--output"/);
    },
  );

  it('keeps CLI shell commands out of the shared adapter rationale', () => {
    const body = readFileSync(path.join(sharedDir, 'why-adapters.src.md'), 'utf8');
    expect(body).not.toContain('webcmd ');
  });

  it.each(['smart-search', 'webcmd-browser', 'webcmd-usage'] as const)(
    '%s does not inherit CLI adapter commands',
    (name) => {
      const body = readFileSync(path.join(mcpSkillsDir, `${name}.md`), 'utf8');
      expect(body).not.toMatch(/webcmd (?:list|browser)\b/);
    },
  );

  it('webcmd-usage names the invocation cap and the long-work pattern', () => {
    const body = readFileSync(path.join(mcpSkillsDir, 'webcmd-usage.md'), 'utf8');
    expect(body).toContain('240');
    expect(body).toContain('session create');
    expect(body).toContain('artifacts get');
    expect(body).toContain('action_required');
  });

  it('ships the MCP documents in the npm package', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('mcp-skills/**');
  });
});
