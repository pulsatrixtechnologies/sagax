import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { ToolGrantStore } from "../tool-grants.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import type { BotRuntimeSettings } from "../bot-runtime-settings.ts";
import { createBotRuntimeSettingsRoutes } from "./bot-runtime-settings.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((d) => s.close(d)))); });

const admin: RequestAuth = { kind: "loopback", scopes: ["admin"] };
const session = (principalId: string, admin = false): RequestAuth =>
  ({ kind: "session", scopes: admin ? ["admin", "client"] : ["client"], session: { id: `s-${principalId}`, principalId } } as unknown as RequestAuth);

async function serve(auth: RequestAuth, opts: { global?: BotRuntimeSettings & Record<string, unknown>; turnPayerDefault?: "owner" | "speaker"; sharedHost?: boolean } = {}) {
  const bots = new Map<string, { id: string; name: string; owner: string; turnPayer?: "owner" | "speaker" } & BotRuntimeSettings>([
    ["bot-1", { id: "bot-1", name: "One", owner: "pr_owner" }],
    ["bot-2", { id: "bot-2", name: "Two", owner: "pr_other" }],
  ]);
  const grants = new ToolGrantStore(null, () => NOW);
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const routes = [createBotRuntimeSettingsRoutes({
    bot: (id) => bots.get(id),
    global: () => ({ threads: { maxConcurrentPerBot: 4 }, automaticRecovery: { enabled: false }, ...opts.global }),
    // the owner (with the profile permission) or an admin
    mayManage: (a, bot) => a.kind === "loopback" || a.scopes.includes("admin") ||
      (a.kind === "session" && a.session.principalId === bots.get(bot.id)?.owner),
    isAdmin: (a) => a.kind === "loopback" || a.scopes.includes("admin"),
    checkBackup: (selection) => selection.instanceId === "codex" ? { ok: true, selection } : { ok: false, status: 400, error: "unavailable" },
    save: (id, patch) => { const bot = bots.get(id); if (!bot) return null; Object.assign(bot, patch); return bot; },
    ...(opts.turnPayerDefault ? { turnPayerDefault: () => opts.turnPayerDefault! } : {}),
    ...(opts.sharedHost !== undefined ? { sharedHost: () => opts.sharedHost! } : {}),
    grants,
    audit: (action, _a, _r, detail) => audits.push({ action, detail }),
    now: () => NOW,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { bots, grants, audits, send };
}

describe("a bot's runtime settings (Owner 2026-10-15)", () => {
  it("#1098: the owner sets the bot's turn limits, merged into what it has", async () => {
    const { send, bots } = await serve(session("pr_owner"));
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnLimits: { roomPosts: 10 } })).status).toBe(200);
    const res = await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnLimits: { roomsCreated: 8 } });
    const body = await res.json() as { settings: { turnLimits: Record<string, number> } };
    expect(bots.get("bot-1")!.turnLimits).toEqual({ roomPosts: 10, roomsCreated: 8 });
    expect(body.settings.turnLimits).toEqual({ roomPosts: 10, threadsOpened: 5, roomsCreated: 8 });
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnLimits: { roomPosts: 0 } })).status).toBe(400);
  });

  it("#1098: parallel tasks per person go to 16 on a solo server, at most 10 on a shared host", async () => {
    const solo = await serve(session("pr_owner"), { sharedHost: false });
    expect((await solo.send("PATCH", "/api/bots/bot-1/runtime-settings", { maxParallelPerPerson: 16 })).status).toBe(200);
    expect(solo.bots.get("bot-1")!.maxParallelPerPerson).toBe(16);
    const shared = await serve(session("pr_owner"), { sharedHost: true });
    const refused = await shared.send("PATCH", "/api/bots/bot-1/runtime-settings", { maxParallelPerPerson: 11 });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("parallel_ceiling");
  });

  it("reads the effective values: the server default until the bot has its own", async () => {
    const { send } = await serve(admin);
    const body = await (await send("GET", "/api/bots/bot-1/runtime-settings")).json() as { settings: Record<string, unknown>; stored: Record<string, unknown> };
    expect(body.settings).toEqual({ maxConcurrentThreads: 4, maxParallelPerPerson: 3, busySend: null, automaticRecovery: { enabled: false }, turnPayer: "speaker",
      turnLimits: { roomPosts: 3, threadsOpened: 5, roomsCreated: 4 }, maxParallelPerPersonCeiling: 10 });
    expect(body.stored).toEqual({});
  });

  it("saves on the bot only, and audits what changed", async () => {
    const { send, bots, audits } = await serve(admin);
    const res = await send("PATCH", "/api/bots/bot-1/runtime-settings", { maxConcurrentThreads: 2, busySend: "parallel" });
    expect(res.status).toBe(200);
    expect(bots.get("bot-1")).toMatchObject({ maxConcurrentThreads: 2, busySend: "parallel" });
    expect(bots.get("bot-2")!.maxConcurrentThreads).toBeUndefined();
    expect(audits).toEqual([{ action: "bot.runtime_settings", detail: {
      bot: { id: "bot-1", name: "One" }, changed: ["maxConcurrentThreads", "busySend"],
      before: { maxConcurrentThreads: null, busySend: null }, after: { maxConcurrentThreads: 2, busySend: "parallel" },
    } }]);
    // the same value again changes nothing and writes no row
    await send("PATCH", "/api/bots/bot-1/runtime-settings", { maxConcurrentThreads: 2 });
    expect(audits).toHaveLength(1);
  });

  it("checks the backup model before turning recovery on, never when turning it off", async () => {
    const { send, bots } = await serve(admin);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: true } })).status).toBe(400);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: true, backup: { instanceId: "gone", model: "m" } } })).status).toBe(400);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: true, backup: { instanceId: "codex", model: "m" } } })).status).toBe(200);
    expect(bots.get("bot-1")!.automaticRecovery).toEqual({ enabled: true, backup: { instanceId: "codex", model: "m" } });
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: false, backup: { instanceId: "gone", model: "m" } } })).status).toBe(200);
    expect(bots.get("bot-1")!.automaticRecovery).toEqual({ enabled: false });
  });

  it("refuses bad values and unknown fields", async () => {
    const { send } = await serve(admin);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { maxConcurrentThreads: 0 })).status).toBe(400);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { busySend: "later" })).status).toBe(400);
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { approvalMode: "full" })).status).toBe(400);
    expect((await send("PATCH", "/api/bots/nope/runtime-settings", { maxConcurrentThreads: 2 })).status).toBe(404);
  });

  it("the owner or an admin only; a local service never", async () => {
    expect((await (await serve(session("pr_owner"))).send("PATCH", "/api/bots/bot-1/runtime-settings", { maxConcurrentThreads: 5 })).status).toBe(200);
    expect((await (await serve(session("pr_owner"))).send("PATCH", "/api/bots/bot-2/runtime-settings", { maxConcurrentThreads: 5 })).status).toBe(403);
    expect((await (await serve(session("pr_owner"))).send("GET", "/api/bots/bot-2/runtime-settings")).status).toBe(403);
    expect((await (await serve(session("pr_admin", true))).send("PATCH", "/api/bots/bot-2/runtime-settings", { maxConcurrentThreads: 5 })).status).toBe(200);
    expect((await (await serve({ kind: "loopback", scopes: ["admin"], trust: "service" } as RequestAuth)).send("GET", "/api/bots/bot-1/runtime-settings")).status).toBe(403);
  });
});

