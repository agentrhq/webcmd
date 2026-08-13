import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');
const readJson = (relativePath) =>
  JSON.parse(readText(relativePath));

const packageJson = readJson('package.json');
const manifest = readJson('.codex-plugin/plugin.json');
const marketplace = readJson('.agents/plugins/marketplace.json');
const marketplacePlugin = marketplace.plugins?.[0];
const claudeManifest = readJson('.claude-plugin/plugin.json');
const claudeMarketplace = readJson('.claude-plugin/marketplace.json');
const claudeMarketplacePlugin = claudeMarketplace.plugins?.[0];

assert.equal(manifest.name, 'webcmd');
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, './skills/');
assert.equal(manifest.author?.name, 'AgentRHQ');
assert.equal(manifest.interface?.developerName, 'AgentRHQ');
const expectedDefaultPrompts = [
  'Create a Zillow rental-search plugin for WebCMD with city, max rent, and bedroom filters. Test it and show me the command.',
  'Compare MacBook Air M5 prices and availability on Amazon, Walmart, and Best Buy.',
  'Find and rank today\u2019s most-discussed AI agent launches across Hacker News, Reddit, Product Hunt, and arXiv.',
];
assert.deepEqual(manifest.interface?.defaultPrompt, expectedDefaultPrompts);
assert.ok(expectedDefaultPrompts.every((prompt) => prompt.length <= 128));
assert.equal(marketplace.name, 'webcmd');
assert.equal(marketplace.plugins?.length, 1);
assert.equal(marketplacePlugin?.name, 'webcmd');
assert.deepEqual(marketplacePlugin?.source, {
  source: 'url',
  url: './',
});

assert.equal(claudeManifest.name, 'webcmd');
assert.equal(claudeManifest.version, packageJson.version);
assert.equal(claudeManifest.author?.name, 'AgentRHQ');
assert.equal(claudeMarketplace.name, 'webcmd');
assert.equal(claudeMarketplace.owner?.name, 'AgentRHQ');
assert.equal(claudeMarketplace.plugins?.length, 1);
assert.equal(claudeMarketplacePlugin?.name, 'webcmd');
assert.equal(claudeMarketplacePlugin?.source, './');

const expectedSkills = [
  'smart-search',
  'webcmd-adapter-author',
  'webcmd-autofix',
  'webcmd-browser',
  'webcmd-browser-sitemap',
  'webcmd-sitemap-author',
  'webcmd-usage',
];
const actualSkills = fs
  .readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')),
  )
  .map((entry) => entry.name)
  .sort();

assert.deepEqual(actualSkills, expectedSkills);

const usageSkill = readText('skills/webcmd-usage/SKILL.md');
assert.match(usageSkill, /Bash\(npm:\*\)/);
assert.match(usageSkill, /## CLI Preflight/);
assert.match(usageSkill, /webcmd --version/);
assert.match(usageSkill, /npm install -g @agentrhq\/webcmd/);

console.log(
  `Codex and Claude Code plugin metadata valid: ${actualSkills.length} skills`,
);
