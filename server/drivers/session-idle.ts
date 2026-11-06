// One session-idle policy for every pooled harness process. The Claude
// driver and the ACP core grew byte-identical copies of this computation
// with different env prefixes; the policy lives here so the default, the
// floor, and the env names cannot drift apart again.
import { availableMemory, boxMemory, type BoxMemory } from "../box-memory.ts";

export interface SessionIdlePolicy {
  /** How long a session may sit quiet before it is closed as "idle". */
  idleMs: number;
  /** The smallest idle delay a configuration may ask for. */
  minimumMs: number;
}

const DEFAULT_IDLE_MS = 10 * 60_000;
/** One warm engine and its MCP servers take 250 to 450 MB: on a box this small an idle one is soon given back, and the
 * next turn resumes its session by id. */
export const SMALL_BOX_BYTES = 1.5 * 1024 ** 3;
export const SMALL_BOX_IDLE_MS = 150_000;
const MINIMUM_IDLE_MS = 10_000;
/** setTimeout treats anything above 2^31-1 ms as 1 ms, so a larger delay
 *  would close the session immediately instead of much later. */
const MAX_TIMER_MS = 2_147_483_647;

function usableMilliseconds(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= MAX_TIMER_MS ? value : null;
}

/** The idle policy for one harness. The per-harness names that preceded the
 *  unified ones (SAGAX_CLAUDE_SESSION_IDLE_*, SAGAX_ACP_SESSION_IDLE_*) win when
 *  both are set, so a harness-specific override keeps working alongside a
 *  global SAGAX_SESSION_IDLE_MS / SAGAX_SESSION_IDLE_MIN_MS; those win over the
 *  box's default. A delay that is not a positive finite number of at most
 *  2^31-1 ms is validated away before the floor applies. The floor is the
 *  greater of the built-in ten seconds and any configured minimum. */
export function sessionIdlePolicy(
  driverPrefix: string,
  env: Record<string, string | undefined> = process.env,
  boxBytes: number = boxMemory().bytes,
): SessionIdlePolicy {
  const minimumMs = Math.max(
    MINIMUM_IDLE_MS,
    usableMilliseconds(
      env[`SAGAX_${driverPrefix}_SESSION_IDLE_MIN_MS`] ?? env.SAGAX_SESSION_IDLE_MIN_MS,
    ) ?? 0,
  );
  const configured =
    usableMilliseconds(
      env[`SAGAX_${driverPrefix}_SESSION_IDLE_MS`] ?? env.SAGAX_SESSION_IDLE_MS,
    ) ?? (boxBytes <= SMALL_BOX_BYTES ? SMALL_BOX_IDLE_MS : DEFAULT_IDLE_MS);
  return { idleMs: Math.max(minimumMs, configured), minimumMs };
}

/** On a small box with less than half of it free, a second idle engine would leave no room for a turn's own engine. */
export function idleEnginesAllowed(box: Pick<BoxMemory, "bytes">, availableBytes: number): number {
  return box.bytes <= SMALL_BOX_BYTES && availableBytes < box.bytes / 2 ? 1 : Infinity;
}

export interface WarmEngine {
  /** Still idle and free to close: no turn running, no hold keeping it up. */
  idle: () => boolean;
  close: () => void;
}

/** Idle engines of every driver, the longest idle first. */
const warmEngines = new Map<string, WarmEngine>();

/** An engine went idle: when the box allows fewer idle engines than are up, the ones idle longest close now. */
export function keepWarm(key: string, engine: WarmEngine, box: Pick<BoxMemory, "bytes"> = boxMemory(),
  available: () => number = availableMemory): void {
  if (box.bytes > SMALL_BOX_BYTES) return;
  warmEngines.delete(key);
  warmEngines.set(key, engine);
  for (const [other, warm] of warmEngines) if (other !== key && !warm.idle()) warmEngines.delete(other);
  const extra = warmEngines.size - idleEnginesAllowed(box, available());
  if (extra <= 0) return;
  for (const [other, warm] of [...warmEngines].slice(0, extra)) {
    warmEngines.delete(other);
    warm.close();
  }
}

/** Closes an idle engine after `ms`, or sooner on a small box once another engine goes idle after it. */
export function armIdleClose(key: string, ms: number, engine: WarmEngine): ReturnType<typeof setTimeout> {
  const timer = setTimeout(engine.close, ms);
  timer.unref?.();
  keepWarm(key, engine);
  return timer;
}

export function stopIdleClose(key: string, timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer);
  warmEngines.delete(key);
}

export function warmEngineKeys(): string[] {
  return [...warmEngines.keys()];
}
