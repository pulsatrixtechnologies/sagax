import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import type { ThreadFile } from "../threads/thread-files.ts";
import { createBotLibraryRoutes, type BotLibraryRouteDeps } from "./bot-library.ts";
import { dispatchRoutes } from "./table.ts";

type Bot = { id: string; owner: string };
const BOTS: Record<string, Bot> = { scout: { id: "scout", owner: "ada" } };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

const member = (who: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: who, label: who, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
});

async function serve(auth: RequestAuth, deps: Partial<BotLibraryRouteDeps<Bot>> = {}): Promise<string> {
  const routes = [createBotLibraryRoutes<Bot>({
    bot: (id) => BOTS[id],
    threadsFor: () => ["t1", "t2"],
    messages: (threadId) => threadId === "t1"
      ? [{ id: "m1", kind: "text", text: "https://a.test/1 https://b.test/2", at: 1 }]
      : [{ id: "m2", kind: "text", text: "https://c.test/3", at: 2 }],
    files: async (threadId): Promise<ThreadFile[]> => [{
      id: (threadId === "t1" ? "a" : "b").repeat(24), messageId: "m", source: "attachment", path: "/x", at: threadId === "t1" ? 1 : 2,
      name: threadId === "t1" ? "p.png" : "r.pdf", mime: threadId === "t1" ? "image/png" : "application/pdf", size: 1, available: true,
    }],
    mayExport: (caller, bot) => caller.kind === "loopback" || (caller.kind === "session" && caller.session.id === bot.owner),
    exportBot: (bot) => ({ document: { format: "openmausbot.package", version: 2, bots: [bot.id] }, filename: "scout.json" }),
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline" });
    } catch (error) { json(res, 500, { error: String(error) }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("bot library routes", () => {
  it("are member scope; the export checks the owner in its handler", () => {
    expect(requiredScope("GET", "/api/bots/scout/links")).toBe("client");
    expect(requiredScope("GET", "/api/bots/scout/files")).toBe("client");
    expect(requiredScope("POST", "/api/bots/scout/export")).toBe("client");
    expect(requiredScope("POST", "/api/bots/scout/links")).toBe("admin");
  });

  it("pages links newest first", async () => {
    const base = await serve(member("ada"));
    const first = await (await fetch(`${base}/api/bots/scout/links?limit=2`)).json() as { links: Array<{ url: string }>; nextCursor: string; total: number };
    expect(first.total).toBe(3);
    expect(first.links.map((link) => link.url)).toEqual(["https://c.test/3", "https://a.test/1"]);
    const second = await (await fetch(`${base}/api/bots/scout/links?limit=2&cursor=${first.nextCursor}`)).json() as { links: Array<{ url: string }>; nextCursor: null };
    expect(second).toMatchObject({ links: [{ url: "https://b.test/2" }], nextCursor: null });
    expect((await fetch(`${base}/api/bots/scout/links?cursor=x`)).status).toBe(400);
    expect((await fetch(`${base}/api/bots/nobody/links`)).status).toBe(404);
  });

  it("merges files and filters media", async () => {
    const base = await serve(member("ada"));
    const media = await (await fetch(`${base}/api/bots/scout/files?kind=media`)).json() as { files: Array<{ name: string; previewUrl?: string }> };
    expect(media.files).toEqual([expect.objectContaining({ name: "p.png", previewUrl: `/api/threads/t1/files/${"a".repeat(24)}?preview=1` })]);
    const all = await (await fetch(`${base}/api/bots/scout/files`)).json() as { files: Array<{ name: string }> };
    expect(all.files.map((file) => file.name)).toEqual(["r.pdf", "p.png"]);
    expect((await fetch(`${base}/api/bots/scout/files?kind=video`)).status).toBe(400);
  });

  it("exports for the owner only and passes a refusal through", async () => {
    expect((await fetch(`${await serve(member("bob"))}/api/bots/scout/export`, { method: "POST" })).status).toBe(403);
    const ok = await fetch(`${await serve(member("ada"))}/api/bots/scout/export`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ filename: "scout.json", document: { version: 2 } });
    const refused = await fetch(`${await serve(member("ada"), { exportBot: () => { throw Object.assign(new Error("Too large"), { status: 400 }); } })}/api/bots/scout/export`, { method: "POST" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "Too large" });
  });
});
