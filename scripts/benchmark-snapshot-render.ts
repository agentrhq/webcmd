import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_ACT_SNAPSHOT_CHARS,
  DEFAULT_TREE_SNAPSHOT_CHARS,
  allocateSnapshot,
  captureSnapshot,
  diffSnapshots,
  renderSnapshotDiff,
  renderSnapshotFrames,
  renderSnapshotResult,
} from "../src/browser/snapshot/index.js";
import type { AiSnapshot, AiSnapshotFrame, AiSnapshotNode } from "../src/browser/snapshot/types.js";
import type { Page } from "playwright-core";

const CANDIDATES = [4_096, 6_144, 8_192, 12_288, 16_384, 24_576, 32_768] as const;
const BASELINE_ACT_TOKENS = {
  median: 3_072,
  p95: 3_072,
  corpus: "snapshot-calibration-v1",
  source: "frozen 2026-08-06 isolated baseline measurement",
} as const;
const WARM_ITERATIONS = 200;
const MEASURED_ITERATIONS = 1_000;
const ACTION_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "switch", "combobox",
  "listbox", "menuitem", "tab", "slider",
]);
const RECORD_ROLES = new Set(["listitem", "row", "treeitem", "article"]);
const RECORD_PARENT_ROLES = new Set(["list", "table", "grid", "tree", "feed"]);
const CRITICAL_ROLES = new Set(["alert", "alertdialog", "dialog", "status"]);

type Fixture = { id: string; snapshot: AiSnapshot };
type Distribution = { median: number; p95: number };
type CriticalIdentity = { ref: string; role: string; contentAndState: string[] };

function fixture(id: string, build: (node: NodeFactory) => AiSnapshotFrame[]): Fixture {
  let nextId = 0;
  const node: NodeFactory = (role, input = {}) => ({
    nodeId: `${id}-${++nextId}`,
    ignored: input.ignored ?? false,
    role,
    name: input.name ?? null,
    value: input.value ?? null,
    description: input.description ?? null,
    properties: input.properties ?? {},
    attributes: input.attributes ?? {},
    children: input.children ?? [],
    ref: input.ref ?? null,
    subtreeSize: input.subtreeSize ?? 1,
  });
  return {
    id,
    snapshot: { title: `Fixture ${id}`, url: `https://fixtures.test/${id}`, frames: build(node) },
  };
}

type NodeInput = Partial<Omit<AiSnapshotNode, "role" | "nodeId">>;
type NodeFactory = (role: string, input?: NodeInput) => AiSnapshotNode;

function frame(id: string, roots: AiSnapshotNode[], index = 0, parentId: string | null = null): AiSnapshotFrame {
  return {
    status: "ok",
    scope: "document",
    id,
    index,
    url: `https://fixtures.test/${id}`,
    name: index ? `Frame ${index}` : null,
    parentId,
    roots,
  };
}

function text(node: NodeFactory, value: string): AiSnapshotNode {
  return node("StaticText", { name: value });
}

