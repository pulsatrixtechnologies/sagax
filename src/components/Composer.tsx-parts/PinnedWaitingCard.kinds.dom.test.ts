// @vitest-environment happy-dom
// The card pinned over the composer draws the SAME controls as the card in
// the conversation for every kind a bot can ask, and answering from it
// sends the same payload. A routine run's checklist (a widget form) is
// drawn with its checkboxes and its actions up there, never as words and a
// free text box, and its row is not drawn twice (one card, one state).
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale } from "@/lib/i18n";
import { pinnedHeldIds, pinnedItemsFrom } from "@/lib/pinned-waiting";
import type { Bot, Message } from "@/state/store";
import { parseAskChoiceInput } from "../../../shared/options-card";
import type { AskQuestion } from "../../../shared/ask-question";
import { GOOD_DRAFTS_CARD, GOOD_TIME_CARD } from "../../../shared/card-rules.fixtures";
import { parseWidgetInput } from "../../../shared/widget";
import type { ServedWaitingItem } from "../../../shared/waiting-items";
import { QuestionCard } from "../QuestionCard";
import { PinnedWaitingCard, usePinnedWaiting } from "./PinnedWaitingCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { BotEditorStore, initialState } = await import("@/state/store");

const bot = { id: "orla", name: "Orla", color: "violet", threadId: "main", messages: [], tasks: [] } as unknown as Bot;
const dispatched: Array<{ type?: string } & Record<string, unknown>> = [];
let host: HTMLDivElement;
let root: Root;

const rowsOf = (input: unknown): AskQuestion[] => {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error("fixture does not parse");
  return parsed.value.questions;
};

function questionMessage(questions: AskQuestion[]): Message {
  return {
    id: "m-q", role: "bot", kind: "options", at: 1, text: "", from: { botId: "orla", name: "Orla", color: "violet" },
    card: { title: "Question", subtitle: "", options: [], requestId: "req-q", requestType: "question", questionRequest: { version: 1, questions } },
  } as unknown as Message;
}

function servedQuestion(message: Message): ServedWaitingItem {
  return { id: "req-q", kind: "question", botId: "orla", botName: "Orla", threadId: "main", messageId: message.id, at: 1, ageMs: 0, title: "", text: "", options: [], answerWith: "text", freeText: true, skippable: true, message };
}

