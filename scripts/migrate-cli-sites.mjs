#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const sites = process.argv.slice(2);
const webcmdVersion = readJson(path.join(root, 'package.json'), {}).version;
if (!webcmdVersion) fail('Could not read version from package.json');
const webcmdRange = `>=${webcmdVersion}`;
const sharedRuntime = /((?:\.\.\/)+)_shared\/(?:common|desktop-commands|search-adapter|site-auth)\.js/g;

if (sites.length === 0) fail('Usage: node scripts/migrate-cli-sites.mjs <site...>');
const duplicate = sites.find((site, index) => sites.indexOf(site) !== index);
if (duplicate) fail(`Duplicate site name: ${duplicate}`);
for (const site of sites) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(site)) fail(`Invalid site name: ${site}`);
  if (!fs.existsSync(path.join(root, 'clis', site))) fail(`clis/${site} does not exist`);
  if (site !== 'pypi' && fs.existsSync(path.join(root, 'plugins', site))) {
    fail(`plugins/${site} already exists`);
  }
  if (site === 'pypi') {
    const source = path.join(root, 'clis', site);
    const plugin = path.join(root, 'plugins', site);
    for (const file of walk(source)) {
      const target = destination(file, source, plugin);
      if (fs.existsSync(target)) {
        fail(`${path.relative(root, target)} already exists; merge pypi manually`);
      }
    }
  }
}

const manifestPath = path.join(root, 'cli-manifest.json');
let manifest = readJson(manifestPath, []);
for (const site of sites) {
  migrate(site, manifest.filter(entry => entry.site === site));
  manifest = manifest
    .filter(entry => entry.site !== site)
    .sort((a, b) => String(a.site).localeCompare(String(b.site)) || String(a.name).localeCompare(String(b.name)));
  writeJson(manifestPath, manifest);
}

function migrate(site, commands) {
  const source = path.join(root, 'clis', site);
  const plugin = path.join(root, 'plugins', site);
  const files = walk(source);
  const destinations = new Map(files.map(file => [file, destination(file, source, plugin)]));

  fs.mkdirSync(plugin, { recursive: true });
  for (const file of files) {
    const target = destinations.get(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let content = fs.readFileSync(file);
    if (/\.[cm]?js$/.test(file)) {
      let sourceText = content.toString().replace(sharedRuntime, '@agentrhq/webcmd/plugin-runtime');
      if (/\.test\.[cm]?js$/.test(file)) sourceText = rewriteTestImports(sourceText, file, target, destinations);
      content = Buffer.from(sourceText);
    }
    fs.writeFileSync(target, content);
  }
  fs.rmSync(source, { recursive: true, force: true });

  const description = `Webcmd commands for ${site}`;
  const packageJson = path.join(plugin, 'package.json');
  if (!fs.existsSync(packageJson)) {
    writeJson(packageJson, {
      name: `webcmd-plugin-${site}`,
      version: '0.1.0',
      type: 'module',
      description,
      peerDependencies: { '@agentrhq/webcmd': webcmdRange },
    });
  }
  const pluginManifest = path.join(plugin, 'webcmd-plugin.json');
  if (!fs.existsSync(pluginManifest)) {
    writeJson(pluginManifest, {
      name: site,
      version: '0.1.0',
      description,
      webcmd: webcmdRange,
      author: { name: 'WebCMD Agent', handle: 'agentrhq' },
    });
  }
  const readmePath = path.join(plugin, 'README.md');
  if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, readme(site, description, commands));

  for (const baseline of ['silent-column-drop-baseline.json', 'typed-error-lint-baseline.json']) {
    const file = path.join(root, 'scripts', baseline);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, before.replaceAll(`clis/${site}/`, `plugins/${site}/`));
  }
  console.log(`Migrated ${site}: ${commands.length} command(s)`);
}

function destination(file, source, plugin) {
  const relative = path.relative(source, file);
  return /\.test\.[cm]?js$/.test(file)
    ? path.join(plugin, 'test', path.basename(relative))
    : path.join(plugin, relative);
}

function rewriteTestImports(source, oldFile, newFile, destinations) {
  return source.replace(/(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, specifier) => {
    const oldTarget = path.resolve(path.dirname(oldFile), specifier);
    const newTarget = destinations.get(oldTarget);
    if (!newTarget) return match;
    let relative = path.relative(path.dirname(newFile), newTarget).replaceAll(path.sep, '/');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return `${quote}${relative}${quote}`;
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function readme(site, description, commands) {
  const rows = commands
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(command => `| \`webcmd ${site} ${command.name}\` | ${String(command.description ?? '').replaceAll('|', '\\|')} |`);
  return `# webcmd-plugin-${site}\n\n${description}.\n\n## Install\n\n\`\`\`bash\nwebcmd plugin search ${site} -f json\nwebcmd plugin install <installSource-from-search>\n\`\`\`\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n${rows.join('\n')}\n`;
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