const corpus: Fixture[] = [
  fixture("deep-navigation-v1", (node) => {
    let nested: AiSnapshotNode | null = null;
    for (let section = 7; section >= 0; section -= 1)
      nested = node("navigation", {
        ref: `nav-${section}`,
        children: [
          node("list", {
            ref: `nav-list-${section}`,
            children: Array.from({ length: 18 }, (_, item) => node("listitem", {
              name: `Navigation section ${section + 1} item ${item + 1}`,
              ref: `nr-${section}-${item}`,
              children: [node("link", {
                name: `Open destination ${section + 1}-${item + 1}`,
                ref: `na-${section}-${item}`,
                attributes: { href: `/destination/${section + 1}/${item + 1}` },
              })],
            })),
          }),
          ...(nested ? [nested] : []),
        ],
      });
    return [frame("deep-navigation", [nested!])];
  }),
  fixture("records-300-v1", (node) => [frame("records-300", [node("list", {
    ref: "records-root",
    children: Array.from({ length: 300 }, (_, index) => node("listitem", {
      name: `Result ${String(index + 1).padStart(3, "0")}`,
      ref: `rr${index + 1}`,
      children: [
        text(node, `Deterministic supporting detail ${index + 1} ${"x".repeat(36)}`),
        node("button", { name: `Open ${index + 1}`, ref: `ra${index + 1}` }),
      ],
    })),
  })])]),
  fixture("products-120-v1", (node) => [frame("products-120", [node("grid", {
    ref: "products-root",
    children: Array.from({ length: 120 }, (_, index) => node("row", {
      name: `Product ${String(index + 1).padStart(3, "0")}`,
      ref: `product-${index + 1}`,
      children: [
        text(node, `Product detail ${index + 1} ${"y".repeat(48)}`),
        node("button", { name: `View ${index + 1}`, ref: `product-view-${index + 1}` }),
        node("button", { name: `Add ${index + 1}`, ref: `product-add-${index + 1}` }),
      ],
    })),
  })])]),
  fixture("form-state-v1", (node) => [frame("form-state", [node("form", {
    ref: "form-root",
    children: Array.from({ length: 180 }, (_, index) => node("textbox", {
      name: `Field ${String(index + 1).padStart(3, "0")}`,
      ref: `field-${index + 1}`,
      value: `value-${index + 1}`,
      properties: index === 179 ? { focused: true, invalid: true, required: true } : { required: true },
    })),
  })])]),
  fixture("alerts-v1", (node) => [frame("alerts", [node("main", {
    ref: "alerts-root",
    children: [
      ...Array.from({ length: 80 }, (_, index) => node(index % 2 ? "status" : "alert", {
        name: `Critical notice ${index + 1}`,
        ref: `critical-${index + 1}`,
        children: [text(node, `Critical notice detail ${index + 1}`)],
      })),
      ...Array.from({ length: 180 }, (_, index) => node("button", {
        name: `Alert action ${index + 1}`,
        ref: `alert-action-${index + 1}`,
        properties: index === 179 ? { focused: true } : {},
      })),
    ],
  })])]),
  fixture("nested-critical-v1", (node) => [frame("nested-critical", [node("main", {
    ref: "nested-critical-root",
    children: [
      node("alert", {
        ref: "payment-alert",
        children: [
          text(node, "ERROR"),
          node("list", {
            ref: "payment-alert-list",
            children: [
              node("listitem", {
                ref: "payment-alert-item",
                children: [text(node, "PAYMENT FAILED")],
              }),
            ],
          }),
        ],
      }),
      ...Array.from({ length: 20 }, (_, index) => node("button", {
        name: `Payment action ${index + 1}`,
        ref: `payment-action-${index + 1}`,
      })),
    ],
  })])]),
  fixture("iframes-v1", (node) => Array.from({ length: 4 }, (_, frameIndex) => frame(
    `iframe-${frameIndex}`,
    [node("main", {
      ref: `iframe-root-${frameIndex}`,
      children: Array.from({ length: 80 }, (_, index) => node("button", {
        name: `Frame ${frameIndex + 1} action ${index + 1}`,
        ref: `iframe-action-${frameIndex}-${index}`,
      })),
    })],
    frameIndex,
    frameIndex ? "iframe-0" : null,
  ))),
  fixture("article-prose-v1", (node) => [frame("article-prose", [node("article", {
    name: "Deterministic benchmark article",
    ref: "article-root",
    children: Array.from({ length: 140 }, (_, index) => node("section", {
      name: `Section ${index + 1}`,
      ref: `article-s${index + 1}`,
      children: [
        node("paragraph", { children: [text(node, `Paragraph ${index + 1} ${"prose ".repeat(24)}`)] }),
        node("link", {
          name: `Article reference ${index + 1}`,
          ref: `article-a${index + 1}`,
          attributes: { href: `/article/reference/${index + 1}` },
        }),
      ],
    })),
  })])]),
];

const nodes10000 = fixture("nodes-10000-v1", (node) => [frame("nodes-10000", [node("main", {
  ref: "nodes-root",
  children: [
    node("list", {
      ref: "synthetic-list",
      children: Array.from({ length: 999 }, (_, index) => node("listitem", {
        name: `Synthetic record ${index + 1}`,
        ref: `synthetic-record-${index + 1}`,
        children: [
          ...Array.from({ length: 8 }, (_, part) => text(node, `Detail ${index + 1}-${part + 1}`)),
          node("button", { name: `Open ${index + 1}`, ref: `synthetic-action-${index + 1}` }),
        ],
      })),
    }),
    ...Array.from({ length: 8 }, (_, index) => text(node, `Terminal ${index + 1}`)),
  ],
})])]);

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function distribution(values: number[], digits = 3): Distribution {
  const round = (value: number): number => Number(value.toFixed(digits));
  return { median: round(quantile(values, 0.5)), p95: round(quantile(values, 0.95)) };
}

