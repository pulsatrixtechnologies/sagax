// The Code section's components and helpers: the run card (pill, unread
// dot, stats), the diff (folding, side by side, text only), the timeline
// fold, the grouping, and where a thread's cloud agent card goes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CloudAgentRecord } from "../../../shared/cloud-agents.ts";
import { parseUnifiedDiff } from "../../../shared/code-runs.ts";
import { compactAge, dailyOutcomes, mergeEvents, runBucket, timelineItems, workedMinutes, type CodeEvent } from "@/lib/code-runs";
import { cloudAgentAnchors } from "./CloudAgentsCard";
import { DiffView, foldContext, splitRows } from "./DiffView";
import { MiniBars } from "./MiniBars";
import { RunCard, runCardPill } from "./RunCard";
import { StatCard } from "./StatCard";

const NOW = Date.parse("2026-10-18T15:00:00Z");

describe("RunCard", () => {
  it("shows files, +/- counts, the pill, the unread dot and the meta line", () => {
    const html = renderToStaticMarkup(createElement(RunCard, {
      title: "Fix the list", state: "finished", pr: { number: 42, state: "merged" }, stats: { files: 6, added: 772, removed: 32 },
      model: "model-a", repo: "demo/web-app", updatedAt: new Date(NOW - 2 * 86_400_000), unread: true, onOpen: () => {}, now: NOW,
    }));
    expect(html).toContain("6 files");
    expect(html).toContain("+772");
    expect(html).toContain("-32");
    expect(html).toContain('data-run-pill="merged"');
    expect(html).toContain("data-unread");
    expect(html).toContain("demo/web-app");
    expect(html).toContain("2 d");
  });

  it("is one line in compact form and abbreviates thousands", () => {
    const html = renderToStaticMarkup(createElement(RunCard, {
      title: "Big", state: "running", stats: { files: 41, added: 4200, removed: 164 }, updatedAt: new Date(NOW), onOpen: () => {}, compact: true, now: NOW,
    }));
    expect(html).toContain('data-testid="run-card-compact"');
    expect(html).toContain("+4.2k");
    expect(html).toContain('data-run-pill="running"');
  });

  it("picks the pill: merged first, then working, waiting, failed, PR, stopped, branch", () => {
    expect(runCardPill("running", { state: "merged" })).toBe("merged");
    expect(runCardPill("setup")).toBe("running");
    expect(runCardPill("queued")).toBe("waiting");
    expect(runCardPill("expired")).toBe("failed");
    expect(runCardPill("idle", { state: "draft" })).toBe("draft");
    expect(runCardPill("stopped")).toBe("stopped");
    expect(runCardPill("finished")).toBe("branch");
  });
});

describe("StatCard and MiniBars", () => {
  it("draw a ring, a link and stacked bars with a title per bar", () => {
    const card = renderToStaticMarkup(createElement(StatCard, { label: "Rate", value: "80 %", ring: 0.8, href: "https://console.example.test" }));
    expect(card).toContain('href="https://console.example.test"');
    expect(card).toContain('aria-label="80 %"');
    const bars = renderToStaticMarkup(createElement(MiniBars, { series: [{ label: "Oct 12", ok: 5, fail: 1 }, { label: "Oct 13", ok: 0, fail: 0 }] }));
    expect(bars).toContain('title="Oct 12: 5 succeeded, 1 failed"');
    expect(bars).toContain("h-px");
  });
});

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,12 +1,12 @@
 l1
-old
+new
 l3
 l4
 l5
 l6
 l7
 l8
 l9
 l10
-x
+<b>y</b>
 l12
