// @vitest-environment happy-dom
// #3214: the card pinned over the composer with what the bot waits on. It
// stays while the transcript scrolls, leaves once the question is answered,
// steps "1 of N" through several, folds to one line that still names what
// waits, and jumps to the original message in the conversation.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import type { Pending } from "../PendingApproval";
import { PinnedWaitingCard, pinnedItemText, usePinnedWaiting } from "./PinnedWaitingCard";
import { pendingRequests, type PersonRequest, type TopicPending } from "@/lib/pending-question";
import { topicPending } from "@/lib/use-topic-pending";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { BotEditorStore, initialState } = await import("@/state/store");

const dispatched: unknown[] = [];
const bot = { id: "orla", name: "Orla", color: "violet", threadId: "main", messages: [], tasks: [] } as unknown as Bot;

function ask(id: string, at: number, question: string, options: string[] = ["Yes", "No"], more: Record<string, unknown> = {}): Message {
  return {
    id, role: "bot", kind: "options", at, text: "", from: { botId: "orla", name: "Orla", color: "violet" },
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions: [{ question, options: options.map((label) => ({ label })) }] }, ...more },
  } as unknown as Message;
}

function approval(id: string, at: number): Pending {
  const message = { id, role: "bot", kind: "options", at, text: "", card: { requestId: `req-${id}`, tool: "Bash", title: "Run a command", subtitle: "ls ~", toolInput: JSON.stringify({ command: "ls ~" }), options: ["Allow", "Deny"] } } as unknown as Message;
  return { message, requestId: `req-${id}`, tool: "Bash", detail: "ls ~" };
}

let root: Root | null = null;
let host: HTMLDivElement;
let snapshot: { current?: ReturnType<typeof usePinnedWaiting> } = {};

/** a room: the composer passes no conversation bot, each item names its own */
interface Room { member: Bot }

function Harness({ approvals, questions, requests = [], topics = [], room }: { approvals: Pending[]; questions: Message[]; requests?: PersonRequest[]; topics?: TopicPending[]; room?: Room }) {
  const pinned = usePinnedWaiting(approvals, questions, requests, topics);
  snapshot.current = pinned;
  const asker = room?.member ?? bot;
  return createElement(PinnedWaitingCard, {
    pinned, threadId: "main", bot: room ? undefined : bot, botFor: () => asker, nameFor: () => asker.name, onCancelTurn: () => dispatched.push({ type: "cancel" }),
  });
}

