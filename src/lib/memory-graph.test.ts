import { describe, expect, it } from "vitest";

import {
  bodyRefs,
  buildGraph,
  createSimulation,
  labelOpacity,
  matchesQuery,
  neighbourLinks,
  neighbourSet,
  nodeRadius,
  settle,
  withinDepth,
  type GraphFilters,
  type GraphNote,
} from "./memory-graph";
import { cleanGraphSettings, DEFAULT_GRAPH_SETTINGS, forgetGraphSettingsSession, MEMORY_GRAPH_PREF_KEY, readGraphSettings, writeGraphSettings } from "./memory-graph-settings";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";

const FILTERS: GraphFilters = { ...DEFAULT_GRAPH_SETTINGS.filters };

function note(key: string, title: string, extra: Partial<GraphNote> = {}): GraphNote {
  return { key, title, tier: "bot:atlas", tierName: "Atlas", folderPath: "Atlas / Topics", tags: [], ...extra };
}

/** A ring of `n` notes with chords: a graph with some shape. */
function ring(n: number): GraphNote[] {
  return Array.from({ length: n }, (_, i) => note(`k${i}`, `Note ${i}`, {
    folderPath: i % 3 === 0 ? "Atlas / Logs" : "Atlas / Topics",
    body: `[[Note ${(i + 1) % n}]] [[Note ${(i * 7) % n}]]`,
  }));
}

describe("the graph model", () => {
  it("reads [[links]], embeds and image attachments from a body", () => {
    expect(bodyRefs("See [[Dining|the dining note]] and [[Travel#Trains]], ![[map.png]], ![x](files/plan%20a.pdf)")).toEqual({
      notes: ["dining", "travel"],
      attachments: ["map.png", "plan a.pdf"],
    });
  });

  it("joins notes by their links, and the folder hierarchy clusters notes without links", () => {
    const notes = [note("a", "Dining", { body: "[[Travel]] [[Nowhere]]" }), note("b", "Travel", { path: "memory/travel.md" }), note("c", "Run 1", { folderPath: "Atlas / Logs" })];
    const flat = buildGraph(notes, { ...FILTERS, folders: false, existingOnly: true });
    expect(flat.nodes.map((n) => n.id)).toEqual(["n:a", "n:b", "n:c"]);
    expect(flat.noteLinks).toBe(1);
    const tree = buildGraph(notes, FILTERS);
    const ids = tree.nodes.map((n) => n.id);
    expect(ids).toContain("g:nowhere");
    expect(ids).toContain("r:bot:atlas");
    expect(ids).toContain("f:bot:atlas:Atlas / Topics");
    expect(ids).toContain("f:bot:atlas:Atlas / Logs");
    const run = tree.index.get("n:c")!;
    expect(tree.nodes[tree.nodes[run]!.parent]!.id).toBe("f:bot:atlas:Atlas / Logs");
  });

  it("drops orphans, adds tags and attachments when asked", () => {
    const notes = [note("a", "A", { body: "[[B]] ![[x.png]]", tags: ["work"] }), note("b", "B"), note("c", "Alone")];
    const g = buildGraph(notes, { ...FILTERS, folders: false, orphans: false, tags: true, attachments: true });
    const ids = g.nodes.map((n) => n.id);
    expect(ids).not.toContain("n:c");
    expect(ids).toEqual(expect.arrayContaining(["n:a", "n:b", "t:work", "a:x.png"]));
    for (const link of g.links) expect(g.nodes[link.source] && g.nodes[link.target]).toBeTruthy();
  });

  it("matches Obsidian-like queries", () => {
    const n = { label: "Weekly briefing", folderPath: "notes / reading", tags: ["work", "area:planning"], kind: "note" as const, tierName: "My memory" };
    expect(matchesQuery(n, "tag:#work")).toBe(true);
    expect(matchesQuery(n, "tag:area")).toBe(true);
    expect(matchesQuery(n, "path:reading weekly")).toBe(true);
    expect(matchesQuery(n, "tier:memory")).toBe(true);
    expect(matchesQuery(n, "tag:home")).toBe(false);
  });
});

describe("the hover neighbourhood", () => {
  it("is the node, its neighbours and their links, nothing else", () => {
    const notes = [note("a", "A", { body: "[[B]] [[C]]" }), note("b", "B"), note("c", "C", { body: "[[D]]" }), note("d", "D")];
    const g = buildGraph(notes, { ...FILTERS, folders: false });
    const a = g.index.get("n:a")!;
    const near = neighbourSet(g, a);
    expect([...near].map((i) => g.nodes[i]!.id).sort()).toEqual(["n:a", "n:b", "n:c"]);
    const links = [...neighbourLinks(g, a)].map((k) => g.links[k]!);
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.source === a || link.target === a).toBe(true);
    expect(neighbourSet(g, -1).size).toBe(0);
    expect([...withinDepth(g, a, 2)].map((i) => g.nodes[i]!.id).sort()).toEqual(["n:a", "n:b", "n:c", "n:d"]);
  });
});

