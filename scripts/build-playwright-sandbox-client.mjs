import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { build } from 'esbuild';

const output = 'src/browser/run/generated/playwright-client.js';
const clientRoot = 'src/browser/run/playwright-client';
const vendorRoot = `${clientRoot}/vendor`;
const manifest = JSON.parse(await readFile(`${clientRoot}/vendor-manifest.json`, 'utf8'));
const check = process.argv.includes('--check');
const directory = check ? await mkdtemp(join(tmpdir(), 'webcmd-playwright-client-')) : 'src/browser/run/generated';
const outfile = check ? join(directory, 'playwright-client.js') : output;

async function vendorDigest(directory) {
  const files = [];
  const walk = async path => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name !== '.DS_Store') files.push(child);
    }
  };
  await walk(directory);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const entry = file.slice(directory.length + 1).split(sep).join('/');
    hash.update(entry);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const [packageJson, readme, types, digest] = await Promise.all([
  readFile('node_modules/playwright-core/package.json', 'utf8').then(JSON.parse),
  readFile(`${clientRoot}/README.md`, 'utf8'),
  readFile('src/browser/run/types.ts', 'utf8'),
  vendorDigest(vendorRoot),
]);
if (packageJson.version !== manifest.version || packageJson.license !== manifest.license
  || !types.includes(`BROWSER_RUN_PLAYWRIGHT_VERSION = '${manifest.version}'`)
  || !readme.includes(`v${manifest.version}`) || !readme.includes(manifest.commit)
  || !readme.includes(manifest.license) || digest !== manifest.vendorSha256) {
  throw new Error('Playwright QuickJS client provenance or vendor digest does not match the pinned manifest.');
}

const banner = `/* Webcmd Playwright QuickJS client: Playwright v${manifest.version} (${manifest.commit}, ${manifest.license}) */`;

await build({
  entryPoints: ['src/browser/run/playwright-client/bundle-entry.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__WebcmdPlaywrightClient',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  sourcemap: false,
  banner: { js: banner },
  outfile,
  alias: {
    '@isomorphic': './src/browser/run/playwright-client/vendor/isomorphic',
    '@protocol/channels': './src/browser/run/playwright-client/vendor/protocol/channels.d.ts',
  },
});

if (check) {
  try {
    const [built, committed] = await Promise.all([readFile(outfile), readFile(output)]);
    if (!built.equals(committed)) throw new Error('Generated Playwright QuickJS client is out of date. Run node scripts/build-playwright-sandbox-client.mjs.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
