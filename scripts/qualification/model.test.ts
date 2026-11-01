import { describe, expect, it } from "vitest";

import { CORPUS, CORPUS_IDS, CATEGORIES, renderCorpusMarkdown } from "./corpus.ts";
import { fakeProfile, realProfile } from "./engines.ts";
import { blankRecord, buildReport, compare, percentile, renderComparison, renderReport, summarize, validateManualReport, type TaskRecord } from "./model.ts";
import { grokTemplate, selectTasks } from "./run.ts";
import { promptRequestText, stripContext } from "./context.ts";

const task = (over: Partial<TaskRecord>): TaskRecord => ({
  ...blankRecord({ id: "t", category: "reply", title: "t", engine: "fake" }),
  status: "completed", completed: true, timed: true, ...over,
});

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarize", () => {
  it("counts completion, losses, duplicates and restart recovery over run tasks only", () => {
    const tasks = [
      task({ id: "a", samples: [{ ttftMs: 100, finalMs: 200 }] }),
      task({ id: "b", samples: [{ ttftMs: 300, finalMs: 400 }], lostAccepted: 1, completed: false, status: "failed" }),
      task({ id: "c", duplicateReplies: 2, duplicateDispatches: 1, restartRecovery: "recovered", timed: false, samples: [{ ttftMs: 9_999, finalMs: 9_999 }] }),
      task({ id: "d", restartRecovery: "not-recovered", completed: false, status: "failed", stuck: true }),
      { ...blankRecord({ id: "e", category: "reply", title: "e", engine: "fake" }), skipReason: "x" },
    ];
    const s = summarize(tasks);
    expect(s).toMatchObject({ tasks: 5, run: 4, skipped: 1, completed: 2, lostAccepted: 1, duplicateReplies: 2, duplicateDispatches: 1, stuck: 1, restartTasks: 2, restartRecovered: 1 });
    expect(s.completionRate).toBeCloseTo(0.5);
    expect(s.restartRecoveryRate).toBeCloseTo(0.5);
    // untimed and failed tasks never join the latency percentiles
    expect(s.final).toEqual({ n: 1, p50: 200, p95: 200 });
  });

  it("reads a manual record's two numbers as one sample", () => {
    const s = summarize([task({ engine: "grok-manual", ttftMs: 1_200, finalMs: 5_000 })]);
    expect(s.ttft.p50).toBe(1_200);
    expect(s.final.p95).toBe(5_000);
  });

  it("has no rate for an empty run", () => {
    expect(summarize([]).completionRate).toBeNull();
  });
});

describe("corpus", () => {
  it("has unique ids, known categories, and one scenario kind per task", () => {
    expect(new Set(CORPUS_IDS).size).toBe(CORPUS.length);
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    for (const entry of CORPUS) expect(CATEGORIES).toContain(entry.category);
    for (const category of CATEGORIES) expect(CORPUS.some((entry) => entry.category === category)).toBe(true);
  });

  it("covers every required situation", () => {
    const kinds = new Set(CORPUS.map((entry) => entry.kind));
    for (const kind of ["reply", "busy", "delegate", "routine", "upload", "page", "failover", "cancel", "reconnect", "restart", "concurrent"]) expect(kinds).toContain(kind);
  });

  it("is plain synthetic text with no dash characters and no secrets", () => {
    const text = JSON.stringify(CORPUS) + renderCorpusMarkdown();
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{8}|xai-[A-Za-z0-9]{8}/);
  });

  it("selects by id and category and refuses unknown names", () => {
    expect(selectTasks(["reply-01"], []).map((entry) => entry.id)).toEqual(["reply-01"]);
    expect(selectTasks([], ["restart"]).every((entry) => entry.category === "restart")).toBe(true);
    expect(() => selectTasks(["nope"], [])).toThrow(/unknown task/);
    expect(() => selectTasks([], ["nope"])).toThrow(/unknown categor/);
  });
});

