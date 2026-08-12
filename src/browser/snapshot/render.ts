/*
 * Derived from libretto-browser-tools.
 * MIT License, Copyright (c) 2026 Libretto contributors.
 */

import { scopeSnapshotToRef } from "./capture.js";
import {
  allocateSnapshot,
  renderSnapshotMarker,
  snapshotCriticalSupplementalText,
  snapshotCriticalSupplementalValues,
  snapshotIdentityAttrs,
  snapshotIdentityLabel,
  type SnapshotAllocation,
} from "./budget.js";
import type {
  AiSnapshot,
  AiSnapshotFrame,
  AiSnapshotNode,
  BoundedSnapshotText,
  RenderedSnapshotChild,
  RenderedSnapshotFrame,
  RenderedSnapshotNode,
  SnapshotPriority,
  SnapshotRecordIdentity,
  SnapshotRenderResult,
  SnapshotSubtreeSummary,
  SnapshotTreeMode,
  SnapshotPrimitive,
  SnapshotTextNode,
} from "./types.js";

const MAX_LABEL_CHARS = 140;
const MAX_HREF_CHARS = 96;
const TREE_EXTRA_ROLES = new Set(["paragraph", "article", "section", "region"]);

const PRESERVE_CHILDREN_BY_ROLE = new Set([
  "document",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "alert",
  "alertdialog",
  "dialog",
  "status",
  "form",
  "search",
  "list",
  "table",
  "grid",
  "tabpanel",
]);
const FLATTEN_ROLES = new Set([
  "none",
  "presentation",
  "LayoutTable",
  "LayoutTableRow",
  "LayoutTableCell",
]);
const SKIP_ROLES = new Set(["InlineTextBox", "ListMarker"]);
const ACTION_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "slider",
]);
const CRITICAL_ROLES = new Set(["alert", "alertdialog", "dialog", "status"]);
const RECORD_ROLES = new Set(["listitem", "row", "treeitem", "article"]);
const RECORD_PARENT_ROLES = new Set(["list", "table", "grid", "tree", "feed"]);
const RECORD_IDENTITY_STATE_ATTRS = new Set([
  "focused",
  "checked",
  "selected",
  "expanded",
  "disabled",
  "pressed",
  "value",
]);
const KEEP_ROLES = new Set([
  "document",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "alert",
  "alertdialog",
  "dialog",
  "status",
  "form",
  "search",
  "list",
  "listitem",
  "grid",
  "row",
  "button",
  "link",
  "image",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menu",
  "menuitem",
  "option",
  "tab",
  "slider",
]);
const BLOCK_FLATTEN_ROLES = new Set([
  "paragraph",
  "section",
  "article",
  "region",
  "group",
  "figure",
]);
const RENDERED_STATE_PROPERTIES = [
  "focused",
  "disabled",
  "checked",
  "expanded",
  "selected",
  "pressed",
  "required",
  "invalid",
  "readonly",
  "multiline",
  "autocomplete",
  "haspopup",
  "value",
];

export interface RenderSnapshotOptions {
  mode?: SnapshotTreeMode;
  ref?: string;
  maxChars?: number;
}

export const DEFAULT_ACT_SNAPSHOT_CHARS = 12_288;
export const DEFAULT_TREE_SNAPSHOT_CHARS = 32_768;

export function renderSnapshotResult(
  snapshot: AiSnapshot,
  options: RenderSnapshotOptions = {},
): SnapshotRenderResult {
  const mode = options.mode ?? "act";
  const scoped = options.ref ? scopeSnapshotToRef(snapshot, options.ref) : snapshot;
  const maxChars = Math.max(0, Math.floor(options.maxChars ?? (
    mode === "act" ? DEFAULT_ACT_SNAPSHOT_CHARS : DEFAULT_TREE_SNAPSHOT_CHARS
  )));
  const frames = renderSnapshotFrames(scoped, mode);
  const envelopeChars = pageAndFrameEnvelopeChars(scoped, frames);
  const allocation = allocateSnapshot(frames, maxChars, envelopeChars);
  const value = renderAllocatedSnapshot(scoped, frames, allocation);
  if (value.length > maxChars) {
    const bounded = boundSnapshotText(value, maxChars);
    return {
      ...bounded,
      criticalOmitted: allocation.criticalOmitted,
      warnings: allocation.criticalOmitted
        ? ["Critical snapshot content was omitted; inspect the nearest [more ref=...] scope."]
        : [],
    };
  }
  return {
    value,
    truncated: allocation.truncated,
    criticalOmitted: allocation.criticalOmitted,
    warnings: allocation.criticalOmitted
      ? ["Critical snapshot content was omitted; inspect the nearest [more ref=...] scope."]
      : [],
  };
}

