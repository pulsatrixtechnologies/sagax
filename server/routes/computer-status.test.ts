import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { diskSpace, folderBytes } from "../disk-usage.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { UserSandboxUnavailable, type UserSandboxView } from "../user-sandbox-manager.ts";
import { createComputerStatusRoutes, diskStateForFree, diskStateForQuota, type ComputerStatusRouteDeps, type SandboxLike } from "./computer-status.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const GiB = 1024 ** 3;
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const view = (over: Partial<UserSandboxView> = {}): UserSandboxView => ({
  state: "running", lastUsedAt: 1, workspaceBytes: 1_900 * 1024 * 1024, overQuota: false,
  limits: { memoryMb: 1024, cpus: 1, pids: 256, diskMb: 2048, tmpMb: 256 }, idleMinutes: 15, pendingDeletionAt: null, ...over,
});
const person = (principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "phone", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, ...(principalId ? { principalId } : {}) } as never,
});

async function serve(auth: RequestAuth, deps: Partial<ComputerStatusRouteDeps>) {
  const calls: string[] = [];
  const routes = [createComputerStatusRoutes({
    organization: () => false,
    sandbox: () => null,
    local: {
      status: async () => { calls.push("local.status"); return { configured: true, state: "running", diskState: "normal", workspaceBytes: 10, version: "driver-0.20.0-v5" }; },
      update: async () => { calls.push("local.update"); return { configured: true, state: "running", diskState: "normal", workspaceBytes: 10 }; },
      reset: async () => { calls.push("local.reset"); return { configured: true, state: "running", diskState: "normal", workspaceBytes: 0 }; },
    },
    mayManageLocal: (caller) => caller.kind === "loopback",
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/computer`;
  const post = (action: string, body: unknown = {}) => fetch(`${base}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, calls };
}

describe("disk state", () => {
  it("reads a quota and free space", () => {
    expect(diskStateForQuota(100, 1000)).toBe("normal");
    expect(diskStateForQuota(900, 1000)).toBe("almostFull");
    expect(diskStateForQuota(1000, 1000)).toBe("full");
    expect(diskStateForQuota(1, 1000, true)).toBe("full");
    expect(diskStateForQuota(null, 1000)).toBe("normal");
    expect(diskStateForFree(0.5 * GiB, 500 * GiB)).toBe("full");
    expect(diskStateForFree(20 * GiB, 500 * GiB)).toBe("almostFull");
    expect(diskStateForFree(100 * GiB, 500 * GiB)).toBe("normal");
    expect(diskStateForFree(null, null)).toBe("normal");
  });

  it("measures a folder, bounded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-disk-"));
    dirs.push(dir);
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "a.txt"), "12345");
    writeFileSync(join(dir, "sub", "b.txt"), "678");
    expect(await folderBytes(dir)).toBe(8);
    expect(await folderBytes(dir, { maxEntries: 1 })).toBeNull();
    expect(await folderBytes(join(dir, "missing"))).toBeNull();
    expect((await diskSpace(dir)).totalBytes).toBeGreaterThan(0);
  });
});

