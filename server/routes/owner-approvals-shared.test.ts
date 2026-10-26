// Review of #938 (2026-10-21): an Always allow someone else saved on an
// admin's card of a member's bot is listed to the bot's owner (and an
// admin) to remove, by the saver's name: never their id, never the real
// folder the command ran in.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { OwnerApprovalStore } from "../owner-approval-store.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createOwnerApprovalRoutes } from "./owner-approvals.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BOB = "pr_bob";
const ALICE = "pr_alice";

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-shared-rules-"));
  dirs.push(dir);
  const store = new OwnerApprovalStore(join(dir, "owner.json"));
  const routes = [createOwnerApprovalRoutes({
    store, manager: () => BOB,
    ownedBots: () => [{ id: "bot-fern", name: "Fern", threadId: "t-fern" }],
    botName: () => "Fern",
    sharedBotRules: (_person, botId) => store.adminRulesForBot(botId),
    personName: (id) => (id === ALICE ? "Alice" : undefined),
    ownerOf: () => BOB, describeLegacy: (key) => key, revokeLegacy: () => {}, bypassRefusal: () => null,
    audit: () => {}, journalMode: () => {},
  })];
  const auth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, get: async (path: string) => (await (await fetch(base + path)).json()) as any };
}

describe("rules saved on an admin's card, as the bot's owner sees them", () => {
  it("names who saved it, never their id nor the real folder", async () => {
    const { store, get } = await serve();
    store.add({ ownerId: ALICE, botId: "bot-fern", tool: "Bash", scope: { program: "npm", cwd: "/srv/sagax/home/bob/projects" }, behavior: "allow", description: "Run npm", from: "admin" });
    const row = (await get("/api/approval-rules?botId=bot-fern")).rules.find((rule: any) => rule.byOther);
    expect(row).toMatchObject({ botId: "bot-fern", scope: { program: "npm" }, byOther: true, savedBy: "Alice", from: "admin", botName: "Fern" });
    expect(row).not.toHaveProperty("ownerId");
    expect(row.scope).not.toHaveProperty("cwd");
  });
});
