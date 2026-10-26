// The sign-in card's Done and Cancel through the route table: each names the
// card's bot, thread and message, and passes the server's answer through.
// Settling itself is covered by server/index.test.ts and the e2e.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createSignInCardRoutes, type SignInOutcome } from "./sign-in-cards.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve() {
  const settled: Array<{ botId: string; threadId: string; messageId: string; outcome: SignInOutcome }> = [];
  const routes = [createSignInCardRoutes({
    settle: (botId, threadId, messageId, outcome) => {
      settled.push({ botId, threadId, messageId, outcome });
      return messageId === "gone" ? { status: 404, body: { error: "no such sign-in request" } } : { status: 200, body: { resumed: true } };
    },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, type = "application/json") => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
  return { base, settled, post };
}

describe("sign-in card routes", () => {
  it("settles Done and Cancel for the named bot, thread and card", async () => {
    const { settled, post } = await serve();
    const done = await post("/api/bots/scout/sign-in-cards/m1/done", { threadId: "t1" });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ resumed: true });
    expect((await post("/api/bots/scout/sign-in-cards/m2/cancel", { threadId: "t2" })).status).toBe(200);
    expect(settled).toEqual([
      { botId: "scout", threadId: "t1", messageId: "m1", outcome: "done" },
      { botId: "scout", threadId: "t2", messageId: "m2", outcome: "cancelled" },
    ]);
  });

  it("passes the server's refusal through", async () => {
    const { post } = await serve();
    const gone = await post("/api/bots/scout/sign-in-cards/gone/done", { threadId: "t1" });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "no such sign-in request" });
  });

  it("leaves other methods and paths to the next route", async () => {
    const { base, settled, post } = await serve();
    expect(await (await fetch(`${base}/api/bots/scout/sign-in-cards/m1/done`)).json()).toEqual({ from: "inline routes" });
    expect(await (await post("/api/bots/scout/sign-in-cards/m1/open", { threadId: "t1" })).json()).toEqual({ from: "inline routes" });
    expect(settled).toEqual([]);
  });

  it("has no saved-login answer: Sagax keeps logins in its credential vault", async () => {
    const { settled, post } = await serve();
    const response = await post("/api/bots/scout/sign-in-cards/m1/save-login", { threadId: "t1", username: "alice", password: "fake-card-pass" });
    expect(await response.json()).toEqual({ from: "inline routes" });
    expect(settled).toEqual([]);
  });
});
