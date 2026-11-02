// The task sheet's pieces (2026-10-29): the head's words, what waits on the
// person at the top, the grouped steps, the sub-agents with the waiting one
// first, the facts folded.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  visibleMessages: () => [],
  useStore: () => ({
    state: { instances: [], selectedId: "wren", bots: [{ id: "wren", name: "Wren", color: "green", threadId: "main", tasks: [], messages: [] }, { id: "sol", name: "Sol", color: "violet", threadId: "s", tasks: [], messages: [] }], config: null },
    dispatch: vi.fn(),
  }),
}));

import type { BotActivityDetail, BotActivityItem, BotActivityStep } from "../../../shared/bot-activity";
import type { Bot, Message } from "@/state/store";
import { ActivityDetailBody, waitingSources } from "../bot-settings/ActivityDetailModal";
import { ActivityStepGroups } from "./ActivityStepGroups";
import { SubagentList, sortSubagents } from "./SubagentList";
import { TaskStatusHeader, taskStatusWords } from "./TaskStatusHeader";
import { WaitingOnYou, waitingKind } from "./WaitingOnYou";
import { waitingItemsOf } from "@/lib/use-waiting-cards";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const wren = { id: "wren", name: "Wren", color: "green" } as unknown as Bot;
const sol = { id: "sol", name: "Sol", color: "violet" } as unknown as Bot;
const botFor = (id: string) => (id === "wren" ? wren : id === "sol" ? sol : undefined);

const routine = (id: string, ok: boolean | undefined, where: "server" | "computer" = "server"): BotActivityStep => ({
  id, name: "mcp__agents__run_routine_action", at: NOW - MIN, where, summary: "Next routine action", ...(ok === undefined ? {} : { ok }),
});
const children: BotActivityItem[] = [
  { id: "thread:c1", kind: "subagent", botId: "sol", botName: "Sol", title: "Read the latest emails", status: "finished", startedAt: NOW - 12 * MIN, endedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN, threadId: "c1" },
  { id: "thread:c2", kind: "subagent", botId: "sol", botName: "Sol", title: "Draft the follow-ups", status: "waiting", startedAt: NOW - 8 * MIN, updatedAt: NOW - MIN, threadId: "c2", currentStep: "Send an email" },
  { id: "thread:c3", kind: "subagent", botId: "sol", botName: "Sol", title: "Check the open tickets", status: "running", startedAt: NOW - 5 * MIN, updatedAt: NOW, threadId: "c3" },
  { id: "thread:c4", kind: "subagent", botId: "sol", botName: "Sol", title: "Update the sheet", status: "failed", startedAt: NOW - 4 * MIN, endedAt: NOW - 3 * MIN, updatedAt: NOW - 3 * MIN, threadId: "c4" },
];
const detail: BotActivityDetail = {
  id: "thread:t1", kind: "session", botId: "wren", botName: "Wren", title: "Follow up with silent clients", status: "running", startedAt: NOW - 14 * MIN, updatedAt: NOW,
  threadId: "t1", parallel: true, canStop: true, stepsTruncated: true, files: ["clients.csv"], children,
  engine: { instanceId: "claude", model: "claude-opus-5-5" }, via: "subscription",
  steps: [
    { id: "s0", name: "Read", at: NOW - 13 * MIN, ok: true, where: "server", summary: "clients.csv", input: JSON.stringify({ file_path: "clients.csv" }) },
    ...Array.from({ length: 12 }, (_, index) => routine(`r${index}`, true)),
    routine("rf", false, "computer"),
    { id: "rx", name: "Read", at: NOW - 10_000, where: "computer", input: JSON.stringify({ file_path: "relances.md" }) },
  ],
};
const approval: Message = { id: "m-a", role: "bot", kind: "options", at: NOW - MIN, card: { requestId: "req-2", tool: "mcp__mail__send_mail", title: "", subtitle: "To: management@example.test", options: ["Allow", "Deny"] } } as Message;
const question: Message = { id: "m-q", role: "bot", kind: "options", at: NOW - MIN, card: { requestId: "ask-1", title: "Follow up the paused accounts too?", subtitle: "", options: ["Yes", "No"], questionRequest: { id: "ask-1" } } } as unknown as Message;

