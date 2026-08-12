import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DOC_ROOTS = ['README.md', 'docs', 'skills'];

describe('Session documentation sync', () => {
  it('does not call adapter siteSession modes browser Sessions', () => {
    const offenders = walkDocs()
      .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
      .filter(({ text }) => siteSessionModeAsSessionPattern.test(text));

    expect(offenders.map(({ file }) => path.relative(ROOT, file))).toEqual([]);
  });

  it('flags retired Session wording and examples', () => {
    expect(findRemovedSessionSyntaxes('Use webcmd browser session_a run')).toEqual(['positional browser command']);
    expect(findRemovedSessionSyntaxes('Use webcmd browser <session-id> tabs')).toEqual(['positional browser session']);
    expect(findRemovedSessionSyntaxes('Use browser --session for this')).toEqual(['browser-local session selector']);
    expect(findRemovedSessionSyntaxes('session_abc...')).toEqual(['truncated session id']);
    expect(siteSessionModeAsSessionPattern.test('a persistent session')).toBe(true);
    expect(siteSessionModeAsSessionPattern.test('an ephemeral session')).toBe(true);
  });

  it('keeps removed Session syntaxes out of docs and skills', () => {
    const offenders = walkDocs()
      .flatMap((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return findRemovedSessionSyntaxes(text).map((label) => `${path.relative(ROOT, file)}: ${label}`);
      });

    expect(offenders).toEqual([]);
  });

  it('documents structured Session runtime errors', () => {
    const troubleshooting = fs.readFileSync(path.join(ROOT, 'docs', 'troubleshooting.mdx'), 'utf8');

    for (const code of [
      'SESSION_REQUIRED',
      'INVALID_SESSION_SELECTOR',
      'SESSION_SELECTOR_POSITION',
      'SESSION_NOT_FOUND',
      'INVALID_SESSION_LIMIT',
      'SESSION_BUSY',
      'SESSION_PAUSED_FOR_HUMAN_HANDOFF',
      'SESSION_WINDOW_CONFLICT',
      'SESSION_CAPACITY_EXCEEDED',
      'HOSTED_CONTRACT_MISMATCH',
    ]) {
      expect(troubleshooting).toContain(code);
    }
    expect(troubleshooting).toContain('webcmd session close <session-id> --force');
  });

  it('teaches Session lifecycle commands in every agent guide', () => {
    const agentDir = path.join(ROOT, 'docs', 'agents');
    const guides = fs.readdirSync(agentDir)
      .filter((file) => file.endsWith('.md'))
      .filter((file) => file !== 'custom-sdk.md')
      .map((file) => path.join(agentDir, file));

    for (const guide of guides) {
      const text = fs.readFileSync(guide, 'utf8');
      expect(text, path.relative(ROOT, guide)).toContain('webcmd session create');
      expect(text, path.relative(ROOT, guide)).toContain('webcmd --session <session-id>');
      expect(text, path.relative(ROOT, guide)).toContain('webcmd session list');
      expect(text, path.relative(ROOT, guide)).toContain('webcmd session close <session-id>');
    }
  });
});

function findRemovedSessionSyntaxes(text: string): string[] {
  return [
    [/\bwebcmd browser <session/i, 'positional browser session'],
    [/\bwebcmd browser [A-Za-z0-9_-]+ (?:run|tabs|snapshot|state)\b/i, 'positional browser command'],
    [/\bbrowser --session\b/i, 'browser-local session selector'],
    [/\bsession_[A-Za-z0-9-]*\.\.\./i, 'truncated session id'],
  ].filter(([pattern]) => (pattern as RegExp).test(text))
    .map(([, label]) => label as string);
}

const siteSessionModeAsSessionPattern = /\b(?:persistent|ephemeral) sessions?\b/i;

function walkDocs(): string[] {
  const files: string[] = [];
  for (const root of DOC_ROOTS) {
    const absolute = path.join(ROOT, root);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) files.push(absolute);
    else collect(absolute, files);
  }
  return files.filter((file) => !file.includes(`${path.sep}docs${path.sep}superpowers${path.sep}`));
}

function collect(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(absolute, files);
    else if (/\.(md|mdx)$/u.test(entry.name)) files.push(absolute);
  }
}
