// Sandbox lifecycle in the provisioner: lazy creation, reuse, idle stop,
// capacity, removal, and the refusal to run without the egress policy.
import { describe, expect, it } from "vitest";

import { SANDBOX_TTY_ARGV, SandboxService, ttyArgv } from "./sandboxd-core.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { sandboxIsolationProblems, sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const alice = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-00000000000a");
const bob = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-00000000000b");
const carol = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-00000000000c");

function setup(env: Record<string, string> = {}) {
  let now = 1_000_000;
  const docker = new FakeDocker();
  docker.now = () => now;
  const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", ...env });
  const service = new SandboxService(docker, config, () => now);
  return { docker, service, advance: (ms: number) => { now += ms; } };
}

describe("sandbox lifecycle", () => {
  it("creates nothing until first needed, then creates network, volume and container once", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    expect((await service.status(alice)).state).toBe("missing");
    expect(docker.calls.filter((call) => !call.startsWith("helper"))).toEqual([]);
    await service.exec(alice, { argv: ["true"] });
    const names = sandboxNames(alice);
    expect(docker.calls).toEqual(expect.arrayContaining([`net ${names.network}`, `vol ${names.volume}`, `create ${names.container}`, `start ${names.container}`]));
    expect(sandboxIsolationProblems(docker.containers.get(names.container)!.spec, alice)).toEqual([]);
  });

  it("reuses the one sandbox for every later call (all bots of the person)", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    for (let i = 0; i < 5; i++) await service.exec(alice, { argv: ["true"] });
    await Promise.all([service.ensure(alice), service.ensure(alice), service.ensure(alice)]);
    expect(docker.calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
    expect(docker.containers.size).toBe(1);
  });

  it("gives two people two sandboxes on two distinct subnets", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    await service.ensure(alice);
    await service.ensure(bob);
    const subnets = [...docker.networks.values()].map((network) => network.subnets[0]);
    expect(new Set(subnets).size).toBe(2);
  });

  it("starts a stopped sandbox from an older image again from the current one, keeping /workspace", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    await service.ensure(alice);
    const names = sandboxNames(alice);
    // Created before a deploy: the image it was made from is not the current one.
    docker.containers.get(names.container)!.spec.Image = "sagax-sandbox:before-the-desktop";
    await service.stop(alice);
    await service.ensure(alice);
    expect(docker.containers.get(names.container)!.spec.Image).toBe("sagax-sandbox:test");
    expect(docker.containers.get(names.container)!.running).toBe(true);
    expect(docker.calls.filter((call) => call.startsWith("create "))).toHaveLength(2);
    expect(docker.calls).toContain(`rm ${names.container}`);
    expect(docker.volumes.has(names.volume)).toBe(true);
    expect(sandboxIsolationProblems(docker.containers.get(names.container)!.spec, alice)).toEqual([]);
  });

  it("never replaces a running sandbox from an older image behind its owner's back", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    await service.ensure(alice);
    const names = sandboxNames(alice);
    docker.containers.get(names.container)!.spec.Image = "sagax-sandbox:before-the-desktop";
    await service.ensure(alice);
    expect(docker.calls).not.toContain(`rm ${names.container}`);
    expect(docker.containers.get(names.container)!.spec.Image).toBe("sagax-sandbox:before-the-desktop");
  });

  it("stops a sandbox idle past the idle period and starts it again on demand", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_IDLE_MINUTES: "15" });
    await service.installEgressPolicy();
    await service.exec(alice, { argv: ["true"] });
    advance(14 * 60_000);
    expect(await service.sweepIdle()).toEqual([]);
    advance(2 * 60_000);
    expect(await service.sweepIdle()).toEqual([alice]);
    expect((await service.status(alice)).state).toBe("stopped");
    await service.exec(alice, { argv: ["true"] });
    expect((await service.status(alice)).state).toBe("running");
    expect(docker.calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
  });

  it("stops an unused sandbox after the 10 minute default", async () => {
    const { service, advance } = setup();
    await service.installEgressPolicy();
    await service.exec(alice, { argv: ["true"] });
    advance(10 * 60_000 - 1);
    expect(await service.sweepIdle()).toEqual([]);
    advance(2);
    expect(await service.sweepIdle()).toEqual([alice]);
    expect((await service.status(alice)).state).toBe("stopped");
  });

  it("counts a marked use as use: the idle stop waits again, and nothing is started", async () => {
    const { docker, service, advance } = setup();
    await service.installEgressPolicy();
    expect((await service.markUsed(alice)).state).toBe("missing");
    expect(docker.calls.filter((call) => call.startsWith("create") || call.startsWith("start"))).toEqual([]);
    await service.exec(alice, { argv: ["true"] });
    advance(9 * 60_000);
    await service.markUsed(alice);
    advance(9 * 60_000);
    expect(await service.sweepIdle()).toEqual([]);
    advance(60_000 + 1);
    expect(await service.sweepIdle()).toEqual([alice]);
    const starts = docker.calls.filter((call) => call.startsWith("start")).length;
    expect((await service.markUsed(alice)).state).toBe("stopped");
    expect(docker.calls.filter((call) => call.startsWith("start"))).toHaveLength(starts);
  });

  it("counts a sandbox first seen running after a provisioner restart from now", async () => {
    const { docker, service, advance } = setup();
    await service.installEgressPolicy();
    await service.ensure(alice);
    const restarted = new SandboxService(docker, service.config, () => docker.now());
    advance(60 * 60_000);
    expect(await restarted.sweepIdle()).toEqual([]);
  });

  it("stops the least recently used idle sandbox to make room, or refuses when all are busy", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_MAX_RUNNING: "2" });
    await service.installEgressPolicy();
    await service.ensure(alice);
    advance(5 * 60_000);
    await service.ensure(bob);
    advance(5 * 60_000);
    await service.ensure(carol);
    expect(docker.containers.get(sandboxNames(alice).container)!.running).toBe(false);
    expect(docker.containers.get(sandboxNames(carol).container)!.running).toBe(true);
    // Both running sandboxes were just used: no room.
    await service.ensure(bob);
    await expect(service.ensure(alice)).rejects.toMatchObject({ status: 429, code: "capacity" });
  });

  it("removes container, network and volume (or keeps the workspace on request)", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    await service.ensure(alice);
    await service.remove(alice, { keepWorkspace: true });
    expect(docker.volumes.has(sandboxNames(alice).volume)).toBe(true);
    expect(docker.containers.size).toBe(0);
    await service.ensure(alice);
    await service.remove(alice);
    expect(docker.volumes.size).toBe(0);
    expect(docker.networks.size).toBe(0);
  });

  it("refuses to create anything while the egress policy is missing", async () => {
    const { docker, service } = setup();
    docker.helperOutput = { exitCode: 3, output: "sagax-egress-missing" };
    expect(await service.installEgressPolicy()).toBe("missing");
    await expect(service.ensure(alice)).rejects.toMatchObject({ status: 503, code: "egress_policy" });
    expect(docker.containers.size).toBe(0);
  });

  it("can run without the policy only when explicitly not required", async () => {
    const { docker, service } = setup({ SAGAX_SANDBOX_REQUIRE_EGRESS_POLICY: "false" });
    docker.helperOutput = { exitCode: 3, output: "" };
    expect(await service.installEgressPolicy()).toBe("not-required");
    expect((await service.ensure(alice)).state).toBe("running");
  });

  it("refuses when the image is not on the host", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    docker.images.clear();
    await expect(service.ensure(alice)).rejects.toMatchObject({ code: "image_missing" });
  });

  it("validates exec input: argv, env names and timeouts", async () => {
    const { docker, service } = setup();
    await service.installEgressPolicy();
    await expect(service.exec(alice, { argv: [] })).rejects.toMatchObject({ code: "bad_exec" });
    await expect(service.exec(alice, { argv: ["true"], env: { LD_PRELOAD: "x" } })).rejects.toMatchObject({ code: "bad_exec" });
    await service.exec(alice, { argv: ["sleep", "9999"], timeoutSec: 99_999 });
    const commands = docker.execs.filter((entry) => entry.exec.Cmd[0] === "timeout");
    expect(commands.at(-1)!.exec.Cmd.slice(0, 4)).toEqual(["timeout", "-k", "2", "600"]);
  });
});

