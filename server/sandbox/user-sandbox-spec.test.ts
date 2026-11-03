// CI isolation checks for the per-person server environment: the exact
// container, network and egress policy the provisioner sends to Docker, and
// the compose overlay that deploys it. No Docker daemon needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  DEFAULT_EGRESS_DENY,
  allocateSubnet,
  assertSandboxIsolation,
  cidrContains,
  egressHelperSpec,
  egressPolicyScript,
  egressUninstallScript,
  sandboxContainerSpec,
  sandboxIsolationProblems,
  sandboxKeyForPrincipal,
  sandboxNames,
  sandboxNetworkSpec,
  sandboxdConfigFromEnv,
  sandboxVolumeSpec,
} from "./user-sandbox-spec.ts";

const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: "test" });
const key = sandboxKeyForPrincipal("test", "pr_00000000-0000-4000-8000-000000000001");
type Spec = Record<string, unknown> & { HostConfig: Record<string, unknown> };
const spec = () => sandboxContainerSpec(config, key) as Spec;

describe("sandbox keys and names", () => {
  it("derives one opaque key per person and instance, never from a bot", () => {
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(sandboxKeyForPrincipal("test", "pr_00000000-0000-4000-8000-000000000001")).toBe(key);
    expect(sandboxKeyForPrincipal("test", "pr_00000000-0000-4000-8000-000000000002")).not.toBe(key);
    expect(sandboxKeyForPrincipal("other", "pr_00000000-0000-4000-8000-000000000001")).not.toBe(key);
  });

  it("names every object sagax-user-<key> and keeps the bridge within 15 characters", () => {
    const names = sandboxNames(key);
    expect(names.container).toBe(`sagax-user-${key}`);
    expect(names.volume.startsWith(`sagax-user-${key}`)).toBe(true);
    expect(names.bridge.length).toBeLessThanOrEqual(15);
    expect(() => sandboxNames("../etc")).toThrow();
  });
});

