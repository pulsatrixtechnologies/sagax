// @vitest-environment happy-dom
// #3681, the owner's rule (2026-11-11): an ask that waits is drawn once.
// While the pinned card over the composer holds it, the conversation draws
// its compact history line (the surrounding words stay); once it is settled its
// record is back at its place in the conversation. Mounted through the real
// chat (ChatView: transcript, composer and its pinned card).
import { createElement, type ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createAgentCard, type AgentCardStore } from "../../server/widgets/chat-widgets";
import { ASK_CHOICE_TOOL, WATCHER_OPTIONS_CARD_BOT_ID } from "../../shared/options-card";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWidgetInput } from "../../shared/widget";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), waiting: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true, useThreadsMode: () => "header" as "one" | "header" | "sidebar",
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./SidebarPopoverMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("./SidebarPopoverMenu")>(),
  SidebarPopoverMenu: (props: { renderTrigger: (state: { open: boolean }) => unknown }) => props.renderTrigger({ open: false }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span"),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (_props: ComponentProps<typeof ApprovalModeSelector>) => createElement("span") }));

const { ChatView } = await import("./ChatView");

const QUESTION = "Which webhooks should I pause?";
const bot: Bot = {
  id: "bot", threadId: "main", name: "Atlas", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "main", title: "Main", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" }],
};
const from = { botId: "bot", name: "Atlas", color: "green" as const };
const person: Message = { id: "person", role: "user", kind: "text", at: 1_000, text: "Clean up the integrations" };
const words: Message = { id: "words", role: "bot", kind: "text", at: 2_000, text: "Two things before I start.", from };
const question = (card: Record<string, unknown> = {}): Message => ({
  id: "q1", role: "bot", kind: "options", at: 3_000, text: "", from,
  card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
    questionRequest: { version: 1, questions: [{ question: QUESTION, options: ["Billing", "Alerts", "Tickets", "All of them"].map((label) => ({ label })) }] }, ...card },
} as unknown as Message);
const approval = (card: Record<string, unknown> = {}): Message => ({
  id: "a1", role: "bot", kind: "options", at: 4_000, text: "", from,
  card: { title: "Run a command", subtitle: "ls ~", options: ["Allow", "Deny"], requestId: "req-a1", tool: "Bash", toolInput: JSON.stringify({ command: "ls ~" }), ...card },
} as unknown as Message);
const after: Message = { id: "after", role: "bot", kind: "text", at: 5_000, text: "I will wait for you.", from };

/** The server's own list (GET /api/approvals?waiting=1) for the open asks. */
function served(messages: Message[]) {
  return messages.filter((message) => message.card?.requestId && !message.card.answered && !message.card.expired).map((message) => ({
    id: message.card!.requestId, kind: message.card!.questionRequest ? "question" : "approval", botId: "bot", botName: "Atlas",
    threadId: "main", messageId: message.id, at: message.at, ageMs: 0, title: "", text: "", options: [],
    answerWith: "option", freeText: false, skippable: true, message,
  }));
}

let host: HTMLDivElement;
let root: Root;
async function render(messages: Message[]) {
  fixture.waiting = served(messages);
  await act(async () => { root.render(createElement(ChatView, { bot: { ...bot, messages } })); });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}
const transcript = () => host.querySelector('[role="log"]')!;
const pinned = () => host.querySelector("[data-pinned-waiting]");