export function renderSnapshot(
  snapshot: AiSnapshot,
  options: RenderSnapshotOptions = {},
): string {
  return renderSnapshotResult(snapshot, options).value;
}

export function renderSnapshotFrames(
  snapshot: AiSnapshot,
  mode: SnapshotTreeMode = "act",
): RenderedSnapshotFrame[] {
  return snapshot.frames
    .map((frame) => toRenderedFrame(frame, mode))
    .filter(hasRenderedFrameContent);
}

export function boundSnapshotText(
  value: string,
  maxChars: number,
): BoundedSnapshotText {
  const limit = Math.max(0, Math.floor(maxChars));
  if (value.length <= limit) return { value, truncated: false };
  let omitted = value.length;
  let marker = `\n...[truncated, ${omitted} chars omitted]`;
  let kept = Math.max(0, limit - marker.length);
  while (value.length - kept < omitted) {
    omitted = value.length - kept;
    marker = `\n...[truncated, ${omitted} chars omitted]`;
    kept = Math.max(0, limit - marker.length);
  }
  return {
    value: `${value.slice(0, kept)}${marker}`.slice(0, limit),
    truncated: true,
  };
}

function renderPageOpen(
  snapshot: Pick<AiSnapshot, "title" | "url">,
  prefix: string,
  selfClosing = false,
): string {
  return `${prefix}${formatTag(
    "page",
    [
      ["title", firstNonEmpty(snapshot.title, snapshot.url) ?? ""],
      ["url", snapshot.url],
    ],
    !selfClosing,
  )}`;
}

function pageAndFrameEnvelopeChars(
  snapshot: AiSnapshot,
  frames: RenderedSnapshotFrame[],
): number {
  const lines = [renderPageOpen(snapshot, "")];
  for (const frame of frames) {
    lines.push(renderFrameLine(frame, 1, "", frame.status === "unavailable"));
    if (frame.status === "ok") lines.push(`${indent(1)}</frame>`);
  }
  lines.push("</page>");
  return lines.join("\n").length;
}

function renderAllocatedSnapshot(
  snapshot: AiSnapshot,
  frames: RenderedSnapshotFrame[],
  allocation: SnapshotAllocation,
): string {
  const lines = [renderPageOpen(snapshot, "")];
  const renderedMarkers = new Set<string>();
  for (const frame of frames) {
    if (frame.status === "unavailable") {
      lines.push(renderFrameLine(frame, 1, "", true));
      continue;
    }
    lines.push(renderFrameLine(frame, 1, "", false));
    for (const root of frame.roots)
      renderAllocatedNode(root, 2, lines, allocation, renderedMarkers);
    lines.push(`${indent(1)}</frame>`);
  }
  lines.push("</page>");
  return lines.join("\n");
}

