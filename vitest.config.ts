import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  exports: Record<string, string>;
};
const packageAliases = Object.entries(packageJson.exports)
  .map(([subpath, target]) => ({
    find: subpath === '.' ? packageJson.name : `${packageJson.name}${subpath.slice(1)}`,
    replacement: path.resolve(root, target.replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts')),
  }))
  .sort((a, b) => b.find.length - a.find.length);

const includeExtendedE2e = process.env.WEBCMD_E2E === '1';
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'src/*.test.ts',
            'src/!(browser)/**/*.test.ts',
            'src/browser/verify-fixture.test.ts',
            'src/browser/sessions.test.ts',
            'src/browser/daemon-client.test.ts',
            'src/browser/run/runner.test.ts',
            'src/browser/runtime/local-cloak/provider.test.ts',
            'src/browser/runtime/local-cloak/process-matcher.test.ts',
            'src/browser/runtime/local-cloak/session-manager.test.ts',
            'src/browser/runtime/local-cloak/darwin-background-launch.test.ts',
          ],
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias: packageAliases },
        test: {
          name: 'plugin',
          include: ['plugins/*/test/**/*.test.{ts,js}', 'clis/*/test/**/*.test.{ts,js}'],
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'e2e-fixed-port',
          include: ['tests/e2e/browser-tabs.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
      {
        test: {
          name: 'e2e',
          include: [
            'tests/e2e/browser-public.test.ts',
            'tests/e2e/band-auth.test.ts',
            'tests/e2e/public-commands.test.ts',
            'tests/e2e/management.test.ts',
            'tests/e2e/output-formats.test.ts',
            'tests/e2e/plugin-management.test.ts',
            'tests/e2e/article-download-pipeline.test.ts',
            'tests/e2e/cloak-runtime.test.ts',
            'tests/e2e/cloak-session-concurrency.test.ts',
            'tests/e2e/browser-run.test.ts',
            // Extended browser tests (20+ sites) — opt-in only:
            //   WEBCMD_E2E=1 npx vitest run
            ...(includeExtendedE2e ? ['tests/e2e/browser-public-extended.test.ts', 'tests/e2e/browser-auth.test.ts'] : []),
          ],
          fileParallelism: false,
          maxWorkers: 2,
          sequence: { groupOrder: 3 },
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          sequence: { groupOrder: 4 },
        },
      },
    ],
  },
});
