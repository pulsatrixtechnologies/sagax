// The Sagax server's view of the per-person server environments. Maps a
// principal (the bot OWNER, for every bot, thread and routine of theirs) to
// one sandbox key, and owns what the provisioner cannot know: who is out.
// A person signed out by Perspicax (back-channel logout, disabled, removed)
// has their environment stopped at once and deleted after a grace period; a
// person back in before it ends keeps it. Pending deletions survive restarts.
import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Duplex } from "node:stream";

import { writeFileAtomic } from "./atomic.ts";
import type { SandboxExecInput, SandboxExecOutput, SandboxStats, SandboxStatus, SandboxStdioSpec } from "./sandboxd-core.ts";
import { sandboxRouteFromEnv, type SandboxBackend } from "./sandbox-route.ts";
import type { SandboxdClient, SandboxdInfo } from "./user-sandbox-client.ts";
import { SandboxdRequestError, validSandboxdUrl } from "./user-sandbox-client.ts";
import { sandboxKeyForPrincipal } from "./user-sandbox-spec.ts";
import { UserSandboxUnavailable } from "./user-sandbox-errors.ts";
import { provisionerNotReached, provisionerUnreachable, sandboxStarting, SANDBOX_STARTING_RETRY_DELAY_MS, SANDBOX_STARTING_RETRY_MS, sandboxWakeSettingsFromEnv, type SandboxClusterWaker, type SandboxWakeSettings, type WakeMode } from "./sandbox-k8s-wake.ts";

export const DEFAULT_DELETE_GRACE_MS = 72 * 3600_000;

export interface UserSandboxView {
  state: SandboxStatus["state"] | "unavailable";
  lastUsedAt: number | null;
  workspaceBytes: number | null;
  overQuota: boolean;
  limits: SandboxStatus["limits"] | null;
  idleMinutes: number | null;
  pendingDeletionAt: number | null;
  error?: string;
  /** The Kubernetes cluster of the environments is being woken (it was
   * stopped while idle): since when, and for how long so far (the
   * screen's clock may differ from the server's). Only while a status read
   * fails during the wake window; never the webhook or another detail. */
  waking?: { since: number; elapsedMs: number };
}

export { UserSandboxUnavailable };

export interface UserSandboxManagerOptions {
  /** Docker provisioner. Also the only client when Kubernetes is not configured. */
  client: SandboxdClient;
  /** Kubernetes provisioner. Used when `backendFor` returns kubernetes. */
  kubernetes?: SandboxdClient;
  /** Per call, so a test can change the route. Production reads the environment each call. */
  backendFor?: (principalId: string, botId?: string) => SandboxBackend;
  /** Starts the Kubernetes provisioner's cluster when it is stopped
   * (server/sandbox-k8s-wake.ts). Without it an unreachable provisioner
   * fails the call, as before 0.5.3. Never used for Docker. */
  kubernetesWaker?: SandboxClusterWaker;
  /** A call of this person waits for the cluster to start, or gave up
   * waiting: the server says so in their running conversation. */
  onClusterWait?: (event: ClusterWaitEvent) => void;
  instance: string;
  /** JSON file holding pending deletions (DATA_DIR/user-sandbox-deletions.json). */
  stateFile: string;
  graceMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ClusterWaitEvent {
  principalId: string;
  botId?: string;
  phase: "waiting" | "timeout";
}

export class UserSandboxManager {
  private readonly pending = new Map<string, number>();
  /** person + bot -> last call that could wake the cluster (a bot's real
   * use), for prewake. In memory: after a restart the first run is cold. */
  private readonly recentUse = new Map<string, number>();
  /** One desktop open at a time per person (two at once raced on the VNC
   * password file and one failed), and the passwords of the live views
   * still open: a second view must not change them under the first. */
  private readonly desktopOpens = new Map<string, Promise<unknown>>();
  private readonly desktopViews = new Map<string, { passwords: { full: string; view: string }; open: number; openedAt: number }>();
  private info: SandboxdInfo | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly graceMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly options: UserSandboxManagerOptions;

