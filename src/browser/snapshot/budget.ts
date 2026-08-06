import type {
  RenderedSnapshotChild,
  RenderedSnapshotFrame,
  RenderedSnapshotNode,
  SnapshotSubtreeSummary,
} from "./types.js";

export type SnapshotRepresentation = "identity" | "full";

export interface SnapshotAllocation {
  selected: Map<RenderedSnapshotNode, SnapshotRepresentation>;
  omittedByScope: Map<string, SnapshotSubtreeSummary>;
  criticalOmitted: number;
  truncated: boolean;
}

export type SnapshotRepresentationCost = (
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
  depth: number,
) => number;

export interface SnapshotAllocationOptions {
  representationCost?: SnapshotRepresentationCost;
}

type Candidate = {
  node: RenderedSnapshotNode;
  parent: Candidate | null;
  depth: number;
  missingIdentityCost: number;
  missingFrontier: Candidate | null | undefined;
};

type AllocationState = {
  contentChars: number;
  markerChars: number;
  scopeByNode: Map<RenderedSnapshotNode, string>;
  markerDepthByScope: Map<string, number>;
};

const allocationStates = new WeakMap<SnapshotAllocation, AllocationState>();
const representationCosts = new WeakMap<
  RenderedSnapshotNode,
  Record<SnapshotRepresentation, number>
>();
const representationSummaries = new WeakMap<
  RenderedSnapshotNode,
  Record<SnapshotRepresentation, SnapshotSubtreeSummary>
>();
const STATE_ATTRS = new Set([
  "ref",
  "focused",
  "checked",
  "disabled",
  "expanded",
  "invalid",
  "placeholder",
  "pressed",
  "readonly",
  "required",
  "selected",
  "value",
]);
const CRITICAL_IDENTITY_ROLES = new Set(["alert", "alertdialog", "dialog", "status"]);

export function allocateSnapshot(
  frames: RenderedSnapshotFrame[],
  maxChars: number,
  envelopeChars: number,
  options: SnapshotAllocationOptions = {},
): SnapshotAllocation {
  const buckets: Candidate[][] = [[], [], [], [], []];
  collectCandidates(frames, buckets, options.representationCost ?? snapshotRepresentationCost);
  breadthFirstRecordsWithinP2(buckets[2]!);
  const allocation = reserveEnvelopeAndMarkers(frames, maxChars, envelopeChars);
  if (envelopeChars > maxChars) return finish(allocation);
  const candidates = buckets.flat();
  if (trySelectComplete(candidates, allocation, maxChars)) return finish(allocation);
  for (let priority = 0; priority < buckets.length; priority += 1)
    for (const candidate of buckets[priority]!)
      trySelect(
        candidate,
        preferredRepresentation(candidate.node),
        allocation,
        maxChars,
      );
  return finish(allocation);
}

function finish(allocation: SnapshotAllocation): SnapshotAllocation {
  allocation.criticalOmitted = totalOmitted(allocation, "critical");
  allocation.truncated = totalOmitted(allocation, "nodes") > 0 ||
    totalOmitted(allocation, "textChars") > 0;
  return allocation;
}

function collectCandidates(
  frames: RenderedSnapshotFrame[],
  buckets: Candidate[][],
  cost: SnapshotRepresentationCost,
): void {
  const visit = (
    node: RenderedSnapshotNode,
    parent: Candidate | null,
    depth: number,
  ): void => {
    const candidate = {
      node,
      parent,
      depth,
      missingIdentityCost: 0,
      missingFrontier: undefined,
    };
    representationCosts.set(node, {
      identity: cost(node, "identity", depth),
      full: cost(node, "full", depth),
    });
    representationSummaries.set(node, {
      identity: ownSummary(node, "identity"),
      full: ownSummary(node, "full"),
    });
    buckets[node.priority]!.push(candidate);
    for (const child of node.children)
      if (child.kind === "node") visit(child, candidate, depth + 1);
  };
  for (const frame of frames)
    if (frame.status === "ok")
      for (const root of frame.roots) visit(root, null, 2);
}

