/** Shared types for Codex turn phase modules (issue #1383). */
import type { SendTurnInput } from "../../contracts.ts";
import type { RenewalStep } from "../../context/context-renewal.ts";

/** PreparedCodexLaunch lives in session-types.ts with CodexSession (#1381). */
export type { PreparedCodexLaunch } from "./session-types.ts";

/** Mutable turn-level state owned by sendTurn / launchAttempt. */
export type CodexTurnMutable = {
  turn: SendTurnInput;
  stopRequested: boolean;
  promptSubmitted: boolean;
  recoveredMissingSession: boolean;
  loginRaceRetried: boolean;
  announced: boolean;
  autoAcceptPermissions: boolean;
  renewalSteps: RenewalStep[];
  renewalLastText: string;
  inTurnRenewal: string | null;
};