describe("a bot's tool access (Owner 2026-10-15)", () => {
  it("grants, lists only this bot's grants, revokes, and audits", async () => {
    const { send, grants, audits } = await serve(admin);
    grants.grant({ kind: "bot", id: "bot-2" }, "agents:read", "x");
    grants.grant({ kind: "user", id: "pr_someone" }, "agents:read", "x");
    const created = await send("POST", "/api/bots/bot-1/tool-grants", { scope: "agents:write" });
    expect(created.status).toBe(201);
    const { grant } = await created.json() as { grant: { id: string; subject: unknown } };
    expect(grant.subject).toEqual({ kind: "bot", id: "bot-1" });
    const list = await (await send("GET", "/api/bots/bot-1/tool-grants")).json() as { grants: Array<{ id: string; state: string }>; mayGrantAdmin: boolean };
    expect(list.grants.map((g) => [g.id, g.state])).toEqual([[grant.id, "active"]]);
    expect(list.mayGrantAdmin).toBe(true);
    expect((await send("POST", `/api/bots/bot-1/tool-grants/${grant.id}/revoke`)).status).toBe(200);
    expect((await send("POST", `/api/bots/bot-1/tool-grants/${grant.id}/revoke`)).status).toBe(404);
    expect(audits.map((a) => a.action)).toEqual(["tool_grants.grant", "tool_grants.revoke"]);
  });

  it("never reaches another bot's or a person's grant", async () => {
    const { send, grants } = await serve(admin);
    const other = grants.grant({ kind: "bot", id: "bot-2" }, "agents:read", "x");
    const person = grants.grant({ kind: "user", id: "pr_someone" }, "agents:read", "x");
    expect((await send("POST", `/api/bots/bot-1/tool-grants/${other.id}/revoke`)).status).toBe(404);
    expect((await send("POST", `/api/bots/bot-1/tool-grants/${person.id}/revoke`)).status).toBe(404);
    expect(grants.active().length).toBe(2);
    // the body names no subject: the bot is the one in the path
    expect((await send("POST", "/api/bots/bot-1/tool-grants", { subject: { kind: "user", id: "pr_x" }, scope: "agents:read" })).status).toBe(400);
  });

  it("the owner grants every tier in their own environment; a scope past it stays an admin's, within 30 days (Owner 2026-10-26)", async () => {
    const owner = await serve(session("pr_owner"));
    expect((await owner.send("POST", "/api/bots/bot-1/tool-grants", { scope: "agents:write" })).status).toBe(201);
    // create_agent (agents:admin) makes a temporary agent of the owner's own: theirs to grant
    expect((await owner.send("POST", "/api/bots/bot-1/tool-grants", { scope: "agents:admin", expiresAt: NOW + 7 * DAY })).status).toBe(201);
    expect((await owner.send("POST", "/api/bots/bot-1/tool-grants", { scope: "agents:admin" })).status).toBe(400);
    const refused = await owner.send("POST", "/api/bots/bot-1/tool-grants", { scope: "org:admin", expiresAt: NOW + DAY });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("org_scope_admin_only");
    for (const scope of ["members:admin", "billing:admin", "fleet:admin", "tool-grants:admin"]) {
      expect((await owner.send("POST", "/api/bots/bot-1/tool-grants", { scope, expiresAt: NOW + DAY })).status).toBe(403);
    }
    const listed = (await (await owner.send("GET", "/api/bots/bot-1/tool-grants")).json()) as { mayGrantAdmin: boolean; adminOnlyAreas: string[] };
    expect(listed.mayGrantAdmin).toBe(true);
    expect(listed.adminOnlyAreas).toEqual(expect.arrayContaining(["org", "members", "billing", "fleet"]));
    expect((await owner.send("GET", "/api/bots/bot-2/tool-grants")).status).toBe(403);
    const adminServer = await serve(admin);
    expect((await adminServer.send("POST", "/api/bots/bot-1/tool-grants", { scope: "org:admin" })).status).toBe(400);
    expect((await adminServer.send("POST", "/api/bots/bot-1/tool-grants", { scope: "org:admin", expiresAt: NOW + 31 * DAY })).status).toBe(400);
    expect((await adminServer.send("POST", "/api/bots/bot-1/tool-grants", { scope: "org:admin", expiresAt: NOW + 7 * DAY })).status).toBe(201);
  });
});

