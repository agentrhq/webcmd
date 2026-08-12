/**
 * Copy YAML support files to dist/.
 * (Adapters are JS-first and no longer need yaml copying.)
 */
const { copyFileSync, mkdirSync, existsSync } = require('fs');

// Copy external CLI registry to dist/
const extSrc = 'src/external-clis.yaml';
if (existsSync(extSrc)) {
  mkdirSync('dist/src', { recursive: true });
  copyFileSync(extSrc, 'dist/src/external-clis.yaml');
}

const playwrightClient = 'src/browser/run/generated/playwright-client.js';
mkdirSync('dist/src/browser/run/generated', { recursive: true });
copyFileSync(playwrightClient, 'dist/src/browser/run/generated/playwright-client.js');