function breadthFirstRecordsWithinP2(candidates: Candidate[]): void {
  const groups = new Map<RenderedSnapshotNode | null, Candidate[]>();
  for (const candidate of candidates) {
    const container = candidate.parent?.node ?? null;
    const group = groups.get(container);
    if (group) group.push(candidate);
    else groups.set(container, [candidate]);
  }
  candidates.length = 0;
  let active = [...groups.values()].map((group) => ({ group, index: 0 }));
  while (active.length) {
    const next = [] as typeof active;
    for (const entry of active) {
      candidates.push(entry.group[entry.index]!);
      entry.index += 1;
      if (entry.index < entry.group.length) next.push(entry);
    }
    active = next;
  }
}

function reserveEnvelopeAndMarkers(
  frames: RenderedSnapshotFrame[],
  maxChars: number,
  envelopeChars: number,
): SnapshotAllocation {
  const omittedByScope = new Map<string, SnapshotSubtreeSummary>();
  const scopeByNode = new Map<RenderedSnapshotNode, string>();
  const markerDepthByScope = new Map<string, number>();
  const visit = (
    node: RenderedSnapshotNode,
    scope: string,
    depth: number,
  ): void => {
    scopeByNode.set(node, scope);
    addSummary(omittedByScope, scope, representationSummaryFor(node, "full"));
    const childScope = node.scopeRef ?? scope;
    if (node.scopeRef) markerDepthByScope.set(node.scopeRef, depth + 1);
    for (const child of node.children)
      if (child.kind === "node") visit(child, childScope, depth + 1);
  };
  for (const frame of frames)
    if (frame.status === "ok")
      for (const root of frame.roots) {
        const scope = root.scopeRef ?? firstScopeRef(root);
        if (!scope) continue;
        markerDepthByScope.set(scope, 3);
        visit(root, scope, 2);
      }
  const allocation: SnapshotAllocation = {
    selected: new Map(),
    omittedByScope,
    criticalOmitted: totalSummary(omittedByScope, "critical"),
    truncated: omittedByScope.size > 0,
  };
  const markerChars = envelopeChars > maxChars ? 0 : [...omittedByScope].reduce(
    (total, [ref, summary]) => total + markerCost(
      ref,
      summary,
      markerDepthByScope.get(ref) ?? 2,
    ),
    0,
  );
  allocationStates.set(allocation, {
    contentChars: envelopeChars,
    markerChars,
    scopeByNode,
    markerDepthByScope,
  });
  return allocation;
}

function trySelect(
  candidate: Candidate,
  representation: SnapshotRepresentation,
  allocation: SnapshotAllocation,
  maxChars: number,
): void {
  const state = allocationStates.get(allocation);
  if (!state) return;
  const current = allocation.selected.get(candidate.node);
  if (current) {
    if (current === "identity" && representation === "full")
      tryUpgrade(candidate, allocation, state, maxChars);
    return;
  }
  const candidateCost = representationCostFor(
    candidate.node,
    representation,
    candidate.depth,
  );
  const ancestorCost = missingAncestorIdentityCost(candidate, allocation);
  if (state.contentChars + ancestorCost + candidateCost > maxChars) return;
  const missing: Candidate[] = [];
  for (
    let ancestor = candidate.parent;
    ancestor && !allocation.selected.has(ancestor.node);
    ancestor = ancestor.parent
  ) missing.push(ancestor);
  missing.reverse();
  const selections: Array<[Candidate, SnapshotRepresentation]> = [
    ...missing.map(
      (ancestor): [Candidate, SnapshotRepresentation] => [ancestor, "identity"],
    ),
    [candidate, representation],
  ];
  const cost = missing.reduce(
    (total, ancestor) => total + representationCostFor(
      ancestor.node,
      "identity",
      ancestor.depth,
    ),
    0,
  ) + candidateCost;
  if (
    state.contentChars + cost + projectedMarkerChars(selections, allocation, state) >
    maxChars
  ) return;
  state.contentChars += cost;
  for (const ancestor of missing)
    select(ancestor.node, "identity", allocation, state);
  select(candidate.node, representation, allocation, state);
}

