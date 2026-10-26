import { describe, expect, it } from "vitest";
import type { TurnFacts } from "../shared/bot-act.ts";
import { createBotActService, type BotActAnswerer, type PerformActor } from "./bot-act.ts";

const person = "person-1";

function facts(patch: Partial<TurnFacts> = {}): TurnFacts {
  return { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: person, sharedServer: false, ...patch };
}

function harness(options: { mode?: "ask" | "edits" | "auto" | "full" | "custom"; session?: { id: string; scopes: Array<"admin" | "client"> } | null } = {}) {
  const performed: Array<{ actor: PerformActor; method?: string; path?: string }> = [];
  const broadcasts: Array<{ audience: string; command: string; input: Record<string, unknown> }> = [];
  const cards: Array<{ requestId: string; summary: string; rule?: unknown; answered?: "allow" | "deny"; expired?: true }> = [];
  let seq = 0;
  let now = 0;
  const gate = { release: () => undefined as void, opened: Promise.resolve() };
  let holdPerform: { resolve: (value: { status: number; text: string }) => void } | null = null;
  const service = createBotActService({
    now: () => now,
    newId: () => `req-${++seq}`,
    neededScope: (_method, path) => path.startsWith("/api/admin") ? "admin" : "client",
    operatorAudience: () => "operator",
    sessionForPerson: () => options.session === undefined ? { id: "wide", scopes: ["client"] } : options.session,
    async performRoute(actor, target) {
      performed.push({ actor, method: target.method, path: target.path });
      if (holdPerform) return new Promise((resolve) => { holdPerform = { resolve }; });
      return { status: 200, text: "ok" };
    },
    broadcastUi: (audience, command, input) => { broadcasts.push({ audience, command, input }); },
    postCard: (input) => {
      cards.push({ requestId: input.requestId, summary: input.summary, ...(input.rule ? { rule: input.rule } : {}) });
      return { messageId: `m-${input.requestId}` };
    },
    patchCard: (_threadId, messageId, patch) => {
      const card = cards.find((item) => `m-${item.requestId}` === messageId);
      if (card) Object.assign(card, patch);
    },
    findCard: (_threadId, requestId) => {
      const card = cards.find((item) => item.requestId === requestId);
      return card ? { messageId: `m-${card.requestId}`, answered: card.answered, expired: card.expired } : null;
    },
  });
  const answerer = (patch: Partial<Extract<BotActAnswerer, { kind: "session" }>> = {}): BotActAnswerer => ({
    kind: "session", personKey: person, sessionId: "phone", scopes: ["client"], admin: false, ...patch,
  });
  return { service, performed, broadcasts, cards, answerer, setNow: (value: number) => { now = value; }, armHold: () => { holdPerform = { resolve: () => undefined }; }, holdPerform: () => holdPerform, gate };
}

