// @vitest-environment happy-dom
// M-20261119-045: a bot's question on its card read as raw text: the
// **headings** kept their asterisks, the "- " bullets stayed bare and each
// record link showed whole, "[#300478](sagax://record/...)". The same words
// in a chat bubble were drawn. Every field of a card that carries the bot's
// words (the question, the card's context, an option's detail, a pinned
// item's text) now goes through the chat's own Markdown renderer
// (ChatMarkdown): bold is bold, a list is a list, and a record link is the
// record chip. A one-line view of the card (the history line, the folded
// pinned line) reads the words as plain text, never the Markdown.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import type { AskQuestion } from "../../shared/ask-question";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import { WaitingHistoryLine } from "./ChatView.tsx-parts/chips";
import { PinnedWaitingCard, pinnedItemText, usePinnedWaiting } from "./Composer.tsx-parts/PinnedWaitingCard";
import { OptionCard } from "./OptionCard";
import { QuestionCard } from "./QuestionCard";
import { cardDraftId } from "./CardMarkdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { BotEditorStore, initialState } = await import("@/state/store");

const link = (id: number) => `[#${id}](sagax://record/nimbus_desk/ticket/${id})`;
/** The shape of the bot's question in the owner's capture: bold headings,
 * bullets and several record links, in invented words. */
const ASK = [
  "J'ai relu le billet avec la cliente.",
  "",
  "**Ce qu'elle confirme**",
  `- L'imprimante du 2e étage est revenue : ${link(300478)}`,
  `- Le poste de la réception redémarre seul : ${link(300481)}`,
  "",
  "**Autre erreur qu'elle a trouvée**",
  `- Le partage réseau refuse son accès : ${link(300490)}`,
  "",
  "**À toi de décider**",
  "Je ferme les deux premiers et j'ouvre un suivi pour le partage ?",
].join("\n");

const bot = { id: "orla", name: "Orla", color: "violet", threadId: "main", messages: [], tasks: [] } as unknown as Bot;
let host: HTMLDivElement;
let root: Root;

