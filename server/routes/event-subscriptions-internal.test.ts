import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import { createEventSubscriptionsInternalRoutes } from "./event-subscriptions-internal.ts";
import { PASS } from "./table.ts";

type Sub = { id: string; botId: string; ownerId: string; events: string[]; target: unknown };

function setup(over: { speaker?: string; failDestination?: boolean } = {}) {
  const subs: Sub[] = [];
  const owners: Record<string, string> = { "bot-1": "pr_owner", "bot-2": "pr_owner", "bot-x": "pr_other" };
  const routines: Record<string, { id: string; botId: string }> = { r1: { id: "r1", botId: "bot-1" }, r2: { id: "r2", botId: "bot-2" }, rx: { id: "rx", botId: "bot-x" } };
  const route = createEventSubscriptionsInternalRoutes({
    ownsThread: (botId, threadId) => botId === "bot-1" && threadId === "t-1",
    speaker: () => over.speaker,
    botOwner: (botId) => owners[botId],
    routine: (id) => routines[id] as never,
    checkDestination: async () => { if (over.failDestination) throw new Error("private"); },
    store: {
      list: (botId: string) => subs.filter((s) => s.botId === botId),
      get: (botId: string, id: string) => subs.find((s) => s.botId === botId && s.id === id),
      create: (input: Omit<Sub, "id">) => { const sub = { ...input, id: `s${subs.length + 1}` }; subs.push(sub); return sub; },
      remove: (botId: string, id: string) => { const i = subs.findIndex((s) => s.botId === botId && s.id === id); if (i < 0) return false; subs.splice(i, 1); return true; },
      test: async (botId: string, id: string) => (subs.some((s) => s.botId === botId && s.id === id) ? { ok: true, status: 200 } : undefined),
    } as never,
  });
  const call = async (body: Record<string, unknown>, ctx: Partial<InternalRouteContext> = {}) => {
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      res: {} as ServerResponse,
      path: "/api/internal/event-subscriptions",
      method: "POST",
      json: ((_res: ServerResponse, status: number, b: unknown) => { sent.push({ status, body: b }); }) as InternalRouteContext["json"],
      capability: { botId: "bot-1", threadId: "t-1", generation: "g" },
      readBody: async () => body,
      ...ctx,
    });
    return { out, sent, subs };
  };
  return { call, subs };
}

describe("event_subscriptions through the internal bridge (#2700)", () => {
  it("passes other paths and refuses a conversation of another bot", async () => {
    const h = setup();
    expect((await h.call({}, { path: "/api/internal/other" })).out).toBe(PASS);
    expect((await h.call({}, { capability: { botId: "bot-1", threadId: "t-9", generation: "g" } })).sent[0]!.status).toBe(403);
  });

  it("creates, lists, tests and deletes a webhook subscription owned by the speaker", async () => {
    const h = setup({ speaker: "pr_speaker" });
    const created = (await h.call({ action: "create", events: ["run.failed", "bogus"], url: "https://example.com/hook" })).sent[0]!;
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ botId: "bot-1", ownerId: "pr_speaker", events: ["run.failed"], target: { kind: "url", url: "https://example.com/hook" } });
    expect((await h.call({})).sent[0]!.body.subscriptions).toHaveLength(1);
    expect((await h.call({ action: "test", subscriptionId: "s1" })).sent[0]!.body.delivery).toEqual({ ok: true, status: 200 });
    expect((await h.call({ action: "delete", subscriptionId: "s1" })).sent[0]!.status).toBe(200);
    expect(h.subs).toEqual([]);
    expect((await h.call({ action: "delete", subscriptionId: "s1" })).sent[0]!.status).toBe(404);
  });

  it("targets a routine of the same owner only, and needs exactly one target", async () => {
    const h = setup();
    const ok = (await h.call({ action: "create", events: ["run.reported"], routineId: "r2" })).sent[0]!;
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ ownerId: "pr_owner", target: { kind: "routine", botId: "bot-2", routineId: "r2" } });
    expect((await h.call({ action: "create", events: ["run.reported"], routineId: "rx" })).sent[0]!.status).toBe(404);
    expect((await h.call({ action: "create", events: ["run.reported"] })).sent[0]!.status).toBe(400);
    expect((await h.call({ action: "create", events: ["run.reported"], routineId: "r1", url: "https://example.com" })).sent[0]!.status).toBe(400);
    expect((await h.call({ action: "create", events: [], url: "https://example.com" })).sent[0]!.status).toBe(400);
  });

  it("refuses a private destination", async () => {
    const h = setup({ failDestination: true });
    expect((await h.call({ action: "create", events: ["run.quiet"], url: "http://10.0.0.1/x" })).sent[0]!.status).toBe(400);
  });
});