  constructor(options: UserSandboxManagerOptions) {
    this.options = options;
    this.graceMs = options.graceMs ?? DEFAULT_DELETE_GRACE_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }));
    this.load();
  }

  /** The only way to name a sandbox: by person. There is no per-bot key. */
  keyFor(principalId: string): string {
    return sandboxKeyForPrincipal(this.options.instance, principalId);
  }

  /** Docker, unless this person or this bot is on the Kubernetes canary.
   * `wake` (a bot's command, a start the person asked for) may start a
   * stopped Kubernetes cluster and waits for it; `peek` (status, usage,
   * quota) never starts it. Docker is never gated. */
  private clientFor(principalId: string, botId?: string, mode: WakeMode = "peek"): SandboxdClient {
    const backend = this.options.backendFor?.(principalId, botId) ?? "docker";
    if (backend === "docker") return this.options.client;
    if (!this.options.kubernetes) {
      throw new UserSandboxUnavailable("This environment is set to Kubernetes, and that provisioner is not configured.", "kubernetes_unconfigured");
    }
    if (!this.options.kubernetesWaker) return this.options.kubernetes;
    return this.wakingClient(this.options.kubernetes, this.options.kubernetesWaker, { principalId, ...(botId ? { botId } : {}) }, mode);
  }

  /** The Kubernetes provisioner behind the cluster wake: wait while it
   * starts, and when a call finds it gone, wake it (a call that certainly
   * did not reach it is sent once more). */
  private wakingClient(client: SandboxdClient, waker: SandboxClusterWaker, who: { principalId: string; botId?: string }, mode: WakeMode): SandboxdClient {
    const notify = (phase: ClusterWaitEvent["phase"]) => {
      try { this.options.onClusterWait?.({ ...who, phase }); } catch { /* a notice never fails the call */ }
    };
    const ready = async () => {
      try {
        await waker.ready(mode, () => notify("waiting"));
      } catch (error) {
        if ((error as { code?: unknown }).code === "cluster_start_timeout") notify("timeout");
        throw error;
      }
    };
    // 2026-10-19 (GOX): right after a cold start the provisioner answered,
    // then the first exec waited for a pod on a node pool scaling 0 -> 1, was
    // cut at 90 s and taken for a provisioner gone: the routine gave up.
    // Now a `starting` refusal is sent again, bounded, and a call that only
    // reads or converges (status, ensure, resume...) is sent again once
    // after a cut connection; a command (exec) only when it surely did not
    // reach the provisioner.
    const run = async <T>(call: () => Promise<T>, idempotent = false): Promise<T> => {
      const calledAt = this.now();
      await ready();
      if (mode === "wake") this.recentUse.set(useKey(who.principalId, who.botId), this.now());
      const startedAt = this.now();
      let resent = false;
      for (;;) {
        try {
          return await call();
        } catch (error) {
          // Bounded twice: the starting window, and the whole call (wake
          // included) stays under the engine's 10 minute cut of a tool call.
          if (mode === "wake" && sandboxStarting(error) && this.now() - startedAt < SANDBOX_STARTING_RETRY_MS
            && this.now() - calledAt < SANDBOX_CALL_BUDGET_MS) {
            notify("waiting");
            await this.sleep(SANDBOX_STARTING_RETRY_DELAY_MS);
            continue;
          }
          if (!provisionerUnreachable(error)) throw error;
          waker.markUnreachable();
          if (mode !== "wake" || resent || !(idempotent || provisionerNotReached(error))) throw error;
          resent = true;
          await ready();
        }
      }
    };
    return {
      info: () => run(() => client.info(), true),
      status: (key) => run(() => client.status(key), true),
      ensure: (key) => run(() => client.ensure(key), true),
      stop: (key) => run(() => client.stop(key)),
      pause: (key) => run(() => client.pause(key)),
      resume: (key) => run(() => client.resume(key)),
      markUsed: (key) => run(() => client.markUsed(key), true),
      stats: (key) => run(() => client.stats(key), true),
      remove: (key, options) => run(() => client.remove(key, options)),
      exec: (key, input) => run(() => client.exec(key, input)),
      desktopStream: (key, options) => run(() => client.desktopStream(key, options)),
      stdioStream: (key, spec) => run(() => client.stdioStream(key, spec)),
      ...(client.ttyStream ? { ttyStream: (key: string, size: { cols: number; rows: number }) => run(() => client.ttyStream!(key, size)) } : {}),
    };
  }

  /** Stop and delete reach both provisioners so a revert does not leave the other one running. */
  private clients(): SandboxdClient[] {
    return this.options.kubernetes ? [this.options.client, this.options.kubernetes] : [this.options.client];
  }

  private load(): void {
    if (!existsSync(this.options.stateFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as { version?: number; pending?: Record<string, number> };
      for (const [principalId, dueAt] of Object.entries(parsed.pending ?? {})) {
        if (typeof dueAt === "number" && Number.isFinite(dueAt)) this.pending.set(principalId, dueAt);
      }
    } catch (error) {
      console.error(`user-sandbox: ${this.options.stateFile} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist(): void {
    writeFileAtomic(this.options.stateFile, `${JSON.stringify({ version: 1, pending: Object.fromEntries(this.pending) }, null, 2)}\n`);
  }

  pendingDeletionAt(principalId: string): number | null {
    return this.pending.get(principalId) ?? null;
  }

  private async provisionerInfo(client: SandboxdClient = this.options.client): Promise<SandboxdInfo | null> {
    try {
      const info = await client.info();
      if (client === this.options.client) this.info = info;
      return info;
    } catch {
      return client === this.options.client ? this.info : null;
    }
  }

  /** This person's environment waits for its cluster to wake, or null. */
  private clusterWaking(principalId: string, botId?: string): { since: number; elapsedMs: number } | null {
    const waker = this.options.kubernetesWaker;
    if (!waker || !this.options.kubernetes) return null;
    try {
      if ((this.options.backendFor?.(principalId, botId) ?? "docker") !== "kubernetes") return null;
    } catch {
      return null;
    }
    return waker.wakeState();
  }

  async status(principalId: string, botId?: string): Promise<UserSandboxView> {
    const pendingDeletionAt = this.pendingDeletionAt(principalId);
    try {
      const client = this.clientFor(principalId, botId);
      const [status, info] = await Promise.all([client.status(this.keyFor(principalId)), this.provisionerInfo(client)]);
      return {
        state: status.state,
        lastUsedAt: status.lastUsedAt,
        workspaceBytes: status.workspaceBytes,
        overQuota: status.overQuota,
        limits: status.limits,
        idleMinutes: info?.idleMinutes ?? null,
        pendingDeletionAt,
        ...(info?.egress === "missing" ? { error: "egress_policy" } : {}),
      };
    } catch (error) {
      // The cluster is waking (or just woke and is settling): the screen says
      // "starting" with a quiet hint, never an error, for the wake window.
      const waking = this.clusterWaking(principalId, botId);
      if (waking) {
        return {
          state: "unavailable", lastUsedAt: null, workspaceBytes: null, overQuota: false, limits: null, idleMinutes: null, pendingDeletionAt,
          error: "cluster_starting",
          waking,
        };
      }
      // The Kubernetes cluster is stopped (server/sandbox-k8s-wake.ts): the
      // environment is off, and Start or the next bot turn starts it.
      if (error instanceof UserSandboxUnavailable && error.code === "cluster_stopped") {
        return { state: "stopped", lastUsedAt: null, workspaceBytes: null, overQuota: false, limits: null, idleMinutes: null, pendingDeletionAt, error: error.code };
      }
      return {
        state: "unavailable", lastUsedAt: null, workspaceBytes: null, overQuota: false, limits: null,
        idleMinutes: null, pendingDeletionAt,
        error: error instanceof UserSandboxUnavailable || error instanceof SandboxdRequestError ? error.code : "unreachable",
      };
    }
  }

  /** The provisioner's own facts (its limit, idle stop and egress), null
   * when it does not answer. */
  async provisioner(): Promise<SandboxdInfo | null> {
    try {
      return await this.options.client.info();
    } catch {
      return null;
    }
  }

  /** The console's Computers (2026-10-11): each of these people's
   * environments that exists, with its status, the commands running there
   * and its usage sample. Eight people at a time, each call bounded by
   * `timeoutMs`; an environment that does not answer in time reads
   * `unavailable`. Starts nothing. */
  async inventory(principalIds: readonly string[], timeoutMs = 3_000): Promise<Map<string, { view: UserSandboxView; busy: number; stats: SandboxStats | null }>> {
    const info = await this.provisionerInfo();
    const queue = [...new Set(principalIds)];
    const out = new Map<string, { view: UserSandboxView; busy: number; stats: SandboxStats | null }>();
    const bounded = async <T>(call: () => Promise<T>): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([call(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const key = this.keyFor(id);
        const pendingDeletionAt = this.pendingDeletionAt(id);
        const status = await bounded(() => this.options.client.status(key));
        if (!status) {
          out.set(id, { view: { state: "unavailable", lastUsedAt: null, workspaceBytes: null, overQuota: false, limits: null, idleMinutes: info?.idleMinutes ?? null, pendingDeletionAt, error: "unreachable" }, busy: 0, stats: null });
          continue;
        }
        if (status.state === "missing") continue;
        const stats = await bounded(() => this.options.client.stats(key));
        out.set(id, {
          view: { state: status.state, lastUsedAt: status.lastUsedAt, workspaceBytes: status.workspaceBytes, overQuota: status.overQuota, limits: status.limits, idleMinutes: info?.idleMinutes ?? null, pendingDeletionAt },
          busy: status.busy,
          stats,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
    return out;
  }

  /** The console's Overview (2026-10-08): how many of these people's
   * environments are running, and the provisioner's limit. Eight status
   * calls at a time, each bounded by `timeoutMs`; one that fails or times
   * out counts as not running. */
  async overview(principalIds: readonly string[], timeoutMs = 3_000): Promise<{ running: number; limit: number | null }> {
    const info = await this.provisionerInfo();
    const queue = [...new Set(principalIds)];
    let running = 0;
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const status = await Promise.race([
            this.clientFor(id).status(this.keyFor(id)),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
          ]);
          if (status?.state === "running") running += 1;
        } catch {
          /* unreachable: not running as far as the console can tell */
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
    return { running, limit: info?.maxRunning ?? null };
  }

  private refuseIfOut(principalId: string): void {
    if (this.pending.has(principalId)) {
      throw new UserSandboxUnavailable("This person was signed out by Perspicax; their server environment is closed.", "person_out");
    }
  }

  async exec(principalId: string, input: SandboxExecInput, botId?: string): Promise<SandboxExecOutput> {
    this.refuseIfOut(principalId);
    try {
      return await this.clientFor(principalId, botId, "wake").exec(this.keyFor(principalId), input);
    } catch (error) {
      throw asUnavailable(error);
    }
  }

  /** Before a scheduled routine of this person (server/routines.ts
   * prewake): on Kubernetes with the cluster wake, start the cluster and the
   * person's environment now, so the run finds them up instead of spending
   * its first ten minutes waking them. Never for Docker, never for a person
   * signed out; best effort, never throws. True when it was asked. */
  async prewake(principalId: string, botId?: string): Promise<boolean> {
    if (!this.options.kubernetes || !this.options.kubernetesWaker || this.pending.has(principalId)) return false;
    // Only for a bot that used this environment lately: a routine that never
    // touches it must not keep the cluster up or create an environment.
    const usedAt = this.recentUse.get(useKey(principalId, botId));
    if (usedAt === undefined || this.now() - usedAt > PREWAKE_RECENT_USE_MS) return false;
    try {
      if ((this.options.backendFor?.(principalId, botId) ?? "docker") !== "kubernetes") return false;
      await this.clientFor(principalId, botId, "wake").ensure(this.keyFor(principalId));
    } catch (error) {
      console.warn(`user-sandbox: prewake failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // a prewake is not a use: it must not keep itself going
      this.recentUse.set(useKey(principalId, botId), usedAt);
    }
    return true;
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw asUnavailable(error);
    }
  }

  /** The power controls of the person's own Computer tab. Start creates or
   * starts it (and resumes a paused one); shutdown stops it and keeps
   * /workspace; pause freezes it (bots are refused until resumed). */
  async power(principalId: string, action: "start" | "shutdown" | "pause" | "resume"): Promise<UserSandboxView> {
    if (action !== "shutdown") this.refuseIfOut(principalId);
    const key = this.keyFor(principalId);
    const client = this.clientFor(principalId, undefined, action === "start" || action === "resume" ? "wake" : "peek");
    await this.call(async () => {
      if (action === "shutdown") return client.stop(key);
      if (action === "pause") return client.pause(key);
      if (action === "resume") return client.resume(key);
      const current = await client.status(key);
      return current.state === "paused" ? client.resume(key) : client.ensure(key);
    });
    return this.status(principalId);
  }

  /** The person is on a voice call (its heartbeat): count it as use of
   * their environment, so the provisioner's idle stop never takes it away
   * mid-call. Best effort; starts nothing, and never for a person signed out. */
  async markUsed(principalId: string, botId?: string): Promise<boolean> {
    if (this.pending.has(principalId)) return false;
    try {
      await this.clientFor(principalId, botId).markUsed(this.keyFor(principalId));
      return true;
    } catch {
      return false;
    }
  }

  /** Commands in flight in the person's environment right now. */
  async busy(principalId: string, botId?: string): Promise<number> {
    try { return (await this.clientFor(principalId, botId).status(this.keyFor(principalId))).busy; } catch { return 0; }
  }

  /** The usage panel: CPU, memory, disk and OS of the person's own
   * environment. Starts nothing. */
  stats(principalId: string): Promise<SandboxStats> {
    return this.call(() => this.clientFor(principalId).stats(this.keyFor(principalId)));
  }

  /** Open the person's desktop for their live view: start the sandbox and its
   * desktop when needed and set two fresh VNC passwords, the full one
   * (controls the screen) and the view-only one. Only the owner's own
   * request reaches this (server/routes/desktop-viewer.ts). */
  async openDesktop(principalId: string): Promise<{ full: string; view: string }> {
    const previous = this.desktopOpens.get(principalId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.startDesktop(principalId));
    this.desktopOpens.set(principalId, next);
    try { return await next; }
    finally { if (this.desktopOpens.get(principalId) === next) this.desktopOpens.delete(principalId); }
  }

  private async startDesktop(principalId: string): Promise<{ full: string; view: string }> {
    // Fresh passwords for every open, unless a live view is still open or
    // was just opened (still connecting): then the same ones, or that view
    // would fail its next authentication.
    const views = this.desktopViews.get(principalId);
    const shared = views !== undefined && (views.open > 0 || this.now() - views.openedAt < DESKTOP_CONNECT_MS);
    const passwords = shared ? views.passwords : { full: vncPassword(), view: vncPassword() };
    const start = () => this.exec(principalId, {
      argv: ["sagax-desktop", "start"],
      env: { SAGAX_VNC_FULL: passwords.full, SAGAX_VNC_VIEW: passwords.view },
      timeoutSec: 30,
    });
    let result = await start();
    // 127: no sagax-desktop, the environment runs an image from before the
    // desktop. The person asked to see it: rebuild it from the current image
    // (keeps /workspace) when no command runs there, then start again.
    if (result.exitCode === 127) {
      if (await this.busy(principalId) > 0) {
        throw new UserSandboxUnavailable("The server environment predates the desktop. Update it from the Computer tab.", "outdated");
      }
      console.error("user-sandbox: an environment from an older image had no desktop; updating it from the current image");
      await this.call(async () => {
        const client = this.clientFor(principalId, undefined, "wake");
        await client.remove(this.keyFor(principalId), { keepWorkspace: true });
        await client.ensure(this.keyFor(principalId));
      });
      result = await start();
    }
    if (result.exitCode !== 0) {
      console.error(`user-sandbox: the desktop did not start (exit ${result.exitCode}): ${result.stderr.slice(-300).replace(/\s+/g, " ").trim()}`);
      throw new UserSandboxUnavailable("The desktop of the server environment did not start.", result.exitCode === 127 ? "outdated" : "desktop_failed");
    }
    if (shared) views.openedAt = this.now();
    else this.desktopViews.set(principalId, { passwords, open: 0, openedAt: this.now() });
    return passwords;
  }

  /** The live view's byte stream to the desktop's VNC port. Never starts a
   * stopped environment. */
  async desktopStream(principalId: string, options: { control: boolean }): Promise<Duplex> {
    this.refuseIfOut(principalId);
    try {
      const stream = await this.clientFor(principalId).desktopStream(this.keyFor(principalId), options);
      const views = this.desktopViews.get(principalId);
      if (views) {
        views.open += 1;
        stream.once("close", () => { views.open = Math.max(0, views.open - 1); });
      }
      return stream;
    } catch (error) {
      throw asUnavailable(error);
    }
  }

  /** A person's own MCP server command, running in their environment,
   * as a byte stream (server/sandbox-stdio-mcp.ts). Starts it when needed. */
  /** The person's own in-chat terminal in their environment (by person:
   * never anyone else's). Wakes a stopped cluster like a bot's command. */
  async ttyStream(principalId: string, size: { cols: number; rows: number }, botId?: string): Promise<{ stream: Duplex; resize(cols: number, rows: number): void }> {
    this.refuseIfOut(principalId);
    const client = this.clientFor(principalId, botId, "wake");
    if (!client.ttyStream) throw new UserSandboxUnavailable("This server's provisioner cannot open a terminal.", "tty_unsupported");
    return this.call(() => client.ttyStream!(this.keyFor(principalId), size));
  }

  async stdioStream(principalId: string, spec: SandboxStdioSpec, botId?: string): Promise<Duplex> {
    this.refuseIfOut(principalId);
    return this.call(() => this.clientFor(principalId, botId, "wake").stdioStream(this.keyFor(principalId), spec));
  }

  async workspaceOverQuota(principalId: string, botId?: string): Promise<boolean> {
    try {
      return (await this.clientFor(principalId, botId).status(this.keyFor(principalId))).overQuota;
    } catch {
      return false;
    }
  }

  /** Throw away the environment (container, network and /workspace) and
   * create a fresh one. Only the person themselves asks for this. */
  async reset(principalId: string): Promise<UserSandboxView> {
    this.refuseIfOut(principalId);
    const key = this.keyFor(principalId);
    const client = this.clientFor(principalId, undefined, "wake");
    await client.remove(key);
    await client.ensure(key);
    return this.status(principalId);
  }

  /** Rebuild the environment from the server's current image and keep
   * /workspace: the container and its network are replaced, the workspace
   * volume stays. Only the person themselves asks for this. */
  async update(principalId: string): Promise<UserSandboxView> {
    this.refuseIfOut(principalId);
    const key = this.keyFor(principalId);
    const client = this.clientFor(principalId, undefined, "wake");
    await client.remove(key, { keepWorkspace: true });
    await client.ensure(key);
    return this.status(principalId);
  }

  /** Delete the environment and its /workspace now (account deletion). */
  async removeNow(principalId: string): Promise<void> {
    const key = this.keyFor(principalId);
    const errors: unknown[] = [];
    for (const client of this.clients()) {
      try { await client.remove(key); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
    if (this.pending.delete(principalId)) this.persist();
  }

  /** Perspicax signed the person out: stop now, delete after the grace. */
  async personOut(principalId: string): Promise<void> {
    if (!this.pending.has(principalId)) {
      this.pending.set(principalId, this.now() + this.graceMs);
      this.persist();
    }
    const key = this.keyFor(principalId);
    for (const client of this.clients()) {
      try {
        await client.stop(key);
      } catch (error) {
        console.error(`user-sandbox: could not stop an environment of a person signed out: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** The person is back before the grace ended: keep their environment. */
  personBack(principalId: string): void {
    if (this.pending.delete(principalId)) this.persist();
  }

  /** Delete the environments whose grace has ended. */
  async sweepDeletions(): Promise<string[]> {
    const removed: string[] = [];
    const now = this.now();
    for (const [principalId, dueAt] of new Map(this.pending)) {
      if (dueAt > now) continue;
      try {
        const key = this.keyFor(principalId);
        const errors: unknown[] = [];
        for (const client of this.clients()) {
          try { await client.remove(key); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw errors[0];
        this.pending.delete(principalId);
        removed.push(principalId);
      } catch (error) {
        console.error(`user-sandbox: deletion failed, retrying later: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (removed.length) this.persist();
    return removed;
  }

  start(intervalMs = 5 * 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.sweepDeletions(); }, intervalMs);
    this.timer.unref?.();
    void this.sweepDeletions();
  }

  stopTimers(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** A whole call that waits for the cluster and then for its pod stays under
 * the 10 minute cut an engine puts on one tool call. */
export const SANDBOX_CALL_BUDGET_MS = 9 * 60_000 + 30_000;
/** prewake only for a bot that used the environment this recently. */
export const PREWAKE_RECENT_USE_MS = 7 * 24 * 3600_000;

function useKey(principalId: string, botId?: string): string {
  return `${principalId}\n${botId ?? ""}`;
}

const VNC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** VNC authentication reads at most 8 characters. */
/** How long a just-opened view has to connect before the next open may
 * change the passwords. */
const DESKTOP_CONNECT_MS = 30_000;

function asUnavailable(error: unknown): never {
  if (error instanceof UserSandboxUnavailable) throw error;
  if (error instanceof SandboxdRequestError) throw new UserSandboxUnavailable(error.message, error.code);
  throw new UserSandboxUnavailable("The server environment could not be reached. Try again in a moment.", "unreachable");
}

function vncPassword(): string {
  let value = "";
  for (let index = 0; index < 8; index++) value += VNC_ALPHABET[randomInt(VNC_ALPHABET.length)];
  return value;
}

/** The manager this server runs, or null when organization mode or the
 * provisioner is not configured (solo servers never have one). */
export function userSandboxSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  keyFile: string;
  instance: string;
  graceMs: number;
  kubernetesUrl: string | null;
  tlsCaFile: string | null;
  /** The cluster wake (SAGAX_SANDBOX_K8S_WAKE_URL): only with a Kubernetes
   * provisioner. The URL is a secret; never log this object. */
  wake: SandboxWakeSettings | null;
} | null {
  const url = env.SAGAX_SANDBOXD_URL?.trim();
  if (!url) return null;
  const hours = env.SAGAX_SANDBOX_DELETE_GRACE_HOURS?.trim();
  const graceHours = hours ? Number(hours) : DEFAULT_DELETE_GRACE_MS / 3600_000;
  if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > 24 * 90) throw new Error("SAGAX_SANDBOX_DELETE_GRACE_HOURS must be between 0 and 2160");
  const kubernetesUrl = env.SAGAX_SANDBOXD_K8S_URL?.trim() || null;
  const tlsCaFile = env.SAGAX_SANDBOXD_TLS_CA?.trim() || null;
  const route = sandboxRouteFromEnv(env);
  const canary = route.forced === "kubernetes" || route.bots.length > 0 || route.people.length > 0;
  if (kubernetesUrl) {
    if (!tlsCaFile) throw new Error("SAGAX_SANDBOXD_K8S_URL requires SAGAX_SANDBOXD_TLS_CA");
    validSandboxdUrl(kubernetesUrl, { ca: Buffer.from("configured") });
    if (new URL(kubernetesUrl).protocol !== "https:") throw new Error("SAGAX_SANDBOXD_K8S_URL must be https");
  } else if (canary && route.forced !== "docker") {
    throw new Error("a Kubernetes canary requires SAGAX_SANDBOXD_K8S_URL");
  }
  return {
    url,
    keyFile: env.SAGAX_SANDBOXD_KEY_FILE?.trim() || "/run/sagax-sandboxd/key",
    instance: env.SAGAX_SANDBOX_INSTANCE?.trim() || "default",
    graceMs: graceHours * 3600_000,
    kubernetesUrl,
    tlsCaFile,
    wake: kubernetesUrl ? sandboxWakeSettingsFromEnv(env) : null,
  };
}
