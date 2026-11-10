// @vitest-environment happy-dom
// #3471: every card that waits for the person has one quiet skip at the end
// of its top row, in the conversation: a choice question, a free-text
// question, a question in words (a hand-off's or a routine run's), a
// proposal. A skip is never a deny; the card folds into one quiet line, and
// an expired card says so the same way.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import type { PersonAttentionCard } from "../../shared/person-attention";
import { AttentionCard } from "./AttentionCard";
import { OptionCard } from "./OptionCard";
import { QuestionCard } from "./QuestionCard";
import { ProactiveChoiceCard } from "./ProactiveChoiceCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { BotEditorStore, initialState } = await import("@/state/store");

const dispatched: Array<Record<string, unknown>> = [];
const bot = { id: "orla", name: "Orla", color: "violet", threadId: "main", messages: [], tasks: [] } as unknown as Bot;

let root: Root | null = null;
let host: HTMLDivElement;

async function render(child: ReactNode) {
  const value = { state: { ...initialState, bots: [bot], instances: [] }, dispatch: (action: Record<string, unknown>) => dispatched.push(action), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  await act(async () => { root!.render(createElement(BotEditorStore, { value: value as never, children: child })); });
}

const skipButton = () => host.querySelector<HTMLButtonElement>("[data-card-skip]");

function question(card: Record<string, unknown> = {}, options: string[] = ["North", "South"]): Message {
  return {
    id: "q1", role: "bot", kind: "options", at: 1, text: "",
    card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which site first?", options: options.map((label) => ({ label })) }] }, ...card },
  } as unknown as Message;
}

function routineCard(extra: Partial<PersonAttentionCard> = {}): PersonAttentionCard {
  return { kind: "question", botId: "orla", botName: "Orla", threadId: "run-1", sourceMessageId: "s1", routineName: "Morning check", items: [{ text: "Close the ticket?" }], ...extra };
}

beforeEach(async () => {
  await loadLocale("en");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
  dispatched.length = 0;
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

describe("a choice question and a free-text question (#3471)", () => {
  it.each([["a choice question", ["North", "South"]], ["a free-text question", []]] as const)("%s has the skip, and a skip is never a deny", async (_name, options) => {
    await render(createElement(QuestionCard, { threadId: "main", bot, message: question({}, [...options]) }));
    expect(skipButton()?.getAttribute("aria-label")).toBe("Skip this without answering");
    await act(async () => { skipButton()!.click(); });
    expect(dispatched).toContainEqual({ type: "skipCard", threadId: "main", requestId: "req-q1" });
    expect(dispatched.some((action) => action.type === "decideRequest")).toBe(false);
    // folded into one quiet line at once
    expect(host.textContent).toContain("Skipped, no answer");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("an expired question folds the same way", async () => {
    await render(createElement(QuestionCard, { threadId: "main", bot, message: question({ expired: true }) }));
    expect(host.textContent).toContain("Expired, no answer");
    expect(skipButton()).toBeNull();
  });

  it("a plain option card of a live ask skips through the same action", async () => {
    const message = { id: "o1", role: "bot", kind: "options", at: 1, text: "", card: { title: "Pick one", subtitle: "", options: ["A", "B"], requestId: "req-o1", requestType: "question" } } as unknown as Message;
    await render(createElement(OptionCard, { botId: "orla", threadId: "main", message }));
    await act(async () => { skipButton()!.click(); });
    expect(dispatched).toContainEqual({ type: "skipCard", threadId: "main", requestId: "req-o1", tool: false });
    expect(dispatched.some((action) => action.type === "dismissCard")).toBe(false);
  });
});

describe("a question in words a routine run or a hand-off left (#3471)", () => {
  it("has the skip next to its answer box and folds once skipped", async () => {
    const onSkip = vi.fn(async () => undefined);
    await render(createElement(AttentionCard, { card: routineCard(), onReply: async () => undefined, onSkip }));
    expect(host.querySelector("textarea")).not.toBeNull();
    await act(async () => { skipButton()!.click(); });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Skipped, no answer");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("an expired one says so", async () => {
    await render(createElement(AttentionCard, { card: routineCard({ handledAt: 2, closed: "expired" }), onReply: async () => undefined, onSkip: async () => undefined }));
    expect(host.textContent).toContain("Expired, no answer");
    expect(skipButton()).toBeNull();
  });
});

describe("a proposal card (#3471)", () => {
  const proposal = { title: "Watch the mailbox?", subtitle: "", options: ["Yes", "Not now"], proactiveProposal: { id: "p1" }, proactiveChoice: { domain: "mail", label: "Mail", botName: "Orla", watches: [] } } as never;

  it("has the skip, neither a yes nor a not now", async () => {
    const onSkip = vi.fn();
    const onAnswer = vi.fn();
    await render(createElement(ProactiveChoiceCard, { card: proposal, onAnswer, onNever: async () => undefined, onSkip }));
    await act(async () => { skipButton()!.click(); });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a plain proposal skips through its own route, never a no", async () => {
    const message = { id: "p", role: "bot", kind: "options", at: 1, text: "", card: { title: "Handle the new mail?", subtitle: "", options: ["Yes", "No thanks"], proactiveProposal: { id: "p9" } } } as unknown as Message;
    await render(createElement(OptionCard, { botId: "orla", threadId: "main", message }));
    await act(async () => { skipButton()!.click(); });
    expect(dispatched).toContainEqual({ type: "skipCard", threadId: "main", proposal: { botId: "orla", id: "p9" } });
    expect(dispatched.some((action) => action.type === "pickOption")).toBe(false);
  });

  it("a skipped one reads skipped, an expired one expired", async () => {
    await render(createElement(ProactiveChoiceCard, { card: { ...(proposal as object), answered: "skipped", skipped: true } as never, onAnswer: () => undefined, onNever: async () => undefined }));
    expect(host.textContent).toContain("Skipped, no answer");
    await render(createElement(ProactiveChoiceCard, { card: { ...(proposal as object), expired: true } as never, onAnswer: () => undefined, onNever: async () => undefined }));
    expect(host.textContent).toContain("Expired, no answer");
  });
});
