// @vitest-environment happy-dom
// A message sent while a bot's question waits (owner 2026-10-21, #885): the
// question stays open, nothing answers it for the person, and the composer
// says so.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), busy: false, messages: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [{ ...bot, busy: fixture.busy, messages: fixture.messages }], instances: [{
      instanceId: "fake", driverKind: "claude", displayName: "Fake",
      capabilities: { agentsMcp: true, queueing: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "ask-bot", threadId: "ask-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

const question = {
  id: "q1", at: 1, role: "bot", kind: "options",
  card: {
    title: "q", subtitle: "Which plan?", options: [], requestId: "req-1",
    questionRequest: { version: 1, questions: [{ question: "Which plan?", options: [{ label: "Free" }, { label: "Pro" }] }] },
  },
} as unknown as Message;

describe("sending while a question waits", () => {
  let root: Root;
  let container: HTMLDivElement;

  const mount = (messages: Message[]) => {
    fixture.messages = messages;
    flushSync(() => root.render(createElement(Composer, { bot: { ...bot, messages } })));
  };

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const sendWithEnter = (text: string) => {
    flushSync(() => restoreComposerDraft(draftId, { text, attachments: [] }));
    const input = container.querySelector("textarea")!;
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  };

  // #3214 (2026-11-09) replaced #940's rule: the waiting question is pinned
  // over the composer, and what the person types answers it through the
  // usual answer path, in the person's own words (never "best judgment").
  it("answers the pinned question with the typed words, never a guess for the person", () => {
    mount([question]);
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).toBe("Type your answer to the pinned question, or pick an option above");
    sendWithEnter("Autre chose en attendant");
    const actions = fixture.dispatch.mock.calls.map(([action]) => action);
    expect(actions).toContainEqual(expect.objectContaining({ type: "decideRequest", behavior: "answer", message: expect.stringContaining("A: Autre chose en attendant") }));
    expect(actions.some((action) => action.type === "send")).toBe(false);
    expect(JSON.stringify(actions)).not.toContain("best judgment");
  });

  it("keeps the usual placeholder when no question waits", () => {
    mount([]);
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).not.toContain("pinned question");
  });
});