describe("the force simulation", () => {
  it("is deterministic with a seed", () => {
    const g = buildGraph(ring(60), FILTERS);
    const one = createSimulation(g.links, g.nodes.length, { seed: 3 });
    const two = createSimulation(g.links, g.nodes.length, { seed: 3 });
    for (let k = 0; k < 120; k++) { one.tick(); two.tick(); }
    expect(Array.from(one.x)).toEqual(Array.from(two.x));
    expect(Array.from(one.y)).toEqual(Array.from(two.y));
    const other = createSimulation(g.links, g.nodes.length, { seed: 4 });
    for (let k = 0; k < 120; k++) other.tick();
    expect(Array.from(other.x)).not.toEqual(Array.from(one.x));
  });

  it("settles, then stays still (no jitter)", () => {
    const g = buildGraph(ring(200), FILTERS);
    const sim = createSimulation(g.links, g.nodes.length, { seed: 1 });
    const ticks = settle(sim);
    expect(sim.settled()).toBe(true);
    expect(ticks).toBeLessThan(400);
    let speed = 0;
    for (let i = 0; i < sim.n; i++) speed = Math.max(speed, Math.hypot(sim.vx[i]!, sim.vy[i]!));
    expect(speed).toBeLessThan(0.5);
    for (const value of sim.x) expect(Number.isFinite(value)).toBe(true);
    // Linked notes end nearer each other than the average pair.
    const dist = (a: number, b: number) => Math.hypot(sim.x[a]! - sim.x[b]!, sim.y[a]! - sim.y[b]!);
    const linked = g.links.reduce((sum, l) => sum + dist(l.source, l.target), 0) / g.links.length;
    let any = 0;
    for (let i = 0; i < 200; i++) any += dist(i, (i * 37 + 11) % sim.n);
    expect(linked).toBeLessThan(any / 200);
  });

  it("follows a pinned node and rests again once released", () => {
    const g = buildGraph(ring(30), FILTERS);
    const sim = createSimulation(g.links, g.nodes.length, { seed: 2 });
    settle(sim);
    sim.pin(0, 500, 500);
    sim.alphaTarget = 0.3;
    sim.reheat(0.3);
    for (let k = 0; k < 30; k++) sim.tick();
    expect([sim.x[0], sim.y[0]]).toEqual([500, 500]);
    sim.release(0);
    sim.alphaTarget = 0;
    settle(sim);
    expect(sim.settled()).toBe(true);
  });

  it("keeps the places it is given", () => {
    const sim = createSimulation([], 2, { start: (i) => (i === 0 ? { x: 40, y: -10 } : null) });
    expect([sim.x[0], sim.y[0]]).toEqual([40, -10]);
  });
});

describe("the view", () => {
  it("fades the labels in with the zoom, the threshold moving where", () => {
    expect(labelOpacity(0.3)).toBe(0);
    expect(labelOpacity(2)).toBe(1);
    const mid = labelOpacity(0.75);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(labelOpacity(0.8, 1)).toBe(0);
    expect(labelOpacity(0.8, -1)).toBe(1);
    let last = -1;
    for (let s = 0.2; s < 3; s += 0.05) { const o = labelOpacity(s); expect(o).toBeGreaterThanOrEqual(last); last = o; }
  });

  it("grows a node gently with its links", () => {
    expect(nodeRadius(0, "note")).toBeLessThan(nodeRadius(9, "note"));
    expect(nodeRadius(400, "note")).toBeLessThan(nodeRadius(0, "note") * 5);
  });
});

describe("the settings", () => {
  it("clean what they read and are kept per person", () => {
    expect(cleanGraphSettings({ forces: { repel: 99 }, groups: [{ query: "x", color: "red" }] }).forces.repel).toBe(20);
    expect(cleanGraphSettings({ groups: [{ query: "x", color: "red" }] }).groups).toEqual([]);
    expect(USER_PREFERENCE_KEYS).toContain(MEMORY_GRAPH_PREF_KEY);
    const store = new Map<string, string>();
    const prior = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
    try {
      writeGraphSettings("Dana", { ...DEFAULT_GRAPH_SETTINGS, colorBy: "folder" });
      forgetGraphSettingsSession();
      expect(readGraphSettings("dana").colorBy).toBe("folder");
      expect(readGraphSettings("sam").colorBy).toBe("tier");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prior });
    }
  });
});
