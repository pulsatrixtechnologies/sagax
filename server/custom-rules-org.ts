// The organization's approval policy (2026-10-21, the reference design parity lot 1A):
// what an organization admin sets for every person of the server, above
// their own rules.
//
// - Organization rules: "Demander d'abord" or "Refuser" in plain words
//   (shared/custom-rules.ts), kept in custom-approval-rules.json beside the
//   people's own rules (server/custom-rules-store.ts). They apply to every
//   person and every bot, win over a person's own rule of the same behavior,
//   and a member can neither change nor remove them ("Exigé par votre
//   administrateur"). They only restrict: an organization rule never allows.
// - "Toujours permettre" off: an Allow answers this card only. No answer
//   saves a standing grant (a session allow, a saved command, an Always
//   allow rule or key), and the standing grants people already saved stop
//   answering while it is off (autoVerdict, matchOwnerRule, the store's
//   rulesOf). On again, they answer again. 2026-10-27 (#1098): never in the
//   person's own sandbox (their cloud computer, their Local VM): what happens
//   there is theirs, so their Allow rules keep answering and saving there.
//
// The admin sets both in the Perspicax console (server/org/org-admin-ops.ts,
// `org-approvals`). This module holds the live policy for the pure deciders,
// which read it without a new parameter from every caller.

export interface OrgApprovalPolicy {
  /** Whether an answer may save a standing grant ("Toujours permettre"). */
  alwaysAllow: boolean;
}

export const ORG_ALWAYS_ALLOW_OFF = {
  error: "Your organization requires an approval each time: Always allow is turned off by an organization admin.",
  code: "org_always_allow_off",
} as const;

export const ORG_RULE_LOCKED = {
  error: "Required by your organization admin. You cannot change or delete this rule.",
  code: "org_rule_locked",
} as const;

let source: (() => OrgApprovalPolicy) | null = null;

/** The store that holds the policy registers itself here (one per server). */
export function setOrgApprovalPolicySource(read: (() => OrgApprovalPolicy) | null): void {
  source = read;
}

/** Whether "Toujours permettre" may save or use a standing grant now. With
 * no store registered (a test, a tool), the default: allowed. A policy that
 * cannot be read refuses (fail closed). `ownSandbox`: the call runs in the
 * person's own sandbox, where the switch never applies (#1098). */
export function standingGrantsAllowed(where?: { ownSandbox?: boolean }): boolean {
  if (where?.ownSandbox === true) return true;
  if (!source) return true;
  try {
    return source().alwaysAllow;
  } catch {
    return false;
  }
}

/** Whether an answer to a card would save a standing grant. */
export function answerWidens(answer: { always?: boolean | null; rememberCommand?: boolean | null; rule?: string | null; alwaysAllowKey?: string | null } | undefined): boolean {
  return Boolean(answer && (answer.always === true || answer.rememberCommand === true || answer.rule === "allow" || answer.alwaysAllowKey));
}
