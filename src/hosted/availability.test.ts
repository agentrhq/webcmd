import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ManifestEntry } from '../manifest-types.js';
import {
  deriveBrowserAvailability,
  deriveHostedAvailability,
} from './availability.js';

const EXPECTED_LOCAL_TOOLS = [
  'antigravity/recent-paths',
  'antigravity/settings-read',
  'antigravity/state-get',
  'antigravity/state-keys',
  'antigravity/workspaces-list',
  'mercury/reimbursement-plan',
  'trae-solo/extensions-list',
  'trae-solo/recent-workspaces',
  'trae-solo/settings-read',
  'trae-solo/skill-fs-installed',
  'trae-solo/skill-fs-list',
  'trae-solo/skill-fs-show',
  'trae-solo/state-get',
  'trae-solo/state-keys',
  'trae-solo/task-fs-list',
  'trae-solo/task-fs-show',
  'trae-solo/task-fs-turns',
  'trae-solo/user-rules',
  'trae-solo/workspaces-list',
] as const;

const EXPECTED_DESKTOP_APPS = [
  'antigravity/add-context',
  'antigravity/cookies',
  'antigravity/copy-code',
  'antigravity/copy-message',
  'antigravity/delete',
  'antigravity/display-options',
  'antigravity/dump',
  'antigravity/extract-code',
  'antigravity/history',
  'antigravity/idb-list',
  'antigravity/mark-read',
  'antigravity/model',
  'antigravity/nav',
  'antigravity/new',
  'antigravity/react',
  'antigravity/read',
  'antigravity/rename',
  'antigravity/revert',
  'antigravity/send',
  'antigravity/settings',
  'antigravity/sidebar-toggle',
  'antigravity/status',
  'antigravity/storage-get',
  'antigravity/storage-keys',
  'antigravity/toggle-aux',
  'antigravity/watch',
  'chatgpt-app/ask',
  'chatgpt-app/model',
  'chatgpt-app/new',
  'chatgpt-app/read',
  'chatgpt-app/send',
  'chatgpt-app/status',
  'chatwise/ask',
  'chatwise/export',
  'chatwise/history',
  'chatwise/model',
  'chatwise/new',
  'chatwise/read',
  'chatwise/screenshot',
  'chatwise/send',
  'chatwise/status',
  'codex/archive',
  'codex/ask',
  'codex/dump',
  'codex/export',
  'codex/extract-diff',
  'codex/history',
  'codex/model',
  'codex/new',
  'codex/pin',
  'codex/projects',
  'codex/read',
  'codex/rename',
  'codex/screenshot',
  'codex/send',
  'codex/status',
  'codex/unpin',
  'cursor/ask',
  'cursor/composer',
  'cursor/dump',
  'cursor/export',
  'cursor/extract-code',
  'cursor/history',
  'cursor/model',
  'cursor/new',
  'cursor/read',
  'cursor/screenshot',
  'cursor/send',
  'cursor/status',
  'discord-app/channels',
  'discord-app/delete',
  'discord-app/goto',
  'discord-app/members',
  'discord-app/read',
  'discord-app/search',
  'discord-app/send',
  'discord-app/servers',
  'discord-app/status',
  'discord-app/thread-read',
  'discord-app/threads',
  'qoder/account',
  'qoder/add-workspace',
  'qoder/ask',
  'qoder/credits',
  'qoder/history',
  'qoder/knowledge',
  'qoder/marketplace',
  'qoder/more-actions',
  'qoder/new',
  'qoder/open-editor',
  'qoder/open-panel',
  'qoder/prompt-enhance',
  'qoder/read',
  'qoder/search',
  'qoder/send',
  'qoder/settings',
  'qoder/sidebar-toggle',
  'qoder/status',
  'qoder/view-all',
  'trae-solo/automation-list',
  'trae-solo/cookies',
  'trae-solo/history',
  'trae-solo/idb-list',
  'trae-solo/mode',
  'trae-solo/model',
  'trae-solo/skill-category',
  'trae-solo/skill-list',
  'trae-solo/skill-search',
  'trae-solo/status',
  'trae-solo/storage-get',
  'trae-solo/storage-keys',
] as const;

function exceptionDiff(actual: readonly string[], expected: readonly string[]) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    added: actual.filter(name => !expectedSet.has(name)),
    missing: expected.filter(name => !actualSet.has(name)),
  };
}

describe('hosted availability', () => {
  it('derives decisions only from normalized strategy and domain metadata', () => {
    expect(deriveHostedAvailability({ strategy: 'local', domain: 'localhost' }))
      .toEqual({ mode: 'local-only', reason: 'local-tool' });
    expect(deriveHostedAvailability({ strategy: 'ui', domain: 'localhost' }))
      .toEqual({ mode: 'local-only', reason: 'desktop-app' });
    expect(deriveHostedAvailability({ strategy: 'cookie', domain: 'example.com' }))
      .toEqual({ mode: 'hosted' });
    expect(deriveBrowserAvailability('bind'))
      .toEqual({ mode: 'local-only', reason: 'browser-bind' });
    expect(deriveBrowserAvailability('open')).toEqual({ mode: 'hosted' });
  });

  it('matches the reviewed local-only adapter exception sets exactly', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const entries = JSON.parse(
      fs.readFileSync(path.join(root, 'cli-manifest.json'), 'utf8'),
    ) as ManifestEntry[];
    const byReason = new Map<string, string[]>([
      ['local-tool', []],
      ['desktop-app', []],
    ]);

    for (const entry of entries) {
      const availability = deriveHostedAvailability(entry);
      if (availability.mode === 'local-only') {
        byReason.get(availability.reason)?.push(`${entry.site}/${entry.name}`);
      }
    }

    const localTools = (byReason.get('local-tool') ?? []).sort();
    const desktopApps = (byReason.get('desktop-app') ?? []).sort();
    expect(exceptionDiff(localTools, EXPECTED_LOCAL_TOOLS)).toEqual({ added: [], missing: [] });
    expect(exceptionDiff(desktopApps, EXPECTED_DESKTOP_APPS)).toEqual({ added: [], missing: [] });
    expect(localTools).toHaveLength(19);
    expect(desktopApps).toHaveLength(111);
  });
});
