// /api/mac-apps: the Apple apps of the solo Mac (Mail, Calendar, Contacts,
// Reminders, Notes, Messages). An organization server answers 404 so the
// desktop app takes over; the test runs a mock, never a real osascript.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createMacAppsRoutes } from "./mac-apps.ts";
import { PASS } from "./table.ts";

let server: Server;
let base = "";
let dir = "";
let identityKind: "solo" | "perspicax" = "solo";
const test = vi.fn(async (_dir: string, _app: string) => ({ ok: true, count: 4, names: ["Work", "Home"] }));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sagax-mac-apps-route-"));
  identityKind = "solo";
  test.mockClear();
  const handler = createMacAppsRoutes({ dataDir: dir, host: () => ({ platform: "darwin", identityKind, bridgeAction: false }), test });
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
  await removeTempDir(dir);
});

const put = (body: unknown) => fetch(`${base}/api/mac-apps`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/api/mac-apps", () => {
  it("404s on an organization server so the desktop app answers", async () => {
    identityKind = "perspicax";
    const res = await fetch(`${base}/api/mac-apps`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: "mac_apps_not_on_this_mac" });
  });

  it("lists the six apps off, then turns one on", async () => {
    const first = await (await fetch(`${base}/api/mac-apps`)).json() as { apps: { id: string; enabled: boolean }[] };
    expect(first.apps.map((row) => row.id)).toEqual(["messages", "mail", "calendar", "contacts", "reminders", "notes"]);
    expect(first.apps.every((row) => !row.enabled)).toBe(true);
    const on = await put({ app: "calendar", enabled: true });
    expect(on.status).toBe(200);
    const after = await on.json() as { apps: { id: string; enabled: boolean }[] };
    expect(after.apps.find((row) => row.id === "calendar")?.enabled).toBe(true);
    expect((await put({ app: "terminal", enabled: true })).status).toBe(400);
  });

  it("tests one app through the app call and returns names, never content", async () => {
    const res = await fetch(`${base}/api/mac-apps/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "notes" }) });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, count: 4, names: ["Work", "Home"] });
    expect(test).toHaveBeenCalledWith(dir, "notes");
  });
});
