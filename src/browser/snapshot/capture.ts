/*
 * Derived from libretto-browser-tools.
 * MIT License, Copyright (c) 2026 Libretto contributors.
 */

import type { CDPSession, Page } from 'playwright-core';
import type { AiSnapshot, AiSnapshotNode, SnapshotPrimitive } from './types.js';

const MAX_ATTRIBUTE_NODE_LOOKUPS = 300;
const REFS_BY_ROLE = new Set(['RootWebArea', 'main', 'navigation', 'banner', 'contentinfo', 'form', 'search', 'article', 'section', 'region', 'heading', 'button', 'link', 'textbox', 'textField', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'menuitem', 'tab', 'slider', 'dialog', 'alertdialog', 'list', 'table', 'grid', 'tree', 'feed', 'group', 'listitem', 'row', 'treeitem']);
const INTERESTING_ATTRIBUTES = new Set(['data-testid', 'data-test', 'data-qa', 'data-cy', 'id', 'name', 'type', 'placeholder', 'href', 'src', 'aria-label', 'aria-modal', 'aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'role', 'title', 'alt', 'onclick', 'tabindex']);
const STATE_PROPERTY_NAMES = ['level', 'disabled', 'checked', 'expanded', 'selected', 'pressed', 'focused', 'required', 'invalid', 'readonly', 'multiline', 'autocomplete', 'haspopup', 'value'];

type RawAxProperty = { name: string; value: SnapshotPrimitive };
type RawAxNode = { nodeId: string; parentId: string | null; ignored: boolean; role: string; name: string | null; value: SnapshotPrimitive; description: string | null; properties: RawAxProperty[]; childIds: string[]; backendDOMNodeId: number | null };
type MutableSnapshotNode = Omit<AiSnapshotNode, 'children'> & { childIds: string[]; children: MutableSnapshotNode[]; parent: MutableSnapshotNode | null };
type FrameInfo = { id: string; url: string; name: string | null; parentId: string | null };

export async function captureSnapshot(page: Page): Promise<AiSnapshot> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await enableIfSupported(cdp, 'DOM.enable');
    await enableIfSupported(cdp, 'Accessibility.enable');
    await enableIfSupported(cdp, 'Runtime.enable');
    const [title, frames] = await Promise.all([page.title().catch(() => ''), getFrameInfos(cdp)]);
    const snapshotFrames: AiSnapshot['frames'] = [];
    let nextRef = 1;
    for (const [index, frame] of frames.entries()) {
      const frameSnapshot = await captureFrameSnapshot(cdp, frame, index);
      if (frameSnapshot.ok) {
        nextRef = assignRefs(frameSnapshot.roots, nextRef);
        snapshotFrames.push({ status: 'ok', scope: frameSnapshot.scope, id: frame.id, index, url: frame.url, name: frame.name, parentId: frame.parentId, roots: frameSnapshot.roots.map(toSnapshotNode) });
      } else {
        snapshotFrames.push({ status: 'unavailable', id: frame.id, index, url: frame.url, name: frame.name, parentId: frame.parentId, error: frameSnapshot.error });
      }
    }
    return { title, url: page.url(), frames: snapshotFrames };
  } finally { await cdp.detach().catch(() => {}); }
}

export function findSnapshotNodeByRef(snapshotTree: AiSnapshot, ref: string): AiSnapshotNode {
  const matchingNode = findNodeByRef(snapshotTree, ref.trim());
  if (!matchingNode) throw new Error(`Snapshot ref "${ref}" was not found.`);
  return matchingNode;
}

export function scopeSnapshotToRef(snapshotTree: AiSnapshot, ref: string): AiSnapshot {
  const matchingNode = findSnapshotNodeByRef(snapshotTree, ref);
  return { ...snapshotTree, frames: snapshotTree.frames.flatMap((frame) => frame.status === 'ok' && frameContainsNode(frame.roots, matchingNode) ? [{ ...frame, roots: [matchingNode] }] : []) };
}

function findNodeByRef(snapshotTree: AiSnapshot, ref: string): AiSnapshotNode | null {
  const exact = findNode(snapshotTree, (node) => node.ref === ref);
  if (exact) return exact;
  const numericSuffix = ref.match(/^[a-zA-Z]+(\d+)$/)?.[1];
  return numericSuffix ? findNode(snapshotTree, (node) => node.ref?.match(/^[a-zA-Z]+(\d+)$/)?.[1] === numericSuffix) : null;
}
function findNode(snapshotTree: AiSnapshot, predicate: (node: AiSnapshotNode) => boolean): AiSnapshotNode | null {
  for (const frame of snapshotTree.frames) if (frame.status === 'ok') for (const root of frame.roots) { const node = findNodeInTree(root, predicate); if (node) return node; }
  return null;
}
function findNodeInTree(node: AiSnapshotNode, predicate: (node: AiSnapshotNode) => boolean): AiSnapshotNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) { const match = findNodeInTree(child, predicate); if (match) return match; }
  return null;
}
function frameContainsNode(roots: AiSnapshotNode[], target: AiSnapshotNode): boolean { return roots.some((root) => findNodeInTree(root, (node) => node === target)); }

