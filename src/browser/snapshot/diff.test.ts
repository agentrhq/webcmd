import { describe, expect, it } from 'vitest';
import { diffSnapshots, renderSnapshotDiff } from './diff.js';
import type { AiSnapshot, AiSnapshotNode } from './types.js';

function node(input: Partial<AiSnapshotNode> & { role: string }): AiSnapshotNode {
  return {
    nodeId: input.nodeId ?? input.ref ?? input.role,
    ignored: input.ignored ?? false,
    role: input.role,
    name: input.name ?? null,
    value: input.value ?? null,
    description: input.description ?? null,
    properties: input.properties ?? {},
    attributes: input.attributes ?? {},
    ref: input.ref ?? null,
    subtreeSize: input.subtreeSize ?? 1,
    children: input.children ?? [],
  };
}

function snap(children: AiSnapshotNode[], url = 'https://example.test/docs?utm=old#top'): AiSnapshot {
  return {
    title: 'Demo',
    url,
    frames: [{
      status: 'ok',
      scope: 'document',
      id: 'main',
      index: 0,
      url,
      name: null,
      parentId: null,
      roots: [node({ role: 'RootWebArea', ref: 'l1', children: [
        node({ role: 'main', ref: 'l2', children }),
      ] })],
    }],
  };
}

function beforeWide(): AiSnapshot {
  return snap(Array.from({ length: 7 }, (_, index) => node({
    role: 'button',
    name: `${`Before ${index + 1} `.padEnd(140, 'x')}`,
    ref: `l${index + 3}`,
  })), '');
}

function afterWideChanged(): AiSnapshot {
  return snap(Array.from({ length: 7 }, (_, index) => node({
    role: 'button',
    name: index === 6 ? 'Changed late value' : `${`After ${index + 1} `.padEnd(140, 'y')}`,
    ref: `l${index + 3}`,
  })), '');
}

function documentSnapshot(): AiSnapshot {
  return snap([node({ role: 'button', name: 'Background', ref: 'l3' })]);
}

function modalSnapshot(): AiSnapshot {
  const snapshot = snap([node({ role: 'dialog', name: 'Confirm', ref: 'l10', children: [
    node({ role: 'button', name: 'Continue', ref: 'l11' }),
  ] })]);
  const frame = snapshot.frames[0]!;
  if (frame.status === 'ok') frame.scope = 'modal';
  return snapshot;
}

