import { describe, expect, it } from "vitest";

import {
  buildMemoryMapGraph,
  extractWikiLinks,
  layoutMemoryMapNodes,
  MEMORY_NODE_GAP,
  MEMORY_NODE_HEIGHT,
  MEMORY_NODE_WIDTH,
  memoryEdgeEndpoints,
  memoryMapNodesOverlap,
  memoryNodeRect,
  memoryRectsIntersect,
  type MemoryMapNode,
} from "./memory-map";
import type { MemoryBrowse, MemoryManagerSource, MemoryNoteRow } from "./memory-manager";

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

function denseBrowse(count = 40): { browse: MemoryBrowse; bodies: Record<string, string> } {
  const folders = ["alpha", "beta", "gamma", "delta"];
  const notes: MemoryNoteRow[] = Array.from({ length: count }, (_, index) => {
    const folder = folders[index % folders.length]!;
    const id = `n${index + 1}`;
    return {
      id,
      title: `Note ${index + 1}`,
      folder,
      tags: index % 3 === 0 ? ["shared", folder] : [folder],
      excerpt: `Excerpt ${index + 1}`,
      path: `memory/${folder}/note-${index + 1}.md`,
    };
  });
  const bodies: Record<string, string> = {};
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]!;
    const next = notes[(index + 1) % notes.length]!;
    const jump = notes[(index + 7) % notes.length]!;
    bodies[note.id] = `# ${note.title}\n\nSee [[${next.title}]] and [[${jump.title}]].\n`;
  }
  return {
    browse: {
      folders: folders.map((name) => ({
        id: name,
        name,
        count: notes.filter((note) => note.folder === name).length,
      })),
      notes,
      mayWrite: true,
    },
    bodies,
  };
}

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

  it("lays out fixtures so no two node rectangles intersect", () => {
    const small = buildMemoryMapGraph({ source, browse, bodies: { n1: "Related to [[Travel]]." } });
    expect(memoryMapNodesOverlap(small.nodes, MEMORY_NODE_GAP)).toBe(false);

    const dense = denseBrowse(40);
    const graph = buildMemoryMapGraph({ source, browse: dense.browse, bodies: dense.bodies });
    expect(graph.nodes.filter((node) => node.kind === "note")).toHaveLength(40);
    expect(graph.edges.some((edge) => edge.kind === "link")).toBe(true);
    expect(memoryMapNodesOverlap(graph.nodes, MEMORY_NODE_GAP)).toBe(false);

    for (let i = 0; i < graph.nodes.length; i++) {
      for (let j = i + 1; j < graph.nodes.length; j++) {
        expect(memoryRectsIntersect(memoryNodeRect(graph.nodes[i]!), memoryNodeRect(graph.nodes[j]!))).toBe(false);
      }
    }
  });
});

describe("layoutMemoryMapNodes", () => {
  it("keeps GAP spacing after a residual collision pass", () => {
    const overlapping: MemoryMapNode[] = [
      { id: "a", kind: "note", label: "A", sourceId: "s", x: 0, y: 0 },
      { id: "b", kind: "note", label: "B", sourceId: "s", x: 10, y: 10 },
      { id: "c", kind: "note", label: "C", sourceId: "s", x: 20, y: 20 },
    ];
    const laid = layoutMemoryMapNodes(overlapping);
    expect(memoryMapNodesOverlap(laid, MEMORY_NODE_GAP)).toBe(false);
  });
});

describe("memoryEdgeEndpoints", () => {
  it("attaches on card borders between two side-by-side nodes", () => {
    const from = { x: 0, y: 0 };
    const to = { x: MEMORY_NODE_WIDTH + MEMORY_NODE_GAP, y: 0 };
    const points = memoryEdgeEndpoints(from, to);
    expect(points.x1).toBeCloseTo(MEMORY_NODE_WIDTH);
    expect(points.y1).toBeCloseTo(MEMORY_NODE_HEIGHT / 2);
    expect(points.x2).toBeCloseTo(MEMORY_NODE_WIDTH + MEMORY_NODE_GAP);
    expect(points.y2).toBeCloseTo(MEMORY_NODE_HEIGHT / 2);
  });
});
