/*
 * Derived from libretto-browser-tools.
 * MIT License, Copyright (c) 2026 Libretto contributors.
 */

import {
  boundSnapshotText,
  renderSnapshotResult,
  renderSnapshotFrames,
} from './render.js';
import {
  allocateSnapshot,
  renderSnapshotMarker,
  snapshotRepresentationCost,
  snapshotIdentityAttrs,
  snapshotIdentityLabel,
  type SnapshotAllocation,
  type SnapshotRepresentation,
  type SnapshotRepresentationCost,
} from './budget.js';
import type {
  AiSnapshot,
  RenderedSnapshotChild,
  RenderedSnapshotFrame,
  RenderedSnapshotNode,
  SnapshotRenderResult,
  SnapshotSubtreeSummary,
  SnapshotTreeMode,
} from './types.js';

const MAX_LABEL_CHARS = 140;
const LOW_SIGNAL_DIFF_ATTRS = new Set(['ref']);
const OUTPUT_CEILING_WARNING = 'Critical snapshot content was omitted while enforcing the output ceiling.';

export type SnapshotDiff = {
  before: AiSnapshot;
  after: AiSnapshot;
  changed: boolean;
  pageChanged: boolean;
  mode: SnapshotTreeMode;
  frames: SnapshotFrameDiff[];
};

type SnapshotFrameDiff =
  | { type: 'scope-change'; beforeScope: 'document' | 'modal'; frame: RenderedSnapshotFrame }
  | { type: 'context'; frame: RenderedSnapshotFrame; children: SnapshotDiffChild[] }
  | { type: 'modified'; before: RenderedSnapshotFrame; after: RenderedSnapshotFrame }
  | { type: 'added'; frame: RenderedSnapshotFrame }
  | { type: 'removed'; frame: RenderedSnapshotFrame };

type SnapshotDiffChild = SnapshotNodeDiff | SnapshotTextDiff;

type SnapshotNodeDiff =
  | { kind: 'node'; type: 'context'; node: RenderedSnapshotNode; children: SnapshotDiffChild[] }
  | { kind: 'node'; type: 'modified'; before: RenderedSnapshotNode; after: RenderedSnapshotNode; children: SnapshotDiffChild[] }
  | { kind: 'node'; type: 'added'; node: RenderedSnapshotNode }
  | { kind: 'node'; type: 'removed'; node: RenderedSnapshotNode };

type SnapshotTextDiff =
  | { kind: 'text'; type: 'modified'; before: TextNode; after: TextNode }
  | { kind: 'text'; type: 'added'; node: TextNode }
  | { kind: 'text'; type: 'removed'; node: TextNode };

type TextNode = Extract<RenderedSnapshotChild, { kind: 'text' }>;

export function diffSnapshots(
  before: AiSnapshot,
  after: AiSnapshot,
  mode: SnapshotTreeMode = 'act',
): SnapshotDiff {
  const beforeFrames = renderSnapshotFrames(before, mode);
  const afterFrames = renderSnapshotFrames(after, mode);
  const pageChanged = before.title !== after.title || before.url !== after.url;
  const frames = diffFrames(beforeFrames, afterFrames);
  return { before, after, mode, pageChanged, frames, changed: pageChanged || frames.length > 0 };
}

