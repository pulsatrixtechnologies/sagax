// #4219: a keyed card in a room, addressed to one person: everyone in the
// room sees it, only its addressee can answer it, and the answered row
// says who answered.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), viewer: "p-ana" };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { config: { viewer: { principalId: fixture.viewer } } }, dispatch: fixture.dispatch }),
}));

const { QuestionCard } = await import("./QuestionCard");

afterAll(() => vi.unstubAllGlobals());

const bot = { id: "bot-desk", name: "Desk" } as Bot;
const question = "Ticket 12: who takes the on-site visit today?";

function message(card: Record<string, unknown> = {}): Message {
  return {
    id: "m-1", role: "bot", kind: "options", at: "2026-11-13T10:00:00.000Z",
    from: { botId: bot.id, name: bot.name, color: "blue" },
    card: {
      title: "Your bot has a question", subtitle: question, options: ["Take it", "Hand it over"],
      requestId: "ask-choice-1", askKey: "ticket-12", askTo: { id: "p-ana", name: "Ana" },
      questionRequest: { version: 1, questions: [{ question, options: [{ label: "Take it" }, { label: "Hand it over" }] }] },
      ...card,
    },
  } as unknown as Message;
}

const render = (m: Message, viewer: string) => {
  fixture.viewer = viewer;
  return renderToStaticMarkup(createElement(QuestionCard, { threadId: "room-thread", bot, message: m }));
};

describe("QuestionCard in a room (#4219)", () => {
  it("names the addressee, and the addressee answers it", () => {
    const markup = render(message(), "p-ana");
    expect(markup).toContain("For Ana");
    expect(markup).not.toContain("Waiting for Ana");
    expect(markup).toContain("Other");
  });

  it("another person of the room sees it, waiting on the addressee, with nothing to answer", () => {
    const markup = render(message(), "p-ben");
    expect(markup).toContain("For Ana");
    expect(markup).toContain("Waiting for Ana&#x27;s answer");
    expect(markup).not.toContain("Other");
    expect(markup).toContain("Take it");
  });

  it("the answered row says who answered", () => {
    const markup = render(message({ answered: "answer", answeredText: "Take it", answeredBy: { kind: "session", id: "p-ana", name: "Ana" } }), "p-ben");
    expect(markup).toContain("Answered by Ana");
  });
});
