import type { SandboxExecInput, SandboxExecOutput } from "./sandbox-exec-types.ts";
export type { SandboxExecInput, SandboxExecOutput } from "./sandbox-exec-types.ts";
// The provisioner's sandbox lifecycle, independent of HTTP and of a real
// Docker daemon (the DockerApi is injected). One sandbox per opaque person
// key: created on first need, started on demand, stopped after an idle
// period, removed on request. Every object it touches carries its labels and
// its deployment instance; anything else with a matching name is refused.
import type { Duplex } from "node:stream";

import type { DockerApi, TtyExec, TtySize } from "./sandboxd-docker.ts";
import { BOT_FOLDER_RE } from "./sandbox-bot-folder.ts";
import {
  SANDBOX_INSTANCE_LABEL,
  SANDBOX_KEY_RE,
  SANDBOX_LABEL,
  SANDBOX_UID,
  SANDBOX_USER_LABEL,
  SANDBOX_WORKSPACE,
  allocateSubnet,
  assertSandboxIsolation,
  cidrContains,
  egressHelperSpec,
  egressPolicyScript,
  sandboxContainerSpec,
  sandboxNames,
  sandboxNetworkSpec,
  sandboxVolumeSpec,
  type SandboxdConfig,
} from "./user-sandbox-spec.ts";

export type SandboxState = "missing" | "stopped" | "running" | "paused";
export type EgressPolicyState = "enforced" | "missing" | "not-required";

export interface SandboxStatus {
  key: string;
  state: SandboxState;
  lastUsedAt: number | null;
  workspaceBytes: number | null;
  overQuota: boolean;
  busy: number;
  limits: { memoryMb: number; cpus: number; pids: number; diskMb: number; tmpMb: number };
  /** The filesystem of /workspace itself (df), measured with the usage:
   * what is really left, whatever the quota says. Absent until measured. */
  workspaceFreeBytes?: number;
  workspaceTotalBytes?: number;
  /** Kubernetes: the sandbox's Pod is on its way up (state stays
   * "stopped" for older readers). Absent otherwise. */
  starting?: true;
  /** Hibernated (#2611): unused past the hibernation period, its container
   * and network were removed and /workspace kept; the next call wakes it.
   * Absent otherwise. */
  hibernated?: true;
  /** #4463: kernel keys the environment's own uid holds, and its quota
   * (/proc/key-users inside it), measured with the usage. Every command
   * still running, and on an older environment every leftover zombie,
   * holds one; at the quota no command can start. Absent until measured. */
  keys?: { used: number; max: number };
}

/** The usage panel of the person's Computer tab: a light sample, scoped to
 * that one sandbox. */
export interface SandboxStats {
  key: string;
  state: SandboxState;
  /** CPU in use as a percentage of the sandbox's own CPU quota. */
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number;
  workspaceBytes: number | null;
  workspaceQuotaBytes: number;
  /** The /workspace filesystem itself (df), when measured. */
  workspaceFreeBytes?: number;
  workspaceTotalBytes?: number;
  /** e.g. "Debian GNU/Linux 12 (bookworm)", read inside the sandbox once. */
  os: string | null;
  arch: string | null;
  /** The image's name and tag, without the registry. */
  image: string;
}

/** #3440: the code of an exec the environment's transport did not complete
 * (the cluster refused it, or its stream broke): the message says why. */
export const EXEC_FAILED_CODE = "exec_failed";
export const EXEC_NOT_RUN_MESSAGE = "the server environment did not run the command";
/** #4463: the environment could not start even a trivial command, and
 * starting it again on its disk did not fix it. */
export const ENVIRONMENT_BROKEN_CODE = "environment_broken";
export const ENVIRONMENT_BROKEN_MESSAGE = "Your server environment could not start any command, and restarting it on its disk did not fix it. Your files are kept. Try again in a few minutes; if it keeps failing, tell your administrator";
/** Not restarted: something still runs in it, and a restart would end it. */
export const ENVIRONMENT_BUSY_MESSAGE = "Your server environment cannot start new commands, and it was not restarted because commands, terminals or MCP servers are still running in it (a restart would stop them). Your files are kept. Once they end, the next command restarts it";
/** Not restarted again: it already was, a short while ago. */
export const ENVIRONMENT_RECENTLY_REPAIRED_MESSAGE = "Your server environment cannot start new commands. It was already restarted on its disk less than 10 minutes ago, so it is not restarted again yet. Your files are kept. Try again in a few minutes; if it keeps failing, tell your administrator";
/** Put first on the stderr of a command run again after a repair. */
export const ENVIRONMENT_REPAIRED_NOTICE = "sagax: your server environment could not start commands any more, so it was restarted on its disk before this command ran. Your files are kept; processes left running in the background and open terminals were stopped.\n";
/** The plain words, then the reason (#3440). */
function brokenMessage(lead: string, cause: Error): string {
  return `${lead}. Cause: ${cause.message.slice(0, 400)}`;
}
/** A broken environment is restarted at most once in this period. */
export const ENVIRONMENT_REPAIR_COOLDOWN_MS = 10 * 60_000;
const HEALTH_PROBE_TIMEOUT_MS = 20_000;
/** #4463: the runtime's refusal when the uid's kernel key quota is spent,
 * e.g. "unable to start container process: unable to join session keyring:
 * unable to create session key: disk quota exceeded". The runtime creates
 * the session keyring before the command starts: a command refused so never
 * ran. Nothing else triggers a restart. */