export function renderSnapshotDiff(
  diff: SnapshotDiff,
  maxChars?: number,
): SnapshotRenderResult {
  if (!diff.changed) return emptyRenderResult('');

  const scopeChanges = diff.frames.filter(
    (frame): frame is Extract<SnapshotFrameDiff, { type: 'scope-change' }> => frame.type === 'scope-change',
  );
  if (scopeChanges.length) {
    const frameIds = new Set(scopeChanges.map(({ frame }) => frame.id));
    const activeSnapshot = {
      ...diff.after,
      frames: diff.after.frames.filter((frame) => frameIds.has(frame.id)),
    };
    const scopes = scopeChanges.map(({ frame }) => frame.status === 'ok' ? frame.scope : 'document');
    const scopeChars = scopes.reduce((total, scope) => total + ` scope="${scope}"`.length, 0);
    const renderMaxChars = Number.isFinite(maxChars)
      ? Math.max(0, Math.floor(maxChars!) - scopeChars)
      : maxChars;
    const rendered = renderSnapshotResult(activeSnapshot, { mode: diff.mode, maxChars: renderMaxChars });
    let frameIndex = 0;
    const value = rendered.value.replace(/<frame /g, () =>
      `<frame scope="${scopes[frameIndex++]!}" `);
    const bounded = Number.isFinite(maxChars)
      ? boundSnapshotText(value, maxChars!)
      : { value, truncated: false };
    return { ...rendered, value: bounded.value, truncated: rendered.truncated || bounded.truncated };
  }

  const value = diff.pageChanged && diff.frames.length === 0
    ? [renderPageOpen(diff.before, '- ', true), renderPageOpen(diff.after, '+ ', true)].join('\n')
    : null;
  if (value !== null) return boundedRenderResult(value, maxChars, true);

  const budgeted = budgetDiffFrames(diff.frames);
  const limit = Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars!))
    : Number.MAX_SAFE_INTEGER;
  const allocation = allocateSnapshot(
    budgeted.frames,
    limit,
    diffEnvelopeChars(diff.after, budgeted) + diffSyntaxReserve(budgeted),
    { representationCost: diffRepresentationCost },
  );
  const rendered = renderDiffPage(diff, budgeted, allocation);
  const bounded = rendered.length > limit
    ? boundSnapshotText(rendered, limit)
    : { value: rendered, truncated: false };
  const criticalOmitted = allocation.criticalOmitted || (bounded.truncated ? 1 : 0);
  return {
    value: bounded.value,
    truncated: allocation.truncated || bounded.truncated,
    criticalOmitted,
    warnings: criticalOmitted
      ? [allocation.criticalOmitted
        ? 'Critical snapshot content was omitted; inspect the nearest [more ref=...] scope.'
          : OUTPUT_CEILING_WARNING]
      : [],
  };
}

type BudgetedDiff = {
  frames: RenderedSnapshotFrame[];
  frameDiffs: Map<RenderedSnapshotFrame, SnapshotFrameDiff>;
  nodeDiffs: Map<RenderedSnapshotNode, SnapshotNodeDiff>;
  textDiffs: Map<TextNode, SnapshotTextDiff>;
};

function emptyRenderResult(value: string): SnapshotRenderResult {
  return { value, truncated: false, criticalOmitted: 0, warnings: [] };
}

function boundedRenderResult(
  value: string,
  maxChars?: number,
  criticalOnTruncate = false,
): SnapshotRenderResult {
  const bounded = Number.isFinite(maxChars)
    ? boundSnapshotText(value, maxChars!)
    : { value, truncated: false };
  const criticalOmitted = criticalOnTruncate && bounded.truncated ? 1 : 0;
  return {
    ...bounded,
    criticalOmitted,
    warnings: criticalOmitted ? [OUTPUT_CEILING_WARNING] : [],
  };
}

function renderDiffPage(
  diff: SnapshotDiff,
  budgeted: BudgetedDiff,
  allocation: SnapshotAllocation,
): string {
  const lines = [renderPageOpen(diff.after, '')];
  const renderedMarkers = new Set<string>();
  for (const frame of budgeted.frames)
    renderBudgetedFrame(frame, budgeted, allocation, renderedMarkers, 1, lines);
  lines.push('</page>');
  return lines.join('\n');
}

function diffFrames(beforeFrames: RenderedSnapshotFrame[], afterFrames: RenderedSnapshotFrame[]): SnapshotFrameDiff[] {
  const diffs: SnapshotFrameDiff[] = [];
  const maxLength = Math.max(beforeFrames.length, afterFrames.length);
  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeFrames[index];
    const after = afterFrames[index];
    if (before && !after) diffs.push({ type: 'removed', frame: before });
    else if (!before && after) diffs.push({ type: 'added', frame: after });
    else if (before && after) {
      if (before.status === 'ok' && after.status === 'ok' && before.scope !== after.scope) {
        diffs.push({ type: 'scope-change', beforeScope: before.scope, frame: after });
        continue;
      }
      const diff = diffFrame(before, after);
      if (diff) diffs.push(diff);
    }
  }
  const scopeChanges = diffs.filter(
    (diff): diff is Extract<SnapshotFrameDiff, { type: 'scope-change' }> => diff.type === 'scope-change',
  );
  return scopeChanges.length ? scopeChanges : diffs;
}

