// @vitest-environment happy-dom
// #3681: in a room as in a direct chat, an ask the room's pinned card holds
// is drawn there only while it waits; "See in the conversation" lands on the
// words before it. A transcript with no pinned card (no hold) draws it.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), focus: null as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [] as Bot[], focusMessage: fixture.focus },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { Transcript } = await import("./GroupView");
const { createPinnedHold, PinnedHoldContext } = await import("@/lib/pinned-waiting");

const QUESTION = "Which release should we ship?";
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch", memberIds: ["lead"],
  defaultResponder: { kind: "member", botId: "lead" }, bulletin: "", unread: false,
  createdAt: 1, messages: [],
};
const lead = { id: "lead", name: "Lead", color: "blue" } as Bot;
const from = { botId: "lead", name: "Lead", color: "blue" as const };
const words: Message = { id: "words", role: "bot", kind: "text", at: 1, text: "One choice before I go on.", from };
const ask = (more: Record<string, unknown> = {}): Message => ({
  id: "q1", role: "bot", kind: "options", at: 2, text: "", from,
  card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
    questionRequest: { version: 1, questions: [{ question: QUESTION, options: [{ label: "Today" }, { label: "Monday" }] }] }, ...more },
} as unknown as Message);

let host: HTMLDivElement;
let root: Root;
const render = (messages: Message[], held: string[] | null) => {
  const hold = createPinnedHold();
  if (held) hold.set(new Set(held));
  const transcript = createElement(Transcript, { group: room, members: [lead], locale: "en", messages, transcript: messages, onReply: () => {} });
  flushSync(() => root.render(held ? createElement(PinnedHoldContext, { value: hold }, transcript) : transcript));
};

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.focus = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a room's waiting ask is drawn once (#3681)", () => {
  it("draws no card for an ask the room's pinned card holds; the bot's words stay", () => {
    render([words, ask()], ["q1"]);
    expect(host.textContent).toContain("One choice before I go on.");
    expect(host.textContent).not.toContain(QUESTION);
    expect(host.querySelector('[data-mid="q1"]')).toBeNull();
  });

  it("draws its record once it is answered", () => {
    render([words, ask({ answered: "answer", answeredText: "Monday" })], []);
    expect(host.textContent).toContain(QUESTION);
  });

  it("draws the card where no pinned card holds it", () => {
    render([words, ask()], null);
    expect(host.textContent).toContain(QUESTION);
  });

  it("sends See in the conversation to the words before the held ask", () => {
    fixture.focus = { threadId: "room-thread", messageId: "q1", nonce: 1, consumed: false };
    render([words, ask()], ["q1"]);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "focusMessage", threadId: "room-thread", messageId: "words" });
  });
});
