import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createViewerBotOverrideStore } from "./viewer-bot-overrides.ts";
import { createViewerBotOverrideRoutes, VIEWER_BOT_OVERRIDES_PATH } from "../routes/viewer-bot-overrides.ts";
import { PASS } from "../routes/table.ts";
import { CLIENT_ALLOW } from "../auth/request-auth.ts";
import { readFileSync as readSource } from "node:fs";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";

describe("viewer bot override store", () => {
  it("keeps each person's choices apart and never writes a bot record", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-overrides-"));
    const store = createViewerBotOverrideStore(dir, () => 1000);
    const ownerBot = { id: "bot-1", ownerUserId: BOB, modelSelection: { instanceId: "claude", model: "opus" }, notifications: true };
    const before = JSON.parse(JSON.stringify(ownerBot));
    expect(store.put(ADA, "bot-1", { model: { instanceId: "grok", model: "grok-4" }, effort: "low", notifications: false })).toMatchObject({
      model: { instanceId: "grok", model: "grok-4" }, effort: "low", notifications: false,
    });
    expect(store.getOne(BOB, "bot-1")).toBeUndefined();
    expect(ownerBot).toEqual(before);
    const again = createViewerBotOverrideStore(dir);
    expect(again.getOne(ADA, "bot-1")?.model).toEqual({ instanceId: "grok", model: "grok-4" });
    const file = readFileSync(join(dir, "viewer-bot-overrides.json"), "utf8");
    expect(file).not.toContain("modelSelection");
    expect(file).toContain(ADA);
    expect(file).not.toContain(BOB);
    if (process.platform !== "win32") expect(statSync(join(dir, "viewer-bot-overrides.json")).mode & 0o777).toBe(0o600);
    expect(() => store.getAll("local-owner")).toThrow(/not a person/);
  });
});

type Answer = { status: number; body: unknown };
function call(route: ReturnType<typeof createViewerBotOverrideRoutes>, input: { method: string; auth: unknown; body?: unknown; path?: string; type?: string }) {
  let answer: Answer | null = null;
  const res = {} as never;
  const path = input.path ?? VIEWER_BOT_OVERRIDES_PATH;
  return route({
    req: { headers: { "content-type": input.type ?? "application/json" } } as never,
    res, url: new URL(`http://x${path}`), path, method: input.method,
    auth: input.auth as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/bot-overrides", () => {
  const session = (principalId?: string) => ({ kind: "session", scopes: ["client"], session: { id: "s1", principalId } });
  const bots = new Map<string, { ownerUserId: string; modelSelection: { instanceId: string; model: string }; notifications: boolean }>([
    ["bot-1", { ownerUserId: BOB, modelSelection: { instanceId: "claude", model: "opus" }, notifications: true }],
  ]);

  it("stores the viewer's choice and leaves the owner's bot as it was", async () => {
    const store = createViewerBotOverrideStore(mkdtempSync(join(tmpdir(), "omb-overrides-")));
    const route = createViewerBotOverrideRoutes({
      store,
      organization: () => true,
      bot: (id) => bots.get(id) ?? null,
    });
    const snapshot = JSON.parse(JSON.stringify(bots.get("bot-1")));
    expect(await call(route, { method: "GET", auth: session(ADA), path: "/api/me/engines" })).toBe("PASS");
    expect(await call(route, {
      method: "PUT", auth: session(ADA), path: "/api/me/bot-overrides/bot-1",
      body: { model: { instanceId: "grok", model: "grok-4" }, effort: "low", notifications: false },
    })).toMatchObject({ status: 200, body: { botId: "bot-1", override: { model: { instanceId: "grok", model: "grok-4" } } } });
    expect(bots.get("bot-1")).toEqual(snapshot);
    expect(await call(route, { method: "GET", auth: session(ADA) })).toMatchObject({
      status: 200,
      body: { overrides: { "bot-1": { notifications: false } } },
    });
    expect(await call(route, { method: "GET", auth: session(BOB) })).toMatchObject({ status: 200, body: { overrides: {} } });
    expect(await call(route, {
      method: "PUT", auth: session(BOB), path: "/api/me/bot-overrides/bot-1",
      body: { model: { instanceId: "grok", model: "grok-4" } },
    })).toMatchObject({ status: 403, body: { code: "owner_bot_settings" } });
    expect(store.getOne(BOB, "bot-1")).toBeUndefined();
    expect(await call(route, { method: "PUT", auth: session(ADA), path: "/api/me/bot-overrides/missing", body: { notifications: true } })).toMatchObject({ status: 404 });
    expect(await call(route, { method: "PUT", auth: session(ADA), path: "/api/me/bot-overrides/bot-1", body: { soul: "no" } })).toMatchObject({ status: 400 });
    expect(await call(route, { method: "PUT", auth: session(ADA), path: "/api/me/bot-overrides/bot-1", type: "text/plain", body: { notifications: true } })).toMatchObject({ status: 415 });
  });

  it("answers only on an organization server", async () => {
    const store = createViewerBotOverrideStore(mkdtempSync(join(tmpdir(), "omb-overrides-")));
    const solo = createViewerBotOverrideRoutes({ store, organization: () => false, bot: () => null });
    expect(await call(solo, { method: "GET", auth: session(ADA) })).toMatchObject({ status: 404 });
    expect(await call(createViewerBotOverrideRoutes({ store, organization: () => true, bot: () => null }), { method: "GET", auth: { kind: "loopback", scopes: ["admin"] } })).toMatchObject({ status: 404 });
  });

  it("is a member route, and the bot PATCH consults the cross-owner refusal", () => {
    const list = CLIENT_ALLOW.find((entry) => entry.path.test(VIEWER_BOT_OVERRIDES_PATH) && entry.methods.includes("GET"));
    const one = CLIENT_ALLOW.find((entry) => entry.path.test("/api/me/bot-overrides/bot-1") && entry.methods.includes("PUT"));
    expect(list?.methods).toEqual(["GET"]);
    expect(list?.feature).toBeUndefined();
    expect(one?.methods).toEqual(["PUT"]);
    const source = readSource(new URL("../index.ts", import.meta.url), "utf8");
    expect(source).toContain("crossOwnerSettingsRefusal");
    expect(source).toContain("owner_bot_settings");
  });
});
