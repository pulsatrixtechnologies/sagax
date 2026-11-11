// #3519: a bot's one-shot calls sign in through the turn's own resolution.
import { describe, expect, it, vi } from "vitest";

import { resolveEngineAccess } from "../engines/engine-credentials.ts";
import { createBotOneShotAccess, createOrgTurnAccess } from "./orgTurnAccess.ts";
import { createSafetyReviewer } from "./safetyReviewer.ts";

class EngineAccessLost extends Error {
  readonly refusal: unknown;
  constructor(refusal: unknown) { super("no engine access for this turn"); this.refusal = refusal; }
}

function orgHost(options: { personSignedIn?: boolean; personExpired?: boolean } = {}) {
  const speakers: unknown[] = [];
  return {
    speakers,
    host: {
      IDENTITY: { kind: "perspicax", issuer: "https://org.invalid" },
      DATA_DIR: "/data",
      resolveEngineAccess,
      EngineAccessLost,
      orgRefusalOf: (plan: unknown) => plan,
      piLocalModel: () => false,
      withPiModelServers: (access: unknown) => access,
      effectiveBotOwner: () => "p1",
      turnSlotFor: () => "primary",
      principalLoginDir: (principalId: string) => `/data/principals/${principalId}/claude`,
      principals: { list: () => [] },
      providerAccountOwner: () => null,
      turnAccessByThread: new Map<string, unknown>(),
      orgEngineInput: (_bot: unknown, instance: { instanceId: string; driverKind: string }, speaker: unknown) => {
        speakers.push(speaker);
        return {
          identity: "perspicax",
          speaker,
          owner: { principalId: "p1", sub: "subject-p1" },
          instance: { instanceId: instance.instanceId, driver: instance.driverKind, installed: true },
          subscriptionSignedIn: () => options.personSignedIn !== false,
          subscriptionExpired: () => options.personExpired === true,
          hasKey: () => false,
          // the server keeps a sign-in of its own: the organization's key path
          keyBacked: true,
        };
      },
    },
  };
}

const bot = { id: "b1", name: "Helper", threadId: "main-b1", modelSelection: { instanceId: "claude", model: "claude-sonnet" } };
const instance = { instanceId: "claude", driverKind: "claudeAgent" };

describe("a bot's one-shot account (#3519)", () => {
  it("is the account its owner's turn with that bot resolves, by the same function", async () => {
    const { host, speakers } = orgHost();
    const oneShot = await createBotOneShotAccess(() => host)(bot, instance);
    const turn = await createOrgTurnAccess(() => host)("thread-1", bot, instance, { origin: "person", principalId: "p1" }, "claude-sonnet");
    expect(oneShot.access).toEqual(turn);
    expect(oneShot.access).toMatchObject({ via: "subscription", claudeConfigDir: "/data/principals/p1/claude" });
    expect(oneShot.ranOn).toMatchObject({ via: "subscription", payerPrincipalId: "p1" });
    expect(speakers[0]).toEqual({ origin: "person", principalId: "p1" });
    // a one-shot records nothing under a conversation; the turn does
    expect(host.turnAccessByThread.size).toBe(1);
    expect(host.turnAccessByThread.has("thread-1")).toBe(true);
  });

  it("never falls back on the server's own sign-in while the person's account is valid", async () => {
    const { host } = orgHost();
    const { access } = await createBotOneShotAccess(() => host)(bot, instance);
    expect(access?.via).toBe("subscription");
    // the person's sign-in marked expired: the turn's next step serves (here the organization's key)
    const expired = orgHost({ personExpired: true });
    expect((await createBotOneShotAccess(() => expired.host)(bot, instance)).access?.via).toBe("org-key");
  });

  it("is the instance's own configuration on a solo server, as a solo turn", async () => {
    const solo = { ...orgHost().host, IDENTITY: { kind: "solo" } };
    expect((await createBotOneShotAccess(() => solo)(bot, instance)).access).toBeUndefined();
  });
});

describe("the permission review (#3519)", () => {
  it("signs in through the bot's one-shot account, with the review's own signal", async () => {
    const account = { via: "subscription", identity: "subscription:p1", claudeConfigDir: "/data/principals/p1/claude" };
    const reviewPermission = vi.fn(async () => "ALLOW");
    const engine = { ...instance, reviewPermission };
    const botOneShotText = vi.fn((_bot: unknown, _instance: unknown, call: (prompt: string, options?: { signal?: AbortSignal; access?: unknown }) => Promise<string>) =>
      (prompt: string, options?: { signal?: AbortSignal }) => call(prompt, { ...options, access: account }));
    const host = { store: { bot: () => bot }, registry: { get: () => engine }, botOneShotText };
    const review = createSafetyReviewer(() => host)("b1");
    const controller = new AbortController();
    await expect(review("review this request", controller.signal)).resolves.toBe("ALLOW");
    expect(botOneShotText).toHaveBeenCalledWith(bot, engine, expect.any(Function));
    expect(reviewPermission).toHaveBeenCalledWith("review this request", controller.signal, account);
  });
});