function estimatedTokens(characters: number): number {
  return Math.ceil(characters / 4);
}

function timed(operation: () => unknown): Distribution {
  for (let index = 0; index < WARM_ITERATIONS; index += 1) operation();
  const samples: number[] = [];
  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  return distribution(samples);
}

function allNodes(snapshot: AiSnapshot): Array<{ node: AiSnapshotNode; parentRole: string | null }> {
  const result: Array<{ node: AiSnapshotNode; parentRole: string | null }> = [];
  const visit = (node: AiSnapshotNode, parentRole: string | null): void => {
    result.push({ node, parentRole });
    for (const child of node.children) visit(child, node.role);
  };
  for (const currentFrame of snapshot.frames)
    if (currentFrame.status === "ok")
      for (const root of currentFrame.roots) visit(root, null);
  return result;
}

function descendantStaticText(node: AiSnapshotNode): string[] {
  const values: string[] = [];
  const visit = (current: AiSnapshotNode): void => {
    if (current.role === "StaticText" && current.name) values.push(current.name);
    for (const child of current.children) visit(child);
  };
  for (const child of node.children) visit(child);
  return values;
}

function identities(fixtureValue: Fixture): {
  actions: string[];
  records: string[];
  critical: CriticalIdentity[];
} {
  const actions: string[] = [];
  const records: string[] = [];
  const critical: CriticalIdentity[] = [];
  for (const { node, parentRole } of allNodes(fixtureValue.snapshot)) {
    if (!node.ref) continue;
    if (ACTION_ROLES.has(node.role)) actions.push(node.ref);
    if (RECORD_ROLES.has(node.role) && parentRole && RECORD_PARENT_ROLES.has(parentRole)) records.push(node.ref);
    if (
      node.properties.focused === true || node.properties.invalid === true ||
      node.properties.invalid === "true" || CRITICAL_ROLES.has(node.role)
    ) {
      const contentAndState = [node.name, node.description]
        .filter((value): value is string => Boolean(value));
      contentAndState.push(...descendantStaticText(node));
      for (const property of ["focused", "invalid", "checked", "selected", "expanded", "disabled", "pressed"])
        if (node.properties[property] !== undefined)
          contentAndState.push(`${property}="${String(node.properties[property])}"`);
      critical.push({ ref: node.ref, role: node.role, contentAndState });
    }
  }
  return { actions, records, critical };
}

function recalled(output: string, refs: string[]): number {
  if (refs.length === 0) return 1;
  return refs.filter((ref) => output.includes(`ref="${ref}"`)).length / refs.length;
}

function criticalRecalled(output: string, identities: CriticalIdentity[]): number {
  if (identities.length === 0) return 1;
  return identities.filter(({ ref, role, contentAndState }) => {
    const refIndex = output.indexOf(`ref="${ref}"`);
    if (refIndex === -1) return false;
    const blockStart = output.lastIndexOf("<", refIndex);
    const closingTag = `</${role}>`;
    const closingIndex = output.indexOf(closingTag, refIndex);
    const lineEnd = output.indexOf("\n", refIndex);
    const blockEnd = closingIndex === -1
      ? (lineEnd === -1 ? output.length : lineEnd)
      : closingIndex + closingTag.length;
    const block = output.slice(blockStart, blockEnd);
    return contentAndState.every((value) => block.includes(value));
  }).length / identities.length;
}

function corpusStats(mode: "act" | "tree", maxChars: number): {
  characters: Distribution;
  tokens: Distribution;
  outputOverruns: number;
  outputs: string[];
} {
  const rendered = corpus.map(({ snapshot }) => renderSnapshotResult(snapshot, { mode, maxChars }));
  const characters = rendered.map(({ value }) => value.length);
  return {
    characters: distribution(characters, 0),
    tokens: distribution(characters.map(estimatedTokens), 0),
    outputOverruns: rendered.filter(({ value }) => value.length > maxChars).length,
    outputs: rendered.map(({ value }) => value),
  };
}

const candidates = CANDIDATES.map((maxChars) => ({ maxChars, ...corpusStats("act", maxChars) }));
const recommendedActChars = candidates.filter(({ tokens }) =>
  tokens.median <= BASELINE_ACT_TOKENS.median && tokens.p95 <= BASELINE_ACT_TOKENS.p95
).at(-1)?.maxChars ?? 0;