const KEYRING_REFUSAL_RE = /unable to (?:join session keyring|create session key)|session key(?:ring)?\b[^\n]*disk quota exceeded/i;
/** A transport cut after the start: the command may have run. */
const MAY_HAVE_RUN_RE = /may have run in part/i;

/** True for an exec the runtime refused at its start because the
 * environment's key quota is full: the command certainly never ran. */
export function isKeyringRefusal(error: unknown): error is SandboxError {
  return error instanceof SandboxError && error.code === EXEC_FAILED_CODE
    && KEYRING_REFUSAL_RE.test(error.message) && !MAY_HAVE_RUN_RE.test(error.message);
}
/** Above this share of its key quota, an environment is reported in the log. */
const KEYS_WARN_RATIO = 0.75;

/** #4463: the uid 0 line of /proc/key-users read inside the environment
 * (the container's own root, whose quota every exec's session keyring
 * uses): `0: usage nkeys/nikeys qnkeys/maxkeys qnbytes/maxbytes`. */
export function parseKeyUsers(text: string): { used: number; max: number } | null {
  const match = /^\s*0:\s+\d+\s+\d+\/\d+\s+(\d+)\/(\d+)\s+\d+\/\d+/m.exec(text);
  if (!match) return null;
  const used = Number(match[1]);
  const max = Number(match[2]);
  return Number.isFinite(used) && Number.isFinite(max) && max > 0 ? { used, max } : null;
}

export class SandboxError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const EXEC_ENV_KEY_RE = /^SAGAX_[A-Z0-9_]{1,40}$/;
/** A person's MCP server command (stdioStream): its own variables, minus
 * those that describe the environment itself. */
export const STDIO_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const STDIO_ENV_RESERVED = new Set(["HOME", "PATH", "USER", "SAGAX_ENVIRONMENT"]);
/** MCP servers of one person running at once (one per server and turn). */
export const MAX_STDIO_STREAMS = 8;
/** In-chat terminals open at once in one sandbox (the server allows 3 per person). */
export const MAX_TTY_STREAMS = 4;
/** The login shell of the sandbox user, in a terminal. */
export const SANDBOX_TTY_ARGV = ["/bin/bash", "-l"] as const;

/** The terminal's shell, in the bot's own folder when one is named
 * (server/sandbox/sandbox-bot-folder.ts; created on first use), else /workspace.
 * Only a folder of /workspace/bots is accepted. */
export function ttyArgv(cwd?: string): string[] {
  if (!cwd || !BOT_FOLDER_RE.test(cwd)) return [...SANDBOX_TTY_ARGV];
  return ["/bin/sh", "-c", 'mkdir -p -- "$1/tmp" 2>/dev/null; cd -- "$1" 2>/dev/null && export TMPDIR="$1/tmp" SAGAX_BOT_DIR="$1"; exec /bin/bash -l', "sagax-tty", cwd];
}

export interface SandboxStdioSpec {
  argv: string[];
  env?: Record<string, string>;
}
export const MAX_EXEC_TIMEOUT_SEC = 600;
export const DEFAULT_EXEC_TIMEOUT_SEC = 120;
export const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024;
const MAX_EXEC_ENV_BYTES = 1_500_000;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const MAX_CONCURRENT_EXECS = 4;
const USAGE_TTL_MS = 60_000;
const CAPACITY_IDLE_GRACE_MS = 60_000;
/** Live views of one person's desktop open at once (windows, reconnects). */
export const MAX_DESKTOP_STREAMS = 4;
const CONTROL_TOUCH_MS = 30_000;

export class SandboxService {
  private readonly lastUsed = new Map<string, number>();
  /** Sandboxes hibernated by this process (Kubernetes keeps reporting a
   * claim without a Pod as "stopped", so the flag cannot be read back). */
  private readonly hibernated = new Set<string>();
  private readonly busy = new Map<string, number>();
  private readonly usage = new Map<string, { bytes: number; at: number; freeBytes?: number; totalBytes?: number }>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly desktopStreams = new Map<string, number>();
  private readonly stdioStreams = new Map<string, number>();
  private readonly ttyStreams = new Map<string, number>();
  private readonly osInfo = new Map<string, { os: string; arch: string }>();
  /** #4463: when each environment was last restarted because it could not run a command. */
  private readonly repairedAt = new Map<string, number>();
  /** A repair under way: the other commands that failed meanwhile wait for it. */
  private readonly repairing = new Map<string, Promise<boolean>>();
  /** Commands whose exec is under way right now (busy also counts those
   * waiting for the environment or for a repair). */
  private readonly inFlight = new Map<string, number>();
  private readonly keys = new Map<string, { used: number; max: number }>();
  private readonly keysWarned = new Set<string>();
  egress: EgressPolicyState;

  private readonly docker: DockerApi;
  readonly config: SandboxdConfig;
  private readonly now: () => number;