function diffFrame(before: RenderedSnapshotFrame, after: RenderedSnapshotFrame): SnapshotFrameDiff | null {
  if (before.status !== after.status) return { type: 'modified', before, after };
  if (before.status === 'unavailable' || after.status === 'unavailable')
    return comparableFrame(before) === comparableFrame(after) ? null : { type: 'modified', before, after };
  const children = diffChildren(before.roots, after.roots);
  const frameChanged = comparableFrame(before) !== comparableFrame(after);
  if (!frameChanged && children.length === 0) return null;
  return frameChanged && children.length === 0 ? { type: 'modified', before, after } : { type: 'context', frame: after, children };
}

function diffChildren(beforeChildren: RenderedSnapshotChild[], afterChildren: RenderedSnapshotChild[]): SnapshotDiffChild[] {
  const diffs: SnapshotDiffChild[] = [];
  const usedBefore = new Set<number>();
  const matches = afterChildren.map(() => -1);

  for (let afterIndex = 0; afterIndex < afterChildren.length; afterIndex += 1) {
    const after = afterChildren[afterIndex]!;
    if (after.kind !== 'node') continue;
    const beforeIndex = beforeChildren.findIndex((before, index) =>
      !usedBefore.has(index) && before.kind === 'node' && before.key === after.key);
    if (beforeIndex !== -1) {
      matches[afterIndex] = beforeIndex;
      usedBefore.add(beforeIndex);
    }
  }
  for (let afterIndex = 0; afterIndex < afterChildren.length; afterIndex += 1) {
    if (matches[afterIndex] !== -1) continue;
    const fingerprint = childFingerprint(afterChildren[afterIndex]!);
    const beforeIndex = beforeChildren.findIndex((before, index) =>
      !usedBefore.has(index) && childFingerprint(before) === fingerprint);
    if (beforeIndex !== -1) {
      matches[afterIndex] = beforeIndex;
      usedBefore.add(beforeIndex);
    }
  }
  for (let afterIndex = 0; afterIndex < afterChildren.length; afterIndex += 1) {
    if (matches[afterIndex] !== -1) continue;
    const before = beforeChildren[afterIndex];
    if (before && !usedBefore.has(afterIndex) && arePositionallySimilarChildren(before, afterChildren[afterIndex]!)) {
      matches[afterIndex] = afterIndex;
      usedBefore.add(afterIndex);
    }
  }

  for (let afterIndex = 0; afterIndex < afterChildren.length; afterIndex += 1) {
    const after = afterChildren[afterIndex]!;
    const beforeIndex = matches[afterIndex]!;
    if (beforeIndex === -1) diffs.push(addedChild(after));
    else {
      const childDiff = diffChild(beforeChildren[beforeIndex]!, after);
      if (childDiff) diffs.push(childDiff);
    }
  }
  for (let beforeIndex = 0; beforeIndex < beforeChildren.length; beforeIndex += 1)
    if (!usedBefore.has(beforeIndex)) diffs.push(removedChild(beforeChildren[beforeIndex]!));
  return diffs;
}

function diffChild(before: RenderedSnapshotChild, after: RenderedSnapshotChild): SnapshotDiffChild | null {
  if (before.kind === 'text' || after.kind === 'text') {
    if (before.kind === 'text' && after.kind === 'text')
      return before.text === after.text ? null : { kind: 'text', type: 'modified', before, after };
    return after.kind === 'text' ? addedChild(after) : removedChild(before);
  }
  const children = diffChildren(before.children, after.children);
  const selfChanged = comparableNode(before) !== comparableNode(after);
  const directTextChanged = children.some((child) => child.kind === 'text');
  if (!selfChanged && children.length === 0) return null;
  return selfChanged || directTextChanged
    ? { kind: 'node', type: 'modified', before, after, children }
    : { kind: 'node', type: 'context', node: after, children };
}

