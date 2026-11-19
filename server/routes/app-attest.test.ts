import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createAppAttestStore } from "../attest/store.ts";
import { createAppAttestRoutes } from "./app-attest.ts";
import { dispatchRoutes } from "./table.ts";

const KEY_ID = Buffer.alloc(32, 7).toString("base64");

describe("/api/attest", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve(appId: string | null = "TEAM123456.ca.example.app") {
    const dir = mkdtempSync(join(tmpdir(), "sagax-attest-routes-"));
    dirs.push(dir);
    const store = createAppAttestStore(dir);
    const warnings: string[] = [];
    const routes = [createAppAttestRoutes({
      person: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      store, appId: () => appId ?? undefined, warn: (line) => warnings.push(line),
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/attest/`;
    const call = (action: string, who: string | undefined, body?: unknown) =>
      fetch(base + action, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body ?? {}) })
        .then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
    return { call, warnings };
  }

  it("needs a person, and says when the server cannot verify", async () => {
    const { call } = await serve();
    expect((await call("challenge", undefined)).status).toBe(403);
    const none = await serve(null);
    expect((await none.call("challenge", "pr_a")).body).toEqual({ configured: false });
  });

  it("a challenge is single use and belongs to the person who asked", async () => {
    const { call } = await serve();
    const { challenge } = (await call("challenge", "pr_a")).body as { challenge: string };
    const other = await call("assert", "pr_b", { keyId: KEY_ID, assertion: "AAAA", challenge });
    expect(other.body).toMatchObject({ ok: false, reason: "challenge" });
    const again = await call("assert", "pr_a", { keyId: KEY_ID, assertion: "AAAA", challenge });
    expect(again.body).toMatchObject({ ok: false, reason: "challenge" });
  });

  it("a bad attestation or an unknown key is a log line and ok:false, never an error status", async () => {
    const { call, warnings } = await serve();
    const first = (await call("challenge", "pr_a")).body.challenge;
    const reg = await call("register", "pr_a", { keyId: KEY_ID, attestation: "AAAA", challenge: first });
    expect(reg).toMatchObject({ status: 200, body: { ok: false, reason: "attestation" } });
    expect(warnings[0]).toContain("the phone keeps working");
    expect(warnings[0]).not.toContain(KEY_ID);
    const second = (await call("challenge", "pr_a")).body.challenge;
    expect((await call("assert", "pr_a", { keyId: KEY_ID, assertion: "AAAA", challenge: second })).body).toMatchObject({ ok: false, reason: "unknown_key" });
  });
});
