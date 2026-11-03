import { describe, expect, it } from "vitest";

import type { MemoryManagerSource } from "./memory-manager";
import { buildMemoryPageGraph } from "./memory-map";
import {
  activeSeries,
  applyListView,
  backlinksTo,
  excerptFromBody,
  journalFacts,
  jsonSummary,
  matchesQuery,
  parseMemoryQuery,
  qualityStats,
  sortPageRows,
  tagStats,
  writeSeries,
  type PageRow,
} from "./memory-page";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 2, 12);
const bot: MemoryManagerSource = { id: "bot:a", kind: "bot", name: "Atlas", mayWrite: true, botId: "a" };
const bot2: MemoryManagerSource = { id: "bot:b", kind: "bot", name: "Nova", mayWrite: true, botId: "b" };
const px: MemoryManagerSource = { id: "perspicax", kind: "perspicax", name: "Perspicax", mayWrite: true, scope: "me" };

function row(key: string, title: string, extra: Partial<PageRow["row"]> = {}, source = px, tier = "mine", folderPath = "notes"): PageRow {
  return { key, source, tier, folderKey: `f/${folderPath}`, folderPath, row: { id: key, title, ...extra } };
}

describe("memory-page", () => {
  it("reads a JSON excerpt in words and a body's first plain line", () => {
    expect(jsonSummary('{"a":1,"b":2}')).toEqual({ array: false, count: 2, keys: ["a", "b"] });
    expect(jsonSummary("[1,2,3]")).toEqual({ array: true, count: 3, keys: [] });
    expect(jsonSummary('{"zone":"x","ttl":3')).toEqual({ array: false, count: null, keys: ["zone", "ttl"] });
    expect(jsonSummary("plain")).toBeNull();
    expect(excerptFromBody("# Title\n\n- [x] See [[Travel|trips]] and **bold**\n")).toBe("See trips and bold");
  });

  it("parses the console's search operators", () => {
    const query = parseMemoryQuery('vpn tag:work folder:"run books" author:dana has:json');
    expect(query).toMatchObject({ words: ["vpn"], tag: ["work"], folder: ["run books"], author: ["dana"], has: ["json"] });
    const entry = row("k", "VPN setup", { tags: ["work"], author: "Dana Reyes", excerpt: '{"a":1}' }, px, "mine", "run books");
    expect(matchesQuery(entry, query, "My memory")).toBe(true);
    expect(matchesQuery(entry, parseMemoryQuery("tag:home"), "My memory")).toBe(false);
    expect(matchesQuery(entry, parseMemoryQuery("tier:me"), "My memory")).toBe(true);
  });

  it("orders, ages and links rows", () => {
    const rows = [row("a", "Beta", { updatedAt: now - 2 * DAY }), row("b", "Alpha", { updatedAt: now - 200 * DAY })];
    expect(sortPageRows(rows, "title").map((entry) => entry.key)).toEqual(["b", "a"]);
    expect(sortPageRows(rows, "updated").map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(applyListView(rows, "stale", [], now).map((entry) => entry.key)).toEqual(["b"]);
    expect(backlinksTo("Alpha", rows, { a: "Read [[Alpha]] first." }, "b")).toEqual([{ key: "a", title: "Beta", context: "Read [[Alpha]] first." }]);
  });

  it("counts tags against the vocabulary, and hides what it cannot know", () => {
    const rows = [row("a", "A", { tags: ["area:net", "work"] }), row("b", "B", { tags: ["area:nett", "work"] })];
    const vocabulary = { namespaces: [{ id: "area", controlled: true, tags: [{ tag: "area:net" }] }] };
    const stats = tagStats(rows, vocabulary);
    expect(stats.namespaces).toBe(1);
    expect(stats.values).toBe(1);
    expect(stats.free).toEqual([{ tag: "work", count: 2 }]);
    expect(stats.orphans).toEqual([{ tag: "area:nett", count: 1, closest: "area:net" }]);
    expect(stats.top[0]).toEqual({ tag: "work", count: 2, share: 100 });
    const none = tagStats(rows, null);
    expect(none.namespaces).toBeNull();
    expect(none.orphans).toBeNull();
    expect(none.free.length).toBe(3);
  });

  it("counts duplicates inside one place: two bots' MEMORY.md are not doubles", () => {
    const rows = [
      row("1", "MEMORY.md", {}, bot), row("2", "MEMORY.md", {}, bot2),
      row("3", "Plan", {}, px), row("4", "plan", {}, px),
    ];
    expect(qualityStats(rows, 0, 0, now, tagStats(rows, null)).duplicates).toBe(2);
  });

  it("builds the weekly series from real dates only", () => {
    expect(activeSeries([row("a", "A")], ["mine"], now)).toBeNull();
    const series = activeSeries([row("a", "A", { createdAt: now - 3 * 7 * DAY }), row("b", "B", { createdAt: now - DAY })], ["mine"], now, 4)!;
    expect(series.map((point) => point.values.mine)).toEqual([1, 1, 1, 2]);
    expect(writeSeries([], now)).toBeNull();
    const writes = writeSeries([
      { id: "1", at: now - DAY, botId: "a", path: "p", actor: "bot", via: "", kind: "edited", beforeHash: null, afterHash: null, diff: "", added: 0, removed: 0, canRevert: false },
      { id: "2", at: now - DAY, botId: "a", path: "p", actor: "person", via: "", kind: "edited", beforeHash: null, afterHash: null, diff: "", added: 0, removed: 0, canRevert: false },
    ], now, 2)!;
    expect(writes.at(-1)!.values).toEqual({ bot: 1, person: 1 });
  });

  it("reads a bot's journal: created, last writer, versions", () => {
    const facts = journalFacts([
      { id: "2", at: 20, botId: "a", path: "p", actor: "person", via: "", kind: "edited", beforeHash: null, afterHash: null, diff: "", added: 0, removed: 0, canRevert: false },
      { id: "1", at: 10, botId: "a", path: "p", actor: "bot", via: "", kind: "created", beforeHash: null, afterHash: null, diff: "", added: 0, removed: 0, canRevert: false },
    ]).get("p")!;
    expect(facts).toMatchObject({ createdAt: 10, lastActor: "person", lastAt: 20, versions: 2 });
  });

  it("lays the tiers of the map side by side, with links across them", () => {
    const graph = buildMemoryPageGraph([
      { key: "mine", name: "My memory", notes: [{ id: "a", title: "Alpha", folder: "x" }] },
      { key: "org", name: "Organization", notes: [{ id: "b", title: "Beta", folder: "y" }] },
    ], { a: "See [[Beta]]." });
    const roots = graph.nodes.filter((node) => node.kind === "source");
    expect(roots.length).toBe(2);
    expect(roots[1]!.x).toBeGreaterThan(roots[0]!.x);
    expect(graph.edges.filter((edge) => edge.kind === "link").length).toBe(1);
  });
});
