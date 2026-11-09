import { describe, expect, it, vi } from "vitest";
import { presentRequestOpened, questionCardLanguage } from "./request-opened-present.ts";

// #3150: an ask_choice card raised by a French prompt (an MCP send_prompt
// from a client whose own setting is English) was titled in English.
function present(personText: string, preferred: string) {
  const pushMessage = vi.fn((message: any) => ({ id: "card-1", ...message }));
  const known: Record<string, unknown> = {
    store: new Proxy({ messagesFor: () => [{ role: "user", kind: "text", text: personText }] }, {
      get: (target: any, key) => target[key] ?? (() => undefined),
    }),
    languageOfPerson: () => preferred,
    askMessageByRequest: new Map(),
    directTurnGenerationByThread: new Map(),
    groupSpeakers: new Map(),
  };
  const host = new Proxy(known, { get: (target, key: string) => (key in target ? target[key] : () => undefined) });
  const event = {
    threadId: "thread-1", requestId: "ask-choice-1", requestType: "question", type: "request.opened",
    tool: "ask_choice", harnessAsk: true, origin: "tool", summary: "QA7 : quelle option ?",
    choices: ["Option A", "Option B", "Option C"],
    questions: [{ question: "QA7 : quelle option ?", options: [{ label: "Option A" }, { label: "Option B" }, { label: "Option C" }] }],
  };
  const asker = { id: "bot-1", name: "DOGE", modelSelection: { instanceId: "grok" } };
  try {
    presentRequestOpened(event, { bot: asker, pushMessage }, host, { permission: false, asker, cardAnswerer: "person-1", owner: "person-1" });
  } catch { /* the steps after the card need a whole server */ }
  return pushMessage.mock.calls.map(([message]) => message.card?.title).find(Boolean);
}

describe("#3150 the ask_choice card title follows the conversation", () => {
  it("is French for a French prompt even when the person's setting is English", () => {
    expect(present("Pose-moi une question à choix (ask_choice) avec les options Option A, Option B, Option C. N'écris rien.", "en")).toBe("Ton bot a une question");
  });
  it("is English for an English prompt even when the person's setting is French", () => {
    expect(present("Ask me a multiple choice question with options A, B and C. Do not write anything.", "fr")).toBe("Your bot has a question");
  });
  it("falls back on the person's setting when the last line does not tell", () => {
    expect(questionCardLanguage([{ role: "user", kind: "text", text: "ok" }], "fr-CA")).toBe("fr");
    expect(questionCardLanguage([], "en")).toBe("en");
    expect(questionCardLanguage(undefined, undefined)).toBe("en");
  });
});