describe("ttyArgv (2026-11-02)", () => {
  it("opens the terminal in the bot's folder, only a folder of /workspace/bots", () => {
    expect(ttyArgv()).toEqual([...SANDBOX_TTY_ARGV]);
    expect(ttyArgv("/etc")).toEqual([...SANDBOX_TTY_ARGV]);
    expect(ttyArgv("/workspace/bots/../x")).toEqual([...SANDBOX_TTY_ARGV]);
    const argv = ttyArgv("/workspace/bots/helper-2");
    expect(argv[0]).toBe("/bin/sh");
    expect(argv.at(-1)).toBe("/workspace/bots/helper-2");
    expect(argv[2]).toContain("exec /bin/bash -l");
  });
});

describe("hibernation of idle sandboxes (#2611)", () => {
  it("hibernates a sandbox stopped past the hibernation period: container and network go, /workspace stays", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_IDLE_MINUTES: "10", SAGAX_SANDBOX_HIBERNATE_MINUTES: "60" });
    await service.installEgressPolicy();
    await service.exec(alice, { argv: ["true"] });
    const names = sandboxNames(alice);
    advance(10 * 60_000 + 1);
    expect(await service.sweepIdle()).toEqual([alice]);
    expect(await service.hibernateIdle()).toEqual([]);
    advance(50 * 60_000);
    expect(await service.hibernateIdle()).toEqual([alice]);
    expect(docker.containers.has(names.container)).toBe(false);
    expect(docker.networks.has(names.network)).toBe(false);
    expect(docker.volumes.has(names.volume)).toBe(true);
    const status = await service.status(alice);
    expect(status.state).toBe("missing");
    expect(status.hibernated).toBe(true);
    // Nothing more to do on the next sweeps.
    advance(60 * 60_000);
    expect(await service.hibernateIdle()).toEqual([]);
  });

  it("wakes a hibernated sandbox on demand with the same /workspace", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_HIBERNATE_MINUTES: "30" });
    await service.installEgressPolicy();
    await service.exec(alice, { argv: ["true"] });
    const names = sandboxNames(alice);
    advance(31 * 60_000);
    await service.sweepIdle();
    await service.hibernateIdle();
    const volumes = docker.calls.filter((call) => call.startsWith("vol ")).length;
    await service.exec(alice, { argv: ["true"] });
    const status = await service.status(alice);
    expect(status.state).toBe("running");
    expect(status.hibernated).toBeUndefined();
    expect(docker.calls.filter((call) => call.startsWith("vol "))).toHaveLength(volumes);
    expect(docker.calls.filter((call) => call.startsWith("create "))).toHaveLength(2);
    expect(docker.volumes.has(names.volume)).toBe(true);
    expect(sandboxIsolationProblems(docker.containers.get(names.container)!.spec, alice)).toEqual([]);
  });

  it("never hibernates a running, busy or paused sandbox", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_HIBERNATE_MINUTES: "1" });
    await service.installEgressPolicy();
    await service.ensure(alice);
    await service.ensure(bob);
    await service.pause(bob);
    advance(5 * 60_000);
    expect(await service.hibernateIdle()).toEqual([]);
    expect(docker.containers.has(sandboxNames(alice).container)).toBe(true);
    expect(docker.containers.has(sandboxNames(bob).container)).toBe(true);
  });

  it("counts a sandbox first seen stopped (provisioner restart) from now", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_HIBERNATE_MINUTES: "60" });
    await service.installEgressPolicy();
    await service.ensure(carol);
    await service.stop(carol);
    const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_HIBERNATE_MINUTES: "60" });
    let now = 5_000_000;
    const restarted = new SandboxService(docker, config, () => now);
    expect(await restarted.hibernateIdle()).toEqual([]);
    now += 59 * 60_000;
    expect(await restarted.hibernateIdle()).toEqual([]);
    now += 2 * 60_000;
    expect(await restarted.hibernateIdle()).toEqual([carol]);
    advance(0);
  });

  it("is off with SAGAX_SANDBOX_HIBERNATE_MINUTES=off", async () => {
    const { docker, service, advance } = setup({ SAGAX_SANDBOX_HIBERNATE_MINUTES: "off" });
    await service.installEgressPolicy();
    await service.ensure(alice);
    await service.stop(alice);
    advance(30 * 24 * 60 * 60_000);
    expect(await service.hibernateIdle()).toEqual([]);
    expect(docker.containers.has(sandboxNames(alice).container)).toBe(true);
  });
});
