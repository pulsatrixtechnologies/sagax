import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { mergeSteps, stepGroupWords, summarizeSteps } from "./step-group";

afterEach(() => {
  setLocale("en");
});

let seq = 0;
const step = (name: string, ok?: boolean, input?: Record<string, unknown>, durationMs?: number): Message => ({
  id: `s${++seq}`, at: seq, role: "bot", kind: "activity",
  tool: { name, ...(ok === undefined ? {} : { ok }), ...(input ? { input: JSON.stringify(input) } : {}), ...(durationMs === undefined ? {} : { durationMs }) },
});
const said = (text: string): Message => ({ id: `m${++seq}`, at: seq, role: "bot", kind: "text", text, turnId: "t" });
const tickets = { server: "pulsatrix-psa", tool: "acme_desk__query", args: { resource: "service.tickets" } };

describe("the steps of a group, opened", () => {
  it("merges the same step repeated back to back, with a count", () => {
    const entries = mergeSteps([
      step("Read", true, { file_path: "/a.md" }, 1_000),
      step("Read", true, { file_path: "/b.md" }, 2_000),
      step("Read", true, { file_path: "/c.md" }, 500),
      step("Bash", true, { command: "ls" }),
      step("Read", true, { file_path: "/d.md" }),
    ]);
    expect(entries.map((entry) => entry.kind === "steps" ? [entry.label, entry.messages.length] : entry.kind)).toEqual([
      ["Read a file", 3],
      ["Ran a command", 1],
      ["Read a file", 1],
    ]);
    // three files: no single target, their time added up
    const first = entries[0]!;
    expect(first.kind === "steps" && first.target).toBeUndefined();
    expect(first.kind === "steps" && first.durationMs).toBe(3_500);
  });

  // 2026-11-02: servers before then wrote each stuck notice twice, once with
  // long dashes; the steps showed every count twice in red.
  it("reads a stuck notice an older server wrote twice as one step, with its call", () => {
    const dash = "\u2014";
    const notice = (count: number, call: string, mark: string) => step(`Same call repeated ${count}× ${mark} ${call} ${mark} it may be stuck`, false);
    const entries = mergeSteps([
      notice(5, "other: sagax-environment__run_command", dash), notice(5, "other: sagax-environment__run_command", "-"),
      step("Bash", true, { command: "ls" }),
      notice(5, "other: github__issue_read", dash), notice(5, "other: github__issue_read", "-"),
      notice(10, "other: github__issue_read", dash), notice(10, "other: github__issue_read", "-"),
    ]);
    expect(entries.map((entry) => entry.kind === "steps" && [entry.label, entry.messages.length, entry.target])).toEqual([
      ["Same call repeated 5 times. It may be stuck", 1, "sagax-environment__run_command"],
      ["Ran a command", 1, "ls"],
      ["Same call repeated 5 times. It may be stuck", 1, "github__issue_read"],
      ["Same call repeated 10 times. It may be stuck", 1, "github__issue_read"],
    ]);
    // notices for different calls stay two steps, each with the call it names
    const two = mergeSteps([notice(5, "tool: git status", "-"), notice(5, "tool: npm test", "-")]);
    expect(two.map((entry) => entry.kind === "steps" && [entry.messages.length, entry.target])).toEqual([[1, "git status"], [1, "npm test"]]);
    // a call the guard quoted on several lines up to 0.8.28 (an ACP or Codex
    // title), written twice: one step, its call on one line
    const lines = "tool: cd /work/app\npnpm lint\npnpm test";
    const multi = mergeSteps([notice(5, lines, dash), notice(5, lines, "-"), notice(5, "tool: git status", "-")]);
    expect(multi.map((entry) => entry.kind === "steps" && [entry.label, entry.messages.length, entry.target])).toEqual([
      ["Same call repeated 5 times. It may be stuck", 1, "cd /work/app pnpm lint pnpm test"],
      ["Same call repeated 5 times. It may be stuck", 1, "git status"],
    ]);
  });

  it("never merges a failed step with a finished one, nor a running one at all", () => {
    const entries = mergeSteps([
      step("mcp", true, tickets), step("mcp", false, tickets), step("mcp", false, tickets),
      step("mcp", undefined, tickets), step("mcp", undefined, tickets),
    ]);
    expect(entries.map((entry) => entry.kind === "steps" && [entry.phase, entry.messages.length])).toEqual([
      ["done", 1], ["failed", 2], ["running", 1], ["running", 1],
    ]);
  });

  it("folds every finished tool search into one row, so the calls between them merge", () => {
    // Owner 2026-10-21: "Used search tool ×5, Used use tool, Used search tool ×4, Used use tool ×15"
    const use = (tool: string) => step("use_tool", true, { tool_name: tool, tool_input: { resource: "service.tickets" } });
    const entries = mergeSteps([
      step("search_tool", true, { query: "perspicax" }), step("search_tool", true, { query: "remote" }),
      use("perspicax__acme_desk__query"),
      step("search_tool", true, { query: "tickets" }),
      use("perspicax__acme_desk__query"), use("perspicax__acme_desk__query"),
      step("ToolSearch", true, { query: "select:Read" }),
      step("search_tool", undefined, { query: "still going" }),
    ]);
    expect(entries.map((entry) => entry.kind === "steps" ? [entry.label, entry.messages.length] : entry.kind)).toEqual([
      ["Looked for a tool", 4],
      ["Viewed tickets in Acme Desk", 3],
      ["Looking for a tool", 1],
    ]);
    // opened, the folded row lists its calls in the order they ran, and each
    // merged row keeps its calls in order too
    const folded = entries[0]!;
    const order = folded.kind === "steps" ? folded.messages.map((message) => Number(message.at)) : [];
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(order).toHaveLength(4);
  });

  it("keeps a search in its place when a narration sits between it and the first one", () => {
    const words = said("Now the computer.");
    const entries = mergeSteps([
      step("search_tool", true, { query: "tickets" }),
      step("use_tool", true, { tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }),
      words,
      step("search_tool", true, { query: "remote" }),
      step("use_tool", true, { tool_name: "remote__status", tool_input: {} }),
    ]);
    // the narration splits the stretch: the second search stays after it
    expect(entries.map((entry) => entry.kind === "steps" ? [entry.label, entry.messages.length] : entry.kind)).toEqual([
      ["Looked for a tool", 1],
      ["Viewed tickets in Acme Desk", 1],
      "message",
      ["Looked for a tool", 1],
      ["Read data in Remote", 1],
    ]);
  });

  it("keeps a turn's narration in its place between the steps", () => {
    const words = said("Now the notes.");
    const entries = mergeSteps([step("Read", true), step("Read", true), words, step("Read", true)]);
    expect(entries.map((entry) => entry.kind)).toEqual(["steps", "message", "steps"]);
    expect(entries[1]!.kind === "message" && entries[1]!.message).toBe(words);
  });
});

