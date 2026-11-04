import { describe, expect, it } from "vitest";
import { parseProcessMemory, processMemory, resourceMemory } from "./process-memory.ts";

describe("warm process memory", () => {
  it("parses ps RSS in KiB and ignores malformed rows", () => {
    expect(parseProcessMemory(" 20 1 100\n21 20 50\nno access\n0 1 3")).toEqual([
      { pid: 20, parent: 1, bytes: 102400 }, { pid: 21, parent: 20, bytes: 51200 },
    ]);
  });
  it("charges descendants once to their nearest registered root", () => {
    const memory = resourceMemory([
      { pid: 20, parent: 1, bytes: 100 }, { pid: 21, parent: 20, bytes: 50 },
      { pid: 22, parent: 21, bytes: 25 }, { pid: 23, parent: 20, bytes: 10 },
      { pid: 24, parent: 25, bytes: 10 }, { pid: 25, parent: 24, bytes: 10 },
    ], new Set([20, 21]));
    expect([...memory]).toEqual([[20, 110], [21, 75]]);
  });
  it("samples this isolated test process without leaving a sampler running", async () => {
    const rows = await processMemory();
    if (process.platform !== "win32") expect(rows.find(row => row.pid === process.pid)?.bytes).toBeGreaterThan(0);
  });
});
