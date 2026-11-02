// The per-person server environment ("user-sandbox") on an organization
// server: one isolated Linux container per PERSON, shared by every bot that
// person owns, never one per bot. This module is pure: names, limits, the
// Docker create bodies and the host egress policy, so the isolation rules can
// be asserted in CI without a Docker daemon (user-sandbox-spec.test.ts).
//
// Who uses it: the provisioner (server/sandboxd.ts), a separate small service
// that alone holds the Docker socket, builds every container from
// sandboxContainerSpec() and refuses to create one that fails
// assertSandboxIsolation(). The Sagax server never sees the socket.
import { createHash } from "node:crypto";

/** The opaque per-person key the provisioner API is addressed by. It is a
 * digest of the deployment instance and the principal id, so the provisioner
 * never learns who the person is and a key can never name a bot. */
export const SANDBOX_KEY_RE = /^[a-f0-9]{32}$/;
export const SANDBOX_INSTANCE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const SANDBOX_NAME_PREFIX = "sagax-user-";
export const SANDBOX_LABEL = "com.pulsatrix.sagax.sandbox";
export const SANDBOX_USER_LABEL = "com.pulsatrix.sagax.sandbox.user";
export const SANDBOX_INSTANCE_LABEL = "com.pulsatrix.sagax.sandbox.instance";
export const SANDBOX_UID = 1000;
export const SANDBOX_WORKSPACE = "/workspace";

export function sandboxKeyForPrincipal(instance: string, principalId: string): string {
  if (!SANDBOX_INSTANCE_RE.test(instance)) throw new Error("invalid sandbox instance");
  if (!principalId) throw new Error("a sandbox belongs to a person");
  return createHash("sha256").update(`sagax-user\u0000${instance}\u0000${principalId}`).digest("hex").slice(0, 32);
}

export interface SandboxNames {
  container: string;
  volume: string;
  network: string;
  /** Linux bridge interface name: at most 15 characters. */
  bridge: string;
}

export function sandboxNames(key: string): SandboxNames {
  if (!SANDBOX_KEY_RE.test(key)) throw new Error("invalid sandbox key");
  return {
    container: `${SANDBOX_NAME_PREFIX}${key}`,
    volume: `${SANDBOX_NAME_PREFIX}${key}-workspace`,
    network: `${SANDBOX_NAME_PREFIX}${key}-net`,
    bridge: `sgx${key.slice(0, 12)}`,
  };
}

export interface SandboxLimits {
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  tmpBytes: number;
  /** Quota on /workspace. Soft (measured by the provisioner) by default; hard
   * when hardVolumeQuota is on and the volumes root is XFS with prjquota. */
  workspaceQuotaBytes: number;
  /** Hard per-file ceiling (RLIMIT_FSIZE). */
  maxFileBytes: number;
  nofile: number;
}

export interface SandboxdConfig {
  instance: string;
  image: string;
  /** An alternative OCI runtime the host offers (runsc, sysbox-runc). */
  runtime?: string;
  subnetPool: string;
  idleStopMs: number;
  maxRunning: number;
  limits: SandboxLimits;
  /** Ask Docker for a hard size on each workspace volume (local driver
   * `size` option). Needs the volumes root on XFS mounted with prjquota;
   * Docker refuses the volume otherwise, so it is opt-in
   * (SAGAX_SANDBOX_HARD_QUOTA=1). */
  hardVolumeQuota?: boolean;
  requireEgressPolicy: boolean;
  egressDeny: string[];
  listenHost: string;
  listenPort: number;
  keyFile: string;
  dockerSocket: string;
}

const MiB = 1024 * 1024;

