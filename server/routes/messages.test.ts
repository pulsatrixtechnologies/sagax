import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createMessagesRoutes } from "./messages.ts";
import { PASS } from "./table.ts";

let server: Server;
let base = "";
let dir = "";
let openPrivacyPane = vi.fn(async (_anchor: string) => true);
let identityKind: "solo" | "perspicax" = "solo";
const askAutomation = vi.fn(async (_dataDir: string) => "granted");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sagax-messages-route-"));
  openPrivacyPane = vi.fn(async (_anchor: string) => true);
  identityKind = "solo";
  askAutomation.mockClear();
  const handler = createMessagesRoutes({
    dataDir: dir,
    host: () => ({ platform: "darwin", identityKind, bridgeAction: false }),
    openPrivacyPane: (anchor) => openPrivacyPane(anchor),
    askAutomation,
  });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handler({
      req,
      res,
      url,
      path: url.pathname,
      method: req.method ?? "GET",
      auth: { kind: "loopback" } as unknown as RequestAuth,
      json,
      readBody,
    }).then((out) => {
      if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeTempDir(dir);
});

describe("/api/messages", () => {
  it("404s on an organization server", async () => {
    identityKind = "perspicax";
    const res = await fetch(`${base}/api/messages`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: "messages_not_on_this_mac" });
  });

  it("keeps Messages off until the person enables it", async () => {
    const first = await fetch(`${base}/api/messages`);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ useMessages: false, available: true, onThisMac: true });

    const put = await fetch(`${base}/api/messages`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useMessages: true }),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ useMessages: true, available: true });
  });

  it("opens Full Disk Access settings through the helper", async () => {
    const res = await fetch(`${base}/api/messages/permissions/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane: "fullDiskAccess" }),
    });
    expect(res.status).toBe(200);
    expect(openPrivacyPane).toHaveBeenCalledWith("Privacy_AllFiles");
  });
  it("asks macOS for Automation for Messages through the native layer", async () => {
    const res = await fetch(`${base}/api/messages/permissions/ask`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(askAutomation).toHaveBeenCalledWith(dir);
    await expect(res.json()).resolves.toMatchObject({ available: true, onThisMac: true });
  });
});
