import { describe, expect, it } from "vitest";

import { buildMemoryMapGraph, extractWikiLinks } from "./memory-map";
import type { MemoryBrowse, MemoryManagerSource } from "./memory-manager";

const source: MemoryManagerSource = {
  id: "bot:atlas",
  kind: "bot",
  name: "Atlas",
  mayWrite: true,
  botId: "atlas",
};

const browse: MemoryBrowse = {
  folders: [{ id: "dining", name: "dining", count: 2 }],
  notes: [
    { id: "n1", title: "Dining", folder: "dining", tags: ["food"], excerpt: "Prefers", path: "memory/dining.md" },
    { id: "n2", title: "Travel", folder: "dining", tags: ["food", "trip"], excerpt: "Trips", path: "memory/travel.md" },
    { id: "n3", title: "Lab", tags: ["trip"], excerpt: "Shared", path: "memory/lab.md" },
  ],
  mayWrite: true,
};

describe("extractWikiLinks", () => {
  it("reads [[Note]] targets", () => {
    expect(extractWikiLinks("See [[Dining]] and [[Travel|trips]].")).toEqual(["dining", "travel"]);
  });
});

describe("buildMemoryMapGraph", () => {
  it("builds source, folder and note nodes with contains, tag and link edges", () => {
    const graph = buildMemoryMapGraph({
      source,
      browse,
      bodies: { n1: "Related to [[Travel]] and [[Missing]]." },
    });
    expect(graph.nodes.some((node) => node.kind === "source" && node.label === "Atlas")).toBe(true);
    expect(graph.nodes.filter((node) => node.kind === "folder")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === "note")).toHaveLength(3);
    expect(graph.edges.some((edge) => edge.kind === "contains")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "tag")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "link" && edge.from.includes("n1") && edge.to.includes("n2"))).toBe(true);
  });
});