describe('snapshot diff', () => {
  it('renders same-ref text modifications compactly', () => {
    const before = snap([node({ role: 'button', name: 'Save', ref: 'l3' })]);
    const after = snap([node({ role: 'button', name: 'Saved', ref: 'l3' })]);

    const rendered = renderSnapshotDiff(diffSnapshots(before, after)).value;

    expect(rendered).toContain('<page');
    expect(rendered).toContain('~ ');
    expect(rendered).toContain('<button ref="l3">Saved</button>');
  });

  it('suppresses ref-only changes', () => {
    const before = snap([node({ role: 'link', name: 'Docs', ref: 'l3', attributes: { href: 'https://example.test/docs' } })]);
    const after = snap([node({ role: 'link', name: 'Docs', ref: 'l99', attributes: { href: 'https://example.test/docs' } })]);

    expect(renderSnapshotDiff(diffSnapshots(before, after)).value).toBe('');
  });

  it('suppresses href query and fragment changes', () => {
    const before = snap([node({ role: 'link', name: 'Docs', ref: 'l3', attributes: { href: 'https://example.test/docs?utm=old#top' } })]);
    const after = snap([node({ role: 'link', name: 'Docs', ref: 'l3', attributes: { href: 'https://example.test/docs?utm=new#api' } })]);

    expect(renderSnapshotDiff(diffSnapshots(before, after)).value).toBe('');
  });

  it('retains changed attributes when the full diff fits', () => {
    const before = snap([node({ role: 'link', name: 'Docs', ref: 'l3', attributes: { href: 'https://example.test/a' } })]);
    const after = snap([node({ role: 'link', name: 'Docs', ref: 'l3', attributes: { href: 'https://example.test/b' } })]);

    const rendered = renderSnapshotDiff(diffSnapshots(before, after));

    expect(rendered.value).toContain('href="https://example.test/b"');
    expect(rendered.truncated).toBe(false);
  });

  it('prioritizes direct text changes on nodes without refs', () => {
    const prose = (text: string) => ({
      ...snap([], ''),
      frames: [{
        status: 'ok' as const,
        scope: 'document' as const,
        id: 'main',
        index: 0,
        url: '',
        name: null,
        parentId: null,
        roots: [node({ role: 'main', ref: null, children: [
          node({ role: 'StaticText', name: text, ref: null }),
        ] })],
      }],
    });
    const changed = `Changed prose ${'x'.repeat(100)}`;

    const rendered = renderSnapshotDiff(
      diffSnapshots(prose(`Before prose ${'y'.repeat(100)}`), prose(changed), 'tree'),
      260,
    );

    expect(rendered.value).toContain(changed);
    expect(rendered.value).toMatch(/^\+ .*Changed prose/m);
  });

  it('bounds rendered diff text', () => {
    const before = snap([node({ role: 'button', name: 'Save', ref: 'l3' })]);
    const after = snap([node({ role: 'button', name: 'Saved', ref: 'l3' })]);

    const bounded = renderSnapshotDiff(diffSnapshots(before, after), 10);

    expect(bounded.value.length).toBeLessThanOrEqual(10);
    expect(bounded.truncated).toBe(true);
  });

  it('reports critical omission metadata when a page-only diff is bounded', () => {
    const before = { ...snap([], ''), title: 'Before' };
    const after = { ...snap([], ''), title: `After ${'title '.repeat(30)}` };

    const bounded = renderSnapshotDiff(diffSnapshots(before, after), 60);

    expect(bounded.value.length).toBeLessThanOrEqual(60);
    expect(bounded.truncated).toBe(true);
    expect(bounded.criticalOmitted).toBeGreaterThan(0);
    expect(bounded.warnings[0]).toMatch(/output ceiling/i);
  });

  it('retains a compact one-line text change when the rendered diff exactly fits', () => {
    const before = snap([node({ role: 'button', name: 'Save', ref: 'l3' })], '');
    const after = snap([node({ role: 'button', name: 'Saved', ref: 'l3' })], '');
    const full = renderSnapshotDiff(diffSnapshots(before, after));

    const exact = renderSnapshotDiff(diffSnapshots(before, after), full.value.length);

    expect(exact.value).toBe(full.value);
    expect(exact.truncated).toBe(false);
    expect(exact.criticalOmitted).toBe(0);
  });

  it('does not hard-cut selected changes without critical omission metadata', () => {
    const before = snap([node({ role: 'button', name: 'Save', ref: 'l3' })], '');
    const after = snap([node({ role: 'button', name: 'Saved', ref: 'l3' })], '');

    const bounded = renderSnapshotDiff(diffSnapshots(before, after), 175);

    expect(bounded.value.length).toBeLessThanOrEqual(175);
    expect(bounded.truncated).toBe(true);
    expect(bounded.criticalOmitted).toBeGreaterThan(0);
    expect(bounded.warnings[0]).toMatch(/inspect.*ref/i);
  });

  it('preserves a complete recovery marker when replacement stubs consume the budget', () => {
    const links = (version: 'before' | 'after') => Array.from({ length: 4 }, (_, index) => node({
      nodeId: `link-${index}`,
      role: 'link',
      name: `Docs ${index}`,
      ref: `${version === 'before' ? 'old' : 'new'}-${index}`,
      attributes: { href: `https://example.test/${version}/${index}` },
    }));

    const bounded = renderSnapshotDiff(diffSnapshots(snap(links('before'), ''), snap(links('after'), '')), 284);

    expect(bounded.truncated).toBe(true);
    expect(bounded.criticalOmitted).toBeGreaterThan(0);
    expect(bounded.value).toMatch(/\[more ref=[^\]\n]+\]/);
  });

  it('reports only an addition when a same-role sibling is inserted', () => {
    const before = snap([
      node({ nodeId: 'alpha', role: 'button', name: 'Alpha', ref: 'l3' }),
      node({ nodeId: 'beta', role: 'button', name: 'Beta', ref: 'l4' }),
    ]);
    const after = snap([
      node({ nodeId: 'new', role: 'button', name: 'New', ref: 'l5' }),
      node({ nodeId: 'alpha', role: 'button', name: 'Alpha', ref: 'l3' }),
      node({ nodeId: 'beta', role: 'button', name: 'Beta', ref: 'l4' }),
    ]);

    const rendered = renderSnapshotDiff(diffSnapshots(before, after)).value;

    expect(rendered).toContain('+ ');
    expect(rendered).toContain('<button ref="l5">New</button>');
    expect(rendered).not.toContain('~ ');
    expect(rendered).not.toContain('- ');
  });

  it('retains late changed nodes and their ancestors under a tight budget', () => {
    const rendered = renderSnapshotDiff(diffSnapshots(beforeWide(), afterWideChanged()), 700);
    expect(rendered.value).toContain('Changed late value');
    expect(rendered.value).toMatch(/changed=\d+/);
  });

  it('renders modal open and close as scope changes, not background churn', () => {
    const opened = renderSnapshotDiff(diffSnapshots(documentSnapshot(), modalSnapshot())).value;
    expect(opened).toContain('scope="modal"');
    expect(opened).not.toMatch(/^- .*Background/m);

    const closed = renderSnapshotDiff(diffSnapshots(modalSnapshot(), documentSnapshot())).value;
    expect(closed).toContain('scope="document"');
    expect(closed).not.toMatch(/^\+ .*Background/m);
  });
});
