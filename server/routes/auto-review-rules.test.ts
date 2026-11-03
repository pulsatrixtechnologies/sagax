import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CommandAllowlistStore } from "../command-allowlist.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createAutoReviewRuleRoutes } from "./auto-review-rules.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function serve(auth: RequestAuth) {
  const dir = mkdtempSync(join(tmpdir(), "omb-rules-"));
  dirs.push(dir);
  const store = new CommandAllowlistStore(join(dir, "command-allowlist.json"));
  store.add("bot-a", { command: "npm test", cwd: dir, providerInstanceId: "claude" });
  store.add("bot-b", { command: "make lint", cwd: dir, providerInstanceId: "codex" });
  const routes = [createAutoReviewRuleRoutes({
    bots: () => [{ id: "bot-a", name: "Alpha" }, { id: "bot-b", name: "Beta" }],
    rules: (botId) => store.list(botId),
    remove: (botId, ruleId) => store.remove(botId, ruleId),
    mayManage: (caller) => (caller.kind === "loopback" ? caller.trust !== "service" : caller.scopes.includes("admin")),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auto-review/rules`;
}

describe("auto-review rules", () => {
  it("stay admin scope for sessions", () => {
    expect(requiredScope("GET", "/api/auto-review/rules")).toBe("admin");
    expect(requiredScope("DELETE", "/api/auto-review/rules/cmd.a.b")).toBe("admin");
  });

  it("lists every bot's saved rules with a count, and removes one", async () => {
    const base = await serve({ kind: "loopback", scopes: ["admin", "client"] });
    const listed = await (await fetch(base)).json() as { rules: Array<{ id: string; botName: string; command: string }>; global: unknown[]; total: number };
    expect(listed.total).toBe(2);
    expect(listed.global).toEqual([]);
    expect(listed.rules.map((rule) => [rule.botName, rule.command])).toEqual([["Alpha", "npm test"], ["Beta", "make lint"]]);
    expect(listed.rules[0]!.id).toMatch(/^cmd\.bot-a\.[0-9a-f-]{36}$/);
    const after = await (await fetch(`${base}/${listed.rules[0]!.id}`, { method: "DELETE" })).json() as { total: number };
    expect(after.total).toBe(1);
    expect((await fetch(`${base}/${listed.rules[0]!.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/cmd.ghost.x`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  });

  it("refuses anyone who may not manage command permissions", async () => {
    const base = await serve({ kind: "loopback", scopes: ["client"], trust: "service" });
    expect((await fetch(base)).status).toBe(403);
  });
});