  constructor(docker: DockerApi, config: SandboxdConfig, now: () => number = Date.now) {
    this.docker = docker;
    this.config = config;
    this.now = now;
    this.egress = config.requireEgressPolicy ? "missing" : "not-required";
  }

  private ownLabels(): Record<string, string> {
    return { [SANDBOX_LABEL]: "1", [SANDBOX_INSTANCE_LABEL]: this.config.instance };
  }

  private owned(labels: Record<string, string>, key: string): boolean {
    return labels[SANDBOX_LABEL] === "1" && labels[SANDBOX_INSTANCE_LABEL] === this.config.instance && labels[SANDBOX_USER_LABEL] === key;
  }

  private checkKey(key: string): void {
    if (!SANDBOX_KEY_RE.test(key)) throw new SandboxError(400, "bad_key", "invalid sandbox key");
  }

  private withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(work);
    // The chain itself never rejects: the caller gets `next`'s outcome.
    const settled: Promise<void> = next.then(() => {}, () => {}).finally(() => { if (this.locks.get(key) === settled) this.locks.delete(key); });
    this.locks.set(key, settled);
    return next;
  }

  /** Apply the host egress policy through the one-shot helper. */
  async installEgressPolicy(): Promise<EgressPolicyState> {
    try {
      const result = await this.docker.runOnce(
        `sagax-sandbox-egress-${this.config.instance}`,
        egressHelperSpec(this.config, egressPolicyScript(this.config)),
        60_000,
      );
      this.egress = result.exitCode === 0 && result.output.includes("sagax-egress-ok") ? "enforced"
        : this.config.requireEgressPolicy ? "missing" : "not-required";
      if (this.egress !== "enforced") console.error(`sandboxd: egress policy not applied (exit ${result.exitCode}): ${result.output.slice(0, 400)}`);
    } catch (error) {
      this.egress = this.config.requireEgressPolicy ? "missing" : "not-required";
      console.error(`sandboxd: egress policy helper failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.egress;
  }

  private limitsSummary(): SandboxStatus["limits"] {
    const { limits } = this.config;
    return {
      memoryMb: Math.round(limits.memoryBytes / 1048576),
      cpus: limits.nanoCpus / 1e9,
      pids: limits.pidsLimit,
      diskMb: Math.round(limits.workspaceQuotaBytes / 1048576),
      tmpMb: Math.round(limits.tmpBytes / 1048576),
    };
  }

  async status(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    const names = sandboxNames(key);
    const container = await this.docker.inspectContainer(names.container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    const state: SandboxState = !container ? "missing" : container.paused ? "paused" : container.running ? "running" : "stopped";
    const usage = this.usage.get(key);
    const hibernated = state === "missing"
      ? Boolean((await this.docker.inspectVolume(names.volume).then((volume) => volume && this.owned(volume.labels, key), () => false)))
      : state === "stopped" && !container?.starting && this.hibernated.has(key);
    return {
      key,
      state,
      ...(state === "stopped" && container?.starting ? { starting: true as const } : {}),
      ...(hibernated ? { hibernated: true as const } : {}),
      lastUsedAt: this.lastUsed.get(key) ?? null,
      workspaceBytes: usage?.bytes ?? null,
      overQuota: usage ? usage.bytes > this.config.limits.workspaceQuotaBytes : false,
      ...(usage?.freeBytes !== undefined && usage.totalBytes !== undefined ? { workspaceFreeBytes: usage.freeBytes, workspaceTotalBytes: usage.totalBytes } : {}),
      busy: this.busy.get(key) ?? 0,
      limits: this.limitsSummary(),
      ...(state === "running" && this.keys.has(key) ? { keys: { ...this.keys.get(key)! } } : {}),
    };
  }

  async list(): Promise<SandboxStatus[]> {
    const rows = await this.docker.listContainers(this.ownLabels());
    const keys = rows.map((row) => row.labels[SANDBOX_USER_LABEL]).filter((key): key is string => typeof key === "string" && SANDBOX_KEY_RE.test(key));
    return Promise.all(keys.map((key) => this.status(key)));
  }

  private async runningCount(): Promise<{ key: string; lastUsed: number }[]> {
    const rows = await this.docker.listContainers(this.ownLabels());
    return rows.filter((row) => row.running && SANDBOX_KEY_RE.test(row.labels[SANDBOX_USER_LABEL] ?? ""))
      .map((row) => {
        const key = row.labels[SANDBOX_USER_LABEL]!;
        return { key, lastUsed: this.lastUsed.get(key) ?? row.startedAt ?? 0 };
      });
  }

  /** Make room for one more running sandbox: stop the least recently used
   * one that is idle, or refuse with 429. */
  private async makeRoom(forKey: string): Promise<void> {
    const running = (await this.runningCount()).filter((row) => row.key !== forKey);
    if (running.length < this.config.maxRunning) return;
    const now = this.now();
    const victims = running
      .filter((row) => (this.busy.get(row.key) ?? 0) === 0 && now - row.lastUsed > CAPACITY_IDLE_GRACE_MS)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const needed = running.length - this.config.maxRunning + 1;
    if (victims.length < needed) {
      throw new SandboxError(429, "capacity", "every server environment slot is in use; try again in a few minutes");
    }
    for (const victim of victims.slice(0, needed)) await this.docker.stopContainer(sandboxNames(victim.key).container, 5);
  }

  private async ensureNetwork(key: string): Promise<void> {
    const names = sandboxNames(key);
    const existing = await this.docker.inspectNetwork(names.network);
    if (existing) {
      if (!this.owned(existing.labels, key)) throw new SandboxError(409, "conflict", "a network with this name is not managed by this provisioner");
      if (!existing.subnets.every((subnet) => cidrContains(this.config.subnetPool, subnet))) {
        throw new SandboxError(409, "conflict", "the sandbox network is outside the egress-policed pool");
      }
      return;
    }
    const used = (await this.docker.listNetworks({ [SANDBOX_LABEL]: "1" })).flatMap((network) => network.subnets);
    const subnet = allocateSubnet(this.config.subnetPool, used);
    if (!subnet) throw new SandboxError(507, "pool_full", "the sandbox subnet pool is full");
    await this.docker.createNetwork(sandboxNetworkSpec(this.config, key, subnet));
  }

  private async ensureVolume(key: string): Promise<void> {
    const names = sandboxNames(key);
    const existing = await this.docker.inspectVolume(names.volume);
    if (existing) {
      if (!this.owned(existing.labels, key)) throw new SandboxError(409, "conflict", "a volume with this name is not managed by this provisioner");
      return;
    }
    await this.docker.createVolume(sandboxVolumeSpec(this.config, key));
  }

  /** Create on first need, start when stopped. Idempotent. */
  ensure(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      if (this.egress === "missing") {
        throw new SandboxError(503, "egress_policy", "the host egress policy is not in place; server environments stay off until it is");
      }
      const names = sandboxNames(key);
      let container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.paused) {
        throw new SandboxError(409, "paused", "the server environment is paused; its owner resumes it from the Computer tab");
      }
      if (container?.running) {
        this.touch(key);
        return this.status(key);
      }
      await this.makeRoom(key);
      // A stopped environment created from an older image (before a deploy)
      // starts again from the current one: nothing runs in it, /workspace
      // and the network stay. Otherwise it would miss what the new image
      // brings (the desktop, sagax-desktop) until its owner reset it.
      if (container && container.image && container.image !== this.config.image) {
        await this.docker.removeContainer(names.container);
        container = null;
      }
      if (!container) {
        if (!(await this.docker.imageExists(this.config.image))) {
          throw new SandboxError(503, "image_missing", "the server environment image is not on this host");
        }
        await this.ensureNetwork(key);
        await this.ensureVolume(key);
        const spec = sandboxContainerSpec(this.config, key);
        assertSandboxIsolation(spec, key);
        await this.docker.createContainer(names.container, spec);
        container = await this.docker.inspectContainer(names.container);
      }
      // Kubernetes: an older, smaller claim grows to the configured size
      // before the start (best effort; Docker has nothing to grow).
      await this.docker.growVolume?.(names.volume).catch(() => {});
      await this.docker.startContainer(names.container);
      this.hibernated.delete(key);
      this.touch(key);
      return this.status(key);
    });
  }

  stop(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.running) await this.docker.stopContainer(names.container, 5);
      return this.status(key);
    });
  }

  /** Remove the container and its network; the workspace volume too unless
   * `keepWorkspace`. Unknown keys succeed (nothing to remove). */
  remove(key: string, options: { keepWorkspace?: boolean } = {}): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      await this.removeLocked(key, options);
      return this.status(key);
    });
  }

  /** remove() without the lock: the caller holds it. */
  private async removeLocked(key: string, options: { keepWorkspace?: boolean }): Promise<void> {
    const names = sandboxNames(key);
    const container = await this.docker.inspectContainer(names.container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    if (container) await this.docker.removeContainer(names.container);
    const network = await this.docker.inspectNetwork(names.network);
    if (network && this.owned(network.labels, key)) await this.docker.removeNetwork(names.network);
    if (!options.keepWorkspace) {
      const volume = await this.docker.inspectVolume(names.volume);
      if (volume && this.owned(volume.labels, key)) await this.docker.removeVolume(names.volume);
      this.usage.delete(key);
    }
    this.lastUsed.delete(key);
    this.hibernated.delete(key);
    this.osInfo.delete(key);
    this.keys.delete(key);
    this.keysWarned.delete(key);
  }

  private touch(key: string): void {
    this.lastUsed.set(key, this.now());
  }

  /** Count now as use of a running sandbox, so the idle sweep leaves it up
   * (a voice call's heartbeat: the person is talking to a bot that works
   * there). Starts nothing: a stopped, paused or missing sandbox stays so. */
  async markUsed(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    const container = await this.docker.inspectContainer(sandboxNames(key).container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    if (container?.running && !container.paused) this.touch(key);
    return this.status(key);
  }

  async exec(key: string, input: SandboxExecInput): Promise<SandboxExecOutput> {
    this.checkKey(key);
    if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.length > 64 || input.argv.some((arg) => typeof arg !== "string" || arg.includes("\u0000"))) {
      throw new SandboxError(400, "bad_exec", "argv must be 1 to 64 strings");
    }
    const env = Object.entries(input.env ?? {});
    let envBytes = 0;
    for (const [name, value] of env) {
      if (!EXEC_ENV_KEY_RE.test(name) || typeof value !== "string" || value.includes("\u0000")) throw new SandboxError(400, "bad_exec", "env names must be SAGAX_*");
      envBytes += name.length + value.length;
    }
    if (envBytes > MAX_EXEC_ENV_BYTES) throw new SandboxError(413, "too_large", "the request is too large");
    let stdin: Buffer | undefined;
    if (input.stdinBase64 !== undefined) {
      if (typeof input.stdinBase64 !== "string" || !BASE64_RE.test(input.stdinBase64)) throw new SandboxError(400, "bad_exec", "stdin must be base64");
      if (envBytes + input.stdinBase64.length > MAX_EXEC_ENV_BYTES) throw new SandboxError(413, "too_large", "the request is too large");
      stdin = Buffer.from(input.stdinBase64, "base64");
    }
    const timeoutSec = Math.min(MAX_EXEC_TIMEOUT_SEC, Math.max(1, Math.floor(input.timeoutSec ?? DEFAULT_EXEC_TIMEOUT_SEC)));
    const maxOutput = Math.min(MAX_EXEC_OUTPUT_BYTES, Math.max(1024, Math.floor(input.maxOutputBytes ?? 256 * 1024)));
    if ((this.busy.get(key) ?? 0) >= MAX_CONCURRENT_EXECS) throw new SandboxError(429, "busy", "too many commands are running in this environment");
    await this.ensure(key);
    this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
    try {
      const run = () => this.docker.exec(sandboxNames(key).container, {
        Cmd: ["timeout", "-k", "2", String(timeoutSec), ...input.argv],
        User: `${SANDBOX_UID}:${SANDBOX_UID}`,
        Env: env.map(([name, value]) => `${name}=${value}`),
        WorkingDir: SANDBOX_WORKSPACE,
      }, maxOutput, stdin);
      const tracked = async () => {
        this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
        try {
          return await run();
        } finally {
          const left = (this.inFlight.get(key) ?? 1) - 1;
          if (left > 0) this.inFlight.set(key, left);
          else this.inFlight.delete(key);
        }
      };
      let result: Awaited<ReturnType<typeof run>>;
      let notice = "";
      try {
        result = await tracked();
      } catch (error) {
        // #4463: only a refusal at the start for a full key quota (the
        // command never ran) restarts the environment, then runs it once
        // more. Any other failure, the command may have run: as is.
        if (!isKeyringRefusal(error) || !(await this.repairIfBroken(key, error))) throw error;
        result = await tracked();
        notice = ENVIRONMENT_REPAIRED_NOTICE;
      }
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString("utf8"),
        stderr: notice + result.stderr.toString("utf8"),
        truncated: result.truncated,
        timedOut: result.exitCode === 124 || result.exitCode === 137,
      };
    } finally {
      this.busy.set(key, Math.max(0, (this.busy.get(key) ?? 1) - 1));
      this.touch(key);
      void this.refreshUsage(key).catch(() => {});
    }
  }

  /** Whether a trivial command runs: "ok", "refused" (the same key quota
   * refusal) or "unknown" (any other failure, or too slow: not a reason to
   * restart anything). */
  private async probe(key: string): Promise<"ok" | "refused" | "unknown"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), HEALTH_PROBE_TIMEOUT_MS); });
    try {
      const result = await Promise.race([
        this.docker.exec(sandboxNames(key).container, { Cmd: ["true"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/" }, 1024),
        late,
      ]);
      return result?.exitCode === 0 ? "ok" : "unknown";
    } catch (error) {
      return isKeyringRefusal(error) ? "refused" : "unknown";
    } finally {
      clearTimeout(timer);
    }
  }

  /** #4463: after a command the runtime refused because the environment's
   * key quota is full ("unable to join session keyring: disk quota
   * exceeded"), check that even `true` is refused the same way. Then, when
   * nothing else runs in it (no other command, terminal, MCP server or
   * desktop view), restart it on its disk (Kubernetes: a new Pod on the
   * same claim; every process in it ends, /workspace stays) and check
   * again. True when it was repaired (the caller runs its command again);
   * false when `true` runs or fails some other way (the original error
   * stands). Throws ENVIRONMENT_BROKEN_CODE, in plain words, when it is
   * occupied, was repaired less than the cooldown ago, or the restart did
   * not help. */
  private repairIfBroken(key: string, error: SandboxError): Promise<boolean> {
    const running = this.repairing.get(key);
    if (running) return running;
    const work = this.repair(key, error).finally(() => { this.repairing.delete(key); });
    this.repairing.set(key, work);
    return work;
  }

  /** Something that a restart would end is open in the environment. */
  private occupied(key: string): boolean {
    return (this.inFlight.get(key) ?? 0) > 0 || (this.ttyStreams.get(key) ?? 0) > 0
      || (this.stdioStreams.get(key) ?? 0) > 0 || (this.desktopStreams.get(key) ?? 0) > 0;
  }

  private async repair(key: string, error: SandboxError): Promise<boolean> {
    const short = key.slice(0, 8);
    if ((await this.probe(key)) !== "refused") return false;
    const last = this.repairedAt.get(key);
    if (last !== undefined && this.now() - last < ENVIRONMENT_REPAIR_COOLDOWN_MS) {
      throw new SandboxError(503, ENVIRONMENT_BROKEN_CODE, brokenMessage(ENVIRONMENT_RECENTLY_REPAIRED_MESSAGE, error));
    }
    let restarted = false;
    try {
      restarted = await this.withLock(key, async () => {
        if (this.occupied(key)) return false;
        this.repairedAt.set(key, this.now());
        console.warn(`sandboxd: environment ${short} cannot start any command (${error.message.slice(0, 200)}); restarting it on its disk`);
        await this.removeLocked(key, { keepWorkspace: true });
        return true;
      });
      if (restarted) await this.ensure(key);
    } catch (repair) {
      const cause = repair instanceof Error ? repair : new Error(String(repair));
      console.error(`sandboxd: environment ${short} restart failed: ${cause.message}`);
      throw new SandboxError(503, ENVIRONMENT_BROKEN_CODE, brokenMessage(ENVIRONMENT_BROKEN_MESSAGE, cause));
    }
    if (!restarted) {
      console.warn(`sandboxd: environment ${short} cannot start any command, not restarted: something still runs in it`);
      throw new SandboxError(503, ENVIRONMENT_BROKEN_CODE, brokenMessage(ENVIRONMENT_BUSY_MESSAGE, error));
    }
    if ((await this.probe(key)) !== "ok") {
      console.error(`sandboxd: environment ${short} still cannot start a command after its restart`);
      throw new SandboxError(503, ENVIRONMENT_BROKEN_CODE, brokenMessage(ENVIRONMENT_BROKEN_MESSAGE, error));
    }
    console.warn(`sandboxd: environment ${short} restarted on its disk and runs commands again`);
    return true;
  }

  /** Freeze every process of the sandbox (docker pause): it keeps its
   * memory but uses no CPU, and bots are refused until it is resumed. */
  pause(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (!container?.running) throw new SandboxError(409, "not_running", "the server environment is not running");
      if (!container.paused) await this.docker.pauseContainer(names.container);
      return this.status(key);
    });
  }

  resume(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.paused) await this.docker.unpauseContainer(names.container);
      this.touch(key);
      return this.status(key);
    });
  }

  /** CPU, memory, disk and OS of one sandbox. Starts nothing; a stopped or
   * paused sandbox answers without CPU and memory figures. */
  async stats(key: string): Promise<SandboxStats> {
    const status = await this.status(key);
    const names = sandboxNames(key);
    const { limits } = this.config;
    let cpuPercent: number | null = null;
    let memoryBytes: number | null = null;
    if (status.state === "running") {
      const sample = await this.docker.containerStats(names.container);
      cpuPercent = Math.round((sample.cpus / (limits.nanoCpus / 1e9)) * 1000) / 10;
      memoryBytes = sample.memoryBytes;
      if (!this.osInfo.has(key)) {
        const result = await this.docker.exec(names.container, {
          Cmd: ["sh", "-c", ". /etc/os-release 2>/dev/null; echo \"${PRETTY_NAME:-Linux}\"; uname -m"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
        }, 4096).catch(() => null);
        const [os, arch] = (result?.stdout.toString("utf8") ?? "").trim().split("\n");
        if (os && arch) this.osInfo.set(key, { os: os.slice(0, 80), arch: arch.slice(0, 20) });
      }
      await this.refreshUsage(key).catch(() => null);
    }
    const usage = this.usage.get(key);
    return {
      key,
      state: status.state,
      cpuPercent,
      memoryBytes,
      memoryLimitBytes: limits.memoryBytes,
      workspaceBytes: usage?.bytes ?? null,
      workspaceQuotaBytes: limits.workspaceQuotaBytes,
      ...(usage?.freeBytes !== undefined && usage.totalBytes !== undefined ? { workspaceFreeBytes: usage.freeBytes, workspaceTotalBytes: usage.totalBytes } : {}),
      os: this.osInfo.get(key)?.os ?? null,
      arch: this.osInfo.get(key)?.arch ?? null,
      image: this.config.image.split("/").pop() ?? this.config.image,
    };
  }

  /** The live view: a byte stream to the desktop's VNC port, which listens
   * on 127.0.0.1 inside the sandbox only. Never starts anything: the
   * sandbox and its desktop must already run (the Sagax server starts them
   * through exec when the owner opens the view). A view in control counts
   * as use, so the sandbox does not idle out under the person's hands; a
   * view that only watches does not keep it alive. */
  async desktopStream(key: string, options: { control: boolean }): Promise<Duplex> {
    this.checkKey(key);
    const names = sandboxNames(key);
    const container = await this.docker.inspectContainer(names.container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    if (!container?.running) throw new SandboxError(409, "not_running", "the server environment is stopped");
    if (container.paused) throw new SandboxError(409, "paused", "the server environment is paused");
    const open = this.desktopStreams.get(key) ?? 0;
    if (open >= MAX_DESKTOP_STREAMS) throw new SandboxError(429, "busy", "too many live views of this desktop are open");
    this.desktopStreams.set(key, open + 1);
    let stream: Duplex;
    try {
      stream = await this.docker.execStream(names.container, {
        Cmd: ["sagax-desktop", "relay"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: SANDBOX_WORKSPACE,
      });
    } catch (error) {
      this.releaseDesktopStream(key);
      throw error;
    }
    let released = false;
    const timer = options.control ? setInterval(() => this.touch(key), CONTROL_TOUCH_MS) : null;
    timer?.unref?.();
    if (options.control) this.touch(key);
    stream.once("close", () => {
      if (timer) clearInterval(timer);
      if (!released) { released = true; this.releaseDesktopStream(key); }
    });
    return stream;
  }

  /** A person's own MCP server (a command) for one turn's engine: its stdin
   * and stdout as a byte stream (server/sandbox/sandbox-stdio-mcp.ts). Starts the
   * sandbox when needed, runs as the sandbox user in /workspace, and counts
   * as use while open. The command and its environment are the person's
   * own, in their own environment: nothing here runs on the host. */
  async stdioStream(key: string, spec: SandboxStdioSpec): Promise<Duplex> {
    this.checkKey(key);
    if (!Array.isArray(spec.argv) || spec.argv.length === 0 || spec.argv.length > 65 || spec.argv.some((arg) => typeof arg !== "string" || arg.includes("\u0000") || arg.length > 4096)) {
      throw new SandboxError(400, "bad_stdio", "argv must be 1 to 65 strings");
    }
    const env = Object.entries(spec.env ?? {});
    let envBytes = 0;
    for (const [name, value] of env) {
      if (!STDIO_ENV_KEY_RE.test(name) || STDIO_ENV_RESERVED.has(name) || typeof value !== "string" || value.includes("\u0000")) throw new SandboxError(400, "bad_stdio", `environment variable ${name.slice(0, 40)} is not allowed`);
      envBytes += name.length + value.length;
    }
    if (envBytes > MAX_EXEC_ENV_BYTES) throw new SandboxError(413, "too_large", "the request is too large");
    const open = this.stdioStreams.get(key) ?? 0;
    if (open >= MAX_STDIO_STREAMS) throw new SandboxError(429, "busy", "too many MCP servers are running in this environment");
    await this.ensure(key);
    this.stdioStreams.set(key, open + 1);
    let stream: Duplex;
    try {
      stream = await this.docker.execStream(sandboxNames(key).container, {
        Cmd: spec.argv, User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: env.map(([name, value]) => `${name}=${value}`), WorkingDir: SANDBOX_WORKSPACE,
      });
    } catch (error) {
      this.releaseStdioStream(key);
      throw error;
    }
    this.touch(key);
    const timer = setInterval(() => this.touch(key), CONTROL_TOUCH_MS);
    timer.unref?.();
    let released = false;
    stream.once("close", () => {
      clearInterval(timer);
      if (!released) { released = true; this.releaseStdioStream(key); }
    });
    return stream;
  }

  /** The in-chat terminal (server/terminal-resources/adapters/sandbox.ts):
   * the sandbox user's login shell in a terminal, in /workspace, on the
   * same sandbox and under the same user, limits and network policy as
   * every command a bot runs there. Starts the sandbox when needed and
   * counts as use while open. Nothing here runs on the host. */
  async ttyStream(key: string, size: TtySize, cwd?: string): Promise<TtyExec> {
    this.checkKey(key);
    const cols = Math.floor(Number(size?.cols));
    const rows = Math.floor(Number(size?.rows));
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 500) {
      throw new SandboxError(400, "bad_tty", "the terminal size is invalid");
    }
    if (!this.docker.execTty) throw new SandboxError(501, "unsupported", "this provisioner cannot open a terminal");
    const open = this.ttyStreams.get(key) ?? 0;
    if (open >= MAX_TTY_STREAMS) throw new SandboxError(429, "busy", "too many terminals are open in this environment");
    await this.ensure(key);
    this.ttyStreams.set(key, open + 1);
    let tty: TtyExec;
    try {
      tty = await this.docker.execTty(sandboxNames(key).container, {
        Cmd: ttyArgv(cwd), User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: ["TERM=xterm-256color"], WorkingDir: SANDBOX_WORKSPACE,
      }, { cols, rows });
    } catch (error) {
      this.releaseTtyStream(key);
      throw error;
    }
    this.touch(key);
    const timer = setInterval(() => this.touch(key), CONTROL_TOUCH_MS);
    timer.unref?.();
    let released = false;
    tty.stream.once("close", () => {
      clearInterval(timer);
      if (!released) { released = true; this.releaseTtyStream(key); }
    });
    return tty;
  }

  private releaseTtyStream(key: string): void {
    const left = (this.ttyStreams.get(key) ?? 1) - 1;
    if (left > 0) this.ttyStreams.set(key, left);
    else this.ttyStreams.delete(key);
  }

  private releaseStdioStream(key: string): void {
    const left = (this.stdioStreams.get(key) ?? 1) - 1;
    if (left > 0) this.stdioStreams.set(key, left);
    else this.stdioStreams.delete(key);
  }

  private releaseDesktopStream(key: string): void {
    const left = (this.desktopStreams.get(key) ?? 1) - 1;
    if (left > 0) this.desktopStreams.set(key, left);
    else this.desktopStreams.delete(key);
  }

  /** Measure /workspace at most once a minute (soft quota). */
  async refreshUsage(key: string, force = false): Promise<number | null> {
    const cached = this.usage.get(key);
    if (!force && cached && this.now() - cached.at < USAGE_TTL_MS) return cached.bytes;
    const container = await this.docker.inspectContainer(sandboxNames(key).container);
    if (!container?.running || container.paused || !this.owned(container.labels, key)) return cached?.bytes ?? null;
    const result = await this.docker.exec(sandboxNames(key).container, {
      Cmd: ["du", "-sxb", SANDBOX_WORKSPACE], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
    }, 4096);
    const bytes = Number(/^(\d+)/.exec(result.stdout.toString("utf8"))?.[1]);
    if (!Number.isFinite(bytes)) return cached?.bytes ?? null;
    // The volume itself: a quota above its real size (an older, smaller
    // claim) must not hide a full disk (2026-11-02, "Free space: 11 MiB").
    const disk = await this.docker.exec(sandboxNames(key).container, {
      Cmd: ["df", "-P", "-B1", SANDBOX_WORKSPACE], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
    }, 4096).catch(() => null);
    const row = disk?.exitCode === 0 ? /\n\S+\s+(\d+)\s+\d+\s+(\d+)/.exec(disk.stdout.toString("utf8")) : null;
    const totalBytes = row ? Number(row[1]) : NaN;
    const freeBytes = row ? Number(row[2]) : NaN;
    this.usage.set(key, { bytes, at: this.now(), ...(Number.isFinite(totalBytes) && Number.isFinite(freeBytes) && totalBytes > 0 ? { freeBytes, totalBytes } : {}) });
    // #4463: the kernel keys of the environment's uid, to see the quota coming
    const keyUsers = await this.docker.exec(sandboxNames(key).container, {
      Cmd: ["cat", "/proc/key-users"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
    }, 4096).catch(() => null);
    const keys = keyUsers?.exitCode === 0 ? parseKeyUsers(keyUsers.stdout.toString("utf8")) : null;
    if (keys) {
      this.keys.set(key, keys);
      if (keys.used >= keys.max * KEYS_WARN_RATIO) {
        if (!this.keysWarned.has(key)) console.warn(`sandboxd: environment ${key.slice(0, 8)} holds ${keys.used} of ${keys.max} kernel keys; at ${keys.max} no command can start`);
        this.keysWarned.add(key);
      } else {
        this.keysWarned.delete(key);
      }
    }
    return bytes;
  }

  /** Stop every running sandbox idle for longer than the idle period. A
   * sandbox first seen running (provisioner restart) counts from now. */
  async sweepIdle(): Promise<string[]> {
    const stopped: string[] = [];
    const now = this.now();
    for (const row of await this.runningCount()) {
      if (!this.lastUsed.has(row.key)) { this.lastUsed.set(row.key, now); continue; }
      if ((this.busy.get(row.key) ?? 0) > 0) continue;
      if (now - this.lastUsed.get(row.key)! < this.config.idleStopMs) continue;
      await this.withLock(row.key, () => this.docker.stopContainer(sandboxNames(row.key).container, 5));
      stopped.push(row.key);
    }
    return stopped;
  }

  /** Hibernate every stopped sandbox unused for longer than the hibernation
   * period (#2611): remove its container (Kubernetes: Pod) and network, keep
   * /workspace. ensure() wakes it: network and container are created again
   * on the same volume. A sandbox first seen stopped (provisioner restart)
   * counts from now. Running, paused, starting or busy ones are left alone. */
  async hibernateIdle(): Promise<string[]> {
    if (this.config.hibernateAfterMs <= 0) return [];
    const done: string[] = [];
    const now = this.now();
    const rows = await this.docker.listContainers(this.ownLabels());
    for (const row of rows) {
      const key = row.labels[SANDBOX_USER_LABEL] ?? "";
      if (!SANDBOX_KEY_RE.test(key) || row.running || row.paused || row.starting) continue;
      if (this.hibernated.has(key)) continue;
      if (!this.lastUsed.has(key)) { this.lastUsed.set(key, now); continue; }
      if ((this.busy.get(key) ?? 0) > 0) continue;
      if (now - this.lastUsed.get(key)! < this.config.hibernateAfterMs) continue;
      const hibernated = await this.withLock(key, async () => {
        const names = sandboxNames(key);
        const container = await this.docker.inspectContainer(names.container);
        if (!container || !this.owned(container.labels, key) || container.running || container.paused || container.starting) return false;
        if ((this.busy.get(key) ?? 0) > 0) return false;
        await this.docker.removeContainer(names.container);
        const network = await this.docker.inspectNetwork(names.network);
        if (network && this.owned(network.labels, key)) await this.docker.removeNetwork(names.network);
        this.osInfo.delete(key);
        this.keys.delete(key);
        this.hibernated.add(key);
        return true;
      });
      if (hibernated) done.push(key);
    }
    return done;
  }
}
