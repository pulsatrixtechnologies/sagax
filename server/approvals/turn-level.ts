// The level one turn of a bot runs at (#4200): the bot's own level, the one
// the person set on it, whatever starts the turn (the person in the chat, a
// routine, a text message, a call, a hand-off from another bot or the
// organization link). What still moves it, and nothing else:
//   - the organization's own policy for Full access and for members' bots;
//   - isolation between people: a guest drives the turn on a Cloud home;
//   - the engine cannot run the level.
// A routine woken by an email runs at Ask below Full access; at Full access
// the person's choice covers it too.
import { approvalModeForOrigin } from "./auto-approve.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";

export interface TurnLevelFacts {
  /** The bot's own level (approvalModeFor on the conversation's projection). */
  level: ApprovalMode;
  /** The organization keeps Full access off for this bot, or its owner did not confirm it. */
  orgDeniesFull: boolean;
  /** A member's bot on an organization server. */
  memberOwned: boolean;
  /** The organization's policy for members' bots keeps this level as is. */
  memberLevelAllowed: boolean;
  /** Someone else drives this turn on a Cloud home. */
  guest: boolean;
  /** A routine run an email woke. */
  mail: boolean;
  /** Another bot started this turn. */
  peerInitiated: boolean;
  engineRuns: (mode: ApprovalMode) => boolean;
}

export function turnApprovalLevel(facts: TurnLevelFacts): ApprovalMode {
  const stored = facts.level;
  if (stored === "full" && facts.orgDeniesFull) return "ask";
  if (facts.memberOwned) {
    if (stored === "custom") return "ask";
    if (!facts.memberLevelAllowed) return "ask";
  }
  if (facts.guest) return "ask";
  if (facts.mail && stored !== "full") return "ask";
  const mode = approvalModeForOrigin(stored, { peerInitiated: facts.peerInitiated });
  return facts.engineRuns(mode) ? mode : "ask";
}