describe("task status words", () => {
  it("says the state in plain words with the step in flight and the time", () => {
    expect(taskStatusWords({ status: "running", startedAt: NOW - 4 * MIN, now: NOW, step: { key: "readFile", detail: "clients.csv" }, parallel: true }))
      .toEqual(["Parallel task", "Working", "Reading clients.csv", "4m so far"]);
    expect(taskStatusWords({ status: "running", startedAt: NOW - 4 * MIN, now: NOW, step: null, stepLabel: "Run the routine action" })).toEqual(["Working", "Run the routine action", "4m so far"]);
    expect(taskStatusWords({ status: "waiting", startedAt: NOW - 4 * MIN, now: NOW, waitingFor: "approval" })).toEqual(["Waiting for your approval", "4m so far"]);
    expect(taskStatusWords({ status: "waiting", startedAt: NOW - 4 * MIN, now: NOW, waitingFor: "question" })).toEqual(["Waiting for your answer", "4m so far"]);
    expect(taskStatusWords({ status: "finished", startedAt: NOW - 12 * MIN, endedAt: NOW, now: NOW + 9e6 })).toEqual(["Finished", "in 12m"]);
    expect(taskStatusWords({ status: "failed", startedAt: NOW - 3 * MIN, endedAt: NOW, now: NOW, handedBy: "Echo" })).toEqual(["Failed", "from Echo", "in 3m"]);
  });

  it("draws the bot's pill with its mascot, the title and the actions", () => {
    const html = renderToStaticMarkup(createElement(TaskStatusHeader, {
      title: "Follow up", bot: { name: "Wren", color: "green" } as never, status: "running", startedAt: NOW - MIN, now: NOW, stepLabel: "Read a file",
      actions: createElement("button", { type: "button" }, "Stop"),
    }));
    expect(html).toContain('data-task-bot="Wren"');
    expect(html).toContain("data-task-actions");
    expect(html).toContain('data-activity-detail-status="running"');
    expect(html).toContain("thinking-shimmer");
  });
});

describe("what waits on the person", () => {
  it("reads a thread's open approvals and questions, tagged with the sub-agent they come from", () => {
    const items = waitingItemsOf([approval, question], { threadId: "c2", botId: "sol", from: "Draft the follow-ups" });
    expect(items.map((item) => item.kind)).toEqual(["approval", "question"]);
    expect(items[0]).toMatchObject({ from: "Draft the follow-ups", threadId: "c2", pending: { requestId: "req-2", threadId: "c2", parallelTitle: "Draft the follow-ups" } });
    expect(waitingKind(items)).toBe("approval");
    expect(waitingKind(items.slice(1))).toBe("question");
    expect(waitingKind([])).toBeUndefined();
    // the task's own thread: no sub-agent line
    expect(waitingItemsOf([approval], { threadId: "t1", botId: "wren" })[0]).not.toHaveProperty("from");
  });

  it("reads the task's thread while it waits and every waiting sub-agent's", () => {
    expect(waitingSources(detail).map((source) => source.threadId)).toEqual(["c2"]);
    expect(waitingSources({ ...detail, status: "waiting" }).map((source) => source.threadId)).toEqual(["t1", "c2"]);
    expect(waitingSources(null)).toEqual([]);
  });

  it("sits at the head of the sheet with its answers, before the sub-agents and the steps", () => {
    const waiting = waitingItemsOf([approval], { threadId: "c2", botId: "sol", from: "Draft the follow-ups" });
    const html = renderToStaticMarkup(createElement(ActivityDetailBody, {
      item: detail, detail: { ...detail, status: "waiting" }, error: false, now: NOW, onStop: () => {}, onOpenThread: () => {}, onOpenChild: () => {}, bot: wren, botFor, waiting,
    }));
    expect(html).toContain('data-task-waiting="1"');
    expect(html).toContain("Waiting on you");
    expect(html).toContain('data-task-waiting-approvals="1"');
    expect(html).toContain("Draft the follow-ups");
    expect(html.indexOf("data-task-waiting")).toBeLessThan(html.indexOf("data-task-subagents"));
    expect(html.indexOf("data-task-waiting")).toBeLessThan(html.indexOf("data-activity-steps"));
    expect(html).toContain("Waiting for your approval");
  });

  it("falls back on what the server says a waiting run asks, with a way into its conversation", () => {
    const html = renderToStaticMarkup(createElement(ActivityDetailBody, {
      item: detail, detail: { ...detail, status: "waiting", note: "Which account should I use?", children: [] }, error: false, now: NOW, onStop: () => {}, onOpenThread: () => {}, onOpenChild: () => {}, botFor,
    }));
    expect(html).toContain('data-task-waiting-item="note"');
    expect(html).toContain("Which account should I use?");
    expect(html).toContain("data-task-waiting-open");
    expect(html).toContain("Waiting for your answer");
  });

  it("draws a question as its own card", () => {
    const html = renderToStaticMarkup(createElement(WaitingOnYou, {
      items: waitingItemsOf([question], { threadId: "t1", botId: "wren" }), threadId: "t1", botFor, onCancel: () => {},
    }));
    expect(html).toContain('data-task-waiting-item="question"');
    expect(html).toContain("Follow up the paused accounts too?");
  });
});

