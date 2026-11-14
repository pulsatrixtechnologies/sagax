import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBotSettingsStore, isTimeZone } from "./bot-settings.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createBotSettingsRoutes } from "../routes/bot-settings.ts";
import { dispatchRoutes } from "../routes/table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "omb-bot-settings-")); dirs.push(dir); return dir; };

const session = (scopes: Array<"admin" | "client">, principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes,
  session: { id: "s1", label: "phone", scopes, createdAt: 0, expiresAt: 0, lastUsedAt: 0, ...(principalId ? { principalId } : {}) } as never,
});

describe("bot settings store", () => {
  it("keeps the server's and each person's, with defaults, in a private file", () => {
    const dir = tempDir();
    const store = createBotSettingsStore(dir);
    expect(store.server()).toEqual({ autoReviewDefault: false, timeZone: null, timeZoneAuto: true });
    store.saveServer({ autoReviewDefault: true });
    store.savePerson(ADA, { timeZone: "Asia/Tokyo", timeZoneAuto: false });
    const again = createBotSettingsStore(dir);
    expect(again.server()).toEqual({ autoReviewDefault: true, timeZone: null, timeZoneAuto: true });
    expect(again.person(ADA)).toEqual({ autoReviewDefault: false, timeZone: "Asia/Tokyo", timeZoneAuto: false });
    if (process.platform !== "win32") expect(statSync(join(dir, "bot-settings.json")).mode & 0o777).toBe(0o600);
    again.forgetPerson(ADA);
    expect(JSON.parse(readFileSync(join(dir, "bot-settings.json"), "utf8")).people).toEqual({});
    expect(() => again.person("not-a-person")).toThrow();
  });

  it("knows a time zone", () => {
    expect(isTimeZone("America/Toronto")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("../../etc")).toBe(false);
  });
});

async function serve(auth: RequestAuth, organization: boolean, dir = tempDir()) {
  const changes: unknown[] = [];
  const routes = [createBotSettingsRoutes({ store: createBotSettingsStore(dir), organization: () => organization, changed: (scope) => changes.push(scope) })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/bot`;
  const put = (body: unknown) => fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, put, changes };
}

describe("GET and PUT /api/settings/bot", () => {
  it("is member scope", () => {
    expect(requiredScope("GET", "/api/settings/bot")).toBe("client");
    expect(requiredScope("PUT", "/api/settings/bot")).toBe("client");
  });

  it("lets the owner change a personal server's settings, and a chat-only device only read them", async () => {
    const owner = await serve({ kind: "loopback", scopes: ["admin", "client"] }, false);
    const saved = await owner.put({ autoReviewDefault: true, timeZone: "Europe/Paris", timeZoneAuto: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ scope: "server", settings: { autoReviewDefault: true, timeZone: "Europe/Paris", timeZoneAuto: false }, effectiveTimeZone: "Europe/Paris" });
    expect(owner.changes).toEqual([{ kind: "server" }]);
    expect((await owner.put({ timeZone: "Mars/Olympus" })).status).toBe(400);
    expect((await owner.put({ approvalMode: "full" })).status).toBe(400);
    const guest = await serve(session(["client"]), false);
    expect((await fetch(guest.base)).status).toBe(200);
    expect((await guest.put({ autoReviewDefault: true })).status).toBe(403);
    await expect((await serve({ kind: "loopback", scopes: ["client"], trust: "service" }, false)).put({}).then((res) => res.status)).resolves.toBe(403);
  });

  it("keeps each person's own on an organization server", async () => {
    const dir = tempDir();
    const ada = await serve(session(["client"], ADA), true, dir);
    const saved = await (await ada.put({ timeZone: "Asia/Tokyo" })).json();
    expect(saved).toMatchObject({ scope: "person", settings: { timeZone: "Asia/Tokyo" } });
    expect(ada.changes).toEqual([{ kind: "person", principalId: ADA }]);
    const operator = await serve({ kind: "loopback", scopes: ["admin", "client"] }, true, dir);
    expect(await (await fetch(operator.base)).json()).toMatchObject({ scope: "server", settings: { timeZone: null } });
    expect((await (await serve(session(["client"]), true, dir)).put({})).status).toBe(403);
  });
});
