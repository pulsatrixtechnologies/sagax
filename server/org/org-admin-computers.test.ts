// Computers (server/org/org-admin-computers.ts) with faked dependencies: the
// listing of server environments and desktops, a computer's page, the
// admin actions with their confirmations and audit rows, and a person's own
// desktop never acted on.
import { describe, expect, it } from "vitest";

import { COMPUTER_ACTIONS, computersRoutes, desktopComputerId, environmentActions, type ComputersDeps, type EnvironmentFacts } from "./org-admin-computers.ts";
import { routeNames } from "./org-admin-console.ts";
import type { UserSandboxView } from "../sandbox/user-sandbox-manager.ts";
import { fakeConsole } from "../testing/console-context.ts";

const NOW = Date.UTC(2026, 9, 11, 12);
const LIMITS = { memoryMb: 2048, cpus: 2, pids: 512, diskMb: 10240, tmpMb: 512 };
const view = (state: UserSandboxView["state"], extra: Partial<UserSandboxView> = {}): UserSandboxView => ({
  state, lastUsedAt: NOW - 60_000, workspaceBytes: 1000, overQuota: false, limits: LIMITS, idleMinutes: 10, pendingDeletionAt: null, ...extra,
});

function setup(options: { sandbox?: boolean; busy?: number; turn?: boolean; fail?: string } = {}) {
  const envs = new Map<string, EnvironmentFacts>([
    ["pr_alice", { view: view("running"), busy: options.busy ?? 0, stats: { key: "k", state: "running", cpuPercent: 12.5, memoryBytes: 300, memoryLimitBytes: 2048 * 1024 * 1024, workspaceBytes: 1000, workspaceQuotaBytes: 5000, os: "Debian GNU/Linux 12 (bookworm)", arch: "x86_64", image: "sagax-sandbox:1.2" } }],
    ["pr_bob", { view: view("stopped", { pendingDeletionAt: NOW + 3600_000 }), busy: 0, stats: null }],
  ]);
  const calls: string[] = [];
  const deps: ComputersDeps = {
    people: () => [{ principalId: "pr_alice" }, { principalId: "pr_bob" }, { principalId: "pr_zoe" }],
    person: (id) => ({ principalId: id, sub: `sub-${id}`, name: id.slice(3) }),
    environments: options.sandbox === false ? null : {
      provisioner: async () => ({ maxRunning: 10, idleMinutes: 10 }),
      inventory: async (ids) => new Map([...envs].filter(([id]) => ids.includes(id))),
      power: async (id, action) => {
        calls.push(`${action}:${id}`);
        if (options.fail) throw Object.assign(new Error("No room for another environment."), { code: options.fail });
        const state = action === "shutdown" ? "stopped" : action === "pause" ? "paused" : "running";
        envs.set(id, { ...envs.get(id)!, view: view(state) });
        return view(state);
      },
      update: async (id) => { calls.push(`update:${id}`); return view("running"); },
      reset: async (id) => { calls.push(`reset:${id}`); return view("running"); },
      remove: async (id) => { calls.push(`remove:${id}`); envs.delete(id); },
    },
    turnRunning: () => options.turn ?? false,
    desktops: () => [{ principalId: "pr_bob", desktopId: "6f9b7c1e-0000-4000-8000-000000000001", name: "Bob's MacBook", platform: "darwin", online: true, lastSeenAt: NOW - 5000, localVm: true, version: "0.4.20" }],
    bots: () => [
      { id: "b1", name: "Atlas", ownerPrincipalId: "pr_alice", computer: null },
      { id: "b2", name: "Beacon", ownerPrincipalId: "pr_bob", computer: "vm" },
      { id: "b3", name: "Cirrus", ownerPrincipalId: "pr_bob", computer: "cloud" },
      { id: "b4", name: "Dot", ownerPrincipalId: "pr_bob", computer: "off" },
    ],
    activity: ({ computerId }) => [{ id: "2026-10-1", action: "computer.start", target: { kind: "computer", id: computerId } }],
  };
  return { console: fakeConsole(computersRoutes(deps), () => NOW), calls, envs };
}

const DESKTOP = desktopComputerId("pr_bob", "6f9b7c1e-0000-4000-8000-000000000001");