async function enableIfSupported(cdp: CDPSession, method: 'DOM.enable' | 'Accessibility.enable' | 'Runtime.enable'): Promise<void> { try { await cdp.send(method); } catch {} }
async function captureFrameSnapshot(cdp: CDPSession, frame: FrameInfo, frameIndex: number): Promise<{ ok: true; roots: MutableSnapshotNode[]; scope: 'document' | 'modal' } | { ok: false; error: string }> {
  try { return await readFrameSnapshot(cdp, { frameId: frame.id }); }
  catch (error) {
    if (frameIndex !== 0) return { ok: false, error: error instanceof Error ? error.message : String(error) };
    try { return await readFrameSnapshot(cdp); }
    catch (fallbackError) { return { ok: false, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }; }
  }
}
async function readFrameSnapshot(cdp: CDPSession, params?: { frameId: string }): Promise<{ ok: true; roots: MutableSnapshotNode[]; scope: 'document' | 'modal' }> {
  const rawNodes = parseAxNodes(await cdp.send('Accessibility.getFullAXTree', params) as unknown);
  return { ok: true, ...buildSnapshotTree(rawNodes, await readAttributesByBackendNodeId(cdp, rawNodes)) };
}
async function getFrameInfos(cdp: CDPSession): Promise<FrameInfo[]> { try { const frames = parseFrameTree(await cdp.send('Page.getFrameTree') as unknown); return frames.length ? frames : [{ id: 'main', url: '', name: null, parentId: null }]; } catch { return [{ id: 'main', url: '', name: null, parentId: null }]; } }
function parseFrameTree(response: unknown): FrameInfo[] {
  const frames: FrameInfo[] = [];
  function visit(value: unknown, inheritedParentId: string | null): void { const tree = readRecord(value); const frame = readRecord(tree.frame); const id = readString(frame.id); if (!id) return; frames.push({ id, url: readString(frame.url) ?? '', name: readString(frame.name), parentId: readString(frame.parentId) ?? inheritedParentId }); for (const child of Array.isArray(tree.childFrames) ? tree.childFrames : []) visit(child, id); }
  visit(readRecord(response).frameTree, null); return frames;
}
function parseAxNodes(response: unknown): RawAxNode[] { const nodes = readRecord(response).nodes; return Array.isArray(nodes) ? nodes.map(parseAxNode) : []; }
function parseAxNode(value: unknown): RawAxNode { const record = readRecord(value); return { nodeId: readString(record.nodeId) ?? '', parentId: readString(record.parentId), ignored: readBoolean(record.ignored) ?? false, role: readAxValueString(record.role) ?? 'unknown', name: readAxValueString(record.name), value: readAxPrimitive(record.value), description: readAxValueString(record.description), properties: parseAxProperties(record.properties), childIds: Array.isArray(record.childIds) ? record.childIds.map(readString).filter((id): id is string => id !== null) : [], backendDOMNodeId: readNumber(record.backendDOMNodeId) }; }
function parseAxProperties(value: unknown): RawAxProperty[] { if (!Array.isArray(value)) return []; const properties: RawAxProperty[] = []; for (const item of value) { const record = readRecord(item); const name = readString(record.name); if (name) properties.push({ name, value: readAxPrimitive(record.value) }); } return properties; }

