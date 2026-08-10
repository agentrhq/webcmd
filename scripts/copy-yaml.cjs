/**
 * Copy YAML support files to dist/.
 * (Adapters are JS-first and no longer need yaml copying.)
 */
const { copyFileSync, cpSync, mkdirSync, existsSync } = require('fs');
const { sep } = require('path');

// Copy external CLI registry to dist/
const extSrc = 'src/external-clis.yaml';
if (existsSync(extSrc)) {
  mkdirSync('dist/src', { recursive: true });
  copyFileSync(extSrc, 'dist/src/external-clis.yaml');
}

const playwrightClient = 'src/browser/run/generated/playwright-client.js';
mkdirSync('dist/src/browser/run/generated', { recursive: true });
copyFileSync(playwrightClient, 'dist/src/browser/run/generated/playwright-client.js');

// Stage the builtin adapter tree next to the compiled output. package.json
// `files` ships dist/src/ but not the repo-root clis/, so without this the
// core manifest points at modules the published package does not contain.
if (existsSync('clis')) {
  cpSync('clis', 'dist/src/clis', {
    recursive: true,
    filter: (src) => !src.split(sep).includes('test'),
  });
}
