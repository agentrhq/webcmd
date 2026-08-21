import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { InternalCliCommand } from './registry.js';
import { resolveAdapterSourcePath, splitAdapterCommandKey } from './adapter-source.js';

const existingPath = fileURLToPath(import.meta.url);

function makeCmd(overrides: Partial<InternalCliCommand> = {}): InternalCliCommand {
  return {
    site: 'test-site',
    name: 'test-cmd', access: 'read',
    description: 'test',
    args: [],
    ...overrides,
  } as InternalCliCommand;
}

describe('resolveAdapterSourcePath', () => {
  it('returns source when it is a real file path (not manifest:)', () => {
    const cmd = makeCmd({ source: existingPath });
    expect(resolveAdapterSourcePath(cmd)).toBe(existingPath);
  });

  it('skips manifest: pseudo-paths and falls back to _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:arxiv/search', _modulePath: existingPath });
    expect(resolveAdapterSourcePath(cmd)).toBe(existingPath);
  });

  it('returns undefined when only manifest: pseudo-path and no _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:test/cmd' });
    expect(resolveAdapterSourcePath(cmd)).toBeUndefined();
  });

  it('returns _modulePath when it is the only path available', () => {
    const cmd = makeCmd({ _modulePath: existingPath });
    expect(resolveAdapterSourcePath(cmd)).toBe(existingPath);
  });

  it('returns undefined when every candidate is stale', () => {
    const cmd = makeCmd({ source: '/tmp/webcmd-missing-source.js', _modulePath: '/tmp/webcmd-missing-module.js' });
    expect(resolveAdapterSourcePath(cmd)).toBeUndefined();
  });
});

describe('splitAdapterCommandKey', () => {
  it('accepts site/command and site command', () => {
    expect(splitAdapterCommandKey('quotes/list')).toEqual({ site: 'quotes', command: 'list' });
    expect(splitAdapterCommandKey('quotes', 'list')).toEqual({ site: 'quotes', command: 'list' });
  });

  it('rejects the wrong arity', () => {
    expect(splitAdapterCommandKey('quotes')).toBeNull();
    expect(splitAdapterCommandKey('quotes/list/extra')).toBeNull();
  });
});
