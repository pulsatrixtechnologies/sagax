// Security review of the security keys (2026-10-16): removing, turning off
// or loosening a deny or ask rule needs the person's key when they chose
// "rule-change". The routes ask `stepUp`; this records what they asked.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CustomRuleStore } from "../rules/custom-rules-store.ts";
import { json, readBody } from "../harness/http.ts";
import { OwnerApprovalStore } from "../approvals/owner-approval-store.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createCustomRuleRoutes } from "./custom-rules.ts";
import { createOwnerApprovalRoutes } from "./owner-approvals.ts";
import { dispatchRoutes, type RouteHandler } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ME = "pr_alice";

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-rules-step-up-"));
  dirs.push(dir);
  const asked: string[] = [];
  const stepUp = (_auth: RequestAuth, _person: string, action: string, _detail: Record<string, unknown>, given: unknown) => {
    asked.push(action);
    return given === "ok" ? null : { status: 403, body: { code: "step_up_required", action } };
  };
  const custom = new CustomRuleStore(join(dir, "custom.json"));
  const owner = new OwnerApprovalStore(join(dir, "owner.json"));
  const routes: RouteHandler[] = [
    createCustomRuleRoutes({ store: custom, manager: () => ME, ownedBots: () => [{ id: "bot-a", name: "Alpha" }], audit: () => {}, home: "/Users/alice", stepUp }),
    createOwnerApprovalRoutes({
      store: owner, manager: () => ME,
      ownedBots: () => [{ id: "bot-a", name: "Alpha", threadId: "t-a", alwaysAllow: ["mcp:files__read"] }],
      ownerOf: () => ME, describeLegacy: (key) => key, revokeLegacy: () => {},
      audit: () => {}, stepUp,
    }),
  ];
  const auth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  return { call, asked, custom, owner };
}

describe("custom rules: loosening a deny or ask rule needs the key", () => {
  it("removing, turning off or softening a deny rule asks; an allow rule does not", async () => {
    const { call, asked } = await serve();
    const deny = (await call("/api/custom-rules", "POST", { when: "la suppression de fichiers", behavior: "deny", botId: null }, )).body.rule;
    expect(asked).toEqual([]);
    expect((await call(`/api/custom-rules/${deny.id}`, "DELETE", {})).body).toMatchObject({ code: "step_up_required", action: "rules.remove" });
    expect((await call(`/api/custom-rules/${deny.id}`, "PATCH", { enabled: false })).status).toBe(403);
    expect((await call(`/api/custom-rules/${deny.id}`, "PATCH", { behavior: "ask" })).status).toBe(403);
    expect((await call(`/api/custom-rules/${deny.id}`, "PATCH", { when: "la suppression de fichiers dans /tmp" })).status).toBe(403);
    expect((await call(`/api/custom-rules/${deny.id}`, "DELETE", { stepUp: "ok" })).status).toBe(200);
    const ask = (await call("/api/custom-rules", "POST", { when: "l'envoi de courriel", behavior: "ask", botId: null })).body.rule;
    // ask to deny tightens
    expect((await call(`/api/custom-rules/${ask.id}`, "PATCH", { behavior: "deny" })).status).toBe(200);
  });
});

describe("owner rules: removing a deny rule or widening a legacy allow needs the key", () => {
  it("asks for the key", async () => {
    const { call, owner } = await serve();
    const rule = owner.add({ ownerId: ME, botId: "bot-a", tool: "mcp__files__delete", scope: {}, behavior: "deny", description: "never delete" });
    expect((await call(`/api/approval-rules/${rule.id}`, "DELETE")).body).toMatchObject({ action: "rules.remove" });
    expect((await call(`/api/approval-rules/${rule.id}`, "PATCH", { behavior: "ask" })).body).toMatchObject({ action: "rules.remove" });
    expect((await call(`/api/approval-rules/${rule.id}`, "DELETE", { stepUp: "ok" })).status).toBe(200);
    const legacy = (await call("/api/approval-rules", "GET")).body.rules.find((row: any) => row.legacy);
    expect((await call(`/api/approval-rules/${legacy.id}`, "PATCH", { botId: null })).body).toMatchObject({ action: "approval-rules.allow" });
    const allow = owner.add({ ownerId: ME, botId: "bot-a", tool: "mcp__files__read", scope: {}, behavior: "allow", description: "read" });
    // removing an allow rule tightens
    expect((await call(`/api/approval-rules/${allow.id}`, "DELETE")).status).toBe(200);
  });
});