function store(children: ReactNode) {
  const value = { state: { ...initialState, bots: [bot], instances: [] }, dispatch: (action: never) => dispatched.push(action), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return createElement(BotEditorStore, { value: value as never, children });
}

function Pinned({ items }: { items: ServedWaitingItem[] }) {
  const pinned = usePinnedWaiting(items, "main", [], []);
  return createElement(PinnedWaitingCard, { pinned, threadId: "main", bot, botFor: () => bot, nameFor: () => "Orla", onCancelTurn: () => {} });
}

const mountPinned = async (items: ServedWaitingItem[]) => {
  await act(async () => { root.render(store(createElement(Pinned, { items }))); });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
};
const mountConversation = async (message: Message) => {
  await act(async () => { root.render(store(createElement(QuestionCard, { threadId: "main", bot: { name: "Orla" }, message }))); });
};

/** What a person can touch on the card: its controls, by kind. */
const SELECTORS = ['[role="radiogroup"]', "[data-form-choice]", "[data-form-row]", '[role="checkbox"]', 'input[type="number"]', 'input[type="date"]', 'input[type="time"]', "[data-ask-choice]", "[data-sheet-send]", "textarea"];
const controls = (scope: ParentNode) => SELECTORS.map((selector) => scope.querySelectorAll(selector).length);

const KINDS: Record<string, AskQuestion[]> = {
  choice: [{ question: "Pause the webhooks?", options: [{ label: "Pause" }, { label: "Keep" }] }] as AskQuestion[],
  "multi-choice": [{ question: "Which rooms?", kind: "multi", multiSelect: true, options: [{ label: "North" }, { label: "South" }] }] as AskQuestion[],
  "yes-no": [{ question: "Ship it?", kind: "yes_no", options: [] }] as AskQuestion[],
  form: rowsOf(GOOD_TIME_CARD),
  checklist: rowsOf(GOOD_DRAFTS_CARD),
  date: [{ question: "Which day?", kind: "date", options: [] }, { question: "Notes", kind: "long_text", options: [] }] as AskQuestion[],
  time: [{ question: "At what time?", kind: "time", options: [] }, { question: "Notes", kind: "long_text", options: [] }] as AskQuestion[],
  number: [{ question: "How many guests?", kind: "number", options: [] }, { question: "Notes", kind: "long_text", options: [] }] as AskQuestion[],
  text: [{ question: "What should I call it?", options: [] }] as AskQuestion[],
};

beforeEach(async () => {
  await loadLocale("en");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
  dispatched.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the pinned card draws every kind as the conversation's card does", () => {
  for (const [kind, questions] of Object.entries(KINDS)) {
    it(`${kind}: same controls, same answer`, async () => {
      const message = questionMessage(questions);
      await mountConversation(message);
      const inConversation = controls(host);
      const send = () => host.querySelector<HTMLButtonElement>("[data-ask-choice], [data-sheet-send], [data-form-choice]");
      send()?.click();
      await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
      const conversationAnswers = dispatched.map((action) => JSON.stringify(action));

      dispatched.length = 0;
      await mountPinned([servedQuestion(message)]);
      const body = host.querySelector('[data-pinned-body="question"]')!;
      expect(body).not.toBeNull();
      expect(controls(body)).toEqual(inConversation);
      expect(inConversation.some((count) => count > 0)).toBe(true);
      send()?.click();
      await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
      expect(dispatched.map((action) => JSON.stringify(action))).toEqual(conversationAnswers);
    });
  }
});

describe("a routine run's checklist form on the pinned card", () => {
  const tree = parseWidgetInput({
    type: "Card", title: "Tonight's drafts",
    children: [
      { type: "Text", value: "Two drafts are ready. Post selected sends only the checked ones. Skip tonight posts nothing." },
      { type: "Checkbox", name: "d1", label: "Release notes for Nimbus 2.4", defaultChecked: true },
      { type: "Checkbox", name: "d2", label: "Thread about the acme meetup", defaultChecked: true },
    ],
    confirm: { label: "Post selected", action: { type: "drafts.post" } }, cancel: { label: "Skip tonight", action: { type: "drafts.skip" } },
  });
  if (!tree.ok) throw new Error(tree.error);
  const message = { id: "m-form", role: "bot", kind: "widget", at: 1, text: "Tonight's drafts", widget: { v: 1, root: tree.value } } as unknown as Message;
  const item: ServedWaitingItem = {
    id: "form:m-form", kind: "form", botId: "orla", botName: "Orla", threadId: "main", messageId: "m-form", at: 1, ageMs: 0,
    title: "Tonight's drafts", text: "Tonight's drafts\n\nPost selected or Skip tonight", options: [], answerWith: "text", freeText: true, skippable: true, message,
  };

  it("shows the checkboxes and the two actions, not a free text box, and the text whole", async () => {
    await mountPinned([item]);
    const body = host.querySelector('[data-pinned-body="other"]')!;
    expect(body.querySelectorAll('[role="checkbox"], input[type="checkbox"]').length).toBe(2);
    const labels = Array.from(body.querySelectorAll("button")).map((button) => button.textContent?.trim());
    expect(labels).toContain("Post selected");
    expect(labels).toContain("Skip tonight");
    expect(body.querySelector("textarea[data-question-field]")).toBeNull();
    expect(body.textContent).toContain("Skip tonight posts nothing.");
  });

  it("is the only copy: the conversation holds its row while it is pinned", () => {
    const held = pinnedHeldIds(pinnedItemsFrom([item], "main"));
    expect(held.has("m-form")).toBe(true);
  });

  it("pressing an action from the pinned card sends the widget action", async () => {
    await mountPinned([item]);
    const post = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Post selected")!;
    await act(async () => { post.click(); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    const sent = vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), body: String((init as RequestInit | undefined)?.body ?? "") }));
    const press = sent.find((call) => call.body.includes("widgetAction"));
    expect(press?.url).toContain("/api/bots/orla/");
    expect(JSON.parse(press!.body)).toMatchObject({ threadId: "main", widgetAction: { messageId: "m-form", ref: "confirm", values: { d1: true, d2: true } } });
  });
});