describe("the group's one line", () => {
  // the capture: 12 steps, 5 of them failed, 2m 53s
  const turn = [
    ...Array.from({ length: 7 }, () => step("mcp", true, tickets)),
    ...Array.from({ length: 5 }, () => step("mcp", false, tickets)),
  ];

  it("says how long, how many tools and how many failed", () => {
    expect(summarizeSteps(turn)).toEqual({ tools: 12, failed: 5, running: undefined });
    expect(stepGroupWords(summarizeSteps(turn), 173_000)).toEqual({
      label: "Worked 2m 53s", tools: "12 tools", failed: "5 failed", target: undefined, phase: "done",
      ariaLabel: "Worked 2m 53s, 12 tools, 5 failed, press to see the detail",
    });
    expect(stepGroupWords(summarizeSteps([step("Read", true), step("Bash", true)]), 400)).toMatchObject({ label: "Worked", tools: "2 tools", failed: undefined });
    expect(stepGroupWords(summarizeSteps([said("…")]), 12_000)).toMatchObject({ label: "Worked 12s", tools: undefined });
  });

  it("#3581: says Working while the bot still works, never the step (the working line names it)", () => {
    const live = [...turn, step("mcp", undefined, tickets)];
    const words = stepGroupWords(summarizeSteps(live), undefined);
    expect(words).toMatchObject({ label: "Working", phase: "running", tools: "13 tools", failed: "5 failed" });
    expect(words.ariaLabel).toBe("Working, 13 tools, 5 failed, press to see the detail");
    expect(JSON.stringify(words)).not.toContain("tickets");
    // a turn writing a note has no running step: still Working
    expect(stepGroupWords(summarizeSteps([said("…")]), 12_000, true)).toMatchObject({ label: "Working", phase: "running" });
  });

  it("speaks French when the interface is in French", () => {
    setLocale("fr");
    expect(stepGroupWords(summarizeSteps(turn), 173_000)).toMatchObject({
      label: "A travaillé 2 min 53 s", tools: "12 outils", failed: "5 échecs",
      ariaLabel: "A travaillé 2 min 53 s, 12 outils, 5 échecs, appuie pour voir le détail",
    });
    expect(stepGroupWords(summarizeSteps([step("Read", true), step("Read", false)]), undefined)).toMatchObject({
      label: "A travaillé", tools: "2 outils", failed: "1 échec",
    });
  });
});