function renderAllocatedNode(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  allocation: SnapshotAllocation,
  renderedMarkers: Set<string>,
): void {
  const representation = allocation.selected.get(node);
  if (!representation) {
    renderAllocatedMarker(node.scopeRef, depth, lines, allocation, renderedMarkers);
    for (const child of node.children)
      if (child.kind === "node")
        renderAllocatedNode(child, depth, lines, allocation, renderedMarkers);
    return;
  }
  const attrs = representation === "identity"
    ? snapshotIdentityAttrs(node)
    : node.attrs;
  const label = representation === "identity" ? snapshotIdentityLabel(node) : criticalSupplementalText(node, allocation);
  const hasMarker = node.scopeRef
    ? hasOmittedSummary(allocation.omittedByScope.get(node.scopeRef))
    : false;
  if (representation === "identity" && label && !node.record && !hasMarker) {
    lines.push(`${indent(depth)}${formatTag(node.role, attrs, true)}${escapeText(label)}</${node.role}>`);
    return;
  }
  lines.push(`${indent(depth)}${formatTag(node.role, attrs, true)}`);
  if (label) lines.push(`${indent(depth + 1)}${escapeText(label)}`);
  for (const child of node.children)
    if (child.kind === "node")
      renderAllocatedNode(child, depth + 1, lines, allocation, renderedMarkers);
    else if (representation === "full") lines.push(`${indent(depth + 1)}${escapeText(child.text)}`);
  renderAllocatedMarker(
    node.scopeRef,
    depth + 1,
    lines,
    allocation,
    renderedMarkers,
  );
  lines.push(`${indent(depth)}</${node.role}>`);
}

function criticalSupplementalText(
  node: RenderedSnapshotNode,
  allocation: SnapshotAllocation,
): string | null {
  const values = criticalSupplementalValues(node, allocation);
  return values.length ? values.join(" ") : null;
}

function criticalSupplementalValues(
  node: RenderedSnapshotNode,
  allocation: SnapshotAllocation,
): string[] {
  const values = snapshotCriticalSupplementalValues(node);
  if (!values.length) return [];
  const covered = new Map<string, number>();
  for (const child of node.children)
    if (child.kind === "node")
      for (const value of renderedTextValues(child, allocation))
        covered.set(value, (covered.get(value) ?? 0) + 1);
  const missing = values.filter((value) => {
    const count = covered.get(value) ?? 0;
    if (count <= 0) return true;
    covered.set(value, count - 1);
    return false;
  });
  return missing;
}

function renderedTextValues(
  node: RenderedSnapshotNode,
  allocation: SnapshotAllocation,
): string[] {
  const representation = allocation.selected.get(node);
  if (!representation)
    return node.children.flatMap((child) =>
      child.kind === "node" ? renderedTextValues(child, allocation) : [],
    );
  const values: string[] = [];
  if (representation === "identity") {
    const label = snapshotIdentityLabel(node);
    if (label) values.push(label);
  } else {
    for (const child of node.children)
      if (child.kind === "text") values.push(child.text);
  }
  for (const child of node.children)
    if (child.kind === "node")
      values.push(...renderedTextValues(child, allocation));
  if (representation === "full")
    values.push(...criticalSupplementalValues(node, allocation));
  return values;
}

function renderAllocatedMarker(
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
  return Boolean(summary && (
    summary.nodes > 0 || summary.actions > 0 || summary.records > 0 ||
    summary.textChars > 0 || summary.changed > 0 || summary.critical > 0
  ));
}

function renderFrameLine(
  frame: RenderedSnapshotFrame,
  depth: number,
  prefix: string,
  selfClosing: boolean,
): string {
  const attrs: Array<[string, string]> = [
    ["index", String(frame.index)],
    ["url", normalizeText(frame.url, MAX_LABEL_CHARS)],
  ];
  if (frame.name)
    attrs.push(["name", normalizeText(frame.name, MAX_LABEL_CHARS)]);
  if (frame.parentId) attrs.push(["parent", frame.parentId]);
  if (frame.status === "unavailable")
    attrs.push(["error", normalizeText(frame.error, 180)]);
  return `${prefix}${indent(depth)}${formatTag("frame", attrs, !selfClosing)}`;
}

function indent(depth: number): string {
  return "\t".repeat(depth);
}
function formatTag(
  tagName: string,
  attributes: Array<[string, string]>,
  hasChildren: boolean,
): string {
  const attrs = attributes
    .filter(([, value]) => value !== "")
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return hasChildren ? `<${tagName}${attrs}>` : `<${tagName}${attrs} />`;
}