function addedChild(child: RenderedSnapshotChild): SnapshotDiffChild {
  return child.kind === 'text' ? { kind: 'text', type: 'added', node: child } : { kind: 'node', type: 'added', node: child };
}
function removedChild(child: RenderedSnapshotChild): SnapshotDiffChild {
  return child.kind === 'text' ? { kind: 'text', type: 'removed', node: child } : { kind: 'node', type: 'removed', node: child };
}
function arePositionallySimilarChildren(before: RenderedSnapshotChild, after: RenderedSnapshotChild): boolean {
  if (before.kind !== after.kind) return false;
  if (before.kind === 'text' && after.kind === 'text') return true;
  return before.kind === 'node' && after.kind === 'node' && (before.key === after.key || before.role === after.role);
}

function budgetDiffFrames(diffs: SnapshotFrameDiff[]): BudgetedDiff {
  const budgeted: BudgetedDiff = {
    frames: [],
    frameDiffs: new Map(),
    nodeDiffs: new Map(),
    textDiffs: new Map(),
  };
  for (const diff of diffs) {
    if (diff.type === 'scope-change') continue;
    const source = diff.type === 'modified' ? diff.after : diff.frame;
    if (source.status === 'unavailable') {
      budgeted.frames.push(source);
      budgeted.frameDiffs.set(source, diff);
      continue;
    }
    const roots = diff.type === 'context'
      ? diff.children.flatMap((child) => cloneDiffChild(child, budgeted)).filter(isRenderedNode)
      : diff.type === 'modified'
        ? []
        : source.roots.map((root) => cloneWholeNode(root, diff.type, budgeted));
    const frame = { ...source, roots };
    budgeted.frames.push(frame);
    budgeted.frameDiffs.set(frame, diff);
  }
  return budgeted;
}

function cloneDiffChild(diff: SnapshotDiffChild, budgeted: BudgetedDiff): RenderedSnapshotChild[] {
  if (diff.kind === 'text') {
    const source = diff.type === 'removed' ? diff.node : diff.type === 'added' ? diff.node : diff.after;
    const text = { ...source };
    budgeted.textDiffs.set(text, diff);
    return [text];
  }
  const source = diff.type === 'modified' ? diff.after : diff.node;
  let children = diff.type === 'added' || diff.type === 'removed'
    ? source.children.map((child) => cloneWholeChild(child, diff.type, budgeted))
    : diff.children.flatMap((child) => cloneDiffChild(child, budgeted));
  if (diff.type === 'modified' && !diff.children.some((child) => child.kind === 'text'))
    children = [...source.children.filter((child) => child.kind === 'text').map((child) => ({ ...child })), ...children];
  const node = cloneNode(source, children, diff.type !== 'context');
  budgeted.nodeDiffs.set(node, diff);
  return [node];
}

function cloneWholeChild(
  child: RenderedSnapshotChild,
  type: 'added' | 'removed',
  budgeted: BudgetedDiff,
): RenderedSnapshotChild {
  if (child.kind === 'node') return cloneWholeNode(child, type, budgeted);
  const text = { ...child };
  budgeted.textDiffs.set(text, { kind: 'text', type, node: child });
  return text;
}

function cloneWholeNode(
  source: RenderedSnapshotNode,
  type: 'added' | 'removed',
  budgeted: BudgetedDiff,
): RenderedSnapshotNode {
  const children = source.children.map((child) => cloneWholeChild(child, type, budgeted));
  const node = cloneNode(source, children, true);
  budgeted.nodeDiffs.set(node, { kind: 'node', type, node: source });
  return node;
}

function cloneNode(
  source: RenderedSnapshotNode,
  children: RenderedSnapshotChild[],
  changed: boolean,
): RenderedSnapshotNode {
  const priority = changed ? 0 : source.priority;
  return {
    ...source,
    children,
    priority,
    summary: summarizeDiffNode(source, children, priority, changed),
  };
}

function summarizeDiffNode(
  source: RenderedSnapshotNode,
  children: RenderedSnapshotChild[],
  priority: RenderedSnapshotNode['priority'],
  changed: boolean,
): SnapshotSubtreeSummary {
  const sourceChildSummary = sumNodeSummaries(source.children);
  const summary: SnapshotSubtreeSummary = {
    nodes: 1,
    actions: Math.max(0, source.summary.actions - sourceChildSummary.actions),
    records: source.record ? 1 : 0,
    textChars: 0,
    changed: changed ? 1 : 0,
    critical: priority === 0 ? 1 : 0,
  };
  for (const child of children) {
    if (child.kind === 'text') summary.textChars += child.text.length;
    else addSummary(summary, child.summary);
  }
  return summary;
}