`;

describe("DiffView", () => {
  it("folds a long unchanged stretch and keeps three lines around changes", () => {
    const [file] = parseUnifiedDiff(DIFF);
    const pieces = foldContext(file!.hunks[0]!, 3, "h");
    const fold = pieces.find((piece) => piece.kind === "fold");
    expect(fold && fold.kind === "fold" ? fold.lines.map((l) => l.text) : []).toEqual(["l6", "l7"]);
  });

  it("pairs removals with additions side by side", () => {
    const [file] = parseUnifiedDiff(DIFF);
    const rows = splitRows(file!.hunks[0]!.lines);
    expect(rows[1]).toMatchObject({ left: { kind: "del", text: "old" }, right: { kind: "add", text: "new" } });
  });

  it("renders a line as text, never as HTML", () => {
    const html = renderToStaticMarkup(createElement(DiffView, { files: parseUnifiedDiff(DIFF), mode: "unified", onModeChange: () => {} }));
    expect(html).toContain("&lt;b&gt;y&lt;/b&gt;");
    expect(html).not.toContain("<b>y</b>");
    expect(html).toContain("2 unchanged lines");
    expect(html).toContain('data-diff-file="a.ts"');
  });
});

const ev = (seq: number, kind: string, payload: Record<string, unknown>): CodeEvent => ({ run_id: "r", seq, at: new Date(NOW + seq * 1000).toISOString(), kind, payload });

describe("timeline and helpers", () => {
  it("folds events into rows: tools grouped, results attached, approvals answered, states hidden", () => {
    const items = timelineItems([
      ev(1, "requested", { prompt: "Do it" }),
      ev(2, "state", { state: "running" }),
      ev(3, "tool_call", { id: "a", name: "Bash", summary: "pnpm test" }),
      ev(4, "tool_call", { id: "b", name: "Read" }),
      ev(5, "tool_result", { id: "a", ok: false, output: "1 failed" }),
      ev(6, "message", { role: "assistant", text: "Done" }),
      ev(7, "approval", { approval_id: "ap", title: "Run it?", options: ["Allow", "Deny"] }),
      ev(8, "approval_answer", { approval_id: "ap", option: "Allow" }),
      ev(9, "pr", { number: 3, url: "javascript:alert(1)", state: "draft" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["task", "tools", "message", "approval"]);
    const tools = items[1]!;
    expect(tools.kind === "tools" && tools.calls).toEqual([
      { id: "a", name: "Bash", summary: "pnpm test", ok: false, output: "1 failed" },
      { id: "b", name: "Read", summary: "" },
    ]);
    expect(items[3]).toMatchObject({ answer: "Allow" });
  });

  it("reads the runner protocol's payloads: input_summary, output_summary, choices and detail, verify", () => {
    const items = timelineItems([
      ev(1, "requested", { prompt: "Do it" }),
      ev(2, "tool_call", { id: "a", name: "Bash", input_summary: "pnpm test" }),
      ev(3, "tool_result", { id: "a", ok: true, output_summary: "42 passed" }),
      ev(4, "approval", { approval_id: "ap", title: "Remove deps?", detail: "Touches the lockfile.", choices: ["Allow", "Deny"] }),
      ev(5, "verify", { commands: [{ cmd: "pnpm test", ok: true, exit_code: 0 }, { cmd: "pnpm lint", ok: false, exit_code: 1, tail: "2 warnings" }] }),
      ev(6, "stats", { files: 1, added: 2, removed: 0, commits: 1 }),
      ev(7, "diff", { files: [] }),
      ev(8, "commits", { commits: [] }),
      ev(9, "terminal", { text: "$ pnpm test" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["task", "tools", "approval", "verify"]);
    expect(items[1]).toMatchObject({ calls: [{ name: "Bash", summary: "pnpm test", ok: true, output: "42 passed" }] });
    expect(items[2]).toMatchObject({ options: ["Allow", "Deny"], detail: "Touches the lockfile." });
    expect(items[3]).toMatchObject({ passed: 1, failed: 1 });
  });

  it("merges live events without duplicates, in order", () => {
    expect(mergeEvents([ev(1, "a", {}), ev(3, "a", {})], [ev(2, "a", {}), ev(3, "a", {})]).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("groups by today, this week, older and counts daily outcomes", () => {
    expect(runBucket(NOW - 60_000, NOW)).toBe("today");
    expect(runBucket(NOW - 3 * 86_400_000, NOW)).toBe("week");
    expect(runBucket(NOW - 9 * 86_400_000, NOW)).toBe("older");
    const days = dailyOutcomes([
      { state: "finished", created_at: new Date(NOW - 1000).toISOString() },
      { state: "failed", created_at: new Date(NOW - 2000).toISOString() },
      { state: "running", created_at: new Date(NOW - 3000).toISOString() },
    ], NOW);
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ ok: 1, fail: 1 });
    expect(compactAge(NOW - 5 * 60_000, NOW)).toEqual({ n: 5, unit: "min" });
    expect(workedMinutes({ created_at: new Date(NOW - 600_000).toISOString(), started_at: new Date(NOW - 480_000).toISOString(), ended_at: null }, NOW)).toBe(8);
  });

  it("puts a thread's cloud agents under the last row at or before their launch", () => {
    const record = (id: string, createdAt: number) => ({ id, createdAt }) as CloudAgentRecord;
    const anchors = cloudAgentAnchors([100, 200, 300], [record("a", 250), record("b", 50), record("c", 260)], 0);
    expect([...anchors.entries()].map(([i, rows]) => [i, rows.map((r) => r.id)])).toEqual([[1, ["a", "c"]], [0, ["b"]]]);
  });
});