function missingAncestorIdentityCost(
  candidate: Candidate,
  allocation: SnapshotAllocation,
): number {
  if (
    candidate.missingFrontier !== undefined &&
    (
      candidate.missingFrontier === null ||
      !allocation.selected.has(candidate.missingFrontier.node)
    )
  )
    return candidate.missingIdentityCost;
  const parent = candidate.parent;
  if (!parent || allocation.selected.has(parent.node)) {
    candidate.missingFrontier = null;
    candidate.missingIdentityCost = 0;
    return 0;
  }
  const cost = representationCostFor(parent.node, "identity", parent.depth) +
    missingAncestorIdentityCost(parent, allocation);
  candidate.missingFrontier = parent.missingFrontier ?? parent;
  candidate.missingIdentityCost = cost;
  return cost;
}

function tryUpgrade(
  candidate: Candidate,
  allocation: SnapshotAllocation,
  state: AllocationState,
  maxChars: number,
): void {
  const depth = candidate.depth;
  const cost = representationCostFor(candidate.node, "full", depth) -
    representationCostFor(candidate.node, "identity", depth);
  if (
    state.contentChars + cost + projectedMarkerChars(
      [[candidate, "full"]],
      allocation,
      state,
      true,
    ) > maxChars
  ) return;
  state.contentChars += cost;
  allocation.selected.set(candidate.node, "full");
  subtractOmitted(
    candidate.node,
    {
      ...emptySummary(),
      textChars: directTextChars(candidate.node.children) -
        representedTextChars(candidate.node, "identity"),
    },
    allocation,
    state,
  );
}

function select(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
  allocation: SnapshotAllocation,
  state: AllocationState,
): void {
  allocation.selected.set(node, representation);
  subtractOmitted(node, representationSummaryFor(node, representation), allocation, state);
}

function subtractOmitted(
  node: RenderedSnapshotNode,
  represented: SnapshotSubtreeSummary,
  allocation: SnapshotAllocation,
  state: AllocationState,
): void {
  const scope = state.scopeByNode.get(node);
  const omitted = scope ? allocation.omittedByScope.get(scope) : undefined;
  if (!scope || !omitted) return;
  const oldCost = markerCostForScope(scope, omitted, state);
  subtractSummary(omitted, represented);
  state.markerChars += markerCostForScope(scope, omitted, state) - oldCost;
}

function trySelectComplete(
  candidates: Candidate[],
  allocation: SnapshotAllocation,
  maxChars: number,
): boolean {
  const state = allocationStates.get(allocation);
  if (!state) return false;
  const projected = cloneSummaries(allocation.omittedByScope);
  let contentChars = state.contentChars;
  for (const candidate of candidates) {
    const representation = preferredRepresentation(candidate.node);
    contentChars += representationCostFor(candidate.node, representation, candidate.depth);
    if (contentChars > maxChars) return false;
    const scope = state.scopeByNode.get(candidate.node);
    const summary = scope ? projected.get(scope) : undefined;
    if (summary) subtractSummary(summary, representationSummaryFor(candidate.node, representation));
  }
  const markerChars = [...projected].reduce(
    (total, [scope, summary]) => total + markerCostForScope(scope, summary, state),
    0,
  );
  if (contentChars + markerChars > maxChars) return false;
  for (const candidate of candidates)
    select(
      candidate.node,
      preferredRepresentation(candidate.node),
      allocation,
      state,
    );
  state.contentChars = contentChars;
  return true;
}

function preferredRepresentation(node: RenderedSnapshotNode): SnapshotRepresentation {
  if (CRITICAL_IDENTITY_ROLES.has(node.role)) return "full";
  let childChanges = 0;
  for (const child of node.children)
    if (child.kind === "node") childChanges += child.summary.changed;
  return node.summary.changed > childChanges || node.priority > 2 ? "full" : "identity";
}