describe("real engine opt-in", () => {
  const ok = { confirmed: true, cli: "/abs/engine", model: "m", passEnv: ["SYNTHETIC_KEY_NAME"] };
  it("needs the environment switch and the flag", () => {
    expect(() => realProfile(ok, {})).toThrow(/opt-in/);
    expect(() => realProfile({ ...ok, confirmed: false }, { QUALIFY_REAL_ENGINE: "1" })).toThrow(/opt-in/);
    expect(realProfile(ok, { QUALIFY_REAL_ENGINE: "1" }).kind).toBe("real");
  });

  it("takes names, never values, and an absolute CLI", () => {
    const env = { QUALIFY_REAL_ENGINE: "1" };
    expect(() => realProfile({ ...ok, passEnv: ["abc-not-a-name"] }, env)).toThrow(/names, not values/);
    expect(() => realProfile({ ...ok, passEnv: [] }, env)).toThrow(/at least one/);
    expect(() => realProfile({ ...ok, cli: "engine" }, env)).toThrow(/absolute/);
  });

  it("copies only the listed variables and never prints a value", () => {
    const profile = realProfile(ok, { QUALIFY_REAL_ENGINE: "1", SYNTHETIC_KEY_NAME: "synthetic-value", OTHER: "no" });
    expect(profile.engineEnv({ dataDir: "", prompts: "", launchLog: "", roomPlan: "", gates: "" })).toEqual({ SYNTHETIC_KEY_NAME: "synthetic-value" });
    expect(JSON.stringify({ ...profile, engineEnv: undefined })).not.toContain("synthetic-value");
  });

  it("the fake profile logs prompts and launches, nothing else", () => {
    const env = fakeProfile().engineEnv({ dataDir: "/d", prompts: "/d/p", launchLog: "/d/l", roomPlan: "", gates: "" });
    expect(Object.keys(env).sort()).toEqual(["FAKE_CLAUDE_LAUNCH_LOG", "FAKE_CLAUDE_PROMPTS"]);
  });
});

describe("prompt text", () => {
  it("drops harness context, recalled passages and quoted recent lines, keeps the request", () => {
    const line = JSON.stringify({ message: { content: "<system-reminder>\nmemory quotes QM-OLD\n</system-reminder>\n\nRecalled for this message: x QM-OLD\n[end of recalled passages, the message follows]\n\nRequest:\nthe real ask QM-NEW" } });
    expect(promptRequestText(line)).toContain("QM-NEW");
    expect(promptRequestText(line)).not.toContain("QM-OLD");
    expect(stripContext("Recent lines of that conversation, for context only (not requests):\n- You: QM-OLD\n\nRequest:\nQM-NEW")).not.toContain("QM-OLD");
  });
});

describe("reports", () => {
  const fake = buildReport({ corpusVersion: "1", engine: "fake", engineLabel: "fake", startedAt: "s", finishedAt: "f", revision: "r", node: "n", tasks: CORPUS.map((entry) => task({ id: entry.id, category: entry.category, title: entry.title, samples: [{ ttftMs: 10, finalMs: 20 }] })) });

  it("renders the numbers the summary holds, without dash characters", () => {
    const markdown = renderReport(fake);
    expect(markdown).toContain("Completion rate | 100.0%");
    expect(markdown).toContain("Time to final reply p50 / p95 | 20 ms / 20 ms");
    expect(markdown).not.toMatch(/[\u2013\u2014]/);
  });

  it("the Grok template validates once its tasks are filled in, and merges", () => {
    const template = grokTemplate();
    expect(validateManualReport(template, CORPUS_IDS)).toEqual([]);
    const filled = { ...template, tasks: template.tasks.map((entry) => (entry.skipReason ? entry : { ...entry, status: "completed" as const, completed: true, ttftMs: 900, finalMs: 4_000 })) };
    const merged = renderComparison(compare(fake, buildReport({ ...filled, engineLabel: filled.engineLabel }) ));
    expect(merged).toContain("| Metric | Sagax | Grok Bot |");
    expect(merged).not.toContain("WARNING");
    expect(renderComparison(compare(fake, { ...filled, corpusVersion: "0" }))).toContain("WARNING");
  });

  it("refuses a manual report that is incomplete or wrong", () => {
    expect(validateManualReport({ schema: 1, corpusVersion: "1", engine: "fake", tasks: [{ id: "reply-01", status: "completed" }, { id: "zzz", status: "completed" }] }, CORPUS_IDS).join("\n")).toMatch(/engine must be grok-manual[\s\S]*unknown task zzz[\s\S]*task reply-02 missing/);
    expect(validateManualReport(null, CORPUS_IDS)).toEqual(["not an object"]);
  });
});