function sumNodeSummaries(children: RenderedSnapshotChild[]): SnapshotSubtreeSummary {
  const summary = emptySummary();
  for (const child of children) if (child.kind === 'node') addSummary(summary, child.summary);
  return summary;
}

function addSummary(target: SnapshotSubtreeSummary, source: SnapshotSubtreeSummary): void {
  target.nodes += source.nodes;
  target.actions += source.actions;
  target.records += source.records;
  target.textChars += source.textChars;
  target.changed += source.changed;
  target.critical += source.critical;
}

function emptySummary(): SnapshotSubtreeSummary {
  return { nodes: 0, actions: 0, records: 0, textChars: 0, changed: 0, critical: 0 };
}

function isRenderedNode(child: RenderedSnapshotChild): child is RenderedSnapshotNode {
  return child.kind === 'node';
}

function diffEnvelopeChars(snapshot: AiSnapshot, budgeted: BudgetedDiff): number {
  const lines = [renderPageOpen(snapshot, '')];
  for (const frame of budgeted.frames) {
    const diff = budgeted.frameDiffs.get(frame)!;
    if (diff.type === 'modified') {
      lines.push(renderFrameLine(diff.before, 1, '- ', true));
      lines.push(renderFrameLine(diff.after, 1, '+ ', true));
    } else {
      const prefix = diff.type === 'added' ? '+ ' : diff.type === 'removed' ? '- ' : '';
      lines.push(renderFrameLine(frame, 1, prefix, frame.status === 'unavailable'));
      if (frame.status === 'ok') lines.push(`${prefix}${indent(1)}</frame>`);
    }
  }
  lines.push('</page>');
  return lines.join('\n').length;
}

function diffSyntaxReserve(budgeted: BudgetedDiff): number {
  let chars = 0;
  const visit = (node: RenderedSnapshotNode, depth: number): void => {
    const diff = budgeted.nodeDiffs.get(node)!;
    const compact = singleTextChild(node) !== null;
    if (diff.type !== 'context') chars += compact ? 2 : 4;
    if (diff.type === 'modified' && !sameRef(diff.before, diff.after))
      chars += renderRemovedNodeLine(diff.before, depth).length + 1;
    if (!compact)
      for (const child of node.children) {
        if (child.kind === 'node') continue;
        const textDiff = budgeted.textDiffs.get(child);
        chars += textDiff?.type === 'modified'
          ? renderTextNode(textDiff.before, depth + 1, '- ').length + 3
          : diff.type === 'context' && !textDiff ? 0 : 2;
      }
    for (const child of node.children)
      if (child.kind === 'node') visit(child, depth + 1);
  };
  for (const frame of budgeted.frames)
    if (frame.status === 'ok')
      for (const root of frame.roots) visit(root, 2);
  return chars;
}

const diffRepresentationCost: SnapshotRepresentationCost = (node, representation, depth) => {
  const singleText = representation === 'full' ? singleTextChild(node) : null;
  if (singleText !== null)
    return `${indent(depth)}${formatTag(node.role, node.attrs, true)}${escapeText(singleText)}</${node.role}>\n`.length;
  return snapshotRepresentationCost(node, representation, depth);
};

function renderBudgetedFrame(
  frame: RenderedSnapshotFrame,
  budgeted: BudgetedDiff,
  allocation: SnapshotAllocation,
  renderedMarkers: Set<string>,
  depth: number,
  lines: string[],
): void {
  const diff = budgeted.frameDiffs.get(frame)!;
  if (diff.type === 'modified') {
    lines.push(renderFrameLine(diff.before, depth, '- ', true));
    lines.push(renderFrameLine(diff.after, depth, '+ ', true));
    return;
  }
  const prefix = diff.type === 'added' ? '+ ' : diff.type === 'removed' ? '- ' : '';
  lines.push(renderFrameLine(frame, depth, prefix, frame.status === 'unavailable'));
  if (frame.status === 'unavailable') return;
  for (const root of frame.roots)
    renderBudgetedNode(root, budgeted, allocation, renderedMarkers, depth + 1, lines);
  lines.push(`${prefix}${indent(depth)}</frame>`);
}