const expected = corpus.map(identities);
const treeCandidates = CANDIDATES.filter((value) => value > recommendedActChars).map((maxChars) => {
  const stats = corpusStats("tree", maxChars);
  const fixtureRecall = expected.map((ids, index) => ({
    fixture: corpus[index]!.id,
    treeActionRecall: recalled(stats.outputs[index]!, ids.actions),
    treeRecordRecall: recalled(stats.outputs[index]!, ids.records),
  }));
  return {
    maxChars,
    treeActionRecall: fixtureRecall.reduce((sum, value) => sum + value.treeActionRecall, 0) / corpus.length,
    treeRecordRecall: fixtureRecall.reduce((sum, value) => sum + value.treeRecordRecall, 0) / corpus.length,
    preservesAll: fixtureRecall.every(({ treeActionRecall, treeRecordRecall }) =>
      treeActionRecall === 1 && treeRecordRecall === 1),
  };
});
const recommendedTreeChars = treeCandidates.find(({ preservesAll }) => preservesAll)?.maxChars ?? 0;

const act = corpusStats("act", recommendedActChars);
const tree = corpusStats("tree", recommendedTreeChars);
const totalRefRecall = (outputs: string[], key: "actions" | "records"): number => {
  const total = expected.reduce((sum, value) => sum + value[key].length, 0);
  if (total === 0) return 1;
  return expected.reduce((sum, value, index) =>
    sum + value[key].filter((ref) => outputs[index]!.includes(`ref="${ref}"`)).length, 0) / total;
};
const actActionRecall = totalRefRecall(act.outputs, "actions");
const treeRecordRecall = totalRefRecall(tree.outputs, "records");
const criticalTotal = expected.reduce((sum, value) => sum + value.critical.length, 0);
const actCriticalRecall = criticalTotal === 0 ? 1 : expected.reduce((sum, value, index) =>
  sum + criticalRecalled(act.outputs[index]!, value.critical) * value.critical.length, 0) / criticalTotal;
const criticalOmitted = corpus.reduce((sum, { snapshot }) =>
  sum + renderSnapshotResult(snapshot, { mode: "act", maxChars: recommendedActChars }).criticalOmitted, 0);
const nestedCriticalRegression = (() => {
  const fixtureValue = corpus.find(({ id }) => id === "nested-critical-v1")!;
  const result = renderSnapshotResult(fixtureValue.snapshot, { mode: "act", maxChars: 240 });
  return {
    contentRecalled: result.value.includes("PAYMENT FAILED"),
    criticalOmitted: result.criticalOmitted,
    characters: result.value.length,
  };
})();

const diffTokens: number[] = [];
const correspondingFullTokens: number[] = [];
for (const { snapshot } of corpus) {
  const before = structuredClone(snapshot);
  const after = structuredClone(snapshot);
  const action = allNodes(after).map(({ node }) => node).findLast((node) => ACTION_ROLES.has(node.role));
  if (!action) continue;
  action.name = `${action.name ?? action.role} changed`;
  diffTokens.push(estimatedTokens(renderSnapshotDiff(
    diffSnapshots(before, after, "act"),
    recommendedActChars,
  ).value.length));
  correspondingFullTokens.push(estimatedTokens(renderSnapshotResult(
    after,
    { mode: "act", maxChars: recommendedActChars },
  ).value.length));
}
const diffMedianTokens = quantile(diffTokens, 0.5);
const correspondingFullMedianTokens = quantile(correspondingFullTokens, 0.5);
const diffToFullMedianRatio = Number((diffMedianTokens / correspondingFullMedianTokens).toFixed(4));

const renderTiming = timed(() => renderSnapshotResult(nodes10000.snapshot, {
  mode: "act",
  maxChars: recommendedActChars,
}));
const renderedNodes10000 = renderSnapshotFrames(nodes10000.snapshot, "act");
const priorityTiming = timed(() => allocateSnapshot(renderedNodes10000, recommendedActChars, 0));
const outputOverruns = candidates.reduce((sum, candidate) => sum + candidate.outputOverruns, 0) +
  act.outputOverruns + tree.outputOverruns;