/** Defaults sized for the production VM (4 vCPU, 8 GiB) next to Perspicax, Caddy,
 * the Teams bot and the Sagax server: every environment can open its desktop
 * (Xvnc, openbox and Chromium measured near 250 MiB, a few heavy tabs well
 * under 1 GiB), so 1.5 GiB and one CPU each and at most two running at once:
 * a full house stays at 3 GiB. Chromium's processes and threads count
 * against the pids limit, hence 512. */
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryBytes: 1536 * MiB,
  nanoCpus: 1_000_000_000,
  pidsLimit: 512,
  tmpBytes: 512 * MiB,
  // 2026-11-02: 20 GiB (was 2 GiB, full in production with LibreOffice files,
  // images and repositories). One node per person on Kubernetes, where it is
  // the claim's size (an older 2 GiB claim grows at its next start); a soft
  // quota on Docker.
  workspaceQuotaBytes: 20480 * MiB,
  maxFileBytes: 512 * MiB,
  nofile: 1024,
};
export const DEFAULT_MAX_RUNNING = 2;
export const DEFAULT_IDLE_MINUTES = 10;
export const DEFAULT_SUBNET_POOL = "10.213.0.0/16";
export const DEFAULT_SANDBOXD_PORT = 8791;

/** Destinations a sandbox may never reach: the host and anything private
 * beside it (Perspicax, the Docker bridges, the VNet), link-local cloud
 * metadata (169.254.169.254), Azure's WireServer, multicast and reserved
 * space. Public internet egress stays open. */