function store(children: ReactNode) {
  const value = { state: { ...initialState, bots: [bot], instances: [] }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return createElement(BotEditorStore, { value: value as never, children });
}

function questionMessage(questions: AskQuestion[], extra: Record<string, unknown> = {}): Message {
  return {
    id: "m-q", role: "bot", kind: "options", at: 1, text: "", from: { botId: "orla", name: "Orla", color: "violet" },
    card: { title: "Ton bot a une question", subtitle: "", options: [], requestId: "req-q", requestType: "question", questionRequest: { version: 1, questions }, ...extra },
  } as unknown as Message;
}

const ASK_QUESTION: AskQuestion[] = [{ question: ASK, options: [{ label: "Fermer les deux", description: `Ferme **les deux** billets, dont ${link(300478)}` }, { label: "Attendre" }] }] as AskQuestion[];

async function mount(node: ReactNode) {
  await act(async () => { root.render(store(node)); });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}

/** What the card shows a person: no Markdown syntax, no record address. */
function expectDrawn(scope: Element) {
  const text = scope.textContent ?? "";
  expect(text).not.toContain("**");
  expect(text).not.toContain("sagax://");
  expect(text).not.toContain("](");
  expect(text).not.toMatch(/(^|\n)- /);
  expect(scope.querySelectorAll("strong").length).toBeGreaterThanOrEqual(3);
  expect(scope.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
}
const chips = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>("[data-record-link]")].map((chip) => chip.textContent);

beforeEach(async () => {
  await loadLocale("fr");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a bot's words on its card are drawn as in its bubble (M-20261119-045)", () => {
  it("the question card in the conversation: bold, a list and the record chips", async () => {
    await mount(createElement(QuestionCard, { threadId: "main", bot: { id: "orla", name: "Orla" }, message: questionMessage(ASK_QUESTION) }));
    const card = host.querySelector("[data-question-sheet]")!;
    expectDrawn(card);
    expect(chips(card)).toEqual(["#300478", "#300481", "#300490"]);
    // the option's detail is the bot's words too: drawn, its link read as its label
    const detail = card.querySelector("[data-ask-choice]")!;
    expect(detail.querySelector("strong")?.textContent).toBe("les deux");
    expect(detail.textContent).not.toContain("sagax://");
    expect(detail.querySelector("button")).toBeNull();
  });

  it("the same card pinned over the composer", async () => {
    const message = questionMessage(ASK_QUESTION);
    const item: ServedWaitingItem = { id: "req-q", kind: "question", botId: "orla", botName: "Orla", threadId: "main", messageId: message.id, at: 1, ageMs: 0, title: "", text: "", options: [], answerWith: "text", freeText: true, skippable: true, message };
    function Pinned() {
      const pinned = usePinnedWaiting([item], "main", [], []);
      return createElement(PinnedWaitingCard, { pinned, threadId: "main", bot, botFor: () => bot, nameFor: () => "Orla", onCancelTurn: () => {} });
    }
    await mount(createElement(Pinned));
    const body = host.querySelector('[data-pinned-body="question"]')!;
    expectDrawn(body);
    expect(chips(body)).toEqual(["#300478", "#300481", "#300490"]);
  });

  it("an answered card keeps the question drawn", async () => {
    await mount(createElement(QuestionCard, { threadId: "main", bot: { id: "orla", name: "Orla" }, message: questionMessage(ASK_QUESTION, { answered: "answer", answeredText: "Attendre" }) }));
    const card = host.querySelector('[data-ask-card="settled"]')!;
    expectDrawn(card);
    expect(chips(card)).toEqual(["#300478", "#300481", "#300490"]);
  });

  it("a short question is the title, and its record link is a chip there too", async () => {
    await mount(createElement(QuestionCard, { threadId: "main", bot: { id: "orla", name: "Orla" }, message: questionMessage([{ question: `Je ferme ${link(300478)} ?`, options: [{ label: "Oui" }, { label: "Non" }] }] as AskQuestion[]) }));
    const card = host.querySelector("[data-question-sheet]")!;
    expect(card.textContent).not.toContain("sagax://");
    expect(chips(card)).toEqual(["#300478"]);
  });

  it("a flat card's body (ask_person, a proposal)", async () => {
    const message = { id: "m-f", role: "bot", kind: "options", at: 1, text: "", card: { title: "Ton bot a une question", subtitle: ASK, options: ["Fermer", "Attendre"], requestId: "req-f", requestType: "question" } } as unknown as Message;
    await mount(createElement(OptionCard, { botId: "orla", threadId: "main", message }));
    const card = host.querySelector("[data-question-sheet]")!;
    expectDrawn(card);
    expect(chips(card)).toEqual(["#300478", "#300481", "#300490"]);
  });

  it("a form's context line", async () => {
    const questions = [
      { question: "Durée", kind: "choice", options: [{ label: "30 min" }, { label: "1 h" }] },
      { question: "Notes", kind: "long_text", options: [] },
    ] as AskQuestion[];
    await mount(createElement(QuestionCard, { threadId: "main", bot: { id: "orla", name: "Orla" }, message: questionMessage(questions, { subtitle: ASK }) }));
    const context = host.querySelector("[data-form-context]")!;
    expectDrawn(context);
    expect(chips(context)).toEqual(["#300478", "#300481", "#300490"]);
  });

  it("a pinned item this app draws as text", async () => {
    const item = { id: "x1", kind: "unknown-kind", botId: "orla", botName: "Orla", threadId: "main", messageId: "m-x", at: 1, ageMs: 0, title: "Ton bot a une question", text: ASK, options: [], answerWith: "text", freeText: false, skippable: false } as unknown as ServedWaitingItem;
    function Pinned() {
      const pinned = usePinnedWaiting([item], "main", [], []);
      return createElement(PinnedWaitingCard, { pinned, threadId: "main", bot, botFor: () => bot, nameFor: () => "Orla", onCancelTurn: () => {} });
    }
    await mount(createElement(Pinned));
    const text = host.querySelector("[data-pinned-text]")!;
    expectDrawn(text);
    expect(chips(text)).toEqual(["#300478", "#300481", "#300490"]);
  });

  it("one-line views read the words, never the Markdown", async () => {
    const message = questionMessage(ASK_QUESTION, { title: "" });
    const line = pinnedItemText({ kind: "question", key: "q", message, item: { botId: "orla" } } as never);
    expect(line).not.toContain("**");
    expect(line).not.toContain("sagax://");
    expect(line).toContain("Ce qu'elle confirme");
    await mount(createElement(WaitingHistoryLine, { text: ASK }));
    const history = host.querySelector("[data-waiting-history]")!;
    expect(history.textContent).not.toContain("**");
    expect(history.textContent).not.toContain("sagax://");
    expect(history.textContent).toContain("#300478");
  });

  it("a chip's Ask writes in the composer of the conversation the card is in", () => {
    const state = { bots: [{ id: "orla", threadId: "main" }], groups: [{ id: "room", threadId: "room-thread" }] };
    expect(cardDraftId(state, "orla", "main")).toBe("bot:orla:main");
    expect(cardDraftId(state, "orla", "room-thread")).toBe("group:room:room-thread");
    expect(cardDraftId(state, "orla", "main", "room")).toBe("group:room:room-thread");
    expect(cardDraftId(state, "nobody", "elsewhere")).toBeUndefined();
    expect(cardDraftId({}, "orla", "main")).toBeUndefined();
  });
});