function toRenderedFrame(
  frame: AiSnapshotFrame,
  mode: SnapshotTreeMode,
): RenderedSnapshotFrame {
  if (frame.status === "unavailable") return frame;
  const roots = frame.roots.flatMap((root) => toRenderedNodes(root, null, mode));
  markRepeatedRecords(roots);
  return {
    ...frame,
    roots,
  };
}
function hasRenderedFrameContent(frame: RenderedSnapshotFrame): boolean {
  return frame.status === "unavailable" || frame.roots.length > 0;
}
function toRenderedNodes(
  node: AiSnapshotNode,
  parent: AiSnapshotNode | null,
  mode: SnapshotTreeMode,
): RenderedSnapshotNode[] {
  return toRenderedChildren(node, parent, mode).filter(isRenderedNode);
}

function toRenderedChildren(
  node: AiSnapshotNode,
  parent: AiSnapshotNode | null,
  mode: SnapshotTreeMode,
): RenderedSnapshotChild[] {
  if (shouldSkipNode(node, parent)) return [];
  if (isTextRole(node.role)) {
    const text = firstNonEmpty(
      node.name,
      node.description,
      primitiveToString(node.value),
    );
    return text && text !== parent?.name && text !== nodeTextValue(parent)
      ? [{ kind: "text", text }]
      : [];
  }
  const children = renderableChildren(node, mode);
  const role = tagNameForRole(node.role);
  if (role === "heading") return renderHeading(node, children);
  const compactRole = roleForNode(node, role, children);
  if (compactRole === "image" && !hasNonEmptyAttribute(node, "src")) return [];
  if (compactRole === "link" && !hasNonEmptyAttribute(node, "href"))
    return flattenedChildren(node, children, mode).filter(
      hasVisibleTextOrInteractive,
    );
  if (mode === "act" && TREE_EXTRA_ROLES.has(compactRole)) {
    return children.some(hasInteractiveNode)
      ? flattenedChildren(node, children, mode).filter(
          hasVisibleTextOrInteractive,
        )
      : [];
  }
  if (
    node.ignored ||
    FLATTEN_ROLES.has(node.role) ||
    (!KEEP_ROLES.has(compactRole) &&
      !(mode === "tree" && TREE_EXTRA_ROLES.has(compactRole)))
  ) {
    return flattenedChildren(node, children, mode).filter(
      hasVisibleTextOrInteractive,
    );
  }
  const text = normalizedText(children);
  const suppressName = text.includes(normalizeRawText(node.name ?? ""))
    ? node.name
    : null;
  const content = nameAttributeAsContent(
    nodeAttributes(node, suppressName),
    children,
  );
  const renderedChildren = removeDuplicateNestedActions(
    compactRole,
    content.attrs,
    content.children,
  ).filter(hasVisibleTextOrInteractive);
  if (
    !ACTION_ROLES.has(compactRole) &&
    !renderedChildren.some(hasVisibleTextOrInteractive)
  )
    return [];
  const record = isRecord(node, parent, compactRole);
  const priority = ownPriority(node, compactRole, record);
  const recordIdentity = identityForNode(
    node,
    compactRole,
    content.attrs,
    renderedChildren,
  );
  return [
    {
      kind: "node",
      key:
        node.nodeId ||
        node.ref ||
        `${compactRole}:${content.attrs.map(([name, value]) => `${name}=${value}`).join(";")}`,
      role: compactRole,
      attrs: content.attrs,
      children: renderedChildren,
      summary: summarizeSubtree(renderedChildren, compactRole, record, priority),
      priority,
      scopeRef: node.ref,
      record,
      recordIdentity,
    },
  ];
}

