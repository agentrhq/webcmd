import { describe, expect, it } from "vitest";
import {
  boundSnapshotText,
  renderSnapshot,
  renderSnapshotFrames,
  renderSnapshotResult,
} from "./render.js";
import type { AiSnapshot, AiSnapshotNode } from "./types.js";

function node(
  input: Partial<AiSnapshotNode> & { role: string },
): AiSnapshotNode {
  return {
    nodeId: input.nodeId ?? input.role,
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

function snap(roots: AiSnapshotNode[]): AiSnapshot {
  return {
    title: "Snapshot Demo",
    url: "https://example.test/path",
    frames: [
      {
        status: "ok",
        scope: "document",
        id: "main",
        index: 0,
        url: "https://example.test/path",
        name: null,
        parentId: null,
        roots,
      },
    ],
  };
}

function wideSnapshot({ lateFocused }: { lateFocused: boolean }): AiSnapshot {
  return snap([
    node({
      role: "main",
      ref: "l1",
      children: [
        ...Array.from({ length: 12 }, (_, index) =>
          node({
            role: "button",
            name: `Early action ${index + 1}`,
            ref: `l${index + 2}`,
          }),
        ),
        node({
          role: "button",
          name: "Late critical action",
          ref: "l20",
          properties: lateFocused ? { focused: true } : {},
        }),
      ],
    }),
  ]);
}

function recordSnapshot(count: number): AiSnapshot {
  const detail = (index: number): AiSnapshotNode =>
    node({
      role: "paragraph",
      children: Array.from({ length: 10 }, (_, part) =>
        node({
          role: "StaticText",
          name: `${part ? "continued" : "verbose detail"} for result ${index} ${"x".repeat(100)}`,
        }),
      ),
    });
  return snap([
    node({
      role: "list",
      ref: "l12",
      children: Array.from({ length: count }, (_, offset) => {
        const index = offset + 1;
        return node({
          role: "listitem",
          name: `Result ${index}`,
          ref: `l${20 + index}`,
          children: [
            detail(index),
            node({ role: "button", name: `Open result ${index}`, ref: `l${40 + index}` }),
          ],
        });
      }),
    }),
  ]);
}

function criticalSnapshot(count: number): AiSnapshot {
  return {
    title: "",
    url: "",
    frames: [
      {
        status: "ok",
        scope: "document",
        id: "main",
        index: 0,
        url: "",
        name: null,
        parentId: null,
        roots: [
          node({
            role: "main",
            ref: "l1",
            children: Array.from({ length: count }, (_, index) =>
              node({
                role: "button",
                name: `Critical ${index + 1}`,
                ref: `l${index + 2}`,
                properties: { focused: true },
              }),
            ),
          }),
        ],
      },
    ],
  };
}

describe("renderSnapshot", () => {
  it('keeps a late focused control ahead of early low-signal siblings', () => {
    const result = renderSnapshotResult(wideSnapshot({ lateFocused: true }), { mode: 'act', maxChars: 700 });
    expect(result.value).toContain('Late critical action');
    expect(result.value).toMatch(/\[more ref=l\d+ nodes=\d+/);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(700);
  });

  it('represents every repeated record before adding record detail', () => {
    const result = renderSnapshotResult(recordSnapshot(8), { mode: 'tree', maxChars: 1400 });
    for (let index = 1; index <= 8; index += 1) expect(result.value).toContain(`Result ${index}`);
    expect(result.value).not.toContain('verbose detail for result 1');
  });

  it('reports critical omission instead of silently cutting it', () => {
    const result = renderSnapshotResult(criticalSnapshot(20), { mode: 'act', maxChars: 180 });
    expect(result.criticalOmitted).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/inspect.*ref/i);
    expect(result.value).toMatch(/criticalOmitted=\d+/);
  });

  it("renders nested critical text when a critical ancestor is selected", () => {
    const result = renderSnapshotResult(snap([
      node({ role: "main", ref: "l1", children: [
        node({ role: "alert", ref: "payment-alert", children: [
          node({ role: "list", ref: "payment-list", children: [
            node({ role: "listitem", ref: "payment-item", children: [
              node({ role: "StaticText", name: "PAYMENT FAILED" }),
            ] }),
          ] }),
        ] }),
        ...Array.from({ length: 20 }, (_, index) =>
          node({ role: "button", name: `Payment action ${index + 1}`, ref: `pay-${index + 1}` }),
        ),
      ] }),
    ]), { mode: "act", maxChars: 420 });

    expect(result.value).toContain('ref="payment-alert"');
    expect(result.value).toContain("PAYMENT FAILED");
    expect(result.criticalOmitted).toBe(0);
    expect(result.value.length).toBeLessThanOrEqual(420);
  });

  it("renders nested critical text alongside direct critical text", () => {
    const result = renderSnapshotResult(snap([
      node({ role: "main", ref: "l1", children: [
        node({ role: "alert", ref: "payment-alert", children: [
          node({ role: "StaticText", name: "ERROR" }),
          node({ role: "list", ref: "payment-list", children: [
            node({ role: "listitem", ref: "payment-item", children: [
              node({ role: "StaticText", name: "PAYMENT FAILED" }),
            ] }),
          ] }),
        ] }),
        ...Array.from({ length: 20 }, (_, index) =>
          node({ role: "button", name: `Payment action ${index + 1}`, ref: `pay-${index + 1}` }),
        ),
      ] }),
    ]), { mode: "act", maxChars: 420 });

    expect(result.value).toContain("ERROR");
    expect(result.value).toContain("PAYMENT FAILED");
    expect(result.criticalOmitted).toBe(0);
    expect(result.value.length).toBeLessThanOrEqual(420);
  });

  it("does not duplicate nested critical text when structural descendants render", () => {
    const result = renderSnapshotResult(snap([
      node({ role: "main", ref: "l1", children: [
        node({ role: "alert", ref: "payment-alert", children: [
          node({ role: "main", ref: "payment-main", children: [
            node({ role: "StaticText", name: "PAYMENT FAILED" }),
          ] }),
        ] }),
      ] }),
    ]), { mode: "act", maxChars: 12000 });

    expect(result.value.match(/PAYMENT FAILED/g)).toHaveLength(1);
    expect(result.criticalOmitted).toBe(0);
  });

  it("does not duplicate multi-value critical supplements rendered by descendants", () => {
    const snapshot = snap([
      node({ role: "main", ref: "l1", children: [
        node({ role: "alert", ref: "l2", children: [
          node({ role: "alert", ref: "l3", children: [
            node({ role: "list", ref: "l4", children: [
              node({ role: "listitem", ref: "l5", children: [
                node({ role: "StaticText", name: "PAYMENT" }),
              ] }),
              node({ role: "listitem", ref: "l6", children: [
                node({ role: "StaticText", name: "FAILED" }),
              ] }),
            ] }),
          ] }),
        ] }),
        ...Array.from({ length: 20 }, (_, index) =>
          node({ role: "button", name: `Action ${index + 1}`, ref: `l${index + 7}` }),
        ),
      ] }),
    ]);
    snapshot.title = "";
    snapshot.url = "";
    if (snapshot.frames[0]?.status === "ok") snapshot.frames[0].url = "";
    const result = renderSnapshotResult(snapshot, { mode: "act", maxChars: 371 });

    expect(result.value.match(/PAYMENT FAILED/g) ?? [], result.value).toHaveLength(1);
    expect(result.criticalOmitted).toBe(0);
    expect(result.value.length).toBeLessThanOrEqual(371);
  });

  it('uses the full scoped budget without a per-parent cap', () => {
    const result = renderSnapshotResult(recordSnapshot(10), { mode: 'tree', ref: 'l12', maxChars: 12000 });
    for (let index = 1; index <= 10; index += 1) expect(result.value).toContain(`Result ${index}`);
  });

  it("reclaims marker space when the complete snapshot fits", () => {
    const result = renderSnapshotResult(snap([
      node({ role: "main", ref: "l1", children: [
        node({ role: "button", name: "First", ref: "l2" }),
        node({ role: "button", name: "Second", ref: "l3" }),
      ] }),
    ]), { mode: "act", maxChars: 228 });

    expect(result.truncated).toBe(false);
    expect(result.value).toContain("First");
    expect(result.value).toContain("Second");
    expect(result.value).not.toContain("[more ref=");
  });

  it("places nested omissions at their nearest recoverable ref", () => {
    const result = renderSnapshotResult(snap([
      node({ role: "main", ref: "l1", children: [
        node({
          role: "list",
          ref: "l12",
          children: Array.from({ length: 10 }, (_, index) =>
            node({ role: "button", name: `Nested ${index + 1}` }),
          ),
        }),
      ] }),
    ]), { mode: "act", maxChars: 350 });

    expect(result.value).toMatch(/\[more ref=l12\b/);
  });

  it("bounds output when the page envelope exceeds the ceiling", () => {
    const result = renderSnapshotResult(wideSnapshot({ lateFocused: true }), {
      mode: "act",
      maxChars: 10,
    });

    expect(result.value.length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
  });

  it("bounds output when required markers exceed the remaining ceiling", () => {
    for (const maxChars of [129, 168, 207]) {
      const result = renderSnapshotResult(wideSnapshot({ lateFocused: true }), {
        mode: "act",
        maxChars,
      });
      expect(result.value.length).toBeLessThanOrEqual(maxChars);
      expect(result.truncated).toBe(true);
      expect(result.criticalOmitted).toBeGreaterThan(0);
    }
  });

  it("summarizes critical state, actions, records, and text during rendering", () => {
    const frames = renderSnapshotFrames(snap([node({
      role: "list", ref: "l10", children: [
        node({ role: "listitem", name: "Alpha", children: [
          node({ role: "button", name: "Open", ref: "l11", properties: { focused: true } }),
        ] }),
      ],
    })]), "tree");
    const list = frames[0]!.status === "ok" ? frames[0]!.roots[0]! : null;
    expect(list?.summary).toMatchObject({ actions: 1, records: 1, critical: 1 });
    expect(list?.scopeRef).toBe("l10");
  });

  it("marks repeated actionable frame roots as records with compact identities", () => {
    const frames = renderSnapshotFrames(snap([
      node({ role: "region", name: "Alpha", properties: { selected: true }, children: [node({ role: "button", name: "Edit Alpha" })] }),
      node({ role: "region", name: "Beta", properties: { selected: true }, children: [node({ role: "button", name: "Edit Beta" })] }),
      node({ role: "region", name: "Gamma", properties: { selected: true }, children: [node({ role: "button", name: "Edit Gamma" })] }),
    ]), "tree");
    const roots = frames[0]!.status === "ok" ? frames[0]!.roots : [];
    expect(roots.map((root) => root.record)).toEqual([true, true, true]);
    expect(roots[0]?.recordIdentity).toEqual({
      name: "Alpha",
      action: "Edit Alpha",
      states: [["selected", "true"]],
    });
  });

  it("renders compact action structure in act mode", () => {
    const text = renderSnapshot(
      snap([
        node({
          role: "RootWebArea",
          ref: "l1",
          children: [
            node({
              role: "main",
              ref: "l2",
              children: [
                node({
                  role: "heading",
                  name: "Welcome",
                  properties: { level: 1 },
                  ref: "l3",
                }),
                node({ role: "button", name: "Save", ref: "l4" }),
                node({
                  role: "textbox",
                  name: "Search",
                  ref: "l5",
                  properties: { value: "query" },
                  attributes: { placeholder: "Search docs" },
                }),
              ],
            }),
          ],
        }),
      ]),
      { mode: "act" },
    );

    expect(text).toContain(
      '<page title="Snapshot Demo" url="https://example.test/path">',
    );
    expect(text).toContain("# Welcome");
    expect(text).toContain('<button ref="l4">Save</button>');
    expect(text).toContain(
      '<textbox ref="l5" value="query" placeholder="Search docs">Search</textbox>',
    );
  });

  it("keeps paragraph text in tree mode but not act mode", () => {
    const page = snap([
      node({
        role: "RootWebArea",
        children: [
          node({
            role: "main",
            ref: "l1",
            children: [
              node({
                role: "paragraph",
                name: "Long useful paragraph for extraction.",
              }),
              node({ role: "button", name: "Continue", ref: "l2" }),
            ],
          }),
        ],
      }),
    ]);

    expect(renderSnapshot(page, { mode: "act" })).not.toContain(
      "Long useful paragraph",
    );
    expect(renderSnapshot(page, { mode: "tree" })).toContain(
      "Long useful paragraph",
    );
    expect(renderSnapshot(page, { mode: "tree" })).toContain(
      '<button ref="l2">Continue</button>',
    );
  });

  it("includes its truncation marker within the requested bound", () => {
    const bounded = boundSnapshotText("x".repeat(100), 40);
    expect(bounded.value.length).toBeLessThanOrEqual(40);
    expect(bounded.value).toMatch(/\n\.\.\.\[truncated, \d+ chars omitted\]$/);
    expect(bounded.truncated).toBe(true);
  });
});
