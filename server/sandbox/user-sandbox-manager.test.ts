// The Sagax side of the per-person environment: one key per person shared by
// all their bots, stop and delayed delete when Perspicax signs them out,
// cancel when they come back, and pending deletions that survive a restart.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sandboxBackendFor, sandboxRouteFromEnv } from "./sandbox-route.ts";
import { SandboxService } from "./sandboxd-core.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { inProcessSandboxdClient } from "../testing/in-process-sandboxd.ts";
import type { SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager, userSandboxSettingsFromEnv } from "./user-sandbox-manager.ts";
import { sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const HOUR = 3600_000;

let dir: string;
let now: number;
let docker: FakeDocker;
let service: SandboxService;

/** The real provisioner logic behind an in-process client. */
function inProcessClient(): SandboxdClient {
  return inProcessSandboxdClient(service);
}

function manager(graceMs = 72 * HOUR) {
  return new UserSandboxManager({ client: inProcessClient(), instance: "default", stateFile: join(dir, "deletions.json"), graceMs, now: () => now });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "user-sandbox-"));
  now = 1_000_000;
  docker = new FakeDocker();
  docker.now = () => now;
  service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }), () => now);
  await service.installEgressPolicy();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("UserSandboxManager", () => {
  it("is lazy: a person's status is missing until a tool needs it", async () => {
    const m = manager();
    expect((await m.status(ALICE)).state).toBe("missing");
    expect(docker.containers.size).toBe(0);
    await m.exec(ALICE, { argv: ["true"] });
    expect((await m.status(ALICE)).state).toBe("running");
  });

  it("uses one environment per person for all their bots, and separate ones per person", async () => {
    const m = manager();
    // Three bots of Alice and one of Bob: the key is the person's, not the bot's.
    for (let bot = 0; bot < 3; bot++) await m.exec(ALICE, { argv: ["true"] });
    await m.exec(BOB, { argv: ["true"] });
    expect(docker.containers.size).toBe(2);
    expect(docker.containers.has(sandboxNames(m.keyFor(ALICE)).container)).toBe(true);
    expect(m.keyFor(ALICE)).not.toBe(m.keyFor(BOB));
  });

  it("stops at once and deletes after the grace period when a person is signed out", async () => {
    const m = manager(72 * HOUR);
    await m.exec(ALICE, { argv: ["true"] });
    await m.personOut(ALICE);
    expect((await m.status(ALICE)).state).toBe("stopped");
    expect(m.pendingDeletionAt(ALICE)).toBe(now + 72 * HOUR);
    await expect(m.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "person_out" });
    now += 71 * HOUR;
    expect(await m.sweepDeletions()).toEqual([]);
    now += 2 * HOUR;
    expect(await m.sweepDeletions()).toEqual([ALICE]);
    expect(docker.containers.size).toBe(0);
    expect(docker.volumes.size).toBe(0);
    expect(m.pendingDeletionAt(ALICE)).toBeNull();
  });

  it("keeps the environment when the person is back before the grace ends", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    await m.personOut(ALICE);
    m.personBack(ALICE);
    now += 100 * HOUR;
    expect(await m.sweepDeletions()).toEqual([]);
    expect(docker.volumes.has(sandboxNames(m.keyFor(ALICE)).volume)).toBe(true);
    await m.exec(ALICE, { argv: ["true"] });
  });

  it("remembers pending deletions across a restart", async () => {
    await manager().personOut(BOB);
    const restarted = manager();
    expect(restarted.pendingDeletionAt(BOB)).toBe(now + 72 * HOUR);
  });

  it("reset recreates the environment from scratch", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    const creates = docker.calls.filter((call) => call.startsWith("create")).length;
    const view = await m.reset(ALICE);
    expect(view.state).toBe("running");
    expect(docker.calls).toContain(`rmvol ${sandboxNames(m.keyFor(ALICE)).volume}`);
    expect(docker.calls.filter((call) => call.startsWith("create")).length).toBe(creates + 1);
  });

  it("update rebuilds the container from the current image and keeps /workspace", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    const creates = docker.calls.filter((call) => call.startsWith("create")).length;
    const view = await m.update(ALICE);
    expect(view.state).toBe("running");
    expect(docker.calls).not.toContain(`rmvol ${sandboxNames(m.keyFor(ALICE)).volume}`);
    expect(docker.calls.filter((call) => call.startsWith("create")).length).toBe(creates + 1);
    await m.personOut(BOB);
    await expect(m.update(BOB)).rejects.toMatchObject({ code: "person_out" });
  });

  it("removes an environment and its workspace at once for account deletion", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    await m.personOut(ALICE);
    await m.removeNow(ALICE);
    expect(docker.calls).toContain(`rmvol ${sandboxNames(m.keyFor(ALICE)).volume}`);
    expect(m.pendingDeletionAt(ALICE)).toBeNull();
  });

  it("keeps a person's environment up through a voice call: each heartbeat counts as use, and starts nothing", async () => {
    const m = manager();
    // nothing to keep yet: a heartbeat does not create or start it
    expect(await m.markUsed(ALICE)).toBe(true);
    expect(docker.containers.size).toBe(0);
    await m.exec(ALICE, { argv: ["true"] });
    // a 30 minute call, a heartbeat every 5 minutes, no tool call after the first
    for (let minute = 5; minute <= 30; minute += 5) {
      now += 5 * 60_000;
      await m.markUsed(ALICE);
      expect(await service.sweepIdle()).toEqual([]);
    }
    expect((await m.status(ALICE)).state).toBe("running");
    // hung up: the idle stop applies again
    now += 10 * 60_000 + 1;
    expect(await service.sweepIdle()).toEqual([m.keyFor(ALICE)]);
    // a heartbeat never starts a stopped environment
    await m.markUsed(ALICE);
    expect((await m.status(ALICE)).state).toBe("stopped");
    // nor touches the environment of a person signed out by Perspicax
    await m.personOut(BOB);
    expect(await m.markUsed(BOB)).toBe(false);
  });

  it("says starting while the environment's Pod is on its way up, and starts nothing to say it (2026-10-26)", async () => {
    const base = inProcessClient();
    let ensures = 0;
    const client: SandboxdClient = {
      ...base,
      status: async (key) => ({ ...(await base.status(key)), state: "stopped", starting: true }),
      ensure: (key) => { ensures += 1; return base.ensure(key); },
    };
    const m = new UserSandboxManager({ client, instance: "default", stateFile: join(dir, "x.json"), now: () => now });
    expect(await m.status(ALICE)).toMatchObject({ state: "stopped", starting: true });
    expect(ensures).toBe(0);
    expect((await manager().status(ALICE)).starting).toBeUndefined();
  });

  it("reports unavailable instead of throwing when the provisioner is down", async () => {
    const down: SandboxdClient = {
      info: () => Promise.reject(new Error("down")), status: () => Promise.reject(new Error("down")),
      ensure: () => Promise.reject(new Error("down")), stop: () => Promise.reject(new Error("down")),
      remove: () => Promise.reject(new Error("down")), exec: () => Promise.reject(new Error("down")),
      desktopStream: () => Promise.reject(new Error("down")), pause: () => Promise.reject(new Error("down")),
      resume: () => Promise.reject(new Error("down")), stats: () => Promise.reject(new Error("down")),
      stdioStream: () => Promise.reject(new Error("down")), markUsed: () => Promise.reject(new Error("down")),
    };
    const m = new UserSandboxManager({ client: down, instance: "default", stateFile: join(dir, "x.json") });
    expect((await m.status(ALICE)).state).toBe("unavailable");
    expect(await m.markUsed(ALICE)).toBe(false);
    await expect(m.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("is configured only with a provisioner URL", () => {
    expect(userSandboxSettingsFromEnv({})).toBeNull();
    expect(userSandboxSettingsFromEnv({ SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791", SAGAX_SANDBOX_DELETE_GRACE_HOURS: "24" }))
      .toMatchObject({ url: "http://sagax-sandboxd:8791", graceMs: 24 * HOUR, instance: "default", kubernetesUrl: null });
    expect(() => userSandboxSettingsFromEnv({ SAGAX_SANDBOXD_URL: "http://x:1", SAGAX_SANDBOX_DELETE_GRACE_HOURS: "-1" })).toThrow();
  });

  it("the console's inventory: each existing environment with its status, commands and usage; a slow one is unavailable", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    const found = await m.inventory([ALICE, BOB]);
    expect([...found.keys()]).toEqual([ALICE]);
    expect(found.get(ALICE)).toMatchObject({ view: { state: "running", pendingDeletionAt: null }, busy: 0, stats: { image: "sagax-sandbox:test" } });
    expect(await m.provisioner()).toMatchObject({ maxRunning: expect.any(Number), idleMinutes: expect.any(Number) });
    const slow = new UserSandboxManager({
      client: { ...inProcessClient(), status: () => new Promise(() => {}), info: () => Promise.reject(new Error("down")) },
      instance: "default", stateFile: join(dir, "slow.json"), now: () => now,
    });
    expect((await slow.inventory([ALICE], 20)).get(ALICE)).toMatchObject({ view: { state: "unavailable" }, stats: null });
    expect(await slow.provisioner()).toBeNull();
  });

  it("requires https and a CA for the kubernetes provisioner, and refuses a canary without it", () => {
    const ca = join(dir, "ca.pem");
    writeFileSync(ca, "ca");
    expect(userSandboxSettingsFromEnv({
      SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791",
      SAGAX_SANDBOXD_K8S_URL: "https://sagax-sandboxd-k8s:8791",
      SAGAX_SANDBOXD_TLS_CA: ca,
    })).toMatchObject({ kubernetesUrl: "https://sagax-sandboxd-k8s:8791", tlsCaFile: ca });
    expect(() => userSandboxSettingsFromEnv({
      SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791",
      SAGAX_SANDBOXD_K8S_URL: "http://sagax-sandboxd-k8s:8791",
      SAGAX_SANDBOXD_TLS_CA: ca,
    })).toThrow(/https/);
    expect(() => userSandboxSettingsFromEnv({
      SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791",
      SAGAX_SANDBOX_CANARY_PEOPLE: ALICE,
    })).toThrow(/SAGAX_SANDBOXD_K8S_URL/);
    expect(userSandboxSettingsFromEnv({
      SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791",
      SAGAX_SANDBOX_ROUTE: "docker",
      SAGAX_SANDBOX_CANARY_PEOPLE: ALICE,
    })?.kubernetesUrl).toBeNull();
  });

  it("sends a listed person or bot to kubernetes and reverts with SAGAX_SANDBOX_ROUTE=docker", async () => {
    const seen: string[] = [];
    const client = (name: string): SandboxdClient => ({
      info: () => Promise.reject(new Error("unused")),
      status: () => Promise.reject(new Error("unused")),
      ensure: () => Promise.reject(new Error("unused")),
      stop: () => Promise.reject(new Error("unused")),
      pause: () => Promise.reject(new Error("unused")),
      resume: () => Promise.reject(new Error("unused")),
      markUsed: () => Promise.reject(new Error("unused")),
      stats: () => Promise.reject(new Error("unused")),
      remove: () => Promise.reject(new Error("unused")),
      desktopStream: () => Promise.reject(new Error("unused")),
      stdioStream: () => Promise.reject(new Error("unused")),
      exec: () => {
        seen.push(name);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false });
      },
    });
    const env: NodeJS.ProcessEnv = { SAGAX_SANDBOX_CANARY_PEOPLE: ALICE, SAGAX_SANDBOX_CANARY_BOTS: "bot-a" };
    const m = new UserSandboxManager({
      client: client("docker"),
      kubernetes: client("kubernetes"),
      backendFor: (principalId, botId) => sandboxBackendFor(sandboxRouteFromEnv(env), principalId, botId),
      instance: "default",
      stateFile: join(dir, "route.json"),
    });
    await m.exec(ALICE, { argv: ["true"] });
    await m.exec(BOB, { argv: ["true"] }, "bot-a");
    await m.exec(BOB, { argv: ["true"] }, "bot-b");
    env.SAGAX_SANDBOX_ROUTE = "docker";
    await m.exec(ALICE, { argv: ["true"] }, "bot-a");
    expect(seen).toEqual(["kubernetes", "kubernetes", "docker", "docker"]);
  });

  it("refuses a kubernetes route when that provisioner is not configured", async () => {
    const m = new UserSandboxManager({
      client: {
        info: () => Promise.reject(new Error("unused")), status: () => Promise.reject(new Error("unused")),
        ensure: () => Promise.reject(new Error("unused")), stop: () => Promise.reject(new Error("unused")),
        pause: () => Promise.reject(new Error("unused")), resume: () => Promise.reject(new Error("unused")),
        markUsed: () => Promise.reject(new Error("unused")), stats: () => Promise.reject(new Error("unused")),
        remove: () => Promise.reject(new Error("unused")), desktopStream: () => Promise.reject(new Error("unused")),
        stdioStream: () => Promise.reject(new Error("unused")), exec: () => Promise.reject(new Error("unused")),
      },
      backendFor: () => "kubernetes",
      instance: "default",
      stateFile: join(dir, "missing-k8s.json"),
    });
    await expect(m.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "kubernetes_unconfigured" });
    expect((await m.status(ALICE)).error).toBe("kubernetes_unconfigured");
  });
});
