// @vitest-environment happy-dom
// #3681, the owner's rule (2026-11-11): an ask that waits is drawn once.
// While the pinned card over the composer holds it, the conversation draws
// no card for it (the bot's words around it stay); once it is settled its
// record is back at its place in the conversation. Mounted through the real
// chat (ChatView: transcript, composer and its pinned card).
import { createElement, type ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const occurrences = (text: string) => (host.textContent ?? "").split(text).length - 1;

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
    expect(transcript().querySelector('[data-mid="q1"]')).toBeNull();
    expect(transcript().querySelector('[data-mid="a1"]')).toBeNull();
    expect(transcript().querySelector('[data-ask-card="pending"]')).toBeNull();
    expect(occurrences(QUESTION)).toBe(1);
    expect(pinned()!.textContent).toContain(QUESTION);
    // both wait: the pinned card steps through them
    expect(pinned()!.textContent).toMatch(/1\s*(of|sur)\s*2/);
    // the bot's own words before and after stay
    expect(transcript().textContent).toContain("Two things before I start.");
    expect(transcript().textContent).toContain("I will wait for you.");
  });

  it("puts the record back at its place once the ask is settled", async () => {
    await render([person, words, question({ answered: "answer", answeredText: "Alerts" }), approval({ answered: "allow" }), after]);
    expect(pinned()).toBeNull();
    expect(transcript().querySelector('[data-mid="q1"]')).not.toBeNull();
    expect(transcript().querySelector('[data-mid="a1"]')).not.toBeNull();
    expect(transcript().querySelector('[data-mid="q1"]')!.textContent).toContain("Alerts");
  });
});
