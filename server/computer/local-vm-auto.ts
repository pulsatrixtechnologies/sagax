// Keeps this computer's Local VM up without anyone asking (2026-10-14).
//
// On the desktop app's own server (solo, SAGAX_DESKTOP_PARENT), the Local VM
// is checked when the app starts and whenever a bot needs it, and is brought
// up in the background when it is missing or stopped:
//
// - the container runtime is started once per launch when it is installed
//   but stopped (nothing is ever installed automatically);
// - the desktop image is prepared at most once per launch (the expected
//   download of a first install, or after an update changed the image); a
//   failed download waits for the person (Retry) instead of downloading
//   again;
// - shared mode: the desktop is created, recreated (a container of an older
//   image or without its safety limits; the workspace folder is kept) or
//   started, then waited on until its desktop answers;
// - per-bot and pool modes: only the runtime and the image; each bot's own
//   desktop still starts when that bot needs it, within the per-bot limit;
// - a container Sagax did not create is never touched;
// - a failure is retried with a growing delay (30 s, 2 min, 10 min), then
//   it stops and waits for the person: never a loop;
// - when the person stopped the VM themselves, nothing starts it again
//   automatically until the app's next launch or the person's own Start.
//
// Pure: every effect is a dependency, so the rules are tested with fakes
// (local-vm-auto.test.ts).
import type { ContainerComputerStatus } from "./container-computer.ts";

export type LocalVmAutoReason = "launch" | "bot" | "person" | "retry";
export type LocalVmAutoPhase = "idle" | "checking" | "starting" | "running" | "stopped" | "waiting" | "problem";
export type LocalVmAutoStep = "runtime" | "image" | "container" | "start";
export type LocalVmAutoProblem = "no_runtime" | "runtime_stopped" | "foreign" | "unsupported" | "image_failed" | "start_failed";

export interface LocalVmAutoSnapshot {
  phase: LocalVmAutoPhase;
  /** The step being worked on while starting. */
  step: LocalVmAutoStep | null;
  problem: LocalVmAutoProblem | null;
  /** The runtime's own words for the last failure (shown under Advanced). */
  detail: string | null;
  /** Failed automatic attempts since the last success or the person's retry. */
  attempts: number;
  /** When the next automatic attempt runs (epoch ms), while waiting. */
  nextRetryAt: number | null;
  stoppedByPerson: boolean;
}

export interface LocalVmAutoDeps {
  mode(): "shared" | "per-bot" | "pool";
  /** False where this server may not keep a Local VM (managed policy). */
  allowed(): boolean;
  status(): Promise<ContainerComputerStatus>;
  /** Start an installed runtime whose engine is stopped. False: cannot. */
  startRuntime(status: ContainerComputerStatus): Promise<boolean>;
  prepareImage(): Promise<unknown>;
  create(): Promise<ContainerComputerStatus>;
  start(): Promise<ContainerComputerStatus>;
  remove(): Promise<ContainerComputerStatus>;
  /** A person's own setup action is running: leave it alone. */
  busy(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  onChange?(snapshot: LocalVmAutoSnapshot): void;
  /** How long a started desktop may take to answer. */
  desktopWaitMs?: number;
  /** How long a started runtime may take to answer. */
  runtimeWaitMs?: number;
}

/** Delays before the 1st, 2nd and 3rd automatic retry; then it stops. */
export const LOCAL_VM_AUTO_BACKOFF_MS = [30_000, 120_000, 600_000] as const;
const POLL_MS = 2_000;

class AutoFailure extends Error {
  readonly problem: LocalVmAutoProblem;
  readonly retry: boolean;
  constructor(problem: LocalVmAutoProblem, detail: string | null, retry: boolean) {
    super(detail ?? problem);
    this.problem = problem;
    this.retry = retry;
  }
}

/** A managed container that only a recreate fixes (older image, missing
 * safety limits or durable folder). Its workspace folder is kept. */
export function localVmNeedsRecreate(status: ContainerComputerStatus): boolean {
  return status.container !== "missing" && status.managed && (
    !status.imageMatches || status.network === "unsafe" || status.security === "unsafe" || status.persistence === "unsafe"
  );
}

export class LocalVmAutoStarter {
  private snap: LocalVmAutoSnapshot = { phase: "idle", step: null, problem: null, detail: null, attempts: 0, nextRetryAt: null, stoppedByPerson: false };
  private inFlight: Promise<LocalVmAutoSnapshot> | null = null;
  private retryHandle: unknown = null;
  private runtimeStartTried = false;
  private imageTried = false;

  private readonly deps: LocalVmAutoDeps;

  constructor(deps: LocalVmAutoDeps) {
    this.deps = deps;
  }

  snapshot(): LocalVmAutoSnapshot {
    return { ...this.snap };
  }

  /** The person stopped the VM: nothing starts it automatically again
   * until the next launch or their own Start. */
  personStopped(): void {
    this.clearRetry();
    this.set({ phase: "stopped", step: null, problem: null, detail: null, stoppedByPerson: true });
  }

  /** The person started, created or reset it: automatic care resumes. */
  personStarted(): void {
    this.set({ stoppedByPerson: false, ...(this.snap.phase === "stopped" ? { phase: "idle" as const } : {}) });
  }