function renderBudgetedNode(
  node: RenderedSnapshotNode,
  budgeted: BudgetedDiff,
  allocation: SnapshotAllocation,
  renderedMarkers: Set<string>,
  depth: number,
  lines: string[],
): void {
  const representation = allocation.selected.get(node);
  if (!representation) {
    renderBudgetMarker(node.scopeRef, depth, lines, allocation, renderedMarkers);
    for (const child of node.children)
      if (child.kind === 'node')
        renderBudgetedNode(child, budgeted, allocation, renderedMarkers, depth, lines);
    return;
  }
  const diff = budgeted.nodeDiffs.get(node)!;
  if (diff.type === 'modified' && !sameRef(diff.before, diff.after)) {
    renderRemovedNode(diff.before, depth, lines);
    renderBudgetedNodeValue(node, '+ ', representation, budgeted, allocation, renderedMarkers, depth, lines);
    return;
  }
  renderBudgetedNodeValue(
    node,
    diff.type === 'added' ? '+ ' : diff.type === 'removed' ? '- ' : diff.type === 'modified' ? '~ ' : '',
    representation,
    budgeted,
    allocation,
    renderedMarkers,
    depth,
    lines,
  );
}

function renderBudgetedNodeValue(
  node: RenderedSnapshotNode,
  prefix: string,
  representation: SnapshotRepresentation,
  budgeted: BudgetedDiff,
  allocation: SnapshotAllocation,
  renderedMarkers: Set<string>,
  depth: number,
  lines: string[],
): void {
  const attrs = representation === 'identity' ? snapshotIdentityAttrs(node) : node.attrs;
  const identityLabel = representation === 'identity' ? snapshotIdentityLabel(node) : null;
  const singleText = representation === 'full' ? singleTextChild(node) : null;
  const hasSelectedNodeChild = node.children.some((child) => child.kind === 'node' && allocation.selected.has(child));
  const hasMarker = node.scopeRef ? hasOmittedSummary(allocation.omittedByScope.get(node.scopeRef)) : false;
  const label = identityLabel ?? singleText;
  if (label !== null && !hasSelectedNodeChild && !hasMarker) {
    lines.push(`${prefix}${indent(depth)}${formatTag(node.role, attrs, true)}${escapeText(label)}</${node.role}>`);
    return;
  }
  lines.push(`${prefix}${indent(depth)}${formatTag(node.role, attrs, true)}`);
  if (identityLabel) lines.push(`${prefix}${indent(depth + 1)}${escapeText(identityLabel)}`);
  for (const child of node.children) {
    if (child.kind === 'node')
      renderBudgetedNode(child, budgeted, allocation, renderedMarkers, depth + 1, lines);
    else if (representation === 'full') renderBudgetedText(child, budgeted, depth + 1, lines, prefix);
  }
  renderBudgetMarker(node.scopeRef, depth + 1, lines, allocation, renderedMarkers);
  lines.push(`${prefix}${indent(depth)}</${node.role}>`);
}

function renderBudgetedText(
  node: TextNode,
  budgeted: BudgetedDiff,
  depth: number,
  lines: string[],
  inheritedPrefix: string,
): void {
  const diff = budgeted.textDiffs.get(node);
  if (!diff || diff.type === 'added') lines.push(renderTextNode(node, depth, diff ? '+ ' : inheritedPrefix));
  else if (diff.type === 'removed') lines.push(renderTextNode(node, depth, '- '));
  else {
    lines.push(renderTextNode(diff.before, depth, '- '));
    lines.push(renderTextNode(diff.after, depth, '+ '));
  }
}

function renderBudgetMarker(
  ref: string | null,
  depth: number,
  lines: string[],
  allocation: SnapshotAllocation,
  renderedMarkers: Set<string>,
): void {
  if (!ref || renderedMarkers.has(ref)) return;
  const summary = allocation.omittedByScope.get(ref);
  if (!hasOmittedSummary(summary)) return;
  lines.push(`${indent(depth)}${renderSnapshotMarker(ref, summary!)}`);
  renderedMarkers.add(ref);
}

function hasOmittedSummary(summary: SnapshotSubtreeSummary | undefined): boolean {
  return Boolean(summary && Object.values(summary).some((value) => value > 0));
}