function projectedMarkerChars(
  selections: Array<[Candidate, SnapshotRepresentation]>,
  allocation: SnapshotAllocation,
  state: AllocationState,
  upgrade = false,
): number {
  const projected = new Map<string, SnapshotSubtreeSummary>();
  for (const [candidate, representation] of selections) {
    const scope = state.scopeByNode.get(candidate.node);
    const current = scope ? allocation.omittedByScope.get(scope) : undefined;
    if (!scope || !current) continue;
    const summary = projected.get(scope) ?? { ...current };
    const represented = upgrade
      ? {
          ...emptySummary(),
          textChars: directTextChars(candidate.node.children) -
            representedTextChars(candidate.node, "identity"),
        }
      : representationSummaryFor(candidate.node, representation);
    subtractSummary(summary, represented);
    projected.set(scope, summary);
  }
  let markerChars = state.markerChars;
  for (const [scope, summary] of projected) {
    const current = allocation.omittedByScope.get(scope)!;
    markerChars += markerCostForScope(scope, summary, state) -
      markerCostForScope(scope, current, state);
  }
  return markerChars;
}

function ownSummary(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
): SnapshotSubtreeSummary {
  const childSummary = emptySummary();
  for (const child of node.children)
    if (child.kind === "node") addToSummary(childSummary, child.summary);
  return {
    nodes: 1,
    actions: Math.max(0, node.summary.actions - childSummary.actions),
    records: node.record ? 1 : 0,
    textChars: representedTextChars(node, representation),
    changed: Math.max(0, node.summary.changed - childSummary.changed),
    critical: node.priority === 0 ? 1 : 0,
  };
}

function representationSummaryFor(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
): SnapshotSubtreeSummary {
  return representationSummaries.get(node)?.[representation] ?? ownSummary(node, representation);
}

function representedTextChars(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
): number {
  const direct = directTextChars(node.children);
  if (representation === "full")
    return direct + (snapshotCriticalSupplementalText(node)?.length ?? 0);
  const label = identityLabel(node);
  return label ? Math.min(direct, label.length) : 0;
}

export function snapshotRepresentationCost(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
  depth: number,
): number {
  const attrs = representation === "identity"
    ? identityAttrs(node)
    : renderAttrs(node.attrs);
  const prefix = "\t".repeat(depth);
  const label = representation === "identity" ? identityLabel(node) : snapshotCriticalSupplementalText(node);
  if (representation === "identity" && label && !node.record)
    return `${prefix}<${node.role}${attrs}>${escapeText(label)}</${node.role}>\n`.length;
  let cost = `${prefix}<${node.role}${attrs}>\n${prefix}</${node.role}>\n`.length;
  if (label) cost += `${prefix}\t${escapeText(label)}\n`.length;
  if (representation === "full")
    for (const child of node.children)
      if (child.kind === "text") cost += `${prefix}\t${escapeText(child.text)}\n`.length;
  return cost;
}

function representationCostFor(
  node: RenderedSnapshotNode,
  representation: SnapshotRepresentation,
  depth: number,
): number {
  return representationCosts.get(node)?.[representation] ??
    snapshotRepresentationCost(node, representation, depth);
}

export function snapshotIdentityAttrs(node: RenderedSnapshotNode): Array<[string, string]> {
  return node.attrs.filter(([name, value]) => STATE_ATTRS.has(name) && value !== "");
}

export function snapshotIdentityLabel(node: RenderedSnapshotNode): string | null {
  return identityLabel(node);
}

export function snapshotCriticalSupplementalValues(node: RenderedSnapshotNode): string[] {
  if (!CRITICAL_IDENTITY_ROLES.has(node.role)) return [];
  const values: string[] = [];
  const visit = (current: RenderedSnapshotNode): void => {
    for (const child of current.children)
      if (child.kind === "text") values.push(child.text);
      else visit(child);
  };
  for (const child of node.children)
    if (child.kind === "node") visit(child);
  return values;
}

export function snapshotCriticalSupplementalText(node: RenderedSnapshotNode): string | null {
  const values = snapshotCriticalSupplementalValues(node);
  return values.length ? values.join(" ") : null;
}

function identityAttrs(node: RenderedSnapshotNode): string {
  return renderAttrs(snapshotIdentityAttrs(node));
}

