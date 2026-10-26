// My Chrome's settings routes with a real service on a throwaway data folder:
// who may use them, POST only, and the person's flow (turn on, allow a site,
// stop, resume, revoke).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MyChromeService } from "../browser/my-chrome/service.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createMyChromeRoutes } from "./my-chrome.ts";
import { PASS } from "./table.ts";

let server: Server;
let base = "";
let dir = "";
let service: MyChromeService;
let allowed = true;
let stopped = 0;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sagax-mychrome-route-"));
  allowed = true;
  stopped = 0;
  service = new MyChromeService({ dataDir: dir, organization: false, onStopped: () => { stopped += 1; } });
  const handler = createMyChromeRoutes({ service: () => service, allowed: () => allowed, botFor: () => null, botsWithShell: () => [] });
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
  await service.close();
  await removeTempDir(dir);
});

const post = async (action: string, body: unknown = {}) => {
  const res = await fetch(`${base}/api/my-chrome/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};

describe("/api/my-chrome", () => {
  it("answers POST only, and only the person or an admin", async () => {
    expect((await fetch(`${base}/api/my-chrome/status`)).status).toBe(405);
    allowed = false;
    expect((await post("status")).status).toBe(403);
    expect((await post("enable", { enabled: true })).status).toBe(403);
    expect(service.status().enabled).toBe(false);
  });

  it("turns on, allows and revokes a site, stops in one call and resumes", async () => {
    const first = await post("status");
    expect(first.body).toMatchObject({ offered: true, enabled: false, sites: [], stopped: false, driving: [], connected: false });
    expect((await post("enable", { enabled: "yes" })).status).toBe(400);
    expect((await post("enable", { enabled: true })).body.unavailable).toMatch(/No site/);
    expect((await post("sites", { site: "*.bank.example" })).status).toBe(400);
    const site = await post("sites", { site: "https://bank.example/login" });
    expect(site.body.sites).toEqual([expect.objectContaining({ origin: "https://bank.example" })]);
    expect(site.body.unavailable).toBeNull();
    const stop = await post("stop");
    expect(stop.body).toMatchObject({ stopped: true });
    expect(stop.body.unavailable).toMatch(/stopped/);
    expect(stopped).toBe(1);
    expect((await post("resume")).body).toMatchObject({ stopped: false, unavailable: null });
    expect((await post("sites/revoke", { site: "https://bank.example" })).body.sites).toEqual([]);
    expect((await post("address", { address: "http://192.168.0.2:9222" })).status).toBe(400);
    expect((await post("address", { address: "9222" })).body.chromeAddress).toBe("9222");
    expect((await post("nope")).status).toBe(404);
  });
});