function renderRemovedNode(node: RenderedSnapshotNode, depth: number, lines: string[]): void {
  lines.push(renderRemovedNodeLine(node, depth));
}

function renderRemovedNodeLine(node: RenderedSnapshotNode, depth: number): string {
  const attrs = node.attrs.filter(([name]) => name === 'ref');
  return node.children.length === 0
    ? `- ${indent(depth)}${formatTag(node.role, attrs, false)}`
    : `- ${indent(depth)}${formatTag(node.role, attrs, true)}...</${node.role}>`;
}

function comparableFrame(frame: RenderedSnapshotFrame): string {
  return JSON.stringify({ status: frame.status, scope: frame.status === 'ok' ? frame.scope : undefined, id: frame.id, index: frame.index, url: frame.url, name: frame.name, parentId: frame.parentId, error: frame.status === 'unavailable' ? frame.error : undefined });
}
function comparableNode(node: RenderedSnapshotNode): string {
  return JSON.stringify({ role: node.role, attrs: comparableAttrs(node.attrs) });
}
function comparableAttrs(attrs: Array<[string, string]>): Array<[string, string]> {
  return attrs.flatMap(([name, value]) => LOW_SIGNAL_DIFF_ATTRS.has(name) ? [] : [[name, name === 'href' ? normalizeComparableHref(value) : value]] as Array<[string, string]>);
}
function sameRef(before: RenderedSnapshotNode, after: RenderedSnapshotNode): boolean {
  const ref = attrValue(before, 'ref');
  return ref !== null && ref === attrValue(after, 'ref');
}
function attrValue(node: RenderedSnapshotNode, name: string): string | null {
  return node.attrs.find(([attr]) => attr === name)?.[1] ?? null;
}
function singleTextChild(node: RenderedSnapshotNode): string | null {
  const child = node.children.length === 1 ? node.children[0]! : null;
  return child?.kind === 'text' && !child.block ? child.text : null;
}
function childFingerprint(child: RenderedSnapshotChild): string {
  return child.kind === 'text'
    ? `text:${child.text}`
    : JSON.stringify({ node: comparableNode(child), children: child.children.map(childFingerprint) });
}
function normalizeComparableHref(value: string): string {
  const normalized = value.endsWith('…') ? value.slice(0, -1) : value;
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return normalized.split(/[?#]/, 1)[0] ?? normalized;
  }
}

function renderPageOpen(snapshot: Pick<AiSnapshot, 'title' | 'url'>, prefix: string, selfClosing = false): string {
  return `${prefix}${formatTag('page', [['title', firstNonEmpty(snapshot.title, snapshot.url) ?? ''], ['url', snapshot.url]], !selfClosing)}`;
}
function renderFrameLine(frame: RenderedSnapshotFrame, depth: number, prefix: string, selfClosing: boolean): string {
  const attrs: Array<[string, string]> = [['index', String(frame.index)], ['url', normalizeText(frame.url, MAX_LABEL_CHARS)]];
  if (frame.status === 'ok') attrs.push(['scope', frame.scope]);
  if (frame.name) attrs.push(['name', normalizeText(frame.name, MAX_LABEL_CHARS)]);
  if (frame.parentId) attrs.push(['parent', frame.parentId]);
  if (frame.status === 'unavailable') attrs.push(['error', normalizeText(frame.error, 180)]);
  return `${prefix}${indent(depth)}${formatTag('frame', attrs, !selfClosing)}`;
}
function renderTextNode(node: TextNode, depth: number, prefix: string): string {
  return `${prefix}${indent(depth)}${escapeText(node.text)}`;
}
function indent(depth: number): string { return '\t'.repeat(depth); }
function formatTag(tagName: string, attributes: Array<[string, string]>, hasChildren: boolean): string {
  const attrs = attributes.filter(([, value]) => value !== '').map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  return hasChildren ? `<${tagName}${attrs}>` : `<${tagName}${attrs} />`;
}
function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeRawText(value ?? '');
    if (normalized) return truncate(normalized, MAX_LABEL_CHARS);
  }
  return null;
}
function normalizeText(value: string, maxChars: number): string { return truncate(value.replace(/\s+/g, ' ').trim(), maxChars); }
function normalizeRawText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function truncate(value: string, maxChars: number): string { return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value; }
function escapeText(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