const localCloudParityHash = createHash("sha256").update([...act.outputs, ...tree.outputs].join("\0")).digest("hex");
let countedBrowserCalls = 0;
const countedPage = {
  context: () => ({
    newCDPSession: async () => ({
      send: async (method: string): Promise<unknown> => {
        countedBrowserCalls += 1;
        if (method === "Page.getFrameTree")
          return { frameTree: { frame: { id: "counted-frame", url: "https://fixtures.test/counted" } } };
        if (method === "Accessibility.getFullAXTree")
          return { nodes: [{ nodeId: "counted-root", role: { value: "RootWebArea" } }] };
        return {};
      },
      detach: async () => undefined,
    }),
  }),
  title: async () => "Counted capture",
  url: () => "https://fixtures.test/counted",
};
const capturedForAllocation = await captureSnapshot(countedPage as unknown as Page);
const captureBrowserCalls = countedBrowserCalls;
const callsBeforeAllocation = countedBrowserCalls;
renderSnapshotResult(capturedForAllocation, { mode: "act", maxChars: recommendedActChars });
const additionalBrowserCalls = countedBrowserCalls - callsBeforeAllocation;

const metrics = {
  corpus: corpus.map(({ id }) => id),
  iterations: { warm: WARM_ITERATIONS, measured: MEASURED_ITERATIONS },
  baselineActTokens: BASELINE_ACT_TOKENS,
  candidates: candidates.map(({ maxChars, characters, tokens }) => ({ maxChars, characters, tokens })),
  treeCandidates,
  recommendedActChars,
  recommendedTreeChars,
  defaults: { actChars: DEFAULT_ACT_SNAPSHOT_CHARS, treeChars: DEFAULT_TREE_SNAPSHOT_CHARS },
  act: { characters: act.characters, estimatedTokens: act.tokens },
  tree: { characters: tree.characters, estimatedTokens: tree.tokens },
  nodes10000: {
    fixture: nodes10000.id,
    nodes: allNodes(nodes10000.snapshot).length,
    renderMedianMs: renderTiming.median,
    renderP95Ms: renderTiming.p95,
    priorityMedianMs: priorityTiming.median,
    priorityP95Ms: priorityTiming.p95,
  },
  actActionRecall: Number(actActionRecall.toFixed(6)),
  treeRecordRecall: Number(treeRecordRecall.toFixed(6)),
  actCriticalRecall: Number(actCriticalRecall.toFixed(6)),
  criticalOmitted,
  nestedCriticalRegression,
  diffMedianTokens,
  correspondingFullMedianTokens,
  diffToFullMedianRatio,
  outputOverruns,
  localCloudParityHash,
  captureBrowserCalls,
  additionalBrowserCalls,
  browserCallAssertion: "one counted capture followed by render-only allocation",
  parityEvidence: "shared package output target; hosted infrastructure timing pending",
  gates: {
    tokens: recommendedActChars === DEFAULT_ACT_SNAPSHOT_CHARS &&
      recommendedTreeChars === DEFAULT_TREE_SNAPSHOT_CHARS &&
      act.tokens.median <= BASELINE_ACT_TOKENS.median && act.tokens.p95 <= BASELINE_ACT_TOKENS.p95,
    recall: treeRecordRecall === 1 && (actCriticalRecall === 1 || criticalOmitted > 0),
    latency: renderTiming.p95 < 30 && priorityTiming.p95 < 5,
  },
};

const fail = (gate: string): never => {
  throw new Error(`snapshot benchmark gate failed: ${gate}`);
};

console.log(JSON.stringify(metrics, null, 2));

if (metrics.nodes10000.renderP95Ms >= 30) fail("10k render P95");
if (metrics.nodes10000.priorityP95Ms >= 5) fail("10k priority P95");
if (metrics.actCriticalRecall < 1 && metrics.criticalOmitted === 0) fail("silent critical loss");
if (!metrics.nestedCriticalRegression.contentRecalled &&
  metrics.nestedCriticalRegression.criticalOmitted === 0) fail("nested critical loss");
if (metrics.diffToFullMedianRatio > 0.5) fail("diff/full token ratio");
if (metrics.outputOverruns !== 0) fail("hard ceiling");
if (metrics.additionalBrowserCalls !== 0) fail("additional browser calls");
if (metrics.captureBrowserCalls === 0) fail("capture call counter");
if (!metrics.recommendedActChars || !metrics.recommendedTreeChars) fail("budget recommendation");
if (!Object.values(metrics.gates).every(Boolean)) fail("acceptance gates");
