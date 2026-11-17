// #4490 review: an engine's own badly made question is sent back once per
// turn; when it cannot be sent back, or the turn already had one sent back,
// the card is shown as asked. Never a turn left with no card and no answer.
import { describe, expect, it, vi } from "vitest";
import { presentRequestOpened } from "./request-opened-present.ts";
import { BAD_TIME_CARD } from "../../shared/card-rules.fixtures.ts";

function harness(outcome: "answered" | "unavailable", generation: string) {
  const pushMessage = vi.fn((message: any) => ({ id: `m${pushMessage.mock.calls.length}`, ...message }));
  const respondToRequest = vi.fn(async () => outcome);
  const known: Record<string, unknown> = {
    store: new Proxy({ messagesFor: () => [] }, { get: (target: any, key) => target[key] ?? (() => undefined) }),
    languageOfPerson: () => "en",
    askMessageByRequest: new Map(),
    directTurnGenerationByThread: new Map(),
    groupSpeakers: new Map(),
    activeInternalGenerationByThread: new Map([["thread-r", generation]]),
    registry: { get: () => ({ adapter: { respondToRequest } }) },
  };
  const host = new Proxy(known, { get: (target, key: string) => (key in target ? target[key] : () => undefined) });
  const asker = { id: "bot-1", name: "Nimbus", modelSelection: { instanceId: "claude" } };
  const ask = (requestId: string) => {
    const event = {
      threadId: "thread-r", requestId, requestType: "question", type: "request.opened", tool: "AskUserQuestion",
      summary: BAD_TIME_CARD.question, questions: [{ question: BAD_TIME_CARD.question, options: [] }],
    };
    try {
      presentRequestOpened(event, { bot: asker, pushMessage }, host, { permission: false, asker, cardAnswerer: "person-1", owner: "person-1" });
    } catch { /* the steps after the card need a whole server */ }
  };
  const cards = () => pushMessage.mock.calls.filter(([message]) => message.kind === "options");
  return { ask, cards, respondToRequest, pushMessage };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("an engine's badly made question (#4490 review)", () => {
  it("is sent back with how to ask again, and no card is drawn", async () => {
    const h = harness("answered", "g-1");
    h.ask("r-1");
    await settle();
    expect(h.respondToRequest).toHaveBeenCalledTimes(1);
    expect((h.respondToRequest.mock.calls[0] as unknown[])[2]).toMatchObject({ message: expect.stringMatching(/^Sagax: not asked\. Card refused/) });
    expect(h.cards()).toHaveLength(0);
  });

  it("is shown as asked when it cannot be sent back", async () => {
    const h = harness("unavailable", "g-2");
    h.ask("r-2");
    await settle();
    expect(h.cards()).toHaveLength(1);
  });

  it("is refused once per turn: the next one is shown as asked", async () => {
    const h = harness("answered", "g-3");
    h.ask("r-3");
    await settle();
    h.ask("r-4");
    await settle();
    expect(h.respondToRequest).toHaveBeenCalledTimes(1);
    expect(h.cards()).toHaveLength(1);
  });
});
