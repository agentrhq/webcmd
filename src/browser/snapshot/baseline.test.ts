import { describe, expect, it } from 'vitest';
import { MemorySnapshotBaselineStore, snapshotBaselineKey } from './baseline.js';
import type { AiSnapshot } from './types.js';

function sample(url = 'https://example.test/'): AiSnapshot {
  return { title: 'Example', url, frames: [] };
}

describe('MemorySnapshotBaselineStore', () => {
  it('stores baselines by page id', () => {
    const store = new MemorySnapshotBaselineStore();
    store.set('page-1', sample('https://one.test/'));
    store.set('page-2', sample('https://two.test/'));

    expect(store.get('page-1')?.url).toBe('https://one.test/');
    expect(store.get('page-2')?.url).toBe('https://two.test/');
  });

  it('clears one baseline without clearing the rest', () => {
    const store = new MemorySnapshotBaselineStore();
    store.set('page-1', sample('https://one.test/'));
    store.set('page-2', sample('https://two.test/'));

    store.clear('page-1');

    expect(store.get('page-1')).toBeUndefined();
    expect(store.get('page-2')?.url).toBe('https://two.test/');
  });

  it('uses stable string keys for page ids', () => {
    expect(snapshotBaselineKey('abc')).toBe('page:abc');
  });
});