describe("computers", () => {
  it("are an admin's: server environments and desktops, owners, states, resources, bots", async () => {
    const { console } = setup();
    const got = await console.call("GET", "computers");
    expect(got.status).toBe(200);
    expect(got.body.environments).toEqual({ configured: true, reachable: true, maxRunning: 10, idleMinutes: 10 });
    expect(got.body.items.map((item: { id: string }) => item.id)).toEqual(["env:pr_alice", DESKTOP, "env:pr_bob"]);
    expect(got.body.items[0]).toEqual({
      id: "env:pr_alice", kind: "server-environment", name: "alice", owner: { principalId: "pr_alice", sub: "sub-pr_alice", name: "alice" },
      state: "running", lastUsedAt: NOW - 60_000,
      resources: { cpus: 2, memoryLimitBytes: 2048 * 1024 * 1024, diskLimitBytes: 10240 * 1024 * 1024, workspaceBytes: 1000, workspaceQuotaBytes: 5000, overQuota: false, cpuPercent: 12.5, memoryBytes: 300 },
      image: "sagax-sandbox:1.2", os: "Debian GNU/Linux 12 (bookworm)", arch: "x86_64", platform: null, busy: 0, pendingDeletionAt: null, localVm: false, appVersion: null,
      bots: [{ id: "b1", name: "Atlas" }],
      actions: ["stop", "pause", "update", "reset", "delete"],
    });
    expect(got.body.items[1]).toEqual({
      id: DESKTOP, kind: "desktop", name: "Bob's MacBook", owner: { principalId: "pr_bob", sub: "sub-pr_bob", name: "bob" }, state: "online", lastUsedAt: NOW - 5000,
      resources: null, image: null, os: null, arch: null, platform: "darwin", busy: 0, pendingDeletionAt: null, localVm: true, appVersion: "0.4.20",
      bots: [{ id: "b2", name: "Beacon" }], actions: [],
    });
    // a person signed out: their environment is stopped and waits for deletion
    expect(got.body.items[2]).toMatchObject({ state: "stopped", pendingDeletionAt: NOW + 3600_000, bots: [{ id: "b3", name: "Cirrus" }], actions: ["delete"] });
    expect(JSON.stringify(got.body)).not.toContain("6f9b7c1e");
    expect((await console.call("GET", "computers?kind=desktop")).body.items).toHaveLength(1);
    expect((await console.call("GET", "computers?state=stopped")).body.items.map((item: { id: string }) => item.id)).toEqual(["env:pr_bob"]);
    expect((await console.call("GET", "computers?owner=sub-pr_alice")).body.items.map((item: { id: string }) => item.id)).toEqual(["env:pr_alice"]);
    expect((await console.call("GET", "computers?q=macbook")).body.items.map((item: { id: string }) => item.id)).toEqual([DESKTOP]);
    expect((await console.call("GET", "computers?state=sleeping")).status).toBe(400);
  });

  it("without the provisioner: the desktops only, and says so", async () => {
    const { console } = setup({ sandbox: false });
    const got = await console.call("GET", "computers");
    expect(got.body.environments).toEqual({ configured: false, reachable: false, maxRunning: null, idleMinutes: null });
    expect(got.body.items.map((item: { kind: string }) => item.kind)).toEqual(["desktop"]);
    expect((await console.call("POST", "computers/env:pr_alice/stop", { body: {} })).status).toBe(404);
  });

  it("a computer's page: its facts and recent activity; unknown ids are 404", async () => {
    const { console } = setup();
    const got = await console.call("GET", "computers/env:pr_alice");
    expect(got.body).toMatchObject({ computer: { id: "env:pr_alice", state: "running" }, activity: [{ action: "computer.start", target: { id: "env:pr_alice" } }] });
    expect((await console.call("GET", `computers/${DESKTOP}`)).body.computer).toMatchObject({ kind: "desktop", actions: [] });
    for (const id of ["env:pr_zoe", "env:pr_ghost", "desktop:0123456789abcdef", "pr_alice"]) {
      expect((await console.call("GET", `computers/${id}`)).status).toBe(404);
    }
  });

  it("stop, pause, start, resume and update; audited with the state before and after", async () => {
    const { console, calls } = setup();
    const stopped = await console.call("POST", "computers/env:pr_alice/stop", { body: {} });
    expect(stopped).toMatchObject({ status: 200, body: { computer: { id: "env:pr_alice", state: "stopped", actions: ["start", "update", "reset", "delete"] } } });
    expect(console.records.at(-1)).toEqual({
      category: "computer", action: "computer.stop", target: { kind: "computer", id: "env:pr_alice", name: "alice" }, changed: ["state"],
      before: { state: "running" }, after: { state: "stopped", ownerPrincipalId: "pr_alice" },
    });
    expect((await console.call("POST", "computers/env:pr_alice/start", { body: {} })).body.computer.state).toBe("running");
    expect((await console.call("POST", "computers/env:pr_alice/pause", {})).body.computer.state).toBe("paused");
    expect((await console.call("POST", "computers/env:pr_alice/resume", {})).body.computer.state).toBe("running");
    expect((await console.call("POST", "computers/env:pr_alice/update", { body: {} })).status).toBe(200);
    expect(calls).toEqual(["shutdown:pr_alice", "start:pr_alice", "pause:pr_alice", "resume:pr_alice", "update:pr_alice"]);
    // an action this state does not offer
    expect((await console.call("POST", "computers/env:pr_alice/resume", {})).body.code).toBe("not_offered");
    // a signed-out person's environment is not started again
    expect((await console.call("POST", "computers/env:pr_bob/start", {})).body.code).toBe("not_offered");
    expect((await console.call("POST", "computers/env:pr_alice/stop", { body: { force: true } })).status).toBe(400);
  });

  it("reset and delete erase /workspace: confirm first; a running bot needs a confirmation to stop", async () => {
    const { console, calls, envs } = setup({ busy: 1 });
    expect((await console.call("POST", "computers/env:pr_alice/reset", { body: {} })).body.code).toBe("confirm_required");
    expect((await console.call("POST", "computers/env:pr_alice/delete", { body: { confirm: false } })).body.code).toBe("confirm_required");
    expect((await console.call("POST", "computers/env:pr_alice/stop", { body: {} }))).toMatchObject({ status: 409, body: { code: "confirm_running" } });
    expect(calls).toEqual([]);
    expect((await console.call("POST", "computers/env:pr_alice/stop", { body: { confirm: true } })).status).toBe(200);
    expect(console.records.at(-1)!.after).toMatchObject({ confirmed: true });
    expect((await console.call("POST", "computers/env:pr_alice/reset", { body: { confirm: true } })).status).toBe(200);
    const deleted = await console.call("POST", "computers/env:pr_alice/delete", { body: { confirm: true } });
    expect(deleted).toEqual({ status: 200, body: { deleted: "env:pr_alice" } });
    expect(console.records.at(-1)).toMatchObject({ action: "computer.delete", after: { state: "deleted" } });
    expect(calls).toEqual(["shutdown:pr_alice", "reset:pr_alice", "remove:pr_alice"]);
    expect(envs.has("pr_alice")).toBe(false);
    // a turn working there counts as busy too
    expect((await setup({ turn: true }).console.call("POST", "computers/env:pr_alice/pause", {})).body.code).toBe("confirm_running");
  });

  it("a person's desktop is theirs: never an action on it", async () => {
    const { console } = setup();
    for (const name of COMPUTER_ACTIONS) {
      const got = await console.call("POST", `computers/${DESKTOP}/${name}`, { body: { confirm: true } });
      expect(got).toMatchObject({ status: 409, body: { code: "personal_computer" } });
    }
    expect(console.records).toEqual([]);
  });

  it("names the provisioner's refusal: capacity 429, a person signed out 409", async () => {
    expect((await setup({ fail: "capacity" }).console.call("POST", "computers/env:pr_alice/stop", {}))).toMatchObject({ status: 429, body: { code: "capacity" } });
    expect((await setup({ fail: "person_out" }).console.call("POST", "computers/env:pr_alice/stop", {}))).toMatchObject({ status: 409, body: { code: "person_out" } });
    expect((await setup({ fail: "unavailable" }).console.call("POST", "computers/env:pr_alice/stop", {}))).toMatchObject({ status: 502, body: { code: "unavailable" } });
  });

  it("offers per state, and names every route", () => {
    expect(environmentActions("paused", false)).toEqual(["start", "stop", "resume", "update", "reset", "delete"]);
    expect(environmentActions("unavailable", false)).toEqual([]);
    expect(routeNames(computersRoutes({} as ComputersDeps))).toEqual([
      "GET computers", "GET computers/{id}",
      "POST computers/{id}/delete", "POST computers/{id}/pause", "POST computers/{id}/reset", "POST computers/{id}/resume",
      "POST computers/{id}/start", "POST computers/{id}/stop", "POST computers/{id}/update",
    ]);
  });
});
