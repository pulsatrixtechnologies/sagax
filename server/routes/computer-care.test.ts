import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MaintenanceStore, type DiskSaverTarget } from "../computer/computer-care.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createComputerCareRoutes, type ComputerCareRouteDeps } from "./computer-care.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const loopback = { kind: "loopback", trust: "app" } as unknown as RequestAuth;
const person = (principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "web", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, ...(principalId ? { principalId } : {}) } as never,
});

function fakeTarget(): DiskSaverTarget & { scripts: string[] } {
  const scripts: string[] = [];
  return {
    scripts,
    exec: async (script) => {
      scripts.push(script);
      return { exitCode: 0, stdout: "packageCaches 4\ntrash 8\n" };
    },
  };
}

async function serve(auth: RequestAuth, deps: Partial<ComputerCareRouteDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "computer-care-route-"));
  dirs.push(dir);
  const store = new MaintenanceStore(join(dir, "care.json"));
  const targets = new Map<string, ReturnType<typeof fakeTarget>>();
  const audits: string[] = [];
  const routes = [createComputerCareRoutes({
    organization: () => false,
    sandboxConfigured: () => false,
    mayManageLocal: (caller) => caller.kind === "loopback",
    store,
    scheduler: { isRunning: () => false },
    diskTarget: (key) => {
      if (!targets.has(key)) targets.set(key, fakeTarget());
      return targets.get(key)!;
    },
    audit: (_auth, action) => { audits.push(action); },
    now: () => Date.UTC(2026, 9, 16, 12),
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/computer`;
  const send = (path: string, method: string, body: unknown) =>
    fetch(`${base}/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, send, store, targets, audits };
}

const SCHEDULE = { enabled: true, days: [6, 0, 0], hour: 2, windowHours: 3, timeZone: "America/Toronto" };

describe("computer care routes", () => {
  it("reads the default schedule, saves one, and answers the next window", async () => {
    const { base, send, store, audits } = await serve(loopback);
    const first = await (await fetch(`${base}/maintenance`)).json();
    expect(first).toMatchObject({ schedule: { enabled: false }, nextWindowAt: null, running: false });
    const saved = await send("maintenance", "PUT", SCHEDULE);
    expect(saved.status).toBe(200);
    const body = await saved.json() as { schedule: { days: number[] }; nextWindowAt: unknown };
    expect(body.schedule.days).toEqual([0, 6]);
    expect(typeof body.nextWindowAt).toBe("number");
    expect(store.get("local")?.schedule.hour).toBe(2);
    expect(audits).toEqual(["computer.maintenance.schedule"]);
  });

  it("refuses a bad schedule or time zone", async () => {
    const { send } = await serve(loopback);
    expect((await send("maintenance", "PUT", { ...SCHEDULE, hour: 24 })).status).toBe(400);
    expect((await send("maintenance", "PUT", { ...SCHEDULE, timeZone: "Mars/Olympus" })).status).toBe(400);
    expect((await send("maintenance", "PUT", { ...SCHEDULE, extra: 1 })).status).toBe(400);
  });

  it("keeps a personal server's computer to its owner", async () => {
    const { base } = await serve(person(ADA));
    expect((await fetch(`${base}/maintenance`)).status).toBe(403);
    expect((await fetch(`${base}/disk-saver`)).status).toBe(403);
  });

  it("uses the signed-in person's own environment on an organization server", async () => {
    const { base, send, store, targets } = await serve(person(ADA), { organization: () => true, sandboxConfigured: () => true });
    expect((await send("maintenance", "PUT", SCHEDULE)).status).toBe(200);
    expect(store.get(`person:${ADA}`)).toBeDefined();
    expect(store.get("local")).toBeUndefined();
    expect((await fetch(`${base}/disk-saver`)).status).toBe(200);
    expect(targets.has(`person:${ADA}`)).toBe(true);
  });

  it("refuses an organization caller without an identity or without environments", async () => {
    expect((await fetch(`${(await serve(person(), { organization: () => true, sandboxConfigured: () => true })).base}/maintenance`)).status).toBe(403);
    expect((await fetch(`${(await serve(person(ADA), { organization: () => true })).base}/maintenance`)).status).toBe(409);
  });

  it("previews, then cleans only what was chosen; the trash needs a confirmation", async () => {
    const { base, send, targets, audits } = await serve(loopback);
    const preview = await (await fetch(`${base}/disk-saver`)).json() as { items: Array<{ id: string }> };
    expect(preview.items.map((item: { id: string }) => item.id)).toContain("trash");
    const target = targets.get("local")!;
    expect(target.scripts.some((script) => /rm -rf|-delete/.test(script))).toBe(false);

    const refused = await send("disk-saver", "POST", { categories: ["trash"] });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { code: string }).code).toBe("confirm_user_files");
    expect(target.scripts.some((script) => /rm -rf|-delete/.test(script))).toBe(false);

    const cleaned = await send("disk-saver", "POST", { categories: ["packageCaches"] });
    expect(cleaned.status).toBe(200);
    expect(target.scripts.some((script) => script.includes("rm -rf") && script.includes(".cache/pip") && !script.includes("Trash"))).toBe(true);
    expect(audits).toEqual(["computer.disk-saver.clean"]);
  });

  it("refuses an unknown category or a simple request", async () => {
    const { base, send } = await serve(loopback);
    expect((await send("disk-saver", "POST", { categories: ["/home"] })).status).toBe(400);
    expect((await fetch(`${base}/disk-saver`, { method: "POST", body: "{}" })).status).toBe(415);
    expect((await fetch(`${base}/maintenance`, { method: "DELETE" })).status).toBe(405);
  });
});