describe("container isolation", () => {
  it("passes every isolation rule by default", () => {
    expect(sandboxIsolationProblems(spec(), key)).toEqual([]);
    expect(() => assertSandboxIsolation(spec(), key)).not.toThrow();
  });

  it("runs non-root, read-only, without capabilities or new privileges", () => {
    const s = spec();
    expect(s.User).toBe("1000:1000");
    expect(s.HostConfig.ReadonlyRootfs).toBe(true);
    expect(s.HostConfig.Privileged).toBe(false);
    expect(s.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(s.HostConfig.CapAdd).toEqual([]);
    expect(s.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
  });

  it("keeps Docker's default seccomp and AppArmor profiles", () => {
    expect(JSON.stringify(spec())).not.toMatch(/seccomp|apparmor/i);
  });

  it("mounts nothing from the host and never a runtime socket", () => {
    const s = spec();
    expect(s.HostConfig.Binds).toEqual([]);
    expect(s.HostConfig.Devices).toEqual([]);
    expect(s.HostConfig.Mounts).toEqual([{ Type: "volume", Source: sandboxNames(key).volume, Target: "/workspace", ReadOnly: false }]);
    expect(JSON.stringify(s)).not.toMatch(/docker\.sock|containerd|podman\.sock/);
  });

  it("applies CPU, memory (no swap), pids, tmpfs and file size limits", () => {
    const host = spec().HostConfig;
    expect(host.Memory).toBe(1536 * 1024 * 1024);
    expect(host.MemorySwap).toBe(host.Memory);
    expect(host.NanoCpus).toBe(1_000_000_000);
    expect(host.PidsLimit).toBe(512);
    expect((host.Tmpfs as Record<string, string>)["/tmp"]).toContain(`size=${512 * 1024 * 1024}`);
    expect(host.Ulimits).toContainEqual({ Name: "fsize", Soft: 512 * 1024 * 1024, Hard: 512 * 1024 * 1024 });
    expect(host.OomScoreAdj).toBeGreaterThan(0);
  });

  it("sits on its own network and publishes no port", () => {
    const host = spec().HostConfig;
    expect(host.NetworkMode).toBe(sandboxNames(key).network);
    expect(host.PortBindings).toEqual({});
    expect(host.PublishAllPorts).toBe(false);
  });

  it("uses an alternative runtime only when configured", () => {
    expect(spec().HostConfig.Runtime).toBeUndefined();
    const gvisor = sandboxContainerSpec({ ...config, runtime: "runsc" }, key) as Spec;
    expect(gvisor.HostConfig.Runtime).toBe("runsc");
    expect(sandboxIsolationProblems(gvisor, key)).toEqual([]);
  });

  it.each([
    ["runs as root", (s: Spec) => { s.User = "0:0"; }],
    ["privileged", (s: Spec) => { s.HostConfig.Privileged = true; }],
    ["writable root filesystem", (s: Spec) => { s.HostConfig.ReadonlyRootfs = false; }],
    ["adds capabilities", (s: Spec) => { s.HostConfig.CapAdd = ["SYS_ADMIN"]; }],
    ["seccomp or AppArmor unconfined", (s: Spec) => { s.HostConfig.SecurityOpt = ["no-new-privileges:true", "seccomp=unconfined"]; }],
    ["no memory limit", (s: Spec) => { s.HostConfig.Memory = 0; }],
    ["no pids limit", (s: Spec) => { s.HostConfig.PidsLimit = 0; }],
    ["host bind mounts", (s: Spec) => { s.HostConfig.Binds = ["/:/host"]; }],
    ["container runtime socket", (s: Spec) => { s.HostConfig.Mounts = [{ Type: "bind", Source: "/var/run/docker.sock", Target: "/var/run/docker.sock" }]; }],
    ["not on its own network", (s: Spec) => { s.HostConfig.NetworkMode = "host"; }],
    ["host PidMode", (s: Spec) => { s.HostConfig.PidMode = "host"; }],
    ["published ports", (s: Spec) => { s.HostConfig.PortBindings = { "22/tcp": [{ HostPort: "2222" }] }; }],
  ])("refuses a spec that is %s", (problem, weaken) => {
    const s = spec();
    weaken(s);
    expect(sandboxIsolationProblems(s, key).join(",")).toContain(problem);
    expect(() => assertSandboxIsolation(s, key)).toThrow(/refused/);
  });
});

describe("network policy", () => {
  it("gives each sandbox its own bridge from the pool, no ICC, no IPv6", () => {
    const network = sandboxNetworkSpec(config, key, "10.213.0.16/28") as Record<string, unknown> & { Options: Record<string, string>; IPAM: { Config: { Subnet: string }[] } };
    expect(network.EnableIPv6).toBe(false);
    expect(network.Internal).toBe(false);
    expect(network.Options["com.docker.network.bridge.enable_icc"]).toBe("false");
    expect(cidrContains(config.subnetPool, network.IPAM.Config[0]!.Subnet)).toBe(true);
  });

  it("allocates distinct /28 subnets inside the pool", () => {
    expect(allocateSubnet("10.213.0.0/16", [])).toBe("10.213.0.0/28");
    expect(allocateSubnet("10.213.0.0/16", ["10.213.0.0/28", "10.213.0.16/28"])).toBe("10.213.0.32/28");
    expect(allocateSubnet("10.213.0.0/24", Array.from({ length: 16 }, (_, i) => `10.213.0.${i * 16}/28`))).toBeNull();
  });

  it("blocks metadata, private ranges, the host and Azure's WireServer, not the internet", () => {
    for (const cidr of ["169.254.0.0/16", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "168.63.129.16/32", "100.64.0.0/10"]) {
      expect(DEFAULT_EGRESS_DENY).toContain(cidr);
    }
    const script = egressPolicyScript(config);
    expect(script).toContain("-I DOCKER-USER 1 -s 10.213.0.0/16");
    expect(script).toContain("-I INPUT 1 -s 10.213.0.0/16 -j DROP");
    expect(script).toContain("169.254.0.0/16");
    expect(script).not.toContain("0.0.0.0/0");
    expect(script).toContain("sagax-egress-ok");
    expect(egressUninstallScript(config)).toContain("-D DOCKER-USER -s 10.213.0.0/16");
  });

  it("adds configured extra denials and refuses malformed ones", () => {
    const extra = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOX_EGRESS_DENY: "203.0.113.0/24" });
    expect(egressPolicyScript(extra)).toContain("203.0.113.0/24");
    expect(() => sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOX_EGRESS_DENY: "nope" })).toThrow();
  });

  it("only the egress helper gets host networking and NET_ADMIN, read-only", () => {
    const helper = egressHelperSpec(config, "true") as Spec;
    expect(helper.HostConfig.NetworkMode).toBe("host");
    expect(helper.HostConfig.CapAdd).toEqual(["NET_ADMIN", "NET_RAW"]);
    expect(helper.HostConfig.ReadonlyRootfs).toBe(true);
    expect(JSON.stringify(helper)).not.toMatch(/docker\.sock|Binds|Mounts/);
  });
});

