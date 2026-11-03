// Automatic approval levels for members' bots on an organization server
// (2026-10-16, security review of #678).
//
// A bot whose owner is not an organization admin (memberOwnedBot) runs its
// Auto ("Approve for me") and Auto-accept edits levels as such unless an
// organization admin turned `organization.memberAutoApproval` off
// (Settings > Organization, the admin API's `POST settings`). Absent means
// allowed: members stay autonomous by default. Explicitly false: those
// levels run as Ask, and a change of a member's bot to one of them is
// refused (`member_auto_not_allowed`). Custom stays Ask and Full keeps its
// own rules (org-full-access.ts) either way. While allowed, a member's
// looser level still goes through the security key step-up.
//
// The first time an admin turns it off (at that save, or at a start that
// finds it off), every saved Auto or Auto-accept edits level of a member's
// bot (the bot's own and each thread's) goes back to Ask, once, and
// `organization.memberAutoResetAt` records the pass. When an admin later
// turns the setting on again, old levels do not come back by themselves:
// members choose again.
//
// 2026-10-26: the switch is gone (memberAutoApprovalAllowed is always
// true), so none of the above happens any more; the helpers stay for the
// callers and their tests.

import type { ApprovalMode } from "../../shared/approval-mode.ts";

export const MEMBER_AUTO_NOT_ALLOWED = {
  error: "Automatic approval levels are turned off for members' bots in this organization. An organization admin can allow them in Settings > Organization.",
  code: "member_auto_not_allowed",
} as const;

/** 2026-10-26: no organization switch any more. Auto on a member's
 * own bot acts in that person's environment; a saved
 * `memberAutoApproval: false` is ignored. */
export function memberAutoApprovalAllowed(_organization?: { memberAutoApproval?: unknown }): boolean {
  return true;
}

/** The levels this setting governs. */
export function memberAutoLevel(mode: string | undefined): mode is "auto" | "edits" {
  return mode === "auto" || mode === "edits";
}

/** The level a member's bot runs at for one turn, from its stored level:
 * Auto and Auto-accept edits only while the organization allows them. */
export function memberTurnLevel(stored: ApprovalMode, policyAllowed: boolean): ApprovalMode {
  return memberAutoLevel(stored) && !policyAllowed ? "ask" : stored;
}

/** The level a member's bot runs at for a room turn, after a Primary
 * Bot's handoff may have raised it (roomTurnApprovalMode): Custom stays
 * Ask, and Auto or Auto-accept edits follow memberTurnLevel, so a handoff
 * never lifts a member's bot past what the organization allows. Full is
 * judged before (org-full-access.ts). */
export function memberRoomTurnLevel(level: ApprovalMode, policyAllowed: boolean): ApprovalMode {
  if (level === "custom") return "ask";
  return memberTurnLevel(level, policyAllowed);
}

/** Whether a change of a member's bot to `to` is refused: an automatic
 * level, while the organization does not allow it, that differs from a
 * level it replaces (resending the same level is not a change). */
export function memberAutoChangeRefused(input: { memberOwned: boolean; policyAllowed: boolean; froms: ReadonlyArray<string | undefined>; to: string }): boolean {
  if (!input.memberOwned || input.policyAllowed || !memberAutoLevel(input.to)) return false;
  return input.froms.some((from) => (from ?? "ask") !== input.to);
}

interface LevelHolder {
  approvalMode?: unknown;
  autoApprove?: unknown;
}

export interface MemberAutoResetBot extends LevelHolder {
  id: string;
  tasks?: Array<LevelHolder & { threadId: string }>;
}

export interface MemberAutoReset {
  /** Bots whose own saved level goes back to Ask. */
  bots: string[];
  /** Threads whose own saved level goes back to Ask. */
  threads: Array<{ botId: string; threadId: string }>;
}

/** A record's own saved level when it is automatic: `approvalMode`, or the
 * legacy `autoApprove` bit when no level was ever saved. A thread with
 * neither follows its bot, which is reset on its own. */
function savedAutomatic(record: LevelHolder): boolean {
  if (typeof record.approvalMode === "string") return memberAutoLevel(record.approvalMode);
  return record.autoApprove === true;
}

/** The one-time pass: which saved levels of members' bots go back to Ask.
 * Pure; the caller writes `{ approvalMode: "ask", autoApprove: false }` on
 * each and records the marker. */
export function memberAutoLevelResets(bots: readonly MemberAutoResetBot[], memberOwned: (bot: MemberAutoResetBot) => boolean): MemberAutoReset {
  const out: MemberAutoReset = { bots: [], threads: [] };
  for (const bot of bots) {
    if (!memberOwned(bot)) continue;
    if (savedAutomatic(bot)) out.bots.push(bot.id);
    for (const task of bot.tasks ?? []) {
      if (savedAutomatic(task)) out.threads.push({ botId: bot.id, threadId: task.threadId });
    }
  }
  return out;
}

/** Whether the pass has to run now: an organization server whose admin
 * turned the setting off explicitly, and no marker yet. Never by default. */
export function memberAutoResetPending(identity: "solo" | "perspicax", organization: { memberAutoApproval?: unknown; memberAutoResetAt?: unknown } | undefined): boolean {
  return identity === "perspicax" && !memberAutoApprovalAllowed(organization) && typeof organization?.memberAutoResetAt !== "number";
}

/** 2026-10-17 (follow-up of #696): which saved automatic levels go back to
 * Ask now, for these bots, whenever the organization refuses them for
 * members' bots: at each start (so nothing stored outlives the setting) and
 * when a bot's owner stops being an organization admin (a demoted admin's
 * bots are members' bots from then on). Unlike the one-time pass, no
 * marker: it runs every time and finds nothing once settled. Nothing on a
 * solo server or while the organization allows them. */
export function memberAutoSettle(input: {
  identity: "solo" | "perspicax";
  organization: { memberAutoApproval?: unknown } | undefined;
  bots: readonly MemberAutoResetBot[];
  memberOwned: (bot: MemberAutoResetBot) => boolean;
}): MemberAutoReset {
  if (input.identity !== "perspicax" || memberAutoApprovalAllowed(input.organization)) return { bots: [], threads: [] };
  return memberAutoLevelResets(input.bots, input.memberOwned);
}