describe("computer routes", () => {
  it("are member scope; the handler keeps a personal computer to its owner", () => {
    expect(requiredScope("GET", "/api/computer/status")).toBe("client");
    expect(requiredScope("POST", "/api/computer/update")).toBe("client");
    expect(requiredScope("POST", "/api/computer/reset")).toBe("client");
    // the phone's scheduled update (parity R7, O2): read and set, never the disk saver
    expect(requiredScope("GET", "/api/computer/maintenance")).toBe("client");
    expect(requiredScope("PUT", "/api/computer/maintenance")).toBe("client");
    expect(requiredScope("POST", "/api/computer/disk-saver")).toBe("admin");
    expect(requiredScope("POST", "/api/me/server-environment/update", { orgDirectory: true })).toBe("client");
    expect(requiredScope("POST", "/api/me/server-environment/update")).toBe("admin");
  });

  it("dispatches to this computer's container on a personal server", async () => {
    const owner = await serve({ kind: "loopback", scopes: ["admin", "client"] }, {});
    expect(await (await fetch(`${owner.base}/status`)).json()).toMatchObject({ kind: "local", diskState: "normal", version: "driver-0.20.0-v5" });
    expect((await owner.post("update")).status).toBe(200);
    expect((await owner.post("reset")).status).toBe(400);
    expect((await owner.post("reset", { confirm: true })).status).toBe(200);
    expect(owner.calls).toEqual(["local.status", "local.update", "local.reset"]);
    const guest = await serve(person(), {});
    expect((await fetch(`${guest.base}/status`)).status).toBe(403);
    const failing = await serve({ kind: "loopback", scopes: ["admin", "client"] }, {
      local: {
        status: async () => { throw new Error("boom"); },
        update: async () => { throw Object.assign(new Error("another Local VM setup action is still running"), { status: 409, code: "busy" }); },
        reset: async () => { throw new Error("boom"); },
      },
    });
    expect((await fetch(`${failing.base}/status`)).status).toBe(502);
    const busy = await failing.post("update");
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "busy" });
  });

  it("dispatches to the person's server environment on an organization server", async () => {
    const calls: string[] = [];
    const sandbox: SandboxLike = {
      status: async (id) => { calls.push(`status ${id}`); return view(); },
      update: async (id) => { calls.push(`update ${id}`); return view({ workspaceBytes: 10 }); },
      reset: async () => { throw new UserSandboxUnavailable("closed", "person_out"); },
    };
    const org = await serve(person(ADA), { organization: () => true, sandbox: () => sandbox });
    expect(await (await fetch(`${org.base}/status`)).json()).toEqual({
      kind: "org-sandbox", configured: true, state: "running", diskState: "almostFull", workspaceBytes: 1_900 * 1024 * 1024, limitBytes: 2048 * 1024 * 1024,
    });
    expect(await (await org.post("update")).json()).toMatchObject({ diskState: "normal", workspaceBytes: 10 });
    const out = await org.post("reset", { confirm: true });
    expect(out.status).toBe(409);
    expect(await out.json()).toMatchObject({ code: "person_out" });
    expect(calls).toEqual([`status ${ADA}`, `update ${ADA}`]);
    expect((await fetch(`${(await serve(person(), { organization: () => true })).base}/status`)).status).toBe(403);
    expect(await (await fetch(`${(await serve(person(ADA), { organization: () => true })).base}/status`)).json()).toMatchObject({ configured: false });
  });

  it("refuses an update while a bot works, while the scheduled one runs, and a second one at once (parity R7 review)", async () => {
    const claimed = new Set<string>();
    let busy = false;
    let releaseUpdate: () => void = () => {};
    const guard = {
      claim: (key: string) => { if (claimed.has(key)) return false; claimed.add(key); return true; },
      release: (key: string) => { claimed.delete(key); },
      busy: async () => busy,
    };
    const calls: string[] = [];
    const owner = await serve({ kind: "loopback", scopes: ["admin", "client"] }, {
      updateGuard: guard,
      local: {
        status: async () => ({ configured: true, state: "running", diskState: "normal", workspaceBytes: 1 }),
        update: () => { calls.push("update"); return new Promise((done) => { releaseUpdate = () => done({ configured: true, state: "running", diskState: "normal", workspaceBytes: 1 }); }); },
        reset: async () => ({ configured: true, state: "running", diskState: "normal", workspaceBytes: 0 }),
      },
    });
    busy = true;
    const working = await owner.post("update");
    expect(working.status).toBe(409);
    expect(await working.json()).toMatchObject({ code: "computer_busy" });
    expect(claimed.size).toBe(0);
    busy = false;
    // the scheduled update holds the computer
    claimed.add("local");
    expect(await (await owner.post("update")).json()).toMatchObject({ code: "computer_updating" });
    claimed.delete("local");
    // two at once: the second is refused, the first still lands
    const first = owner.post("update");
    await new Promise((done) => setTimeout(done, 30));
    const second = await owner.post("update");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "computer_updating" });
    releaseUpdate();
    expect((await first).status).toBe(200);
    expect(calls).toEqual(["update"]);
    expect(claimed.size).toBe(0);
  });
});
