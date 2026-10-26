// Waking the Kubernetes cluster of the sandboxes (0.5.3).
//
// An operator may stop the cluster that runs the Kubernetes provisioner when
// no sandbox Pod has run for a while (an Azure Automation runbook, for
// example). The cluster starts again through a webhook: one HTTPS POST to a
// secret URL (SAGAX_SANDBOX_K8S_WAKE_URL). When a call routed to Kubernetes
// finds the provisioner unreachable, the Sagax server posts that webhook
// itself and waits until the provisioner's GET /healthz answers, up to
// SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS. The turn waits; it never falls back to
// Docker (a workspace must never live in two places).
//
// One wake at a time for the whole process: every caller that finds the
// cluster down waits on the same promise, and the webhook is posted at most
// once per POST_WINDOW_MS. The URL is a secret: it is never logged, never put
// in an error, never returned to a client, and engines never inherit it
// (CONTROL_PLANE_ENV in server/config.ts).
import { UserSandboxUnavailable } from "./user-sandbox-errors.ts";

export const WAKE_URL_ENV = "SAGAX_SANDBOX_K8S_WAKE_URL";
export const WAKE_TIMEOUT_ENV = "SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS";
/** 2026-10-19: a stopped AKS cluster took 7 min 52 s from the webhook to
 * the provisioner's first answer; 8 min was one cut away from failing. */
export const DEFAULT_WAKE_TIMEOUT_MS = 9 * 60_000;
/** Under the 10 minute cut an engine puts on one tool call (pi) and the
 * 12 minute one of the environment's MCP proxy, so the person gets this
 * module's clear error rather than a cut connection. The pod-start retries
 * that follow share the same budget (SANDBOX_CALL_BUDGET_MS in
 * server/user-sandbox-manager.ts). */
export const MAX_WAKE_TIMEOUT_MS = 9 * 60_000;
export const MIN_WAKE_TIMEOUT_MS = 30_000;
/** At most one webhook POST in this window, whatever the callers do. */
export const POST_WINDOW_MS = 2 * 60_000;
/** A provisioner seen healthy this recently is not probed again. */
export const HEALTHY_TTL_MS = 60_000;
/** A failed probe this recent is not repeated (the quota check and the exec
 * of one tool call share it). */
export const DOWN_TTL_MS = 5_000;
export const PROBE_TIMEOUT_MS = 5_000;
const POST_TIMEOUT_MS = 30_000;
const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_MAX_MS = 15_000;

export interface SandboxWakeSettings {
  url: URL;
  timeoutMs: number;
}

/** The wake settings, or null when no webhook is configured (the behaviour
 * before 0.5.3: an unreachable provisioner fails the call). Errors name the
 * variable, never its value. */
