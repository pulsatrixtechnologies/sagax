// LOOP_GUARD_WIRING: how index.ts should construct the guard and pass
// toolErrorCorrectiveRounds into sendTurn. Thin helper so the port does not
// dump a large index.ts edit; wire when ready.
import type { AppConfig } from "../config.ts";
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import {
  correctiveRounds,
  createLoopGuard,
  loopGuardSettings,
  type LoopGuard,
  type LoopGuardDeps,
  type LoopGuardSettingsOpts,
} from "./loop-guard.ts";

/** Build the loop guard (on by default). Keep `server/loop-detector.ts` (identical-call
 * stop) as a separate feature; this guard steers/stops on shell failure streaks. */
export function wireLoopGuard(deps: LoopGuardDeps): LoopGuard {
  return createLoopGuard(deps);
}

/** Settings reader for a live config getter (re-read on every tool event).
 * `botEnabledFor` resolves a per-bot off switch from the thread id. */
export function loopGuardSettingsFrom(
  getConfig: () => AppConfig,
  env: NodeJS.ProcessEnv = process.env,
  botEnabledFor?: (threadId: string) => boolean | undefined,
) {
  return (threadId: string) =>
    loopGuardSettings(getConfig(), env, { botEnabled: botEnabledFor?.(threadId) });
}

/** Value to pass as `SendTurnInput.toolErrorCorrectiveRounds` (0 when the
 * guard is off). Mirrors `loopGuard.correctiveRounds`; defaults to 1 when on. */
export function toolErrorCorrectiveRoundsFor(
  cfg: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: LoopGuardSettingsOpts = {},
): number {
  return correctiveRounds(cfg, env, opts);
}

/** Example bus fold: subscribe after create, skip ignored provider events. */
export function subscribeLoopGuard(
  guard: LoopGuard,
  subscribe: (listener: (event: RuntimeEvent) => void) => void,
  shouldIgnore: (event: RuntimeEvent) => boolean = () => false,
): void {
  subscribe((event) => {
    if (!shouldIgnore(event)) guard.onEvent(event);
  });
}

export type { LoopGuard, LoopGuardDeps, SteerOutcome };