describe("bot act", () => {
  it("refuses a member an admin route and performs a route they may read as their session", async () => {
    const { service, performed } = harness();
    const refused = await service.handle({ facts: facts(), raw: { method: "POST", path: "/api/admin/settings" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(refused).toEqual({ status: 403, body: { error: "This person cannot call that route." } });
    expect(performed).toEqual([]);
    const allowed = await service.handle({ facts: facts(), raw: { method: "GET", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ text: "ok", status: 200 });
    expect(performed).toEqual([{ actor: { kind: "person", sessionId: "wide", personKey: person, scopes: ["client"] }, method: "GET", path: "/api/bots" }]);
  });

  it("2026-10-20: a change to rules or permissions has no Always allow, a plain one keeps its own", async () => {
    const { service, cards } = harness();
    const base = { facts: facts(), target: { kind: "route" as const, method: "PATCH", path: "/api/bots/b2" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green" };
    const rule = { tool: "sagax_settings" as const, scope: { setting: "bot.title" }, description: "Title" };
    await service.handlePlanned({ ...base, plan: { effect: "hold", summary: "a", stepUpClasses: ["rule-change"], rule } });
    await service.handlePlanned({ ...base, plan: { effect: "hold", summary: "b", stepUpClasses: [], rule, noRule: true } });
    await service.handlePlanned({ ...base, plan: { effect: "hold", summary: "c", stepUpClasses: [], rule } });
    expect(cards.map((card) => Boolean(card.rule))).toEqual([false, false, true]);
  });

  it("holds a write until the answering session allows it, and a deny does not perform", async () => {
    const { service, performed, cards, answerer } = harness();
    const held = await service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots", body: { name: "Bea" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(held.status).toBe(200);
    expect(held.body.held).toBe(true);
    expect(String(held.body.text)).toContain("POST /api/bots");
    expect(String(held.body.text)).not.toContain("Bea");
    expect(cards[0]?.summary).toBe("POST /api/bots");
    const denied = await service.confirm({ threadId: "t", requestId: "other", behavior: "deny", answerer: answerer(), sharedServer: false });
    expect(denied).toEqual({ handled: false });
    const requestId = cards[0]!.requestId;
    const deny = await service.confirm({ threadId: "t", requestId, behavior: "deny", answerer: answerer(), sharedServer: false });
    expect(deny).toEqual({ handled: true, status: 200, body: { ok: true, outcome: "rejected" } });
    expect(performed).toEqual([]);
    expect(cards[0]?.answered).toBe("deny");

    const again = await service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots", body: { name: "Bea" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(again.body.held).toBe(true);
    const id = cards[1]!.requestId;
    const allowed = await service.confirm({ threadId: "t", requestId: id, behavior: "allow", answerer: answerer({ sessionId: "phone" }), sharedServer: false });
    expect(allowed).toEqual({ handled: true, status: 200, body: { ok: true, outcome: "allowed-once" } });
    expect(performed[0]?.actor).toMatchObject({ kind: "person", sessionId: "phone" });
    expect(cards[1]?.answered).toBe("allow");
  });

  it("does not run an admin write from a narrower session of the same person", async () => {
    const box = harness({ session: { id: "wide", scopes: ["admin", "client"] } });
    const held = await box.service.handle({ facts: facts(), raw: { method: "POST", path: "/api/admin/settings", body: { a: 1 } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(held.body.held).toBe(true);
    const refused = await box.service.confirm({ threadId: "t", requestId: box.cards[0]!.requestId, behavior: "allow", answerer: box.answerer({ scopes: ["client"], admin: false }), sharedServer: false });
    expect(refused).toMatchObject({ handled: true, status: 403 });
    expect(box.performed).toEqual([]);
    expect(box.cards[0]?.answered).toBeUndefined();
  });

  it("holds a write in auto, runs an ordinary write in full, and refuses unproven turns", async () => {
    const { service, performed } = harness({ mode: "auto" });
    const held = await service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots", body: { name: "Bea" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "auto" });
    expect(held.status).toBe(200);
    expect(held.body.held).toBe(true);
    expect(performed).toHaveLength(0);
    const full = harness({ mode: "full" });
    const ran = await full.service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots", body: { name: "Bea" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(ran.status).toBe(200);
    expect(full.performed).toHaveLength(1);
    const escalated = await full.service.handle({ facts: facts(), raw: { ui: "decideRequest", input: { threadId: "t2", requestId: "r1", behavior: "allow" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(escalated.status).toBe(403);
    expect(full.performed).toHaveLength(1);
    // widening who gets a bot's team-memory cards waits on a card at every
    // level, even Full; narrowing to private is an ordinary write
    const widened = await full.service.handle({ facts: facts(), raw: { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "shared" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(widened.status).toBe(200);
    expect(widened.body.held).toBe(true);
    expect(full.cards).toHaveLength(1);
    expect(full.performed).toHaveLength(1);
    const narrowed = await full.service.handle({ facts: facts(), raw: { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "private" } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.held).toBeUndefined();
    expect(full.performed).toHaveLength(2);
    for (const reason of [
      { automation: true },
      { guest: true },
      { requestUsable: false },
      { senderUnproven: true },
    ] as const) {
      const refused = await service.handle({ facts: facts(reason), raw: { method: "GET", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
      expect(refused.status, JSON.stringify(reason)).toBe(403);
    }
    expect(performed).toHaveLength(0);
    const missing = harness({ session: null });
    const gone = await missing.service.handle({ facts: facts(), raw: { method: "GET", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(gone).toMatchObject({ status: 403 });
  });

  it("acts as the desktop owner only when the turn is unproven on a personal server", async () => {
    const personal = harness();
    const ran = await personal.service.handle({ facts: facts({ provenPerson: null }), raw: { method: "GET", path: "/api/admin/settings" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(ran.status).toBe(200);
    expect(personal.performed[0]?.actor).toEqual({ kind: "operator" });
    const shared = harness();
    const refused = await shared.service.handle({ facts: facts({ provenPerson: null, sharedServer: true }), raw: { method: "GET", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" });
    expect(refused.status).toBe(403);
    expect(shared.performed).toEqual([]);
  });

  it("refuses /api/internal and an internal frame, and broadcasts a screen change to that person", async () => {
    const { service, broadcasts, performed } = harness();
    expect((await service.handle({ facts: facts(), raw: { method: "GET", path: "/api/internal/agents" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" })).status).toBe(400);
    expect((await service.handle({ facts: facts(), raw: { ui: "hydrate" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "full" })).status).toBe(400);
    const screen = await service.handle({ facts: facts(), raw: { ui: "showTeamMap" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(screen).toMatchObject({ status: 200, body: { text: "Done.", status: 200 } });
    expect(broadcasts).toEqual([{ audience: person, command: "showTeamMap", input: {} }]);
    expect(performed).toEqual([]);
  });

  it("lets the owner allow an operator action, and refuses a member or a service", async () => {
    const box = harness();
    await box.service.handle({ facts: facts({ provenPerson: null }), raw: { method: "POST", path: "/api/admin/settings", body: { a: 1 } }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    const id = box.cards[0]!.requestId;
    const member = await box.service.confirm({ threadId: "t", requestId: id, behavior: "allow", answerer: box.answerer(), sharedServer: false });
    expect(member).toMatchObject({ status: 403 });
    const service = await box.service.confirm({ threadId: "t", requestId: id, behavior: "allow", answerer: { kind: "service" }, sharedServer: false });
    expect(service).toMatchObject({ status: 403 });
    const shared = await box.service.confirm({ threadId: "t", requestId: id, behavior: "allow", answerer: { kind: "operator" }, sharedServer: true });
    expect(shared).toMatchObject({ status: 403 });
    expect(box.performed).toEqual([]);
    const admin = await box.service.confirm({
      threadId: "t", requestId: id, behavior: "allow", sharedServer: false,
      answerer: { kind: "session", personKey: "admin-person", sessionId: "admin-device", scopes: ["admin"], admin: true },
    });
    expect(admin).toMatchObject({ status: 200 });
    expect(box.performed[0]?.actor).toMatchObject({ kind: "person", sessionId: "admin-device" });

    await box.service.handle({ facts: facts({ provenPerson: null }), raw: { ui: "showChat" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(box.broadcasts.at(-1)?.audience).toBe("operator");
  });

  it("answers only allow or deny, expires a stale card, and does not run twice", async () => {
    const box = harness();
    await box.service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    const id = box.cards[0]!.requestId;
    const answered = await box.service.confirm({ threadId: "t", requestId: id, behavior: "answer", answerer: box.answerer(), sharedServer: false });
    expect(answered).toMatchObject({ status: 400 });
    expect(box.cards[0]?.answered).toBeUndefined();
    box.setNow(25 * 60 * 60 * 1000);
    const expired = await box.service.confirm({ threadId: "t", requestId: id, behavior: "allow", answerer: box.answerer(), sharedServer: false });
    expect(expired).toMatchObject({ status: 409 });
    expect(box.cards[0]?.expired).toBe(true);
    expect(box.performed).toEqual([]);
  });

  it("stops at 32 waiting actions", async () => {
    const box = harness();
    for (let i = 0; i < 32; i += 1) {
      const held = await box.service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
      expect(held.body.held).toBe(true);
    }
    const blocked = await box.service.handle({ facts: facts(), raw: { method: "POST", path: "/api/bots" }, threadId: "t", botId: "b", botName: "Ada", botColor: "green", mode: "ask" });
    expect(blocked.status).toBe(429);
  });
});
