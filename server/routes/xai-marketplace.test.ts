// GET /api/team-library/xai and /api/team-library/xai/bots/:slug
// (server/routes/xai-marketplace.ts), with a stubbed x.ai: the list, one
// bot, refresh, and a source error as { error, code }.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { XaiMarketplaceSource } from "../plugins/xai-marketplace.ts";
import { PASS } from "./table.ts";
import { createXaiMarketplaceRoutes } from "./xai-marketplace.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8");
let server: Server;
let base = "";
let status = 200;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  status = 200;
  fetcher = vi.fn(async (url: string) => new Response(status === 200 ? fixture(url.endsWith("/marketplace") ? "xai-marketplace-list.html" : "xai-marketplace-bot.html") : "", { status }));
  const handler = createXaiMarketplaceRoutes({ source: new XaiMarketplaceSource({ fetcher: fetcher as unknown as typeof fetch }) });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handler({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("xAI Bot Marketplace routes", () => {
  it("lists the bots, then one bot, from what was read", async () => {
    const list = await get("/api/team-library/xai");
    expect(list.status).toBe(200);
    expect((list.body.bots as Array<{ slug: string }>).map((bot) => bot.slug)).toEqual(["demo-helper", "sample-desk", "test-coach"]);
    const one = await get("/api/team-library/xai/bots/sample-desk");
    expect(one.status).toBe(200);
    expect((one.body.bot as { routines: unknown[] }).routines).toHaveLength(3);
    await get("/api/team-library/xai");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await get("/api/team-library/xai?refresh=1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("answers a clear code when x.ai is out of reach or the bot is gone, and refuses a write", async () => {
    status = 503;
    expect(await get("/api/team-library/xai")).toMatchObject({ status: 502, body: { code: "xai_unreachable" } });
    status = 404;
    expect(await get("/api/team-library/xai/bots/gone-bot")).toMatchObject({ status: 404, body: { code: "xai_not_found" } });
    expect((await get("/api/team-library/xai", { method: "POST" })).status).toBe(405);
    expect((await get("/api/team-library/other")).body).toEqual({ error: "pass" });
  });
});
