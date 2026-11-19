// #3315 (port of OpenMausBot #3907 and #4681): a turn whose engine is known to
// be signed out for its payer starts on a backup the person chose (the bot's
// own list, or the one backup of Automatic recovery), for that turn only. The
// conversation keeps the model the person chose: once the engine is signed in
// again, its next turn runs there with nothing to move back. Every new turn
// and every new conversation of every bot skips it the same way, a restart
// included (engine-refusals.ts keeps the sign-out on disk).
import type { ModelSelection } from "../../shared/model-selection.ts";

export interface SignedOutCarryOnInput {
  /** What the turn would run on. */
  selection: ModelSelection;
  /** The backups the person chose for this bot, in their order. */
  backups: ReadonlyArray<{ instanceId: string; model: string }>;
  /** This engine is known to be signed out for the turn's payer. */
  held: (instanceId: string) => boolean;
  /** The backup as this turn may run on it (its approval level, the
   * organization's engines and policy, its tools, its own limits), or null
   * when it may not take the turn. */
  usable: (backup: ModelSelection) => ModelSelection | null;
}

/** The backup this turn runs on instead, or null when its engine is not held
 * or none of the chosen backups can take it (the turn is then tried on its
 * own engine as usual). Another sign-in to the same provider may stand in:
 * signing in is per account. */
export function signedOutCarryOn(input: SignedOutCarryOnInput): ModelSelection | null {
  const { selection } = input;
  if (selection.auto === true || !selection.instanceId || !input.held(selection.instanceId)) return null;
  for (const backup of input.backups) {
    if (!backup?.instanceId || backup.instanceId === selection.instanceId || input.held(backup.instanceId)) continue;
    const usable = input.usable({ instanceId: backup.instanceId, model: backup.model });
    if (usable) return usable;
  }
  return null;
}

export interface SignedOutResendInput {
  /** The turn ended refused by its engine: signed out, or an account whose
   * plan does not allow it here (an HTTP 403 "permission_error"). */
  refused: boolean;
  /** A sign-in renew holds the refusal and sends the turn again itself. */
  renewHeld: boolean;
  /** A message the person sent, not stopped, not a routine's run. */
  personTurn: boolean;
  /** This thread's refused turn was already sent again once. */
  alreadyResent: boolean;
  /** A chosen backup may take the turn now (signedOutCarryOn, no side effect). */
  backupReady: () => boolean;
}

/** The owner (2026-11-18, a call turn refused by Claude's plan): the refused
 * turn itself is sent again at once, so the backup the person chose answers
 * it, not only the next turn. Once per thread, so a backup that refuses too
 * never loops; the sent-again turn starts on the backup (signedOutCarryOn). */
export function resendOnSignedOutBackup(input: SignedOutResendInput): boolean {
  return input.refused && !input.renewHeld && input.personTurn && !input.alreadyResent && input.backupReady();
}