export function sandboxWakeSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxWakeSettings | null {
  const raw = env[WAKE_URL_ENV]?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${WAKE_URL_ENV} must be an https URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${WAKE_URL_ENV} must be an https URL`);
  const rawTimeout = env[WAKE_TIMEOUT_ENV]?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_WAKE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WAKE_TIMEOUT_MS || timeoutMs > MAX_WAKE_TIMEOUT_MS) {
    throw new Error(`${WAKE_TIMEOUT_ENV} must be an integer between ${MIN_WAKE_TIMEOUT_MS} and ${MAX_WAKE_TIMEOUT_MS}`);
  }
  return { url, timeoutMs };
}

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);
/** Failures where the request never reached the provisioner: safe to send again. */
const NOT_DELIVERED_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function errorCode(error: unknown): string {
  const own = (error as { code?: unknown } | null)?.code;
  if (typeof own === "string") return own;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === "string" ? cause : "";
}

/** A gateway answer with no provisioner body (`code` stays "error"): a load
 * balancer or ingress in front of a provisioner that is not there. */
function gatewayStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof status === "number" && [502, 503, 504].includes(status) && code === "error" ? status : null;
}

/** The provisioner did not answer at all: connection refused or reset, a
 * timeout, no route, or a 502/503/504 from what stands in front of it. A
 * refusal from the provisioner itself (a code in its JSON body) is not. */
export function provisionerUnreachable(error: unknown): boolean {
  if (error instanceof UserSandboxUnavailable) return false;
  if (gatewayStatus(error) !== null) return true;
  if (UNREACHABLE_CODES.has(errorCode(error))) return true;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const message = error instanceof Error ? error.message : "";
  return message === "the provisioner did not answer" || message === "fetch failed";
}

/** The call certainly did not reach the provisioner, so it may be sent again
 * once the cluster is up (a timeout or a reset may have run it already). */
export function provisionerNotReached(error: unknown): boolean {
  return gatewayStatus(error) === 503 || NOT_DELIVERED_CODES.has(errorCode(error));
}

/** The provisioner's refusal while the sandbox pod is not running yet (a
 * cold node pool): HTTP 503 with this code. Nothing ran; the call may be sent
 * again. */
export const SANDBOX_STARTING_CODE = "starting";
/** How long a call refused with `starting` keeps being sent again. A cold
 * node pool (0 -> 1) plus the image pull took ~3 min on 2026-10-19. */
export const SANDBOX_STARTING_RETRY_MS = 5 * 60_000;
export const SANDBOX_STARTING_RETRY_DELAY_MS = 5_000;

/** The provisioner answered that the environment is still starting. */
export function sandboxStarting(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  return status === 503 && code === SANDBOX_STARTING_CODE;
}

export const CLUSTER_STARTING_MESSAGE = "The server environment is starting. This can take a few minutes.";
export const CLUSTER_STOPPED_MESSAGE = "The server environment is stopped. It starts with the next bot turn that needs it.";
export const CLUSTER_TIMEOUT_MESSAGE = "The server environment did not start in time. Send the message again in a few minutes.";

export interface SandboxClusterWakerOptions {
  settings: SandboxWakeSettings;
  /** GET /healthz of the Kubernetes provisioner: true when it answers 200. */
  health: (timeoutMs: number) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** `wake` may start the cluster; `peek` never does (a status read, the
 * Computer tab, a quota check) and fails at once while it is down. */
export type WakeMode = "wake" | "peek";

export class SandboxClusterWaker {
  private healthyAt = Number.NEGATIVE_INFINITY;
  private downAt = Number.NEGATIVE_INFINITY;
  private lastPostAt = Number.NEGATIVE_INFINITY;
  private lastPostOk = false;
  private probing: Promise<boolean> | null = null;
  private waking: Promise<void> | null = null;
  /** When the latest wake started (this process's clock), for the screen's
   * "it was asleep" hint. Never the URL, never anything else. */
  private wakeStartedAt: number | null = null;
  /** Webhook POSTs sent by this process (tests and diagnostics). */
  posts = 0;
  private readonly options: SandboxClusterWakerOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(options: SandboxClusterWakerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }));
    this.log = options.log ?? ((line) => console.error(line));
  }

  get timeoutMs(): number {
    return this.options.settings.timeoutMs;
  }

  /** A wake is in progress. */
  get starting(): boolean {
    return this.waking !== null;
  }

  /** The cluster is being woken: since when (epoch ms) and for how long. Kept for the whole
   * wake window (the timeout), even after the provisioner first answered:
   * a cluster just started may still fail a call while it settles, and a
   * status read that fails in that window is "starting", not an error.
   * Null outside a wake and once the window is over. */
  wakeState(): { since: number; elapsedMs: number } | null {
    const since = this.wakeStartedAt;
    if (since === null) return null;
    const elapsedMs = Math.max(0, this.now() - since);
    return this.waking || elapsedMs < this.options.settings.timeoutMs ? { since, elapsedMs } : null;
  }

  /** Resolve when the provisioner can be called. `onWait` runs once when this
   * caller has to wait for the cluster to start. */
  async ready(mode: WakeMode, onWait?: () => void): Promise<void> {
    if (this.waking) {
      if (mode === "peek") throw new UserSandboxUnavailable(CLUSTER_STARTING_MESSAGE, "cluster_starting");
      onWait?.();
      return this.waking;
    }
    if (this.now() - this.healthyAt < HEALTHY_TTL_MS) return;
    if (this.now() - this.downAt >= DOWN_TTL_MS && await this.probe()) return;
    if (this.waking) {
      // another caller started the wake while this one probed
      if (mode === "peek") throw new UserSandboxUnavailable(CLUSTER_STARTING_MESSAGE, "cluster_starting");
      onWait?.();
      return this.waking;
    }
    if (mode === "peek") throw new UserSandboxUnavailable(CLUSTER_STOPPED_MESSAGE, "cluster_stopped");
    onWait?.();
    return this.wake();
  }

  /** A call failed for lack of an answer: the next one probes again. */
  markUnreachable(): void {
    this.healthyAt = Number.NEGATIVE_INFINITY;
    this.downAt = this.now();
  }

  /** One shared probe: concurrent callers wait on the same GET /healthz. */
  private probe(): Promise<boolean> {
    this.probing ??= (async () => {
      let ok = false;
      try { ok = await this.options.health(PROBE_TIMEOUT_MS); } catch { ok = false; }
      if (ok) this.healthyAt = this.now();
      else this.downAt = this.now();
      return ok;
    })().finally(() => { this.probing = null; });
    return this.probing;
  }

  /** Start the cluster and wait for the provisioner. One at a time. */
  wake(): Promise<void> {
    this.waking ??= this.run().finally(() => { this.waking = null; });
    return this.waking;
  }

  private async run(): Promise<void> {
    this.wakeStartedAt = this.now();
    const deadline = this.wakeStartedAt + this.options.settings.timeoutMs;
    this.log("sandbox wake: the Kubernetes provisioner is unreachable; starting its cluster");
    await this.postIfDue();
    let delay = BACKOFF_FIRST_MS;
    for (;;) {
      if (await this.probe()) {
        this.log("sandbox wake: the Kubernetes provisioner answers again");
        return;
      }
      const left = deadline - this.now();
      if (left <= 0) break;
      await this.sleep(Math.min(delay, left));
      delay = Math.min(Math.round(delay * 1.5), BACKOFF_MAX_MS);
      // A POST that failed is tried again, never more than once per window.
      if (!this.lastPostOk) await this.postIfDue();
    }
    this.log(`sandbox wake: the Kubernetes provisioner did not answer within ${Math.round(this.options.settings.timeoutMs / 1000)} s`);
    throw new UserSandboxUnavailable(CLUSTER_TIMEOUT_MESSAGE, "cluster_start_timeout");
  }

  private async postIfDue(): Promise<void> {
    if (this.now() - this.lastPostAt < POST_WINDOW_MS) return;
    this.lastPostAt = this.now();
    this.posts += 1;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(this.options.settings.url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "sagax", reason: "sandbox-provisioner-unreachable" }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => {});
      this.lastPostOk = response.ok;
      this.log(response.ok ? "sandbox wake: start webhook accepted" : `sandbox wake: start webhook answered ${response.status}`);
    } catch (error) {
      // The error may carry the URL (its host or the request): only its code.
      this.lastPostOk = false;
      const code = errorCode(error) || (error as { name?: unknown } | null)?.name;
      this.log(`sandbox wake: start webhook unreachable${typeof code === "string" && code ? ` (${code})` : ""}`);
    }
  }
}