describe("configuration", () => {
  it("defaults fit an 8 GiB host with a desktop in every running environment", () => {
    expect(config.maxRunning).toBe(2);
    expect(config.limits.memoryBytes).toBeGreaterThanOrEqual(1536 * 1024 ** 2);
    expect(config.limits.memoryBytes * config.maxRunning).toBeLessThanOrEqual(3 * 1024 ** 3);
    expect(config.idleStopMs).toBe(10 * 60_000);
    expect(config.requireEgressPolicy).toBe(true);
  });

  it("requires an image, validates limits and refuses reserved ports", () => {
    expect(() => sandboxdConfigFromEnv({})).toThrow(/SAGAX_SANDBOX_IMAGE/);
    expect(() => sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOX_MEMORY_MB: "-1" })).toThrow();
    expect(() => sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOXD_LISTEN: "0.0.0.0:8799" })).toThrow(/reserved/);
    expect(sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOX_MEMORY_MB: "512", SAGAX_SANDBOX_CPUS: "0.5" }).limits)
      .toMatchObject({ memoryBytes: 512 * 1024 * 1024, nanoCpus: 500_000_000 });
  });

  it("parses idle minutes, refuses zero and more than a day", () => {
    const image = { SAGAX_SANDBOX_IMAGE: "x:1" };
    expect(sandboxdConfigFromEnv({ ...image, SAGAX_SANDBOX_IDLE_MINUTES: "15" }).idleStopMs).toBe(15 * 60_000);
    expect(sandboxdConfigFromEnv({ ...image, SAGAX_SANDBOX_IDLE_MINUTES: "1440" }).idleStopMs).toBe(1440 * 60_000);
    expect(sandboxdConfigFromEnv({ ...image, SAGAX_SANDBOX_IDLE_MINUTES: "  " }).idleStopMs).toBe(10 * 60_000);
    expect(() => sandboxdConfigFromEnv({ ...image, SAGAX_SANDBOX_IDLE_MINUTES: "0" })).toThrow(/SAGAX_SANDBOX_IDLE_MINUTES/);
    expect(() => sandboxdConfigFromEnv({ ...image, SAGAX_SANDBOX_IDLE_MINUTES: "1441" })).toThrow(/SAGAX_SANDBOX_IDLE_MINUTES/);
  });
});

describe("compose overlay (deploy/docker-compose.sandbox.yml)", () => {
  const compose = parse(readFileSync(join(import.meta.dirname, "..", "..", "deploy", "docker-compose.sandbox.yml"), "utf8")) as {
    services: Record<string, Record<string, unknown>>;
    networks: Record<string, Record<string, unknown>>;
  };

  it("mounts the Docker socket into the provisioner only, never the Sagax server", () => {
    const withSocket = Object.entries(compose.services)
      .filter(([, service]) => JSON.stringify(service.volumes ?? []).includes("docker.sock"))
      .map(([name]) => name);
    expect(withSocket).toEqual(["sagax-sandboxd"]);
    expect(JSON.stringify(compose.services.omb)).not.toContain("docker.sock");
    expect(compose.services.omb!.volumes).toEqual(["sandboxd-key:/run/sagax-sandboxd:ro"]);
  });

  it("puts every new service behind the pulsabot profile", () => {
    for (const name of ["sagax-sandboxd", "sagax-sandbox-image"]) expect(compose.services[name]!.profiles).toEqual(["pulsabot"]);
  });

  it("hardens the provisioner and keeps its network internal and unpublished", () => {
    const sandboxd = compose.services["sagax-sandboxd"]!;
    expect(sandboxd.read_only).toBe(true);
    expect(sandboxd.cap_drop).toEqual(["ALL"]);
    expect(sandboxd.security_opt).toEqual(["no-new-privileges:true"]);
    expect(sandboxd.ports).toBeUndefined();
    expect(sandboxd.privileged).toBeUndefined();
    expect(sandboxd.networks).toEqual(["sandbox-control"]);
    expect(compose.networks["sandbox-control"]!.internal).toBe(true);
  });
});

describe("workspace volume hard quota", () => {
  const key = "a".repeat(32);
  it("is soft by default (no DriverOpts)", () => {
    expect(sandboxVolumeSpec(config, key)).not.toHaveProperty("DriverOpts");
    expect(config.hardVolumeQuota).toBe(false);
  });
  it("asks Docker for a hard size when SAGAX_SANDBOX_HARD_QUOTA=1", () => {
    const hard = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "x:1", SAGAX_SANDBOX_HARD_QUOTA: "1", SAGAX_SANDBOX_DISK_MB: "1024" });
    expect(sandboxVolumeSpec(hard, key)).toMatchObject({ Driver: "local", DriverOpts: { size: "1024m" } });
  });
});
