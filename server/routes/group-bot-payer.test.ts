import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TurnPayerMode } from "../../shared/turn-payer.ts";
import { createGroupBotPayerRoutes, type GroupBotPayerGroup } from "./group-bot-payer.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((d) => s.close(d)))); });

const session = (principalId: string, admin = false): RequestAuth =>
  ({ kind: "session", scopes: admin ? ["admin", "client"] : ["client"], session: { id: `s-${principalId}`, principalId } } as unknown as RequestAuth);

async function serve(auth: RequestAuth, organization = true) {
  const owners: Record<string, string> = { "bot-1": "pr_owner", "bot-2": "pr_other", "bot-3": "pr_owner" };
  const groups = new Map<string, GroupBotPayerGroup>([
    ["room-1", { id: "room-1", name: "Room", memberIds: ["bot-1", "bot-2"] }],
    ["dm-1", { id: "dm-1", dm: true, memberIds: ["bot-1"] }],
  ]);
  const audits: unknown[] = [];
  const routes = [createGroupBotPayerRoutes({
    organization: () => organization,
    group: (id) => groups.get(id),
    bot: (id) => owners[id] ? { id, name: id } : null,
    mayChoose: (a, botId) => a.kind === "session" && (a.scopes.includes("admin") || a.session.principalId === owners[botId]),
    save: (id, botPayers) => { const group = groups.get(id)!; group.botPayers = botPayers as Record<string, TurnPayerMode> | undefined; return group; },
    audit: (_a, _r, detail) => audits.push(detail),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (path: string, body: unknown) => fetch(base + path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { groups, audits, put };
}

describe("a group's override of who pays for one of its bots (#1137)", () => {
  it("the bot's owner sets and clears it for their bot, audited", async () => {
    const { put, groups, audits } = await serve(session("pr_owner"));
    const res = await put("/api/groups/room-1/bot-payer", { botId: "bot-1", turnPayer: "owner" });
    expect(res.status).toBe(200);
    expect(groups.get("room-1")!.botPayers).toEqual({ "bot-1": "owner" });
    expect(audits).toEqual([{ group: { id: "room-1", name: "Room" }, bot: { id: "bot-1", name: "bot-1" }, before: null, after: "owner" }]);
    expect((await put("/api/groups/room-1/bot-payer", { botId: "bot-1", turnPayer: null })).status).toBe(200);
    expect(groups.get("room-1")!.botPayers).toBeUndefined();
  });

  it("never someone else's bot, a bot outside the group, a direct conversation or a bad value", async () => {
    const { put, groups } = await serve(session("pr_owner"));
    const other = await put("/api/groups/room-1/bot-payer", { botId: "bot-2", turnPayer: "owner" });
    expect(other.status).toBe(403);
    expect((await other.json() as { code: string }).code).toBe("bot_payer_owner_only");
    expect((await put("/api/groups/room-1/bot-payer", { botId: "bot-3", turnPayer: "owner" })).status).toBe(404);
    expect((await put("/api/groups/dm-1/bot-payer", { botId: "bot-1", turnPayer: "owner" })).status).toBe(404);
    expect((await put("/api/groups/room-1/bot-payer", { botId: "bot-1", turnPayer: "everyone" })).status).toBe(400);
    expect(groups.get("room-1")!.botPayers).toBeUndefined();
  });

  it("an admin may choose for any bot; a solo server has no such setting", async () => {
    expect((await (await serve(session("pr_admin", true))).put("/api/groups/room-1/bot-payer", { botId: "bot-2", turnPayer: "speaker" })).status).toBe(200);
    expect((await (await serve(session("pr_owner"), false)).put("/api/groups/room-1/bot-payer", { botId: "bot-1", turnPayer: "owner" })).status).toBe(404);
  });
});
