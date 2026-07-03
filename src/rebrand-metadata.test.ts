import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relpath: string): string {
  return fs.readFileSync(path.join(ROOT, relpath), 'utf-8');
}

function readJson(relpath: string): Record<string, unknown> {
  return JSON.parse(readText(relpath)) as Record<string, unknown>;
}

function readPackageLock(): Record<string, unknown> {
  return readJson('package-lock.json');
}

function existingFiles(relpaths: string[]): string[] {
  return relpaths.filter((relpath) => fs.existsSync(path.join(ROOT, relpath)));
}

function collectFiles(relpath: string): string[] {
  const absolute = path.join(ROOT, relpath);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return [relpath];
  }

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const childRelpath = path.join(relpath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        return [];
      }
      return collectFiles(childRelpath);
    }
    return entry.isFile() ? [childRelpath] : [];
  });
}

function collectMarkdownDocsAndReadmes(): string[] {
  return [
    ...collectFiles('docs').filter((relpath) => relpath.endsWith('.md')),
    ...fs.readdirSync(ROOT)
      .filter((entry) => /^readme/i.test(entry) && fs.statSync(path.join(ROOT, entry)).isFile()),
  ];
}

describe('webcmd package and legal identity', () => {
  it('uses AgentR npm package metadata', () => {
    const pkg = readJson('package.json');
    expect(pkg.name).toBe('@agentrhq/webcmd');
    expect(pkg.author).toBe('AgentR');
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.bin).toEqual({ webcmd: 'dist/src/main.js' });
    expect(pkg.publishConfig).toEqual({ access: 'public' });
    expect(pkg.files).toEqual(expect.arrayContaining([
      'dist/src/',
      'clis/',
      'skills/webcmd-*/**',
      'cli-manifest.json',
      'scripts/',
      'README.md',
      'LICENSE',
      'NOTICE',
    ]));
  });

  it('keeps the package-lock root identity aligned with webcmd', () => {
    const lock = readPackageLock();
    const packages = lock.packages as Record<string, unknown> | undefined;
    const root = packages?.[''] as Record<string, unknown> | undefined;

    expect(lock.name).toBe('@agentrhq/webcmd');
    expect(root?.name).toBe('@agentrhq/webcmd');
    expect(root?.license).toBe('Apache-2.0');
    expect(root?.bin).toEqual({ webcmd: 'dist/src/main.js' });
  });

  it('preserves Apache attribution and marks AgentR modifications', () => {
    const license = readText('LICENSE');
    const changelog = readText('CHANGELOG.md');
    const notice = readText('NOTICE');
    const upstreamName = ['open', 'cli'].join('');
    const upstreamRepo = ['https://github.com/jackwener', upstreamName].join('/');

    expect(license).toContain('Copyright 2025 jackwener');
    expect(license).toContain('Copyright 2026 AgentR');
    expect(changelog.trim()).toMatch(/^# Changelog(?:\n|$)/);
    expect(notice.trim()).toBe(`webcmd is based on ${upstreamName} (${upstreamRepo}), Copyright 2025 jackwener, licensed under Apache-2.0.`);
  });

  it('does not keep old package ownership in root package metadata', () => {
    const pkgText = readText('package.json');
    expect(pkgText).not.toContain(['@jackwener', ['open', 'cli'].join('')].join('/'));
    expect(pkgText).not.toContain([
      'git+https://github.com',
      'jackwener',
      `${['open', 'cli'].join('')}.git`,
    ].join('/'));
  });
});

describe('webcmd docs and workflow cleanup', () => {
  it('removes upstream distribution and docs-site references from public docs and workflows', () => {
    const translatedReadme = ['README', ['zh', 'CN'].join('-'), 'md'].join('.');
    const checkedFiles = [
      ...existingFiles([
        'README.md',
        translatedReadme,
        'PRIVACY.md',
        'CONTRIBUTING.md',
        'TESTING.md',
        'llms.txt',
        'package.json',
        'package-lock.json',
      ]),
      ...collectFiles('docs'),
      ...collectFiles('.github'),
    ].filter((relpath) => ![
      path.join('docs', 'superpowers', 'specs', '2026-07-01-webcmd-rebrand-design.md'),
      path.join('docs', 'superpowers', 'plans', '2026-07-01-webcmd-rebrand.md'),
      path.join('docs', 'superpowers', 'specs', '2026-07-02-webcmd-cloak-runtime-design.md'),
      path.join('docs', 'superpowers', 'plans', '2026-07-02-webcmd-cloak-runtime.md'),
    ].includes(relpath));

    const forbidden = [
      ['Open', 'CLIApp'].join(''),
      [['open', 'cli'].join(''), 'info'].join('.'),
      ['jackwener', [['open', 'cli'].join(''), 'website'].join('-')].join('/'),
      ['ildkmabpimmkaediidaifkhj', 'pohdnifk'].join(''),
      'Chrome Web Store',
      'Star History',
      ['@jackwener', ['open', 'cli'].join('')].join('/'),
    ];

    const violations = checkedFiles.flatMap((relpath) => {
      const text = readText(relpath);
      return forbidden
        .filter((term) => text.includes(term))
        .map((term) => `${relpath}: ${term}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps superpowers planning artifacts local-only', () => {
    expect(readText('.gitignore')).toContain('docs/superpowers/');
  });

  it('does not keep translated public README or docs content', () => {
    const translatedReadme = ['README', ['zh', 'CN'].join('-'), 'md'].join('.');
    const checkedFiles = collectMarkdownDocsAndReadmes();

    expect(existingFiles([translatedReadme])).toEqual([]);

    const hanText = /\p{Script=Han}/u;
    const violations = checkedFiles
      .filter((relpath) => hanText.test(readText(relpath)));

    expect(violations).toEqual([]);
  });

  it('does not keep stale upstream naming outside legal and current planning files', () => {
    const allowed = new Set([
      'LICENSE',
      path.join('docs', 'superpowers', 'specs', '2026-07-01-webcmd-rebrand-design.md'),
      path.join('docs', 'superpowers', 'plans', '2026-07-01-webcmd-rebrand.md'),
      path.join('docs', 'superpowers', 'specs', '2026-07-02-webcmd-cloak-runtime-design.md'),
      path.join('docs', 'superpowers', 'plans', '2026-07-02-webcmd-cloak-runtime.md'),
    ]);
    const oldName = ['open', 'cli'].join('');
    const forbidden = new RegExp([
      oldName,
      `${oldName}app`,
      `${oldName}version`,
      `x-${oldName}`,
      `${oldName}\\.info`,
      `jackwener\\/${oldName}`,
      `@jackwener\\/${oldName}`,
    ].join('|'), 'i');
    const checkedFiles = [
      ...collectFiles('src'),
      ...collectFiles('tests'),
      ...collectFiles('clis'),
      ...collectFiles('skills'),
      ...collectFiles('scripts'),
      ...collectFiles('docs'),
      ...collectFiles('extension'),
      ...existingFiles([
        'package.json',
        'package-lock.json',
        'README.md',
        ['README', ['zh', 'CN'].join('-'), 'md'].join('.'),
        'CONTRIBUTING.md',
        'TESTING.md',
        'PRIVACY.md',
        'llms.txt',
        'cli-manifest.json',
      ]),
    ].filter((relpath) => !allowed.has(relpath));

    const violations = checkedFiles
      .filter((relpath) => forbidden.test(readText(relpath)));

    expect(violations).toEqual([]);
  });
});
