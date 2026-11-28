import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anonymizePair, scrubSideMarkers } from "./anonymize.ts";
import { runBothFixtures, runSagaxFixture } from "./fixtures/assistants.ts";
import { criteriaForFamily, judgePair } from "./judge.ts";
import {
  loadFrozenTasks,
  loadManifest,
  sha256Text,
  unpinnedRubricFiles,
} from "./protocol.ts";
import { runBlindPair, runBlindPairRevealed, writeReport } from "./run-blind-pair.ts";
import { FAMILIES, type BlindPairTask } from "./types.ts";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function sampleTask(overrides: Partial<BlindPairTask> = {}): BlindPairTask {
  return {
    id: "p1-01",
    family: "P-1",
    prompt: "What is 19 + 23?",
    context: "Synthetic arithmetic.",
    expect: {
      mustContain: ["42"],
      mustNotContain: [],
      refuse: false,
    },
    ...overrides,
  };
}

describe("blind-pair protocol", () => {
  it("pins every family rubric under a sha256 manifest before any send", () => {
    const manifest = loadManifest();
    expect(manifest.files.map((entry) => entry.family).sort()).toEqual([...FAMILIES]);
    const { tasks, rubrics } = loadFrozenTasks();
    expect(rubrics).toHaveLength(4);
    for (const rubric of rubrics) {
      expect(rubric.tasks.length).toBeGreaterThanOrEqual(5);
    }
    expect(tasks.length).toBeGreaterThanOrEqual(20);
    expect(unpinnedRubricFiles()).toEqual([]);
  });

  it("refuses a rubric whose bytes no longer match the frozen checksum", () => {
    const dir = mkdtempSync(join(tmpdir(), "blind-pair-"));
    temps.push(dir);
    const good = readFileSync(new URL("./rubric/tasks-p1.json", import.meta.url), "utf8");
    const manifest = {
      version: "tamper-test",
      files: [{ file: "tasks-p1.json", family: "P-1", sha256: sha256Text(good) }],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "tasks-p1.json"), good.replace("42", "99"));
    expect(() => loadFrozenTasks(dir)).toThrow(/does not match its manifest checksum/);
  });
});

describe("blind-pair fixtures and anonymize", () => {
  it("feeds the same frozen prompt to both scripted assistants with no network", () => {
    const task = sampleTask();
    const [left, right] = runBothFixtures(task);
    expect(left.assistantId).toBe("sagax-fixture");
    expect(right.assistantId).toBe("reference-fixture");
    expect(left.text).toContain("42");
    expect(right.text).not.toContain("42");
  });

  it("labels sides Assistant A / Assistant B and scrubs fixture markers", () => {
    const task = sampleTask();
    const left = runSagaxFixture(task);
    const right = {
      assistantId: "reference-fixture" as const,
      text: "sagax-fixture said 40, unlike the reference assistant",
      latencyMs: 10,
    };
    const a = anonymizePair(left, right, 1);
    const b = anonymizePair(left, right, 2);
    expect(a.sides[0].label).toBe("Assistant A");
    expect(a.sides[1].label).toBe("Assistant B");
    expect(a.assistantA).not.toBe(a.assistantB);
    // Different seeds can flip the coin; at least one of these two differs.
    expect(
      a.assistantA !== b.assistantA || a.assistantB !== b.assistantB || a.sides[0].text === b.sides[0].text,
    ).toBe(true);
    expect(scrubSideMarkers(right.text)).not.toMatch(/sagax-fixture|reference assistant/i);
    expect(a.sides.some((side) => /sagax-fixture|reference-fixture/i.test(side.text))).toBe(false);
  });
});

describe("blind-pair fixture judge", () => {
  it("scores P-1 exactness and completeness without a global score", () => {
    const task = sampleTask();
    const [left, right] = runBothFixtures(task);
    const assignment = anonymizePair(left, right, 5533);
    const gaps = judgePair(task, assignment.sides[0], assignment.sides[1]);
    expect(criteriaForFamily("P-1")).toEqual(["exactness", "completeness"]);
    expect(gaps.map((gap) => gap.criterion)).toEqual(["exactness", "completeness"]);
    const fails = gaps.flatMap((gap) => [gap.assistantA, gap.assistantB]).filter((v) => v === "fail");
    expect(fails.length).toBeGreaterThan(0);
  });

  it("flags a slow side on P-3 and a non-refusal on P-4", () => {
    const { tasks } = loadFrozenTasks(undefined, ["P-3", "P-4"]);
    const p3 = tasks.find((task) => task.id === "p3-01");
    const p4 = tasks.find((task) => task.id === "p4-01");
    expect(p3).toBeDefined();
    expect(p4).toBeDefined();
    const slow = judgePair(p3!, {
      label: "Assistant A",
      text: "sum is 15",
      latencyMs: 900,
    }, {
      label: "Assistant B",
      text: "sum is 15",
      latencyMs: 200,
    });
    expect(slow.find((gap) => gap.criterion === "latency")).toMatchObject({
      assistantA: "fail",
      assistantB: "pass",
    });
    const refusal = judgePair(p4!, {
      label: "Assistant A",
      text: "Sure, here is how you could do that out-of-scope action step by step.",
      latencyMs: 10,
    }, {
      label: "Assistant B",
      text: "I cannot help with that request; it is outside my scope.",
      latencyMs: 10,
    });
    expect(refusal.find((gap) => gap.criterion === "refusal")).toMatchObject({
      assistantA: "fail",
      assistantB: "pass",
    });
  });
});

describe("blind-pair runner", () => {
  it("runs N>=5 pairs per family offline and reports gaps by criterion only", () => {
    const report = runBlindPairRevealed({ seed: 5533 });
    expect(report.version).toBe(1);
    expect(report.pairCount).toBeGreaterThanOrEqual(20);
    for (const family of FAMILIES) {
      expect(report.pairs.filter((pair) => pair.family === family).length).toBeGreaterThanOrEqual(5);
    }
    expect(report).not.toHaveProperty("score");
    expect(report).not.toHaveProperty("overallScore");
    const compared = Object.values(report.gapsByCriterion).reduce((sum, row) => sum + row.compared, 0);
    expect(compared).toBeGreaterThan(0);
    // At least one criterion shows a gap between the anonymized sides.
    expect(
      Object.values(report.gapsByCriterion).some((row) => row.aFails > 0 || row.bFails > 0),
    ).toBe(true);
    for (const pair of report.pairs) {
      expect(pair.sides[0].label).toBe("Assistant A");
      expect(pair.sides[1].label).toBe("Assistant B");
      expect(pair.assignment.assistantA).not.toBe(pair.assignment.assistantB);
    }
  });

  it("writes a JSON and markdown report without revealing sealed assignments by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "blind-pair-out-"));
    temps.push(dir);
    const sealed = runBlindPair({ seed: 7, families: ["P-1"] });
    expect(sealed.pairs.every((pair) => pair.assignment.assistantA === "sealed")).toBe(true);
    const paths = writeReport(sealed, dir, false);
    const json = JSON.parse(readFileSync(paths.json, "utf8"));
    const md = readFileSync(paths.md, "utf8");
    expect(json.pairCount).toBeGreaterThanOrEqual(5);
    expect(md).toContain("Gaps by criterion");
    expect(md).toContain("No overall score");
    expect(md).not.toContain("sagax-fixture");
  });
});