describe("grouped steps", () => {
  it("folds the repeated step into one row with a count, keeps the failure red and marks the place once", () => {
    const html = renderToStaticMarkup(createElement(ActivityStepGroups, { steps: detail.steps, truncated: true }));
    expect(html.match(/data-activity-step-group=/g)).toHaveLength(4);
    expect(html).toContain('data-activity-step-count="12"');
    expect(html).toContain("×12");
    expect(html.match(/data-activity-step-phase="failed"/g)).toHaveLength(1);
    expect(html.match(/data-activity-step-phase="running"/g)).toHaveLength(1);
    expect(html).toContain("text-danger/90");
    expect(html).toContain("thinking-shimmer");
    // the place: once at the start, once when it changes
    expect(html.match(/data-activity-where="server"/g)).toHaveLength(1);
    expect(html.match(/data-activity-where="computer"/g)).toHaveLength(1);
    expect(html).toContain("Older steps are in the conversation.");
    // one chevron per group, the technical detail closed
    expect(html).not.toContain("data-activity-technical");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
  });

  it("folds finished tool searches like ActivityRun and shortens runCommand targets", () => {
    const bot = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const full = `ls /data/.sagax/bots/${bot}/sagax-plugins`;
    const steps: BotActivityStep[] = [
      { id: "s1", name: "search_tool", at: NOW, ok: true, input: JSON.stringify({ query: "perspicax" }) },
      { id: "u1", name: "use_tool", at: NOW, ok: true, input: JSON.stringify({ tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }) },
      { id: "s2", name: "search_tool", at: NOW, ok: true, input: JSON.stringify({ query: "remote" }) },
      { id: "u2", name: "use_tool", at: NOW, ok: true, input: JSON.stringify({ tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }) },
      { id: "b1", name: "Bash", at: NOW, ok: true, where: "server", input: JSON.stringify({ command: full }), summary: full },
    ];
    const html = renderToStaticMarkup(createElement(ActivityStepGroups, { steps }));
    expect(html).toContain("Looked for a tool");
    expect(html).toContain('data-activity-step-count="2"');
    expect(html).toContain("Viewed tickets in Acme Desk");
    expect(html).toContain('data-step-target="true"');
    expect(html).toMatch(/data-step-target[^>]*>ls sagax-plugins</);
    // UUID and server path stay in the tooltip only (title=), never as the visible target
    expect(html).toContain(`title="${full}"`);
    const withoutTitles = html.replace(/\stitle="[^"]*"/g, "");
    expect(withoutTitles).not.toContain(bot);
    expect(withoutTitles).not.toContain("/data/.sagax");
  });
});

describe("sub-agents", () => {
  it("lists the waiting one first, then the running, then the settled, each with its bot", () => {
    expect(sortSubagents(children).map((item) => item.id)).toEqual(["thread:c2", "thread:c3", "thread:c4", "thread:c1"]);
    const html = renderToStaticMarkup(createElement(SubagentList, { items: children, now: NOW, botFor, onOpen: () => {} }));
    expect(html).toContain('data-task-subagents="4"');
    expect(html.indexOf('data-subagent="thread:c2"')).toBeLessThan(html.indexOf('data-subagent="thread:c3"'));
    const waiting = html.slice(html.indexOf('data-subagent="thread:c2"'), html.indexOf('data-subagent="thread:c3"'));
    expect(waiting).toContain("Waiting on you");
    expect(waiting).toContain("Send an email");
    expect(waiting).toContain("8m");
    expect(html).toContain("Sol");
  });
});
