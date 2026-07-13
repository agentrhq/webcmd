import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCommunityPluginOutputs,
  writeCommunityPluginOutputs,
} from '../src/community-plugin-sync.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const result = checkOnly
  ? buildCommunityPluginOutputs(repoRoot)
  : writeCommunityPluginOutputs(repoRoot);

console.log(`${checkOnly ? 'Checked' : 'Synced'} ${Object.keys(result.rootManifest.plugins ?? {}).length} community plugin(s).`);