beforeEach(() => {
  fixture.dispatch.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
    JSON.stringify(String(url).includes("/api/approvals?waiting=1") ? { waiting: fixture.waiting } : {}),
    { status: 200, headers: { "content-type": "application/json" } },
  )));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("an ask that waits is drawn once (#3681)", () => {
  it("draws a waiting question and a waiting approval on the pinned card only, the bot's words staying in the conversation", async () => {
    await render([person, words, question(), approval(), after]);
    expect(pinned()).not.toBeNull();
    // one card each: none in the conversation
    expect(transcript().querySelector('[data-mid="q1"] [data-waiting-history]')).not.toBeNull();
    expect(transcript().querySelector('[data-mid="a1"] [data-waiting-history]')).not.toBeNull();
    expect(transcript().querySelector('[data-ask-card="pending"]')).toBeNull();
    expect(pinned()!.textContent).toContain(QUESTION);
    // both wait: the pinned card steps through them
    expect(pinned()!.textContent).toMatch(/1\s*(of|sur)\s*2/);
    // the bot's own words before and after stay
    expect(transcript().textContent).toContain("Two things before I start.");
    expect(transcript().textContent).toContain("I will wait for you.");
  });

  it("pages three unanswered chat choices above the composer", async () => {
    const tickets: Message[] = [];
    const store: AgentCardStore = {
      groupByThread: () => undefined,
      messagesFor: () => [],
      patchMessage: () => null,
      appendMessage: (_thread, row) => {
        const ticket = 101 + tickets.length;
        const saved = { ...row, id: `ticket-${ticket}`, at: ticket };
        tickets.push(saved as Message);
        return saved;
      },
    };
    for (const ticket of [101, 102, 103]) {
      const legacy = ticket === 103;
      const result = createAgentCard({ store, threadId: bot.threadId, bot: { id: WATCHER_OPTIONS_CARD_BOT_ID, name: bot.name, color: "green" },
        input: { ...(legacy ? {} : { tool: ASK_CHOICE_TOOL, question: "What should I do?" }), title: `Unscheduled ticket #${ticket}`,
          subtitle: "What should I do?", options: ["I'll handle it", "Remind me tomorrow"] } });
      expect(result.ok).toBe(true);
    }
    await render(tickets);
    expect(transcript().querySelectorAll("[data-waiting-history]")).toHaveLength(3);
    expect(transcript().querySelectorAll('[data-ask-card="pending"]')).toHaveLength(0);
    expect(host.querySelectorAll("[data-pinned-waiting]")).toHaveLength(1);
    expect(pinned()!.textContent).toMatch(/1\s*(of|sur)\s*3/);
    const next = pinned()!.querySelectorAll<HTMLButtonElement>("[data-approval-stepper] button")[1]!;
    await act(async () => next.click());
    expect(pinned()!.textContent).toContain("Unscheduled ticket #102");
    await act(async () => pinned()!.querySelector<HTMLButtonElement>("[data-ask-choice]")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "answerCard", botId: bot.id, threadId: "main", messageId: "ticket-102" }));
    await act(async () => pinned()!.querySelector<HTMLButtonElement>("[data-card-skip]")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "dismissCard", botId: bot.id, threadId: "main", messageId: "ticket-102" }));
    await render([tickets[0]!, { ...tickets[1]!, card: { ...tickets[1]!.card!, answered: "I'll handle it" } }, tickets[2]!, person]);
    expect(pinned()!.textContent).toContain("Unscheduled ticket #101");
    expect(pinned()!.querySelector("[data-approval-stepper]")).toBeNull();
  });

  it("bounds a long open ask so the transcript above it stays reachable (M-20261119-007)", async () => {
    // a flat chat choice whose words are long: the pinned card holds them,
    // opened with "Show less", and the dock floats over the transcript, so
    // an unbounded card covers the whole chat and nothing scrolls
    const report = Array.from({ length: 60 }, (_, index) => `Line ${index} of the status report.`).join("\n");
    const flat: Message = {
      id: "flat1", role: "bot", kind: "options", at: 3_000, text: "", from,
      card: { title: "Status report", subtitle: report, options: ["Continue", "Stop here"], requestId: "req-flat1", requestType: "question" },
    } as unknown as Message;
    await render([person, words, flat]);
    const card = pinned()!;
    expect(card.textContent).toContain("Line 59");
    const classes = card.className.split(/\s+/);
    expect(classes.some((name) => name.startsWith("max-h-"))).toBe(true);
    expect(classes).toContain("overflow-y-auto");
    expect(classes).not.toContain("overflow-hidden");
  });

  it("draws a routine's checklist form (checkbox rows, two actions) on the pinned card only", async () => {
    const drafts = ["Reply to @alice", "Reply to @bob", "Post: shipping notes", "Post: weekly recap", "Reply to @carol", "Post: tips"];
    const form: Message = {
      id: "form1", role: "bot", kind: "options", at: 3_000, text: "", from,
      card: { title: "Tonight on @handle", subtitle: "Six drafts are ready.", options: [], requestId: "req-form1", requestType: "question", noHold: true, askKey: "routine:x-drafts",
        questionRequest: { version: 1, questions: [{ question: "Six drafts are ready.", kind: "multi", multiSelect: true, options: drafts.map((label) => ({ label, description: `Draft: ${label}` })), checked: drafts, actions: ["Post selected", "Skip tonight"] }] } },
    } as unknown as Message;
    await render([person, words, form, after]);
    expect(pinned()).not.toBeNull();
    const row = transcript().querySelector('[data-mid="form1"]')!;
    expect(row.querySelector("[data-waiting-history]")).not.toBeNull();
    // never a second interactive copy: no checkbox, no action button, no rows
    expect(row.querySelectorAll('input[type="checkbox"], [role="checkbox"], button')).toHaveLength(0);
    expect(row.textContent).not.toContain("Reply to @alice");
    expect(row.textContent).not.toContain("Skip tonight");
    expect(transcript().querySelector('[data-ask-card="pending"]')).toBeNull();
    expect(pinned()!.textContent).toContain("Skip tonight");
  });

  it("draws a routine run's widget form (title, subtitle, checkboxes, two actions) on the pinned card only, a compact line at the run's row", async () => {
    const drafts = ["Reply to @alice", "Reply to @bob", "Post: shipping notes", "Post: weekly recap", "Reply to @carol", "Post: tips"];
    const tree = parseWidgetInput({
      type: "Card", title: "Tonight on @handle", caption: "Six drafts are ready.",
      children: drafts.map((label, index) => ({ type: "Checkbox", name: `d${index}`, label, defaultChecked: true })),
      confirm: { label: "Post selected", action: { type: "drafts.post" } },
      cancel: { label: "Skip tonight", action: { type: "drafts.skip" } },
    });
    if (!tree.ok) throw new Error(tree.error);
    const widget = { id: "w1", role: "bot", kind: "widget", at: 3_000, text: "Tonight on @handle", from, widget: { v: 1, root: tree.value } } as unknown as Message;
    const run = { id: "run1", role: "bot", kind: "routine.run", at: 3_001, text: "X daily post and reply drafts", from,
      routineRun: { v: 1, runId: "r1", routineId: "rt1", routineName: "X daily post and reply drafts", status: "completed", startedAt: 2_900, summary: "Six drafts are ready.", widgetId: "w1" } } as unknown as Message;
    fixture.waiting = [{ id: "form:w1", kind: "form", botId: "bot", botName: "Atlas", threadId: "main", messageId: "w1", at: 3_000, ageMs: 0, title: "Tonight on @handle", text: "Tonight on @handle",
      options: [], answerWith: "text", freeText: true, skippable: true, message: widget }];
    await act(async () => { root.render(createElement(ChatView, { bot: { ...bot, messages: [person, widget, run, after] } })); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(pinned()).not.toBeNull();
    expect(pinned()!.textContent).toContain("Skip tonight");
    const log = transcript();
    // never a second interactive copy in the conversation
    expect(log.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).toHaveLength(0);
    expect(log.textContent).not.toContain("Reply to @alice");
    expect(log.textContent).not.toContain("Skip tonight");
    expect(log.querySelector("[data-routine-run-widget] [data-waiting-history]")).not.toBeNull();
  });

  it("puts the record back at its place once the ask is settled", async () => {
    await render([person, words, question({ answered: "answer", answeredText: "Alerts" }), approval({ answered: "allow" }), after]);
    expect(pinned()).toBeNull();
    expect(transcript().querySelector('[data-mid="q1"]')).not.toBeNull();
    expect(transcript().querySelector('[data-mid="a1"]')).not.toBeNull();
    expect(transcript().querySelector('[data-mid="q1"]')!.textContent).toContain("Alerts");
  });
});
