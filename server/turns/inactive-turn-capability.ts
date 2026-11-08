// #2632: "cannot mint an integration capability for an inactive turn".
// A turn's tools are minted under its generation; a Stop, a superseding
// send or a provider reload revokes that generation while the setup is
// still awaiting. The mint then refuses, and that refusal is not the
// turn's failure: it must never land as an error step in the thread.

export const INACTIVE_TURN_CAPABILITY = "cannot mint an integration capability for an inactive turn";

export class InactiveTurnCapabilityError extends Error {
  readonly code = "inactive_turn_capability";
  constructor() {
    super(INACTIVE_TURN_CAPABILITY);
    this.name = "InactiveTurnCapabilityError";
  }
}

export function isInactiveTurnCapabilityError(error: unknown): boolean {
  return error instanceof InactiveTurnCapabilityError
    || (error instanceof Error && error.message === INACTIVE_TURN_CAPABILITY);
}

/** What a turn whose mint was refused becomes.
 * - cancelled: the turn was stopped or replaced; it ends quietly, like any
 *   setup that a Stop cut short.
 * - retry: nothing stopped it (a provider reload retired its bearers); it
 *   starts again once, on the same pick, with fresh bearers.
 * - fail: it already retried once; the person is told in plain words. */
export type InactiveCapabilityOutcome = "cancelled" | "retry" | "fail";

export function inactiveCapabilityOutcome(input: { claimCurrent: boolean; stopped: boolean; retried: boolean }): InactiveCapabilityOutcome {
  if (!input.claimCurrent || input.stopped) return "cancelled";
  return input.retried ? "fail" : "retry";
}

export const INACTIVE_CAPABILITY_FAILED =
  "This bot's engine was reloaded twice while the turn was starting its tools. Send the message again.";