function renderableChildren(
  node: AiSnapshotNode,
  mode: SnapshotTreeMode,
): RenderedSnapshotChild[] {
  const children = mergeAdjacentText(
    node.children.flatMap((child) => toRenderedChildren(child, node, mode)),
  ).filter(hasVisibleTextOrInteractive);
  markRepeatedRecords(children);
  return children;
}
function ownPriority(
  node: AiSnapshotNode,
  renderedRole: string,
  record: boolean,
): SnapshotPriority {
  const invalid = node.properties.invalid === true || node.properties.invalid === "true";
  if (node.properties.focused === true || invalid || CRITICAL_ROLES.has(renderedRole)) return 0;
  if (ACTION_ROLES.has(renderedRole)) return 1;
  if (record) return 2;
  if (node.name || renderedRole === "heading") return 3;
  return 4;
}
function isRecord(
  node: AiSnapshotNode,
  parent: AiSnapshotNode | null,
  role: string,
): boolean {
  return RECORD_ROLES.has(role) && parent !== null && RECORD_PARENT_ROLES.has(tagNameForRole(parent.role));
}
function markRepeatedRecords(children: RenderedSnapshotChild[]): void {
  const groups = new Map<string, RenderedSnapshotNode[]>();
  for (const child of children)
    if (child.kind === "node" && child.summary.actions > 0)
      groups.set(child.role, [...(groups.get(child.role) ?? []), child]);
  for (const records of groups.values())
    if (records.length >= 3)
      for (const record of records)
        if (!record.record) {
          record.record = true;
          record.priority = Math.min(record.priority, 2) as SnapshotPriority;
          record.summary.records += 1;
        }
}
function identityForNode(
  node: AiSnapshotNode,
  role: string,
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): SnapshotRecordIdentity {
  return {
    name: firstNonEmpty(
      node.name,
      CRITICAL_ROLES.has(role) ? normalizedText(children) : null,
    ),
    action: ACTION_ROLES.has(role)
      ? actionLabelFromContent(attrs, children)
      : firstActionLabel(children),
    states: attrs.filter(([name, value]) =>
      RECORD_IDENTITY_STATE_ATTRS.has(name) && value !== "",
    ),
  };
}
function firstActionLabel(children: RenderedSnapshotChild[]): string | null {
  for (const child of children)
    if (child.kind === "node" && child.recordIdentity.action)
      return child.recordIdentity.action;
  return null;
}
function actionLabelFromContent(
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): string | null {
  const singleText = children.length === 1 && children[0]!.kind === "text"
    ? children[0]!.text
    : null;
  return firstNonEmpty(
    singleText,
    attrFromAttrs(attrs, "name"),
    attrFromAttrs(attrs, "value"),
    attrFromAttrs(attrs, "placeholder"),
  );
}
function summarizeSubtree(
  children: RenderedSnapshotChild[],
  role: string,
  record: boolean,
  priority: SnapshotPriority,
): SnapshotSubtreeSummary {
  const summary: SnapshotSubtreeSummary = {
    nodes: 1,
    actions: ACTION_ROLES.has(role) ? 1 : 0,
    records: record ? 1 : 0,
    textChars: 0,
    changed: 0,
    critical: priority === 0 ? 1 : 0,
  };
  for (const child of children)
    if (child.kind === "text") summary.textChars += child.text.length;
    else {
      summary.nodes += child.summary.nodes;
      summary.actions += child.summary.actions;
      summary.records += child.summary.records;
      summary.textChars += child.summary.textChars;
      summary.changed += child.summary.changed;
      summary.critical += child.summary.critical;
    }
  return summary;
}
function renderHeading(
  node: AiSnapshotNode,
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const text = firstNonEmpty(node.name, normalizedText(children));
  return text
    ? [
        {
          kind: "text",
          text: `${"#".repeat(headingLevel(node))} ${text}`,
          block: true,
        },
      ]
    : [];
}
function headingLevel(node: AiSnapshotNode): number {
  const level =
    typeof node.properties.level === "number"
      ? node.properties.level
      : Number(node.properties.level);
  return Number.isFinite(level)
    ? Math.min(6, Math.max(1, Math.round(level)))
    : 2;
}
function roleForNode(
  node: AiSnapshotNode,
  role: string,
  children: RenderedSnapshotChild[],
): string {
  return isPointerButtonCandidate(node, role, children) ? "button" : role;
}
function isPointerButtonCandidate(
  node: AiSnapshotNode,
  role: string,
  children: RenderedSnapshotChild[],
): boolean {
  return (
    !KEEP_ROLES.has(role) &&
    !children.some(hasInteractiveNode) &&
    hasClickableHint(node) &&
    Boolean(firstNonEmpty(node.name, normalizedText(children)))
  );
}
function hasClickableHint(node: AiSnapshotNode): boolean {
  return (
    node.attributes.cursor === "pointer" ||
    Object.hasOwn(node.attributes, "onclick") ||
    (node.attributes.tabindex !== undefined &&
      Number(node.attributes.tabindex) >= 0)
  );
}
function hasInteractiveNode(child: RenderedSnapshotChild): boolean {
  return (
    child.kind === "node" &&
    (ACTION_ROLES.has(child.role) || child.children.some(hasInteractiveNode))
  );
}
function flattenedChildren(
  node: AiSnapshotNode,
  children: RenderedSnapshotChild[],
  mode: SnapshotTreeMode,
): RenderedSnapshotChild[] {
  const fallbackText = fallbackTextForFlattenedNode(node);
  const flattened =
    children.length || !fallbackText
      ? children
      : [{ kind: "text" as const, text: fallbackText }];
  return BLOCK_FLATTEN_ROLES.has(tagNameForRole(node.role)) ||
    (mode === "tree" && TREE_EXTRA_ROLES.has(tagNameForRole(node.role)))
    ? flattened.map((child) =>
        child.kind === "text" ? { ...child, block: true } : child,
      )
    : flattened;
}
function fallbackTextForFlattenedNode(node: AiSnapshotNode): string | null {
  const name = firstNonEmpty(node.name, primitiveToString(node.value));
  return !name ||
    attributeMatchesName(node, "aria-label", name) ||
    attributeMatchesName(node, "title", name) ||
    attributeMatchesName(node, "alt", name)
    ? null
    : name;
}
function attributeMatchesName(
  node: AiSnapshotNode,
  attributeName: string,
  name: string,
): boolean {
  return normalizeRawText(node.attributes[attributeName] ?? "") === name;
}
function hasNonEmptyAttribute(
  node: AiSnapshotNode,
  attributeName: string,
): boolean {
  return normalizeRawText(node.attributes[attributeName] ?? "") !== "";
}
function removeDuplicateNestedActions(
  role: string,
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const label = ACTION_ROLES.has(role)
    ? firstNonEmpty(attrFromAttrs(attrs, "name"), normalizedText(children))
    : null;
  return !label
    ? children
    : children.flatMap((child) => {
        if (child.kind === "text" || !ACTION_ROLES.has(child.role))
          return [child];
        const childLabel = firstNonEmpty(
          attrValue(child, "name"),
          singleTextChild(child),
          normalizedText(child.children),
        );
        return childLabel === label ? child.children : [child];
      });
}
function nameAttributeAsContent(
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): { attrs: Array<[string, string]>; children: RenderedSnapshotChild[] } {
  const name = attrFromAttrs(attrs, "name");
  if (!name) return { attrs, children };
  const attrsWithoutName = attrs.filter(([attr]) => attr !== "name");
  return normalizedText(children).includes(normalizeRawText(name))
    ? { attrs: attrsWithoutName, children }
    : {
        attrs: attrsWithoutName,
        children: [{ kind: "text", text: name }, ...children],
      };
}