function renderAttrs(attrs: Array<[string, string]>): string {
  return attrs
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

function identityLabel(node: RenderedSnapshotNode): string | null {
  return node.record || CRITICAL_IDENTITY_ROLES.has(node.role)
    ? node.recordIdentity.name ?? node.recordIdentity.action
    : ownActions(node) > 0 ? node.recordIdentity.action : null;
}

function ownActions(node: RenderedSnapshotNode): number {
  let childActions = 0;
  for (const child of node.children)
    if (child.kind === "node") childActions += child.summary.actions;
  return Math.max(0, node.summary.actions - childActions);
}

function firstScopeRef(node: RenderedSnapshotNode): string | null {
  if (node.scopeRef) return node.scopeRef;
  for (const child of node.children)
    if (child.kind === "node") {
      const ref = firstScopeRef(child);
      if (ref) return ref;
    }
  return null;
}

function markerCost(
  ref: string,
  summary: SnapshotSubtreeSummary,
  depth: number,
): number {
  if (!hasOmittedSummary(summary)) return 0;
  return depth + "[more ref=".length + ref.length + "]\n".length +
    markerFieldChars("nodes".length, summary.nodes) +
    markerFieldChars("actions".length, summary.actions) +
    markerFieldChars("records".length, summary.records) +
    markerFieldChars("textChars".length, summary.textChars) +
    markerFieldChars("changed".length, summary.changed) +
    markerFieldChars("criticalOmitted".length, summary.critical);
}

function markerFieldChars(nameChars: number, value: number): number {
  return value > 0 ? nameChars + 3 + Math.floor(Math.log10(value)) : 0;
}

function markerCostForScope(
  scope: string,
  summary: SnapshotSubtreeSummary,
  state: AllocationState,
): number {
  return markerCost(
    scope,
    summary,
    state.markerDepthByScope.get(scope) ?? 2,
  );
}

export function renderSnapshotMarker(
  ref: string,
  summary: SnapshotSubtreeSummary,
): string {
  const fields: Array<[string, number]> = [
    ["nodes", summary.nodes],
    ["actions", summary.actions],
    ["records", summary.records],
    ["textChars", summary.textChars],
    ["changed", summary.changed],
    ["criticalOmitted", summary.critical],
  ];
  return `[more ref=${ref}${fields
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ` ${name}=${value}`)
    .join("")}]`;
}

function addSummary(
  summaries: Map<string, SnapshotSubtreeSummary>,
  ref: string,
  summary: SnapshotSubtreeSummary,
): void {
  const current = summaries.get(ref) ?? emptySummary();
  addToSummary(current, summary);
  summaries.set(ref, current);
}

const summaryKeys = [
  "nodes",
  "actions",
  "records",
  "textChars",
  "changed",
  "critical",
] as const;

function emptySummary(): SnapshotSubtreeSummary {
  return { nodes: 0, actions: 0, records: 0, textChars: 0, changed: 0, critical: 0 };
}

function addToSummary(
  target: SnapshotSubtreeSummary,
  source: SnapshotSubtreeSummary,
): void {
  for (const key of summaryKeys) target[key] += source[key];
}

function subtractSummary(
  target: SnapshotSubtreeSummary,
  represented: SnapshotSubtreeSummary,
): void {
  for (const key of summaryKeys)
    target[key] = Math.max(0, target[key] - represented[key]);
}

function cloneSummaries(
  summaries: Map<string, SnapshotSubtreeSummary>,
): Map<string, SnapshotSubtreeSummary> {
  return new Map([...summaries].map(([scope, summary]) => [scope, { ...summary }]));
}

function hasOmittedSummary(summary: SnapshotSubtreeSummary): boolean {
  return summaryKeys.some((key) => summary[key] > 0);
}

function totalSummary(
  summaries: Map<string, SnapshotSubtreeSummary>,
  key: keyof SnapshotSubtreeSummary,
): number {
  let total = 0;
  for (const summary of summaries.values()) total += summary[key];
  return total;
}

function totalOmitted(
  allocation: SnapshotAllocation,
  key: keyof SnapshotSubtreeSummary,
): number {
  return totalSummary(allocation.omittedByScope, key);
}

function directTextChars(children: RenderedSnapshotChild[]): number {
  let total = 0;
  for (const child of children) if (child.kind === "text") total += child.text.length;
  return total;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
