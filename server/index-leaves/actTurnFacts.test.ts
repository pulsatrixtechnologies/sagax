import { describe, expect, it } from "vitest";
import { actorForTurn } from "../../shared/bot-act.ts";
import { createActTurnFacts, routineOwnerFor } from "./actTurnFacts.ts";

function hostWith(opts: { automation?: string; lineage?: boolean; payer?: string; owner?: string; bot?: boolean }) {
  const threadId = "t1";
  return {
    threadId,
    host: {
      provenRequestPerson: () => null,
      linePersonKey: () => null,
      directRequestOwners: new Map([[threadId, { automation: opts.automation, generations: new Set(["g"]) }]]),
      guestDrivenTurns: new Map(),
      store: {
        messagesFor: () => [],
        botByThread: () => (opts.bot === false ? undefined : { id: "b1", ownerUserId: opts.owner }),
      },
      effectiveBotOwner: (bot: { ownerUserId?: string }) => bot.ownerUserId ?? "",
      turnRoutineLineage: new Set(opts.lineage ? [threadId] : []),
      turnRoutinePayers: new Map(opts.payer ? [[threadId, opts.payer]] : []),
      LOOPBACK: { trust: "service" },
      IDENTITY: { kind: "local" },
      HOSTED_WORKSPACE: false,
    },
  };
}

describe("actTurnFacts routine owner (QA 0.8.67 G8)", () => {
  it("a scheduled routine without a recorded lineage acts as the bot's owner", () => {
    const { host, threadId } = hostWith({ automation: "schedule", owner: "alice@example.com" });
    const facts = createActTurnFacts(() => host)(threadId, "g");
    expect(facts.routineOwner).toBe("alice@example.com");
    expect(actorForTurn(facts)).toEqual({ kind: "person", personKey: "alice@example.com", routine: true });
  });

  it("a webhook turn acts as the bot's owner too", () => {
    const { host, threadId } = hostWith({ automation: "webhook", owner: "alice@example.com" });
    expect(actorForTurn(createActTurnFacts(() => host)(threadId, "g"))).toMatchObject({ kind: "person", personKey: "alice@example.com" });
  });

  it("the payer recorded for the lineage wins over the bot's owner", () => {
    const { host, threadId } = hostWith({ automation: "schedule", lineage: true, payer: "bob@example.com", owner: "alice@example.com" });
    expect(routineOwnerFor(host, threadId)).toBe("bob@example.com");
  });

  it("no routine owner for a turn a person started", () => {
    const { host, threadId } = hostWith({ owner: "alice@example.com" });
    expect(createActTurnFacts(() => host)(threadId, "g").routineOwner).toBeNull();
  });

  it("no owner when the thread has no bot", () => {
    const { host, threadId } = hostWith({ automation: "schedule", bot: false });
    expect(routineOwnerFor(host, threadId)).toBeNull();
  });
});
