import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { WorkingBot } from "../computer-working-bots.ts";
import { createComputerWorkingBotsRoutes, type ComputerWorkingBotsRouteDeps } from "./computer-working-bots.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const owner: RequestAuth = { kind: "loopback", trust: "operator" } as unknown as RequestAuth;
const stranger: RequestAuth = { kind: "loopback", trust: "service" } as unknown as RequestAuth;

async function serve(deps: Partial<ComputerWorkingBotsRouteDeps>, auth: RequestAuth = owner) {
  const routes = [createComputerWorkingBotsRoutes({
    guard: () => null,
    list: async () => [],
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/computer/working-bots`;
  return { base };
}

describe("GET /api/computer/working-bots", () => {
  it("answers the working bots with human names and the ids the stop needs", async () => {
    const bots: WorkingBot[] = [
      { id: "b1", name: "Katarina", threadId: "t1" },
      { id: "b2", name: "Ember", threadId: "t2" },
    ];
    const { base } = await serve({ list: async () => bots });
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json() as { bots: WorkingBot[] };
    expect(body).toEqual({ bots });
    // no raw uuid field beyond the id the UI already needs
    for (const bot of body.bots) expect(Object.keys(bot).sort()).toEqual(["id", "name", "threadId"]);
  });

  it("answers an empty list when nothing works on the computer", async () => {
    const { base } = await serve({ list: async () => [] });
    expect(await (await fetch(base)).json()).toEqual({ bots: [] });
  });

  it("refuses a caller the guard rejects, with the gate's status and code", async () => {
    const { base } = await serve({ guard: () => ({ status: 403, body: { error: "forbidden", code: "forbidden" } }) }, stranger);
    const res = await fetch(base);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", code: "forbidden" });
  });

  it("does not run the list when the guard refuses", async () => {
    let listed = false;
    const { base } = await serve({
      guard: () => ({ status: 403, body: { error: "no" } }),
      list: async () => { listed = true; return []; },
    });
    await fetch(base);
    expect(listed).toBe(false);
  });

  it("is GET only", async () => {
    const { base } = await serve({});
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  });

  it("declines other paths", async () => {
    const { base } = await serve({});
    expect((await fetch(base.replace("/working-bots", "/status"))).status).toBe(404);
  });
});
