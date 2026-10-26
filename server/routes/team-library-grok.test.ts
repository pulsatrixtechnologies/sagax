// POST /api/team-library/grok (port of OpenMausBot #3073): an admin route that
// reads only x.ai's public card, with a stubbed x.ai.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { PASS } from "./table.ts";
import { createTeamLibraryGrokRoutes } from "./team-library-grok.ts";

const ID = "d8OshqLZvtcKDcNluPuyo";
const page = readFileSync(join(import.meta.dirname, "..", "fixtures", "grok-share-page.html"), "utf8");
let server: Server;
let base = "";
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetcher = vi.fn(async () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }));
  const handler = createTeamLibraryGrokRoutes({ fetcher: fetcher as unknown as typeof fetch });
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

const post = async (body: unknown) => {
  const res = await fetch(`${base}/api/team-library/grok`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("POST /api/team-library/grok", () => {
  it("is an admin route, like the GitHub import", () => {
    expect(requiredScope("POST", "/api/team-library/grok")).toBe("admin");
    expect(requiredScope("POST", "/api/team-library/github")).toBe("admin");
  });

  it("answers the public card of an x.ai share link", async () => {
    const answer = await post({ url: `https://x.ai/bot/${ID}` });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ shareId: ID, name: "DOGE (Department of Grok Efficiency)", creator: "Avid", url: `https://x.ai/bot/${ID}` });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing or foreign link without fetching anything", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ url: `https://evil.example/bot/${ID}` })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says when x.ai has no such bot", async () => {
    fetcher.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const answer = await post({ url: `https://x.ai/bot/${ID}` });
    expect(answer.status).toBe(404);
    expect(String(answer.body.error)).toMatch(/not found/);
  });
});
