// #2191: speaker a card / delegation / restart continuation must carry so
// Perspicax prepareTurn does not refuse with unknown_speaker.
//
// Prefer the thread's last resolved TurnSpeaker (turnSpeakers). When that is
// gone (process restart) but the thread still has a routine run, use that
// run's owner-routine speaker with its runAs principal. When neither is
// known, return undefined so the caller omits speaker and prepareTurn stays
// fail-closed.

import type { TurnSpeaker } from "../engines/engine-access.ts";

export function continuationSpeaker(input: {
  /** Last TurnSpeaker stored for the thread (turnSpeakers.get). */
  lastSpeaker?: TurnSpeaker;
  /** True when this thread belongs to a routine run that should resume. */
  routineRun?: boolean;
  /** The person the routine runs as (runAs), when known. */
  runAsPrincipalId?: string;
}): TurnSpeaker | undefined {
  if (input.lastSpeaker) return input.lastSpeaker;
  if (input.routineRun) {
    const principalId = input.runAsPrincipalId?.trim();
    return principalId ? { origin: "owner-routine", principalId } : { origin: "owner-routine" };
  }
  return undefined;
}