describe("gate and tool policy", () => {
  it("member sessions reach the handler, which decides", () => {
    expect(requiredScope("GET", "/api/bots/b1/runtime-settings")).toBe("client");
    expect(requiredScope("PATCH", "/api/bots/b1/runtime-settings")).toBe("client");
    expect(requiredScope("POST", "/api/bots/b1/tool-grants")).toBe("client");
    expect(requiredScope("POST", "/api/bots/b1/tool-grants/tg_x/revoke")).toBe("client");
  });

  it("no agent tool may use them: a bot never raises its own limits or grants itself anything", () => {
    const rows = TOOL_POLICY_ROWS.filter((row) => row.route.includes("runtime-settings") || (row.route.includes("api\\/bots") && row.route.includes("tool-grants")));
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.tier).toBe("admin");
      expect(row.defaultEnabled).toBe(false);
    }
  });
});

describe("who pays for a bot's replies (#1137)", () => {
  it("reads the default until the bot has its own choice, which the owner sets without an admin", async () => {
    const { send, bots, audits } = await serve(session("pr_owner"), { turnPayerDefault: "owner" });
    const read = async () => await (await send("GET", "/api/bots/bot-1/runtime-settings")).json() as { settings: { turnPayer: string }; stored: Record<string, unknown> };
    expect((await read()).settings.turnPayer).toBe("owner");
    const res = await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnPayer: "speaker" });
    expect(res.status).toBe(200);
    expect(bots.get("bot-1")!.turnPayer).toBe("speaker");
    expect(await read()).toMatchObject({ settings: { turnPayer: "speaker" }, stored: { turnPayer: "speaker" } });
    expect(audits.at(-1)).toMatchObject({ action: "bot.runtime_settings", detail: { changed: ["turnPayer"], before: { turnPayer: null }, after: { turnPayer: "speaker" } } });
    // null goes back to the default
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnPayer: null })).status).toBe(200);
    expect(bots.get("bot-1")!.turnPayer).toBeUndefined();
    expect(await read()).toMatchObject({ settings: { turnPayer: "owner" }, stored: {} });
  });

  it("refuses another person's bot and an unknown value", async () => {
    const { send, bots } = await serve(session("pr_owner"));
    expect((await send("PATCH", "/api/bots/bot-2/runtime-settings", { turnPayer: "owner" })).status).toBe(403);
    expect(bots.get("bot-2")!.turnPayer).toBeUndefined();
    expect((await send("PATCH", "/api/bots/bot-1/runtime-settings", { turnPayer: "admin" })).status).toBe(400);
  });
});
