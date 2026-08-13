import type { AiSnapshot } from './types.js';

export interface SnapshotBaselineStore {
  get(pageId: string): AiSnapshot | undefined;
  set(pageId: string, snapshot: AiSnapshot): void;
  clear(pageId: string): void;
  clearAll(): void;
}

export function snapshotBaselineKey(pageId: string): string {
  return `page:${pageId}`;
}

export class MemorySnapshotBaselineStore implements SnapshotBaselineStore {
  #snapshots = new Map<string, AiSnapshot>();

  get(pageId: string): AiSnapshot | undefined {
    return this.#snapshots.get(snapshotBaselineKey(pageId));
  }

  set(pageId: string, snapshot: AiSnapshot): void {
    this.#snapshots.set(snapshotBaselineKey(pageId), snapshot);
  }

  clear(pageId: string): void {
    this.#snapshots.delete(snapshotBaselineKey(pageId));
  }

  clearAll(): void {
    this.#snapshots.clear();
  }
}