export function renderFrame(
  frame: RenderedSnapshotFrame,
  depth: number,
  lines: string[],
  prefix = "",
): void {
  if (frame.status === "unavailable") {
    lines.push(renderFrameLine(frame, depth, prefix, true));
    return;
  }
  lines.push(renderFrameLine(frame, depth, prefix, false));
  for (const root of frame.roots) renderNode(root, depth + 1, lines, prefix);
  lines.push(`${prefix}${indent(depth)}</frame>`);
}
export function renderNode(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  prefix = "",
): void {
  if (renderFoldedSingleChildChain(node, depth, lines, prefix)) return;
  if (!node.children.length) {
    lines.push(
      `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, false)}`,
    );
    return;
  }
  const singleText = singleTextChild(node);
  if (singleText !== null) {
    if (shouldRenderBareText(node)) {
      lines.push(`${prefix}${indent(depth)}${escapeText(singleText)}`);
      return;
    }
    lines.push(
      `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, true)}${escapeText(singleText)}</${node.role}>`,
    );
    return;
  }
  lines.push(
    `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, true)}`,
  );
  renderChildren(node.children, depth + 1, lines, prefix);
  lines.push(`${prefix}${indent(depth)}</${node.role}>`);
}
function renderChildren(
  children: RenderedSnapshotChild[],
  depth: number,
  lines: string[],
  prefix: string,
): void {
  for (const child of children)
    child.kind === "text"
      ? lines.push(`${prefix}${indent(depth)}${escapeText(child.text)}`)
      : renderNode(child, depth, lines, prefix);
}
function renderFoldedSingleChildChain(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  prefix: string,
): boolean {
  const chain = singleChildChain(node);
  if (chain.length <= 1) return false;
  const keptIndexes = chain
    .map((chainNode, index) => ({ chainNode, index }))
    .filter(({ chainNode, index }) => index === 0 || chainNode.role === "list")
    .map(({ index }) => index);
  if (keptIndexes.length === chain.length) return false;
  renderFoldedChainNode(chain, keptIndexes, 0, depth, lines, prefix);
  return true;
}
function renderFoldedChainNode(
  chain: RenderedSnapshotNode[],
  keptIndexes: number[],
  keptIndexPosition: number,
  depth: number,
  lines: string[],
  prefix: string,
): void {
  const currentIndex = keptIndexes[keptIndexPosition]!;
  const current = chain[currentIndex]!;
  lines.push(
    `${prefix}${indent(depth)}${formatTag(current.role, current.attrs, true)}`,
  );
  for (const child of current.children)
    if (child.kind === "text")
      lines.push(`${prefix}${indent(depth + 1)}${escapeText(child.text)}`);
  const nextKeptIndex = keptIndexes[keptIndexPosition + 1];
  if (nextKeptIndex !== undefined) {
    if (nextKeptIndex > currentIndex + 1)
      lines.push(`${prefix}${indent(depth + 1)}...`);
    renderFoldedChainNode(
      chain,
      keptIndexes,
      keptIndexPosition + 1,
      depth + 1,
      lines,
      prefix,
    );
  } else {
    const terminal = chain[chain.length - 1]!;
    if (chain.length - 1 > currentIndex)
      lines.push(`${prefix}${indent(depth + 1)}...`);
    renderChildren(terminal.children, depth + 1, lines, prefix);
  }
  lines.push(`${prefix}${indent(depth)}</${current.role}>`);
}
function singleChildChain(node: RenderedSnapshotNode): RenderedSnapshotNode[] {
  const chain = [node];
  let current = node;
  while (isDeprioritizedSingleChildParent(current)) {
    const child = singleElementChild(current);
    if (!child || ACTION_ROLES.has(child.role)) break;
    chain.push(child);
    current = child;
  }
  return chain;
}
function isDeprioritizedSingleChildParent(node: RenderedSnapshotNode): boolean {
  return (
    node.role !== "document" &&
    !ACTION_ROLES.has(node.role) &&
    singleElementChild(node) !== null
  );
}
function singleElementChild(
  node: RenderedSnapshotNode,
): RenderedSnapshotNode | null {
  let result: RenderedSnapshotNode | null = null;
  for (const child of node.children)
    if (child.kind === "node") {
      if (result) return null;
      result = child;
    }
  return result;
}
function shouldRenderBareText(node: RenderedSnapshotNode): boolean {
  return (
    !ACTION_ROLES.has(node.role) &&
    !attrValue(node, "ref") &&
    !PRESERVE_CHILDREN_BY_ROLE.has(node.role)
  );
}
function nodeAttributes(
  node: AiSnapshotNode,
  suppressName: string | null,
): Array<[string, string]> {
  const attributes: Array<[string, string]> = [];
  const usedNames = new Set<string>();
  const push = (name: string, value: SnapshotPrimitive | undefined): void => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === false ||
      value === "false"
    )
      return;
    const normalizedName = uniqueAttributeName(
      sanitizeAttributeName(name),
      usedNames,
    );
    attributes.push([
      normalizedName,
      normalizeAttributeValue(normalizedName, value),
    ]);
    usedNames.add(normalizedName);
  };
  push("ref", node.ref);
  if (node.name !== suppressName) push("name", node.name);
  const hasStateValue =
    node.properties.value !== undefined &&
    node.properties.value !== null &&
    node.properties.value !== "";
  for (const name of RENDERED_STATE_PROPERTIES) {
    const value = node.properties[name];
    if (value === true) push(name, "true");
    else push(name, value);
  }
  if (!hasStateValue) push("value", node.value);
  push("href", node.attributes.href);
  push("placeholder", node.attributes.placeholder);
  return attributes;
}
function normalizeAttributeValue(
  name: string,
  value: SnapshotPrimitive,
): string {
  const normalized = normalizeRawText(String(value));
  return name === "href" ? truncate(normalized, MAX_HREF_CHARS) : normalized;
}
function singleTextChild(node: RenderedSnapshotNode): string | null {
  return node.children.length === 1 &&
    node.children[0]!.kind === "text" &&
    !node.children[0]!.block
    ? node.children[0]!.text
    : null;
}
function mergeAdjacentText(
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const result: RenderedSnapshotChild[] = [];
  for (const child of children) {
    const previous = result.at(-1);
    if (
      child.kind === "text" &&
      previous?.kind === "text" &&
      !child.block &&
      !previous.block
    )
      previous.text = normalizeRawText(`${previous.text} ${child.text}`);
    else result.push(child);
  }
  return result;
}
function normalizedText(children: RenderedSnapshotChild[]): string {
  return children
    .map((child) =>
      child.kind === "text" ? child.text : normalizedText(child.children),
    )
    .join(" ");
}
function attrValue(node: RenderedSnapshotNode, name: string): string | null {
  return node.attrs.find(([attr]) => attr === name)?.[1] ?? null;
}
function attrFromAttrs(
  attrs: Array<[string, string]>,
  name: string,
): string | null {
  return attrs.find(([attr]) => attr === name)?.[1] ?? null;
}
function shouldSkipNode(
  node: AiSnapshotNode,
  parent: AiSnapshotNode | null,
): boolean {
  return (
    SKIP_ROLES.has(node.role) ||
    (node.role === "StaticText" &&
      Boolean(parent?.name && node.name && parent.name === node.name))
  );
}
function isTextRole(role: string): boolean {
  return role === "StaticText" || role === "InlineTextBox";
}
function isRenderedNode(
  child: RenderedSnapshotChild,
): child is RenderedSnapshotNode {
  return child.kind === "node";
}
function hasVisibleTextOrInteractive(child: RenderedSnapshotChild): boolean {
  return child.kind === "text"
    ? normalizeRawText(child.text) !== ""
    : ACTION_ROLES.has(child.role) ||
        child.children.some(hasVisibleTextOrInteractive);
}
function tagNameForRole(role: string): string {
  const normalized = normalizeRole(role).replace(/[^a-zA-Z0-9_.:-]/g, "-");
  return /^[a-zA-Z_:]/.test(normalized) ? normalized : "node";
}
function normalizeRole(role: string): string {
  return role === "RootWebArea"
    ? "document"
    : role === "textField"
      ? "textbox"
      : role || "node";
}
function primitiveToString(value: SnapshotPrimitive): string | null {
  return value === null ? null : String(value);
}
function nodeTextValue(node: AiSnapshotNode | null): string | null {
  if (!node) return null;
  const value = primitiveToString(node.properties.value ?? node.value);
  return value ? normalizeRawText(value) : null;
}
function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = normalizeRawText(value ?? "");
    if (normalized) return truncate(normalized, MAX_LABEL_CHARS);
  }
  return null;
}
function normalizeText(value: string, maxChars: number): string {
  return truncate(value.replace(/\s+/g, " ").trim(), maxChars);
}
function normalizeRawText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}
function uniqueAttributeName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) return name;
  let index = 2;
  while (usedNames.has(`${name}-${index}`)) index += 1;
  return `${name}-${index}`;
}
function sanitizeAttributeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_.:-]/g, "-");
  return /^[a-zA-Z_:]/.test(sanitized) ? sanitized : `attr-${sanitized}`;
}
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
