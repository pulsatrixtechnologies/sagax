// Parallel tasks in the renderer (shared/parallel-tasks.ts): the task card, approvals of a parallel task in the conversation's
// stepper, and the activity detail (plain step names, nested sub-agents,
// a message box for a running task).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ tasks: [] as Array<Record<string, unknown>> }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  openThread: vi.fn(),
  useStore: () => ({
    state: { instances: [], selectedId: "pepper", bots: [{ id: "pepper", name: "Pepper", threadId: "main", tasks: fixture.tasks, messages: [] }] },
    dispatch: vi.fn(),
  }),
}));

import type { BotActivityDetail } from "../../shared/bot-activity";
import { ParallelResultLabel, ParallelTaskCard, parallelCardState } from "./ParallelTaskCard";
import { parallelPendings, waitingParallelTasks } from "./parallel-approvals";
import { ActivityDetailBody } from "./bot-settings/ActivityDetailModal";
import { humanStepName, stepTree } from "@/lib/activity-steps";

const NOW = 1_800_000_000_000;
const card = (state?: string) => ({
  id: "card", role: "bot", kind: "activity", at: NOW, tool: { name: "Parallel task #Draft", ok: true },
  threadRef: { botId: "pepper", threadId: "par", title: "Draft the email" },
  parallelTask: { threadId: "par", title: "Draft the email", requestMessageId: "req", role: "card", ...(state ? { state } : {}), startedAt: NOW - 5_000 },
}) as never;

describe("parallel task card", () => {
  it("reads live state from its task: running, waiting for approval, then the recorded end", () => {
    fixture.tasks = [{ threadId: "par", title: "Draft the email", busy: true, activity: "working", turnStartedAt: NOW - 3_000 }];
    let html = renderToStaticMarkup(createElement(ParallelTaskCard, { message: card("running"), botId: "pepper" }));
    expect(html).toContain('data-parallel-state="running"');
    expect(html).toContain("Parallel task · Draft the email");
    expect(html).toContain("data-parallel-stop");
    // the one conversation (#2099): one line like Claude Code's delegation,
    // `● Agent(@Pepper · Draft the email)` then `⎿ Backgrounded agent`; no
    // card, no Open, no thread
    expect(html).toContain("data-parallel-line");
    expect(html).toContain("Agent</span><span");
    expect(html).toContain("(@Pepper · Draft the email)");
    expect(html).toContain("Backgrounded agent");
    expect(html).not.toContain("data-parallel-open");
    expect(html).not.toMatch(/Open thread/i);
    fixture.tasks = [{ threadId: "par", title: "Draft the email", busy: true, activity: "waiting-on-you" }];
    html = renderToStaticMarkup(createElement(ParallelTaskCard, { message: card("running"), botId: "pepper" }));
    expect(html).toContain('data-parallel-state="waiting"');
    expect(html).toContain("Waiting for your approval");
    fixture.tasks = [{ threadId: "par", title: "Draft the email", busy: false }];
    html = renderToStaticMarkup(createElement(ParallelTaskCard, { message: card("done"), botId: "pepper" }));
    expect(html).toContain('data-parallel-state="done"');
    expect(html).not.toContain("data-parallel-stop");
    expect(parallelCardState(card("queued"), { busy: false })).toBe("queued");
    const result = { id: "r", role: "bot", kind: "text", at: NOW, text: "ok", parallelTask: { threadId: "par", title: "Draft the email", requestMessageId: "req", role: "result" } } as never;
    expect(renderToStaticMarkup(createElement(ParallelResultLabel, { message: result }))).toContain("Answer from the parallel task · Draft the email");
  });
});

describe("approvals of a parallel task", () => {
  it("join the conversation's stepper tagged with their task and thread", () => {
    const bot = { tasks: [
      { threadId: "par", title: "Draft", activity: "waiting-on-you", parallelOf: { threadId: "main", messageId: "m", at: 1 } },
      { threadId: "done", title: "Old", activity: "waiting-on-you", parallelOf: { threadId: "main", messageId: "m", at: 1, reportedAt: 2 } },
      { threadId: "other", title: "Elsewhere", activity: "waiting-on-you", parallelOf: { threadId: "x", messageId: "m", at: 1 } },
    ] } as never;
    expect(waitingParallelTasks(bot, "main").map((task) => task.threadId)).toEqual(["par"]);
    const pendings = parallelPendings([
      { id: "c1", role: "bot", kind: "options", at: 1, card: { title: "Allow?", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", subtitle: "ls" } },
    ] as never, { threadId: "par", title: "Draft" });
    expect(pendings).toEqual([expect.objectContaining({ requestId: "req-1", threadId: "par", parallelTitle: "Draft" })]);
  });
});

describe("activity detail steps", () => {
  const detail: BotActivityDetail = {
    id: "thread:par", kind: "session", botId: "pepper", title: "Draft the email", status: "running", startedAt: NOW - 60_000, updatedAt: NOW,
    threadId: "par", parallel: true, canStop: true, stepsTruncated: false, files: [], children: [],
    steps: [
      { id: "s0", name: "ToolSearch", at: NOW - 50_000, ok: true },
      { id: "s1", name: "mcp__sagax-environment__read_file", at: NOW - 40_000, ok: true, where: "server", input: "{\"path\":\"a.txt\"}" },
      { id: "s2", name: "Agent", at: NOW - 30_000, subagent: { description: "check the logs", prompt: "Read the logs" } },
      { id: "s3", name: "Bash", at: NOW - 20_000, parentId: "s2", summary: "tail app.log" },
      { id: "s4", name: "mcp__agents__vm_exec", at: NOW - 10_000, ok: true, where: "computer" },
    ],
  };

  it("names each step in words, keeps the raw id for the details and nests a sub-agent's calls", () => {
    expect(humanStepName(detail.steps[0]!)).toBe("Find a tool");
    expect(humanStepName(detail.steps[1]!)).toBe("Read a file");
    expect(humanStepName(detail.steps[2]!)).toBe("Sub-agent: check the logs");
    expect(humanStepName(detail.steps[4]!)).toBe("Run a command");
    const tree = stepTree(detail.steps);
    expect(tree.top.map((step) => step.id)).toEqual(["s0", "s1", "s2", "s4"]);
    expect(tree.children.get("s2")!.map((step) => step.id)).toEqual(["s3"]);
    const html = renderToStaticMarkup(createElement(ActivityDetailBody, {
      item: detail, detail, error: false, now: NOW, onStop: () => {}, onOpenThread: () => {}, onOpenChild: () => {}, onSteer: async () => {},
    }));
    expect(html).toContain('data-activity-detail-status="running"');
    expect(html).toContain("Parallel task");
    expect(html).toContain('data-activity-subagent="s2"');
    expect(html).toContain("Sub-agent: check the logs");
    expect(html).toContain("Read a file");
    // the raw id and arguments wait behind the row's chevron, one per group
    expect(html).toContain('data-activity-step="mcp__sagax-environment__read_file"');
    expect(html).toContain("data-step-row");
    // the running task takes a message
    expect(html).toContain("data-activity-steer");
    expect(html).toContain("Send a message to this task");
  });
});
