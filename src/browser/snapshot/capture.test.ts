import { describe, expect, it } from 'vitest';
import { findSnapshotNodeByRef, scopeRootsToOpenModal, scopeSnapshotToRef } from './capture.js';
import type { AiSnapshot } from './types.js';

type MutableNode = Parameters<typeof scopeRootsToOpenModal>[0][number];

function mutable(overrides: Partial<MutableNode> & Pick<MutableNode, 'nodeId' | 'role'>): MutableNode {
  return {
    ignored: false,
    name: null,
    value: null,
    description: null,
    properties: {},
    attributes: {},
    childIds: [],
    children: [],
    parent: null,
    ref: null,
    subtreeSize: 1,
    ...overrides,
  };
}

function snapshot(): AiSnapshot {
  return {
    title: 'Demo',
    url: 'https://example.test/',
    frames: [{
      status: 'ok',
      scope: 'document',
      id: 'main',
      index: 0,
      url: 'https://example.test/',
      name: null,
      parentId: null,
      roots: [{
        nodeId: '1',
        ignored: false,
        role: 'document',
        name: null,
        value: null,
        description: null,
        properties: {},
        attributes: {},
        ref: 'l1',
        subtreeSize: 2,
        children: [{
          nodeId: '2',
          ignored: false,
          role: 'button',
          name: 'Save',
          value: null,
          description: null,
          properties: {},
          attributes: {},
          ref: 'l2',
          subtreeSize: 1,
          children: [],
        }],
      }],
    }],
  };
}

describe('snapshot ref helpers', () => {
  it('finds refs exactly', () => {
    expect(findSnapshotNodeByRef(snapshot(), 'l2').name).toBe('Save');
  });

  it('finds refs by numeric suffix fallback', () => {
    expect(findSnapshotNodeByRef(snapshot(), 'e2').name).toBe('Save');
  });

  it('scopes a snapshot to the frame containing the ref', () => {
    const scoped = scopeSnapshotToRef(snapshot(), 'l2');
    expect(scoped.frames).toHaveLength(1);
    expect(scoped.frames[0]).toMatchObject({ status: 'ok' });
    if (scoped.frames[0]?.status !== 'ok') throw new Error('expected ok frame');
    expect(scoped.frames[0].roots[0]?.name).toBe('Save');
  });
});

describe('modal scoping', () => {
  it('uses the last nonignored open modal as the frame root', () => {
    const first = mutable({ nodeId: 'dialog-1', role: 'dialog', properties: { modal: true } });
    const ignored = mutable({ nodeId: 'dialog-2', role: 'dialog', ignored: true, properties: { modal: true } });
    const last = mutable({ nodeId: 'dialog-3', role: 'alertdialog', attributes: { 'aria-modal': 'true' } });

    expect(scopeRootsToOpenModal([mutable({
      nodeId: 'root', role: 'RootWebArea', children: [first, ignored, last],
    })])).toMatchObject({ scope: 'modal', roots: [last] });
  });

  it('leaves ignored and nonmodal dialogs in document scope', () => {
    const root = mutable({ nodeId: 'root', role: 'RootWebArea', children: [
      mutable({ nodeId: 'dialog', role: 'dialog' }),
    ] });
    expect(scopeRootsToOpenModal([root])).toEqual({ scope: 'document', roots: [root] });
  });
});
