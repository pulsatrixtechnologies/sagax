// B2: the one decision every agent tool call goes through (docs/tool-policy.md):
// the policy row, the caller's grants and, for a bot, the person its turn
// speaks for. A bot never reaches past its speaker. Writes and admin calls
// still raise the Sagax approval card in the engine; this decides whether the
// call may happen at all.
//
// Mode "shadow" (the default) records the decision in the audit and lets the
// call through, so it can be compared with live traffic before "enforce".
//
// An owner-scoped admin call (a deletion of the person's own bot, files,
// projects, queue, webhooks or routine runs) is theirs: the guard allows it
// without a grant when the caller says who owns the target and that owner is
// the person (or the person the bot's turn speaks for). No owner given, or
// someone else's: the grant rule below, as before.
import type { GrantSubject, ToolGrantStore } from "./tool-grants.ts";
import type { ToolTier } from "./tool-policy.ts";

export type ToolGuardMode = "off" | "shadow" | "enforce";
export interface GuardPolicy { tier: ToolTier; scope: string; readOnly: boolean; defaultEnabled: boolean; ownerScoped?: boolean }
export type GuardReason = "default" | "owner" | "grant" | "not_granted" | "speaker_not_granted";
export interface GuardDecision { allow: boolean; reason: GuardReason; needsApproval: boolean }
/** The call's target, when the caller can resolve it: whose it is. */
export interface GuardTarget { ownerPrincipalId?: string | null }

/** The person the call acts for: a person themself, or the person a bot's
 * turn speaks for. A bot with no speaker (a routine) acts for nobody here. */
function actingPerson(subject: GrantSubject, speaker: GrantSubject | null): string | null {
  if (subject.kind === "user") return subject.id;
  return speaker?.kind === "user" ? speaker.id : null;
}

export function guardDecision(policy: GuardPolicy, subject: GrantSubject, speaker: GrantSubject | null, grants: ToolGrantStore, target?: GuardTarget): GuardDecision {
  const needsApproval = !policy.readOnly;
  if (policy.defaultEnabled && policy.tier !== "admin") return { allow: true, reason: "default", needsApproval };
  const person = actingPerson(subject, speaker);
  if (policy.tier === "admin" && policy.ownerScoped && person && target?.ownerPrincipalId && target.ownerPrincipalId === person) {
    return { allow: true, reason: "owner", needsApproval };
  }
  if (!grants.holds(subject, policy.scope)) return { allow: false, reason: "not_granted", needsApproval };
  if (subject.kind === "bot" && speaker && !grants.holds(speaker, policy.scope)) return { allow: false, reason: "speaker_not_granted", needsApproval };
  return { allow: true, reason: "grant", needsApproval };
}

export function toolGuardMode(value: string | undefined): ToolGuardMode {
  return value === "enforce" || value === "off" ? value : "shadow";
}
