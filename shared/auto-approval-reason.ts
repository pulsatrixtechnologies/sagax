// 2026-10-28: what answered a call's permission ask with no card, in a few
// plain groups, for the call's details (never its line). `source` is the
// decision log's (server/approvals/auto-approve.ts AutoVerdictSource, owner-approval.ts
// OwnerDecisionSource). An unknown source reads "Approved automatically".

export type AutoApprovalReason =
  | "full"
  | "level"
  | "rule"
  | "command"
  | "recipients"
  | "trusted"
  | "answered"
  | "other";

const BY_SOURCE: Readonly<Record<string, AutoApprovalReason>> = {
  "full-access": "full",
  "owner-bypass": "full",
  "owner-auto": "level",
  "own-environment": "level",
  "web-search": "level",
  "allow-rule": "rule",
  "owner-rule": "rule",
  "custom-rule": "rule",
  "admin-rule": "rule",
  "command-allowlist": "command",
  "allowed-recipient": "recipients",
  "reach-me": "recipients",
  "safety-read": "trusted",
  "connector-read": "trusted",
  "perspicax-read": "trusted",
  "perspicax-lease": "trusted",
  "sagax-internal": "trusted",
  "own-read-only": "trusted",
  "own-attachment": "trusted",
  "own-computer-choice": "trusted",
  "email-draft-approval": "answered",
  "widget-approval": "answered",
};

export function autoApprovalReason(source: string | undefined): AutoApprovalReason {
  return (source && BY_SOURCE[source]) || "other";
}
