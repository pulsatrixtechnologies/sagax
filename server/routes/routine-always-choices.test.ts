// #4558: the person's "always" choices on a routine's cards: listed and
// removed by that person only.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { AlwaysChoice } from "../proactive/answer-learning.ts";
import { createRoutineAlwaysChoicesRoutes } from "./routine-always-choices.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

function session(principalId: string, scopes: string[] = ["client"]): RequestAuth {
  return { kind: "session", via: "cookie", scopes, session: { id: "s", label: "web", scopes, createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId } as never } as RequestAuth;
}

async function serve(auth: RequestAuth, choices: Map<string, AlwaysChoice>) {
  const routes = [createRoutineAlwaysChoicesRoutes({
    scopeOf: (id) => (id === "r1" ? { person: "pr_owner", bot: "b1", routineId: "r1" } : undefined),
    list: () => [...choices.values()],
    forget: (_scope, kind) => choices.delete(kind),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { error: "unrouted" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string) => {
    const res = await fetch(`${base}${path}`, { method });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
}

describe("/api/routines/:id/always-choices (#4558)", () => {
  it("lists the person's choices and removes one", async () => {
    const choices = new Map<string, AlwaysChoice>([["ticket:review", { kind: "ticket:review", answer: "Approve", at: 5 }]]);
    const call = await serve(session("PR_owner"), choices);
    expect(await call("GET", "/api/routines/r1/always-choices")).toEqual({ status: 200, body: { choices: [{ kind: "ticket:review", answer: "Approve", at: 5 }] } });
    expect(await call("DELETE", `/api/routines/r1/always-choices/${encodeURIComponent("ticket:review")}`)).toEqual({ status: 200, body: { ok: true } });
    expect(choices.size).toBe(0);
    expect((await call("DELETE", "/api/routines/r1/always-choices/ticket")).status).toBe(404);
    expect((await call("GET", "/api/routines/r2/always-choices")).status).toBe(404);
  });

  it("never shows nor removes another person's choices, an admin's view included", async () => {
    const choices = new Map<string, AlwaysChoice>([["ticket", { kind: "ticket", answer: "Approve", at: 5 }]]);
    for (const auth of [session("pr_other"), session("pr_admin", ["client", "admin"])]) {
      const call = await serve(auth, choices);
      expect((await call("GET", "/api/routines/r1/always-choices")).status).toBe(404);
      expect((await call("DELETE", "/api/routines/r1/always-choices/ticket")).status).toBe(404);
    }
    expect(choices.size).toBe(1);
  });
});