  /** Check the Local VM and bring it up if it is missing or stopped. One
   * run at a time: a second call while one runs gets the same answer. */
  ensure(reason: LocalVmAutoReason): Promise<LocalVmAutoSnapshot> {
    if (!this.deps.allowed()) return Promise.resolve(this.snapshot());
    if (reason === "person") {
      // The person's Start or Retry: a fresh budget, a fresh download allowance.
      this.clearRetry();
      this.snap.attempts = 0;
      this.imageTried = false;
      this.runtimeStartTried = false;
      this.snap.stoppedByPerson = false;
    }
    if (this.snap.stoppedByPerson) return Promise.resolve(this.snapshot());
    if (this.inFlight) return this.inFlight;
    // Waiting out a delay, or given up: only the timer or the person go on.
    if (reason === "bot" && (this.snap.phase === "waiting" || this.snap.phase === "problem")) return Promise.resolve(this.snapshot());
    if (reason === "retry") this.retryHandle = null;
    this.inFlight = this.run(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(reason: LocalVmAutoReason): Promise<LocalVmAutoSnapshot> {
    if (this.deps.busy()) return this.snapshot();
    this.set({ phase: "checking", step: null, nextRetryAt: null });
    try {
      let status = await this.deps.status();
      if (this.snap.stoppedByPerson) return this.snapshot();
      if (!status.runtime) throw new AutoFailure("no_runtime", status.problem, false);
      if (!status.daemonUp) status = await this.bringRuntimeUp(status);
      if (!status.image) {
        // One download per launch: a failure waits for the person.
        if (this.imageTried && reason !== "person") throw new AutoFailure("image_failed", this.snap.detail, false);
        this.imageTried = true;
        this.set({ phase: "starting", step: "image" });
        try {
          await this.deps.prepareImage();
        } catch (error) {
          throw new AutoFailure("image_failed", message(error), false);
        }
        status = await this.deps.status();
        if (!status.image) throw new AutoFailure("image_failed", status.problem, false);
      }
      if (this.deps.mode() !== "shared") return this.succeed();
      if (status.container !== "missing" && !status.managed) throw new AutoFailure("foreign", status.problem, false);
      if (localVmNeedsRecreate(status)) {
        this.set({ phase: "starting", step: "container" });
        status = await this.deps.remove();
      }
      if (status.container === "missing") {
        if (!status.create_supported) throw new AutoFailure("unsupported", status.problem, false);
        this.set({ phase: "starting", step: "container" });
        status = await this.deps.create();
      } else if (status.container === "stopped") {
        if (this.snap.stoppedByPerson) return this.snapshot();
        this.set({ phase: "starting", step: "start" });
        status = await this.deps.start();
      }
      if (!status.ready) {
        this.set({ phase: "starting", step: "start" });
        const deadline = this.deps.now() + (this.deps.desktopWaitMs ?? 120_000);
        while (!status.ready && status.container === "running" && this.deps.now() < deadline) {
          await this.deps.wait(POLL_MS);
          status = await this.deps.status();
        }
      }
      if (!status.ready) throw new AutoFailure("start_failed", status.problem, true);
      return this.succeed();
    } catch (error) {
      if (error instanceof AutoFailure) return this.fail(error.problem, error.message === error.problem ? null : error.message, error.retry);
      return this.fail("start_failed", message(error), true);
    }
  }

  private async bringRuntimeUp(status: ContainerComputerStatus): Promise<ContainerComputerStatus> {
    if (this.runtimeStartTried) throw new AutoFailure("runtime_stopped", status.problem, true);
    this.runtimeStartTried = true;
    this.set({ phase: "starting", step: "runtime" });
    const started = await this.deps.startRuntime(status).catch(() => false);
    if (!started) throw new AutoFailure("runtime_stopped", status.problem, false);
    const deadline = this.deps.now() + (this.deps.runtimeWaitMs ?? 120_000);
    let current = await this.deps.status();
    while (!current.daemonUp && this.deps.now() < deadline) {
      await this.deps.wait(3_000);
      current = await this.deps.status();
    }
    if (!current.daemonUp) throw new AutoFailure("runtime_stopped", current.problem, true);
    return current;
  }

  private succeed(): LocalVmAutoSnapshot {
    this.clearRetry();
    return this.set({ phase: "running", step: null, problem: null, detail: null, attempts: 0, nextRetryAt: null });
  }

  private fail(problem: LocalVmAutoProblem, detail: string | null, retry: boolean): LocalVmAutoSnapshot {
    const attempts = this.snap.attempts + 1;
    const delay = retry ? LOCAL_VM_AUTO_BACKOFF_MS[attempts - 1] : undefined;
    if (delay === undefined) {
      this.clearRetry();
      return this.set({ phase: "problem", step: null, problem, detail, attempts, nextRetryAt: null });
    }
    this.clearRetry();
    this.retryHandle = this.deps.schedule(() => { void this.ensure("retry"); }, delay);
    return this.set({ phase: "waiting", step: null, problem, detail, attempts, nextRetryAt: this.deps.now() + delay });
  }

  private clearRetry(): void {
    if (this.retryHandle !== null) this.deps.cancel(this.retryHandle);
    this.retryHandle = null;
    this.snap.nextRetryAt = null;
  }

  private set(patch: Partial<LocalVmAutoSnapshot>): LocalVmAutoSnapshot {
    this.snap = { ...this.snap, ...patch };
    try { this.deps.onChange?.(this.snapshot()); } catch { /* display only */ }
    return this.snapshot();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
