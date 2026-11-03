import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createWebBotAuthRoutes } from "./web-bot-auth.ts";
import { WebBotAuthStore, webBotAuthScope } from "../auth/web-bot-auth.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const member = (principalId: string) => ({ kind: "session", via: "bearer", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function harness(organization: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-web-bot-auth-route-"));
  dirs.push(dir);
  const route = createWebBotAuthRoutes({
    store: new WebBotAuthStore(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) })),
    scope: (auth) => webBotAuthScope(organization, auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : null),
  });
  const call = async (method: string, body: unknown, auth: RequestAuth) => {
    let status = 0;
    let sent: unknown;
    const res = { headersSent: false, writableEnded: false, setHeader() {} };
    await route({
      req: { headers: {} } as never, res: res as never, url: new URL("http://x/api/me/web-bot-auth"), path: "/api/me/web-bot-auth", method, auth,
      json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
      readBody: (async () => body) as unknown as typeof readBody,
    });
    return { status, body: sent as Record<string, unknown> };
  };
  return { call };
}

describe("/api/me/web-bot-auth", () => {
  it("needs no admin scope", () => {
    expect(requiredScope("GET", "/api/me/web-bot-auth")).toBe("client");
    expect(requiredScope("PUT", "/api/me/web-bot-auth")).toBe("client");
  });

  it("stays on for the person until they turn it off, and not for someone else", async () => {
    const h = harness(true);
    const ada = member("pr_ada");
    const first = await h.call("GET", undefined, ada);
    expect(first.status).toBe(200);
    expect(first.body.enabled).toBe(true);
    expect(typeof first.body.keyId).toBe("string");
    const off = await h.call("PUT", { enabled: false }, ada);
    expect(off.body.enabled).toBe(false);
    expect((await h.call("GET", undefined, member("pr_bob"))).body.enabled).toBe(true);
    expect(JSON.stringify(off.body)).not.toMatch(/pkcs8/);
  });
});