async function render(approvals: Pending[], questions: Message[], requests: PersonRequest[] = [], topics: TopicPending[] = [], room?: Room) {
  const value = { state: { ...initialState, bots: room ? [bot, room.member] : [bot], instances: [] }, dispatch: (action: unknown) => dispatched.push(action), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const tree: ReactNode = createElement(BotEditorStore, { value: value as never, children: createElement(Harness, { approvals, questions, requests, topics, room }) });
  await act(async () => { root!.render(tree); });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}

const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
const card = () => host.querySelector<HTMLElement>("[data-pinned-waiting]");

beforeEach(async () => {
  await loadLocale("en");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
  dispatched.length = 0;
  snapshot = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the pinned waiting card (#3214)", () => {
  it("draws the open question, names who waits, and stays while the transcript scrolls", async () => {
    await render([], [ask("q1", 1, "Do I pause the two webhooks?")]);
    expect(card()?.getAttribute("data-pinned-waiting")).toBe("open");
    expect(host.querySelector("[data-pinned-title]")?.textContent).toBe("Orla is waiting for your answer");
    expect(host.querySelector('[data-ask-card="pending"]')).not.toBeNull();
    expect(host.textContent).toContain("Do I pause the two webhooks?");
    // the two options, plus the sheet's own "something else" choice
    expect(host.querySelectorAll("[data-ask-choice]").length).toBeGreaterThanOrEqual(2);
    // one item: no "1 of N" stepper
    expect(host.querySelector("[data-approval-stepper]")).toBeNull();
    // a scroll of the page changes nothing: the card is anchored to the composer
    await act(async () => { window.dispatchEvent(new Event("scroll")); document.body.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(card()).not.toBeNull();
  });

  it("leaves once the question is answered, and comes back for the next one", async () => {
    const q1 = ask("q1", 1, "First?");
    await render([], [q1]);
    expect(card()).not.toBeNull();
    const answered = { ...q1, card: { ...q1.card, answered: "answer", answeredText: "Yes" } } as Message;
    // the composer session recomputes the open questions from the store;
    // an answered card is no longer one of them
    await render([], []);
    expect(card()).toBeNull();
    expect(host.querySelector("[data-ask-card]")).toBeNull();
    void answered;
    await render([], [ask("q2", 2, "Second?")]);
    expect(host.textContent).toContain("Second?");
  });

  it("picks an option through the same QuestionCard path as the transcript's card", async () => {
    await render([], [ask("q1", 1, "Pause them?", ["Pause", "Keep"])]);
    const choice = host.querySelector<HTMLButtonElement>("[data-ask-choice]")!;
    await act(async () => { choice.click(); });
    await flush();
    const decided = dispatched.find((action) => (action as { type?: string }).type === "decideRequest") as { requestId: string; behavior: string; message?: string } | undefined;
    expect(decided?.requestId).toBe("req-q1");
    expect(decided?.behavior).toBe("answer");
    expect(decided?.message).toContain("Pause");
  });

  it("steps through two pending items, oldest first, and advances when one drops out", async () => {
    const q1 = ask("q1", 1, "First question?");
    const q2 = ask("q2", 2, "Second question?");
    await render([], [q1, q2]);
    const stepper = host.querySelector("[data-approval-stepper]");
    expect(stepper?.textContent).toContain("1 of 2");
    expect(host.textContent).toContain("First question?");
    expect(host.textContent).not.toContain("Second question?");
    const next = host.querySelector<HTMLButtonElement>('[data-approval-stepper] button[aria-label="Next request"]')!;
    await act(async () => { next.click(); });
    expect(host.querySelector("[data-approval-stepper]")?.textContent).toContain("2 of 2");
    expect(host.textContent).toContain("Second question?");
    // the first one is answered (by someone else, say): the second is now alone, still shown
    await render([], [q2]);
    expect(host.querySelector("[data-approval-stepper]")).toBeNull();
    expect(host.textContent).toContain("Second question?");
    // and the other way round: the one shown drops out, the next moves up
    await render([], [q1, q2]);
    await render([], [q1]);
    expect(host.textContent).toContain("First question?");
  });

  it("holds an approval and a question together, the approval with its own buttons", async () => {
    await render([approval("a1", 1)], [ask("q1", 2, "After that?")]);
    expect(host.querySelector("[data-approval-stepper]")?.textContent).toContain("1 of 2");
    expect(host.querySelector('[data-pinned-body="approval"]')).not.toBeNull();
    expect(host.textContent).toMatch(/Allow/);
    expect(host.textContent).toMatch(/Deny/);
  });

  it("#3414: draws an approval as one compact card, the bot named once and the raw detail folded", async () => {
    // a background turn's card (proactive wake, bot-to-bot conversation):
    // it carries who asked, here the same bot the title names
    const base = approval("a1", 1);
    const pending: Pending = {
      ...base,
      message: { ...base.message, from: { botId: "orla", name: "Orla", color: "violet" }, card: { ...base.message.card!, allowSession: true } } as Message,
      allowSession: true,
      threadId: "work",
      askedBy: "Orla",
    };
    await render([pending], []);
    const shown = card()!;
    // no header bar of its own: the card's title is the ask
    expect(host.querySelector("[data-pinned-title]")).toBeNull();
    expect(shown.textContent?.match(/Orla/g)?.length).toBe(1);
    expect(shown.textContent).toMatch(/Orla wants to/);
    // what runs reads on the card; the raw arguments stay behind the folded Details
    expect(shown.textContent).toContain("ls ~");
    expect(shown.textContent).not.toContain('"command"');
    const details = Array.from(shown.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Details")!;
    expect(details.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { details.click(); });
    expect(shown.textContent).toContain('"command"');
    // the three answers, Always allow included, on the shared ask controls
    const answers = Array.from(shown.querySelectorAll("[data-approval-actions] button")).map((button) => button.textContent);
    expect(answers).toEqual(["Deny", "Always allow", "Allow once"]);
    // the risk mark is a quiet word, never a filled pill
    expect(shown.querySelector("[data-risk]")?.className).not.toMatch(/\bborder\b|bg-/);
  });

  it("#3414: says another bot asked when an unnamed bot opened the conversation, even with the title's bot known", async () => {
    // parallel-approvals: askedBy "" is a conversation an unnamed bot
    // opened. The pinned card always knows its bot, and the line still shows.
    const pending: Pending = { ...approval("a2", 1), threadId: "work", askedBy: "" };
    await render([pending], []);
    expect(card()?.textContent).toContain("Asked by another bot");
  });

  it("#3414: names the member bot over a room's composer when a proposal's title does not", async () => {
    // a skill proposal's title ("Enable this learned skill") never names
    // the bot; in a room the composer has no bot of its own, so the card
    // must still say which member asks
    const quasar = { ...bot, id: "quasar", name: "Quasar" } as Bot;
    const message = {
      id: "s1", role: "bot", kind: "options", at: 1, text: "", from: { botId: "quasar", name: "Quasar", color: "teal" },
      card: {
        title: 'Enable skill "task-abort"?', subtitle: "Stop a task cleanly.", options: ["Enable", "Deny"], requestId: "skill-s1", tool: "stage_skill",
        ownerRule: { tool: "sagax:skill", scope: { action: "create", source: "review" }, description: "Keep the skills this bot learns from its conversations" },
        skillRequest: { version: 1, requestId: "skill-s1", botId: "quasar", threadId: "main", stagedId: "staged-s1", action: "create", name: "task-abort", gist: "Stop a task cleanly.", source: "learn:review", warnings: [], createdAt: 1 },
      },
    } as unknown as Message;
    const pending: Pending = { message, requestId: "skill-s1", tool: "stage_skill", detail: "Stop a task cleanly." };
    await render([pending], [], [], [], { member: quasar });
    const shown = card()!;
    expect(shown.querySelector('[data-pinned-body="approval"]')).not.toBeNull();
    expect(shown.textContent).toContain("Enable this learned skill");
    expect(shown.querySelector("[data-approval-asker]")?.textContent).toBe("Asked by Quasar");
    // the answers, Always allow included, are still all there
    expect(shown.querySelector("[data-always-allow]")).not.toBeNull();
    // a tool approval whose title already names the bot adds no second line
    await render([approval("a3", 2)], [], [], [], { member: quasar });
    expect(card()?.textContent).toMatch(/Quasar wants to/);
    expect(card()?.querySelector("[data-approval-asker]")).toBeNull();
  });

  it("folds to one line that still names who waits and for what, and never hides", async () => {
    await render([], [ask("q1", 1, "Do I pause the two webhooks for the migration tonight, or keep them running until Friday?")]);
    const fold = host.querySelector<HTMLButtonElement>("[data-pinned-fold]")!;
    await act(async () => { fold.click(); });
    expect(card()?.getAttribute("data-pinned-waiting")).toBe("collapsed");
    const line = host.querySelector("[data-pinned-folded-line]")!;
    expect(line.textContent).toContain("Orla is waiting for your answer: Do I pause the two webhooks");
    expect(line.textContent?.endsWith("…")).toBe(true);
    expect(host.querySelector("[data-ask-choice]")).toBeNull();
    await act(async () => { (line as HTMLButtonElement).click(); });
    expect(card()?.getAttribute("data-pinned-waiting")).toBe("open");
  });

  it("jumps to the original message in the conversation", async () => {
    await render([], [ask("q1", 1, "Jump?")]);
    const jump = host.querySelector<HTMLButtonElement>("[data-pinned-jump]")!;
    expect(jump.textContent).toBe("See in the conversation");
    await act(async () => { jump.click(); });
    expect(dispatched).toContainEqual({ type: "focusMessage", threadId: "main", messageId: "q1" });
  });

  it("reads in the conversation's language", async () => {
    await loadLocale("fr");
    await render([], [ask("q1", 1, "On y va ?")]);
    expect(host.querySelector("[data-pinned-title]")?.textContent).toBe("Orla attend ta réponse");
    expect(host.querySelector("[data-pinned-jump]")?.textContent).toBe("Voir dans la conversation");
  });

  it("shortens the folded text and prefers the question's words", () => {
    const short = pinnedItemText({ kind: "question", key: "k", at: 1, message: ask("q", 1, "Short?") });
    expect(short).toBe("Short?");
    const long = pinnedItemText({ kind: "question", key: "k", at: 1, message: ask("q", 1, "x".repeat(200)) });
    expect(long.length).toBeLessThanOrEqual(72);
    expect(long.endsWith("…")).toBe(true);
    expect(pinnedItemText({ kind: "approval", key: "k", at: 1, pending: approval("a", 1) })).toBe("Run a command");
  });
});

// #3438: an input request from handed-over work and a choice question of an
// earlier topic of the one conversation are pinned too, and leave once answered.
describe("the pinned card holds every kind and every topic (#3438)", () => {
  const inputRequest = (id: string, at: number, more: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "activity", text: "", tool: { name: "Kiro needs your input: Which site first?", ok: true }, from: { botId: "orla", name: "Orla", color: "violet" },
      inputRequest: { botId: "orla", threadId: "work-1", botName: "Orla", title: "Teammate work", question: "Which site first?", ...more } }) as unknown as Message;

  it("pins an input request from handed-over work as the standard card, and sends the answer to the waiting work", async () => {
    await render([], [], pendingRequests([inputRequest("ir", 5)]));
    expect(card()?.getAttribute("data-pinned-waiting")).toBe("open");
    const body = host.querySelector("[data-pinned-body=request]")!;
    expect(body.textContent).toContain("Which site first?");
    // the standard card (QuestionSheet), never the plain box
    expect(body.querySelector("[data-question-sheet]")).not.toBeNull();
    expect(body.querySelector("textarea")?.closest("[data-question-sheet]")).not.toBeNull();
    const field = body.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "North first");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const sent = calls.find(([url]) => String(url).includes("/api/bots/orla/messages"));
    expect(sent).toBeDefined();
    expect(JSON.parse(String(sent![1].body))).toMatchObject({ text: "North first", threadId: "work-1" });
    // the server marks it answered: it leaves
    await render([], [], pendingRequests([inputRequest("ir", 5, { answered: true })]));
    expect(card()).toBeNull();
  });

  it("pins a choice question asked two days ago in an earlier topic, oldest first, and jumps to it there", async () => {
    const old = ask("old-q", 1, "Keep both copies?");
    await render([], [], pendingRequests([inputRequest("ir", 2 * 86_400_000)]), [{ threadId: "topic-1", questions: [old], requests: [] }]);
    expect(host.textContent).toContain("1 of 2");
    expect(host.querySelector("[data-pinned-body=question]")?.textContent).toContain("Keep both copies?");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-pinned-jump]")!.click(); });
    expect(dispatched).toContainEqual({ type: "focusMessage", threadId: "topic-1", messageId: "old-q" });
    // answered there: the topic no longer holds it, the input request moves up
    await render([], [], pendingRequests([inputRequest("ir", 2 * 86_400_000)]), [{ threadId: "topic-1", questions: [], requests: [] }]);
    expect(host.textContent).not.toContain("1 of 2");
    expect(host.querySelector("[data-pinned-body=request]")).not.toBeNull();
  });

  // the server counts a live approval card of an earlier topic as "Waiting
  // for you": it is pinned with the rest, oldest first, decided in its own
  // topic, and leaves once decided
  it("pins an approval asked in an earlier topic, decides it there, and drops it once decided", async () => {
    const DAY = 86_400_000;
    const old = approval("old-ap", 1 * DAY).message;
    const topic = (card: Record<string, unknown> = {}) =>
      topicPending("topic-1", { messages: [{ ...old, card: { ...old.card!, ...card } } as Message], activeLeafId: null, loaded: true });
    expect(topic().approvals?.map((pending) => pending.threadId)).toEqual(["topic-1"]);
    await render([], [ask("now-q", 2 * DAY, "And now?")], [], [topic()]);
    expect(host.querySelector("[data-approval-stepper]")?.textContent).toContain("1 of 2");
    expect(host.querySelector('[data-pinned-body="approval"]')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-pinned-jump]")!.click(); });
    expect(dispatched).toContainEqual({ type: "focusMessage", threadId: "topic-1", messageId: "old-ap" });
    const allow = [...host.querySelectorAll<HTMLButtonElement>('[data-pinned-body="approval"] button')].find((button) => button.textContent?.trim() === "Allow once" || button.textContent?.trim() === "Allow")!;
    await act(async () => { allow.click(); });
    await flush();
    expect(dispatched).toContainEqual(expect.objectContaining({ type: "decideRequest", threadId: "topic-1", requestId: "req-old-ap", behavior: "allow" }));
    // decided there: the topic no longer holds it, the question moves up
    await render([], [ask("now-q", 2 * DAY, "And now?")], [], [topic({ answered: "allow" })]);
    expect(host.querySelector("[data-approval-stepper]")).toBeNull();
    expect(host.querySelector('[data-pinned-body="question"]')?.textContent).toContain("And now?");
  });

  it("marks a hand-off's card handled against the bot that owns the conversation, not the bot whose work asks", async () => {
    const handoff = { id: "handoff", at: 5, role: "bot", kind: "text", text: "Kiro has a question for you", from: { botId: "kiro", name: "Kiro" },
      attention: { kind: "question", botId: "kiro", botName: "Kiro", threadId: "work-kiro", sourceMessageId: "src", items: [{ text: "Which site first?" }] } } as unknown as Message;
    await render([], [], pendingRequests([handoff]));
    const field = host.querySelector<HTMLTextAreaElement>("[data-pinned-body=request] textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "North first");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const sent = calls.find(([url]) => String(url).includes("/api/bots/kiro/messages"));
    expect(JSON.parse(String(sent![1].body))).toMatchObject({ text: "North first", threadId: "work-kiro" });
    const handled = calls.find(([url]) => String(url).includes("/api/approvals/handled"));
    expect(JSON.parse(String(handled![1].body))).toEqual({ botId: "orla", threadId: "main", messageId: "handoff" });
  });
});
