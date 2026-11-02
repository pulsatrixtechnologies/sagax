// Frozen hold after a blocked or failed report (DEL-07) and the reserved
// person slot on admission (DEL-08). Pure: computed from the assignment row
// and its stored events; the host decides what to log when a delivery is
// skipped.
import type { Assignment } from "./types.ts";
import {
  hasHumanMessageSince,
  lastBlockedOrFailedAt,
  STAGE_DETAIL,
  type StageAssignment,
  type StageEvent,
} from "./stage.ts";

export { STAGE_DETAIL, hasHumanMessageSince, lastBlockedOrFailedAt };

/** Where an inbound entry for a job came from. */
export type InputSource = "person" | "bot" | "routine" | "webhook" | "other";

export type DeliverDecision =
  | { action: "deliver"; liftsHold: boolean }
  | { action: "skip"; reason: "held_automatic" };

/**
 * True after a blocked or failed report for as long as no human message has
 * arrived since. Recomputed from the stored events on every read, so it
 * survives a process restart.
 */
export function isHeld(assignment: StageAssignment, events: readonly StageEvent[] = []): boolean {
  if (assignment.outcome === "stopped") return false;
  const at = lastBlockedOrFailedAt(assignment, events);
  if (at === undefined) return false;
  return !hasHumanMessageSince(events, at);
}

/**
 * Whether an inbound entry should reach a job. Automatic sources (bot,
 * routine, webhook) are recorded by the caller and skipped while held; a
 * person message is delivered and lifts the hold on the next isHeld read
 * once the harness appends a human_message (or answered) event.
 */
export function shouldDeliverInput(
  assignment: StageAssignment,
  events: readonly StageEvent[],
  source: InputSource,
): DeliverDecision {
  if (!isHeld(assignment, events)) return { action: "deliver", liftsHold: false };
  if (source === "person") return { action: "deliver", liftsHold: true };
  return { action: "skip", reason: "held_automatic" };
}

/** Detail to append when an automatic entry is skipped on a held job. */
export function heldSkipDetail(source: InputSource): string {
  return `held_skip:${source}`;
}

/** Detail to append when a person message lifts the hold. */
export function humanMessageDetail(): string {
  return STAGE_DETAIL.humanMessage;
}

export type WakeKind = "person" | "automatic";

/**
 * A wake that must use the reserved person slot: the person is the
 * requester, or the turn carries their answer. Bot-to-bot and unattended
 * work stay on the ordinary slots.
 */
export function wakeKind(assignment: Pick<Assignment, "requester" | "answer">): WakeKind {
  if (assignment.answer !== undefined) return "person";
  if (assignment.requester.kind === "person") return "person";
  return "automatic";
}

/**
 * Concurrency with one extra slot reserved for a person message or status
 * request (DEL-08). Automatic work may fill `maxSlots`; a person wake may
 * use one more. Hard blockers (thread busy, group turn, review hold) still
 * refuse everyone.
 */
export function reservedSlotAdmission(input: {
  wake: WakeKind;
  usedSlots: number;
  maxSlots: number;
  hardBlocked: boolean;
}): true | false | string {
  if (input.hardBlocked) return false;
  const limit = input.wake === "person" ? input.maxSlots + 1 : input.maxSlots;
  if (input.usedSlots >= limit) {
    return input.wake === "person"
      ? false
      : "waiting for a free slot (one is reserved for a person message)";
  }
  return true;
}