async function readAttributesByBackendNodeId(cdp: CDPSession, nodes: RawAxNode[]): Promise<Map<number, Record<string, string>>> {
  const ids = [...new Set(nodes.filter(shouldReadAttributes).sort((a, b) => attributeLookupPriority(a) - attributeLookupPriority(b)).map((node) => node.backendDOMNodeId).filter((id): id is number => id !== null))].slice(0, MAX_ATTRIBUTE_NODE_LOOKUPS);
  const result = new Map<number, Record<string, string>>();
  await Promise.all(ids.map(async (id) => { const attributes = await readAttributesForBackendNodeId(cdp, id); if (Object.keys(attributes).length) result.set(id, attributes); })); return result;
}
function shouldReadAttributes(node: RawAxNode): boolean { return !node.ignored && node.backendDOMNodeId !== null && (REFS_BY_ROLE.has(node.role) || node.role === 'generic' || node.role === 'group' || Boolean(node.name?.trim()) || node.properties.some((property) => STATE_PROPERTY_NAMES.includes(property.name))); }
function attributeLookupPriority(node: RawAxNode): number { return REFS_BY_ROLE.has(node.role) ? 0 : node.name?.trim() || node.properties.some((property) => STATE_PROPERTY_NAMES.includes(property.name)) ? 1 : 2; }
async function readAttributesForBackendNodeId(cdp: CDPSession, backendNodeId: number): Promise<Record<string, string>> {
  try { const node = readRecord(readRecord(await cdp.send('DOM.describeNode', { backendNodeId, depth: 0, pierce: false }) as unknown).node); const raw = Array.isArray(node.attributes) ? node.attributes : []; const attributes: Record<string, string> = {}; for (let i = 0; i < raw.length - 1; i += 2) { const name = readString(raw[i]); const value = readString(raw[i + 1]); if (name && value !== null && INTERESTING_ATTRIBUTES.has(name) && !(name === 'tabindex' && Number(value) < 0)) attributes[name] = value; } if (await readComputedCursorForBackendNodeId(cdp, backendNodeId) === 'pointer') attributes.cursor = 'pointer'; return attributes; } catch { return {}; }
}
async function readComputedCursorForBackendNodeId(cdp: CDPSession, backendDOMNodeId: number): Promise<string | null> { let objectId: string | null = null; try { objectId = readString(readRecord(readRecord(await cdp.send('DOM.resolveNode', { backendNodeId: backendDOMNodeId }) as unknown).object).objectId); if (!objectId) return null; return readString(readRecord(readRecord(await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { return getComputedStyle(this).cursor; }', returnByValue: true, silent: true }) as unknown).result).value); } catch { return null; } finally { if (objectId) await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {}); } }

function buildSnapshotTree(rawNodes: RawAxNode[], attributesByBackendNodeId: Map<number, Record<string, string>>): { roots: MutableSnapshotNode[]; scope: 'document' | 'modal' } {
  const byId = new Map<string, MutableSnapshotNode>(); const childIds = new Set<string>();
  for (const raw of rawNodes) if (raw.nodeId) byId.set(raw.nodeId, { nodeId: raw.nodeId, ignored: raw.ignored, role: raw.role, name: raw.name, value: raw.value, description: raw.description, properties: Object.fromEntries(raw.properties.map((property) => [property.name, property.value])), attributes: raw.backendDOMNodeId === null ? {} : attributesByBackendNodeId.get(raw.backendDOMNodeId) ?? {}, childIds: raw.childIds, children: [], parent: null, ref: null, subtreeSize: 1 });
  for (const node of byId.values()) for (const childId of node.childIds) { const child = byId.get(childId); if (child) { child.parent = node; node.children.push(child); childIds.add(childId); } }
  for (const raw of rawNodes) { if (!raw.parentId || childIds.has(raw.nodeId)) continue; const node = byId.get(raw.nodeId); const parent = byId.get(raw.parentId); if (node && parent) { node.parent = parent; parent.children.push(node); childIds.add(raw.nodeId); } }
  const scoped = scopeRootsToOpenModal([...byId.values()].filter((node) => !childIds.has(node.nodeId)));
  for (const root of scoped.roots) annotateSubtreeSize(root);
  return scoped;
}
export function scopeRootsToOpenModal(roots: MutableSnapshotNode[]): { roots: MutableSnapshotNode[]; scope: 'document' | 'modal' } {
  let active: MutableSnapshotNode | null = null;
  const visit = (node: MutableSnapshotNode): void => {
    if (!node.ignored && (
      node.properties.modal === true ||
      ((node.role === 'dialog' || node.role === 'alertdialog') &&
        node.attributes['aria-modal'] === 'true')
    )) active = node;
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return active
    ? { roots: [active], scope: 'modal' }
    : { roots, scope: 'document' };
}
function annotateSubtreeSize(node: MutableSnapshotNode): number { node.subtreeSize = 1; for (const child of node.children) node.subtreeSize += annotateSubtreeSize(child); return node.subtreeSize; }
function assignRefs(nodes: MutableSnapshotNode[], nextRef: number): number { for (const node of nodes) { if (shouldAssignRef(node)) node.ref = `l${nextRef++}`; nextRef = assignRefs(node.children, nextRef); } return nextRef; }
function toSnapshotNode(node: MutableSnapshotNode): AiSnapshotNode { return { nodeId: node.nodeId, ignored: node.ignored, role: node.role, name: node.name, value: node.value, description: node.description, properties: node.properties, attributes: node.attributes, children: node.children.map(toSnapshotNode), ref: node.ref, subtreeSize: node.subtreeSize }; }
function shouldAssignRef(node: MutableSnapshotNode): boolean { return !node.ignored && node.role !== 'StaticText' && node.role !== 'InlineTextBox' && node.role !== 'none' && node.role !== 'presentation' && (REFS_BY_ROLE.has(node.role) || Object.keys(node.attributes).length > 0 || Boolean(node.name)); }
function readRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function readString(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function readNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function readBoolean(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function readAxValueString(value: unknown): string | null { const raw = readRecord(value).value; return typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : null; }
function readAxPrimitive(value: unknown): SnapshotPrimitive { const raw = readRecord(value).value; return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null; }
