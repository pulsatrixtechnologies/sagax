import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { OrgBotSecrets } from "./org-bot-secrets.ts";
import { createPerspicaxOrgRoutes } from "./perspicax-org-routes.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { RouteContext } from "./routes/table.ts";

const SECRET = "fake-route-secret-0001";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function routes(role: "admin" | "member") {
  const dir = mkdtempSync(join(tmpdir(), "sagax-team-route-"));
  dirs.push(dir);
  const secrets = new OrgBotSecrets(dir, () => ({ kind: "key", key: Buffer.alloc(32, 6) }));
  return createPerspicaxOrgRoutes({
    issuer: "https://px.example.test",
    orgName: "Acme",
    directory: () => null,
    bySubject: () => null,
    viewerRole: () => role,
    settings: () => ({ orgKeyConfigured: false, allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true }),
    pendingAdminApprovals: () => [],
    botSecrets: { list: () => secrets.list(), change: (change) => secrets.change(change), teamBot: (id) => id === "payroll-bot" },
  });
}

async function call(role: "admin" | "member", method: string, body?: unknown) {
  const out: { status?: number; body?: unknown } = {};
  const auth = { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1" } } as unknown as RequestAuth;
  const ctx = {
    req: {}, res: { setHeader() {} }, url: new URL("http://127.0.0.1/api/org/bot-secrets"),
    path: "/api/org/bot-secrets", method, auth,
    json: (_res: unknown, status: number, payload: unknown) => { out.status = status; out.body = payload; },
    readBody: async () => body,
  } as unknown as RouteContext;
  await routes(role)(ctx);
  return out;
}

describe("/api/org/bot-secrets", () => {
  it("hides the list from a member, including the names", async () => {
    const denied = await call("member", "GET");
    expect(denied).toMatchObject({ status: 403, body: { code: "admin_only" } });
    expect(denied.body).not.toHaveProperty("secrets");
  });

  it("lets an admin save a secret and never sends the value back", async () => {
    const saved = await call("admin", "POST", {
      op: "add", kind: "secret", label: "Shop", value: SECRET,
      injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["payroll-bot"],
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    expect(saved.body).toMatchObject({ secrets: [{ label: "Shop", botIds: ["payroll-bot"] }] });
    const again = await call("member", "GET");
    expect(again.status).toBe(403);
    expect(JSON.stringify(again.body)).not.toContain(SECRET);
  });
});