export const DEFAULT_EGRESS_DENY: readonly string[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "168.63.129.16/32",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export function parseCidr(cidr: string): { base: number; bits: number } {
  const match = CIDR_RE.exec(cidr.trim());
  if (!match) throw new Error(`invalid CIDR: ${cidr}`);
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((octet) => octet > 255) || bits > 32) throw new Error(`invalid CIDR: ${cidr}`);
  const ip = ((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, bits };
}

function formatIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

/** The first free /28 of the pool, or null when the pool is full. */
export function allocateSubnet(pool: string, used: readonly string[]): string | null {
  const { base, bits } = parseCidr(pool);
  if (bits > 24 || bits < 8) throw new Error("the sandbox subnet pool must be between /8 and /24");
  const taken = new Set(used.map((cidr) => {
    try { return parseCidr(cidr).base; } catch { return -1; }
  }));
  const count = 2 ** (28 - bits);
  for (let index = 0; index < count; index++) {
    const candidate = (base + index * 16) >>> 0;
    if (!taken.has(candidate)) return `${formatIp(candidate)}/28`;
  }
  return null;
}

export function cidrContains(outer: string, inner: string): boolean {
  const a = parseCidr(outer);
  const b = parseCidr(inner);
  if (b.bits < a.bits) return false;
  const mask = a.bits === 0 ? 0 : (0xffffffff << (32 - a.bits)) >>> 0;
  return ((b.base & mask) >>> 0) === a.base;
}

function positiveInt(raw: string | undefined, fallback: number, name: string, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error(`${name} must be a positive number up to ${max}`);
  return value;
}

/** The provisioner's configuration. Every limit is configurable; nothing here
 * can mount a host path, add a capability or pick a host network. */
export function sandboxdConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxdConfig {
  const instance = env.SAGAX_SANDBOX_INSTANCE?.trim() || "default";
  if (!SANDBOX_INSTANCE_RE.test(instance)) throw new Error("SAGAX_SANDBOX_INSTANCE must be lowercase letters, digits and hyphens (at most 24)");
  const image = env.SAGAX_SANDBOX_IMAGE?.trim() ?? "";
  if (!image || /\s/.test(image)) throw new Error("SAGAX_SANDBOX_IMAGE is required (the image built from deploy/sandbox/Dockerfile)");
  const runtime = env.SAGAX_SANDBOX_RUNTIME?.trim() || undefined;
  if (runtime && !/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(runtime)) throw new Error("SAGAX_SANDBOX_RUNTIME is not a runtime name");
  const subnetPool = env.SAGAX_SANDBOX_SUBNET_POOL?.trim() || DEFAULT_SUBNET_POOL;
  const pool = parseCidr(subnetPool);
  if (pool.bits > 24 || pool.bits < 8) throw new Error("SAGAX_SANDBOX_SUBNET_POOL must be between /8 and /24");
  const extraDeny = (env.SAGAX_SANDBOX_EGRESS_DENY ?? "").split(/[\s,]+/).filter(Boolean);
  for (const cidr of extraDeny) parseCidr(cidr);
  const listen = env.SAGAX_SANDBOXD_LISTEN?.trim() || `0.0.0.0:${DEFAULT_SANDBOXD_PORT}`;
  const listenMatch = /^([0-9.]+|\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i.exec(listen);
  if (!listenMatch) throw new Error("SAGAX_SANDBOXD_LISTEN must be host:port");
  const listenPort = Number(listenMatch[2]);
  if ([18790, 5199, 8799].includes(listenPort)) throw new Error("SAGAX_SANDBOXD_LISTEN uses a reserved port");
  return {
    instance,
    image,
    ...(runtime ? { runtime } : {}),
    subnetPool,
    idleStopMs: positiveInt(env.SAGAX_SANDBOX_IDLE_MINUTES, DEFAULT_IDLE_MINUTES, "SAGAX_SANDBOX_IDLE_MINUTES", 24 * 60) * 60_000,
    maxRunning: Math.floor(positiveInt(env.SAGAX_SANDBOX_MAX_RUNNING, DEFAULT_MAX_RUNNING, "SAGAX_SANDBOX_MAX_RUNNING", 64)),
    limits: {
      memoryBytes: Math.floor(positiveInt(env.SAGAX_SANDBOX_MEMORY_MB, DEFAULT_SANDBOX_LIMITS.memoryBytes / MiB, "SAGAX_SANDBOX_MEMORY_MB", 65536) * MiB),
      nanoCpus: Math.floor(positiveInt(env.SAGAX_SANDBOX_CPUS, DEFAULT_SANDBOX_LIMITS.nanoCpus / 1e9, "SAGAX_SANDBOX_CPUS", 64) * 1e9),
      pidsLimit: Math.floor(positiveInt(env.SAGAX_SANDBOX_PIDS, DEFAULT_SANDBOX_LIMITS.pidsLimit, "SAGAX_SANDBOX_PIDS", 32768)),
      tmpBytes: Math.floor(positiveInt(env.SAGAX_SANDBOX_TMP_MB, DEFAULT_SANDBOX_LIMITS.tmpBytes / MiB, "SAGAX_SANDBOX_TMP_MB", 8192) * MiB),
      workspaceQuotaBytes: Math.floor(positiveInt(env.SAGAX_SANDBOX_DISK_MB, DEFAULT_SANDBOX_LIMITS.workspaceQuotaBytes / MiB, "SAGAX_SANDBOX_DISK_MB", 1_048_576) * MiB),
      maxFileBytes: Math.floor(positiveInt(env.SAGAX_SANDBOX_MAX_FILE_MB, DEFAULT_SANDBOX_LIMITS.maxFileBytes / MiB, "SAGAX_SANDBOX_MAX_FILE_MB", 1_048_576) * MiB),
      nofile: DEFAULT_SANDBOX_LIMITS.nofile,
    },
    hardVolumeQuota: /^(1|true|yes|on)$/i.test(env.SAGAX_SANDBOX_HARD_QUOTA?.trim() ?? ""),
    requireEgressPolicy: !/^(0|false|no|off)$/i.test(env.SAGAX_SANDBOX_REQUIRE_EGRESS_POLICY?.trim() ?? ""),
    egressDeny: [...DEFAULT_EGRESS_DENY, ...extraDeny],
    listenHost: listenMatch[1]!.replace(/^\[|\]$/g, ""),
    listenPort,
    keyFile: env.SAGAX_SANDBOXD_KEY_FILE?.trim() || "/run/sagax-sandboxd/key",
    dockerSocket: env.SAGAX_SANDBOXD_DOCKER_SOCKET?.trim() || "/var/run/docker.sock",
  };
}

export function sandboxLabels(config: Pick<SandboxdConfig, "instance">, key: string): Record<string, string> {
  return {
    [SANDBOX_LABEL]: "1",
    [SANDBOX_USER_LABEL]: key,
    [SANDBOX_INSTANCE_LABEL]: config.instance,
    "sagax-user": key,
  };
}

/** One bridge network per sandbox: its own subnet from the pool, no
 * inter-container traffic, no IPv6. The host egress policy keys on the pool. */
export function sandboxNetworkSpec(config: Pick<SandboxdConfig, "instance">, key: string, subnet: string): Record<string, unknown> {
  const names = sandboxNames(key);
  return {
    Name: names.network,
    Driver: "bridge",
    CheckDuplicate: true,
    Internal: false,
    Attachable: false,
    EnableIPv6: false,
    IPAM: { Driver: "default", Config: [{ Subnet: subnet }] },
    Options: {
      "com.docker.network.bridge.name": names.bridge,
      "com.docker.network.bridge.enable_icc": "false",
      "com.docker.network.bridge.enable_ip_masquerade": "true",
    },
    Labels: sandboxLabels(config, key),
  };
}

export function sandboxVolumeSpec(
  config: Pick<SandboxdConfig, "instance"> & Partial<Pick<SandboxdConfig, "limits" | "hardVolumeQuota">>,
  key: string,
): Record<string, unknown> {
  const spec: Record<string, unknown> = { Name: sandboxNames(key).volume, Driver: "local", Labels: sandboxLabels(config, key) };
  if (config.hardVolumeQuota && config.limits) {
    // Docker's local driver enforces this with an XFS project quota.
    spec.DriverOpts = { size: `${Math.max(1, Math.floor(config.limits.workspaceQuotaBytes / MiB))}m` };
  }
  return spec;
}

/** The container create body. Read-only root, non-root user, no
 * capabilities, no new privileges, Docker's default seccomp and AppArmor
 * profiles (never unconfined), its own network and its own volume only. */
export function sandboxContainerSpec(config: Pick<SandboxdConfig, "instance" | "image" | "runtime" | "limits">, key: string): Record<string, unknown> {
  const names = sandboxNames(key);
  const { limits } = config;
  return {
    Image: config.image,
    User: `${SANDBOX_UID}:${SANDBOX_UID}`,
    Hostname: "sagax-env",
    WorkingDir: SANDBOX_WORKSPACE,
    Env: [
      `HOME=${SANDBOX_WORKSPACE}`,
      "LANG=C.UTF-8",
      "PATH=/workspace/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "SAGAX_ENVIRONMENT=user-sandbox",
    ],
    Cmd: ["sleep", "infinity"],
    Labels: sandboxLabels(config, key),
    NetworkDisabled: false,
    StopSignal: "SIGTERM",
    StopTimeout: 5,
    HostConfig: {
      ...(config.runtime ? { Runtime: config.runtime } : {}),
      Init: true,
      Privileged: false,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      MemoryReservation: Math.floor(limits.memoryBytes / 4),
      NanoCpus: limits.nanoCpus,
      CpuShares: 512,
      PidsLimit: limits.pidsLimit,
      // Hide host-revealing /proc and /sys entries. The process still has
      // its own /proc; reading the host through it is also refused by the
      // misuse classifier (docs/security/misuse-guardrails.md).
      MaskedPaths: [
        "/proc/acpi",
        "/proc/asound",
        "/proc/kcore",
        "/proc/keys",
        "/proc/latency_stats",
        "/proc/sched_debug",
        "/proc/scsi",
        "/proc/timer_list",
        "/proc/timer_stats",
        "/sys/firmware",
        "/sys/devices/virtual/powercap",
      ],
      ReadonlyPaths: ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"],
      OomScoreAdj: 500,
      Ulimits: [
        { Name: "nofile", Soft: limits.nofile, Hard: limits.nofile },
        { Name: "fsize", Soft: limits.maxFileBytes, Hard: limits.maxFileBytes },
        { Name: "core", Soft: 0, Hard: 0 },
      ],
      Tmpfs: {
        "/tmp": `rw,nosuid,nodev,size=${limits.tmpBytes}`,
        "/run": "rw,nosuid,nodev,noexec,size=8m",
        "/dev/shm": `rw,nosuid,nodev,noexec,size=${Math.min(limits.tmpBytes, 128 * MiB)}`,
      },
      Mounts: [{ Type: "volume", Source: names.volume, Target: SANDBOX_WORKSPACE, ReadOnly: false }],
      Binds: [],
      Devices: [],
      NetworkMode: names.network,
      IpcMode: "private",
      PidMode: "",
      UTSMode: "",
      UsernsMode: "",
      CgroupnsMode: "private",
      PublishAllPorts: false,
      PortBindings: {},
      Dns: [],
      ExtraHosts: [],
      RestartPolicy: { Name: "no" },
      AutoRemove: false,
      LogConfig: { Type: "json-file", Config: { "max-size": "1m", "max-file": "1" } },
    },
  };
}

type Spec = Record<string, unknown>;

/** Every isolation rule, checked on the exact body the provisioner sends to
 * Docker. A failure means the provisioner refuses to create the container;
 * CI asserts the defaults pass and that each weakening is caught. */
export function sandboxIsolationProblems(spec: Spec, key: string): string[] {
  const names = sandboxNames(key);
  const host = (spec.HostConfig ?? {}) as Spec;
  const problems: string[] = [];
  const user = String(spec.User ?? "");
  if (!user || /^(0|root)(:|$)/.test(user)) problems.push("runs as root");
  if (host.Privileged !== false) problems.push("privileged");
  if (host.ReadonlyRootfs !== true) problems.push("writable root filesystem");
  if (!Array.isArray(host.CapDrop) || !host.CapDrop.includes("ALL")) problems.push("capabilities not dropped");
  if (Array.isArray(host.CapAdd) && host.CapAdd.length > 0) problems.push("adds capabilities");
  const securityOpt = Array.isArray(host.SecurityOpt) ? host.SecurityOpt.map(String) : [];
  if (!securityOpt.includes("no-new-privileges:true")) problems.push("new privileges allowed");
  if (securityOpt.some((opt) => /unconfined/i.test(opt))) problems.push("seccomp or AppArmor unconfined");
  if (!(Number(host.Memory) > 0) || Number(host.MemorySwap) !== Number(host.Memory)) problems.push("no memory limit");
  if (!(Number(host.NanoCpus) > 0)) problems.push("no CPU limit");
  if (!(Number(host.PidsLimit) > 0)) problems.push("no pids limit");
  const masked = Array.isArray(host.MaskedPaths) ? host.MaskedPaths.map(String) : [];
  if (!masked.includes("/proc/kcore")) problems.push("host proc not masked");
  const readonlyPaths = Array.isArray(host.ReadonlyPaths) ? host.ReadonlyPaths.map(String) : [];
  if (!readonlyPaths.includes("/proc/sys")) problems.push("proc sys not read-only");
  if (Array.isArray(host.Binds) && host.Binds.length > 0) problems.push("host bind mounts");
  if (Array.isArray(host.Devices) && host.Devices.length > 0) problems.push("host devices");
  const mounts = Array.isArray(host.Mounts) ? host.Mounts as Spec[] : [];
  for (const mount of mounts) {
    if (mount.Type !== "volume" || mount.Source !== names.volume) problems.push(`foreign mount ${String(mount.Source ?? mount.Type)}`);
  }
  const serialized = JSON.stringify(spec);
  if (/docker\.sock|containerd\.sock|podman\.sock/i.test(serialized)) problems.push("container runtime socket");
  if (host.NetworkMode !== names.network) problems.push("not on its own network");
  for (const mode of ["PidMode", "IpcMode", "UTSMode", "UsernsMode"] as const) {
    if (String(host[mode] ?? "") === "host") problems.push(`host ${mode}`);
  }
  if (host.PublishAllPorts === true || (host.PortBindings && Object.keys(host.PortBindings as object).length > 0)) problems.push("published ports");
  return problems;
}

export function assertSandboxIsolation(spec: Spec, key: string): void {
  const problems = sandboxIsolationProblems(spec, key);
  if (problems.length) throw new Error(`sandbox spec refused: ${problems.join(", ")}`);
}

/** The iptables chain name for this deployment (at most 28 characters). */
export function egressChain(instance: string): string {
  return `SAGAX-SBX-${instance.toUpperCase()}`.slice(0, 28);
}

/** A POSIX shell script, run by the provisioner once at start in a short-lived
 * helper container (host network, NET_ADMIN, the sandbox image which ships
 * iptables). Idempotent. It sends everything from the pool through a chain
 * that drops private, link-local and metadata destinations (DOCKER-USER,
 * before Docker's own forwarding rules) and drops every packet from the pool
 * to the host itself (INPUT), so the host's ports and the Perspicax services
 * stay out of reach. It prints `sagax-egress-ok` when the rules are in place. */
export function egressPolicyScript(config: Pick<SandboxdConfig, "instance" | "subnetPool" | "egressDeny">): string {
  parseCidr(config.subnetPool);
  for (const cidr of config.egressDeny) parseCidr(cidr);
  const chain = egressChain(config.instance);
  const pool = config.subnetPool;
  const deny = config.egressDeny.join(" ");
  return [
    "set -eu",
    "ipt=''",
    "for candidate in iptables-nft iptables-legacy iptables; do",
    "  if command -v \"$candidate\" >/dev/null 2>&1 && \"$candidate\" -S DOCKER-USER >/dev/null 2>&1; then ipt=$candidate; break; fi",
    "done",
    "[ -n \"$ipt\" ] || { echo 'sagax-egress-missing: no DOCKER-USER chain (is Docker using iptables?)' >&2; exit 3; }",
    `$ipt -N ${chain} 2>/dev/null || $ipt -F ${chain}`,
    `for cidr in ${deny}; do $ipt -A ${chain} -d "$cidr" -j DROP; done`,
    `$ipt -A ${chain} -j RETURN`,
    `$ipt -C DOCKER-USER -s ${pool} -j ${chain} 2>/dev/null || $ipt -I DOCKER-USER 1 -s ${pool} -j ${chain}`,
    `$ipt -C INPUT -s ${pool} -j DROP 2>/dev/null || $ipt -I INPUT 1 -s ${pool} -j DROP`,
    `$ipt -S DOCKER-USER | grep -q -- '-j ${chain}' && $ipt -S INPUT | grep -q -- '-s ${pool}' && echo sagax-egress-ok`,
  ].join("\n");
}

/** Removes exactly what egressPolicyScript added (the smoke test cleans up). */
export function egressUninstallScript(config: Pick<SandboxdConfig, "instance" | "subnetPool">): string {
  const chain = egressChain(config.instance);
  const pool = config.subnetPool;
  return [
    "set -u",
    "for ipt in iptables-nft iptables-legacy; do",
    "  command -v \"$ipt\" >/dev/null 2>&1 || continue",
    `  while $ipt -D DOCKER-USER -s ${pool} -j ${chain} 2>/dev/null; do :; done`,
    `  while $ipt -D INPUT -s ${pool} -j DROP 2>/dev/null; do :; done`,
    `  $ipt -F ${chain} 2>/dev/null; $ipt -X ${chain} 2>/dev/null`,
    "done",
    "echo sagax-egress-removed",
  ].join("\n");
}

/** The helper container that applies the policy: the ONLY container the
 * provisioner creates with host networking and NET_ADMIN, and only with this
 * fixed script; it is removed as soon as it exits. */
export function egressHelperSpec(config: Pick<SandboxdConfig, "instance" | "image">, script: string): Record<string, unknown> {
  return {
    Image: config.image,
    User: "0:0",
    Entrypoint: ["/bin/sh", "-c"],
    Cmd: [script],
    Labels: { [SANDBOX_LABEL]: "egress-helper", [SANDBOX_INSTANCE_LABEL]: config.instance },
    HostConfig: {
      NetworkMode: "host",
      CapDrop: ["ALL"],
      CapAdd: ["NET_ADMIN", "NET_RAW"],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      AutoRemove: false,
      Memory: 64 * MiB,
      PidsLimit: 32,
    },
  };
}
