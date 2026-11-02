// Full access on an organization server (2026-10-01, owner request).
//
// On a solo server Full access is granted only through the packaged desktop
// app's private channel (Electron confirms the grant), never over HTTP. An
// organization server has no such channel: the person's app is a remote
// client. There a bot's owner turns Full access on over HTTP, under three
// rules decided here:
//
// - (2026-10-26) no organization switch: the former
//   `organization.allowFullAccess` is ignored (orgFullAccessAllowed);
// - the caller is a person signed in (a session with a principal), and is
//   the bot's owner: a bot's own shell, a service caller or loopback never
//   is, so a bot cannot raise itself;
// - the owner confirmed the risks once for that bot (`fullAccessConsent`,
//   kept on the bot): the first grant needs `confirmFullAccess: true`.
//
// At turn time a stored Full runs as Full only while the policy is on and the
// consent belongs to the bot's current owner (a routine runs as the bot's
// owner, so a routine gets Full only when that owner set it on that bot).
// Otherwise it runs as Ask. Full access never lifts a hard limit: host tools
// stay withheld on the server (withholdHostTools), private threads, egress
// and payer rules are unchanged.

export interface FullAccessConsent {
  /** The principal who confirmed the risks for this bot. */
  principalId: string;
  at: number;
}

export interface FullAccessRefusal {
  status: 403 | 409;
  error: string;
  code: "org_full_access_disabled" | "full_access_owner_only" | "full_access_confirm_required";
}

export const ORG_FULL_ACCESS_DISABLED: FullAccessRefusal = {
  status: 403,
  error: "Full access is turned off for this organization. An organization admin can allow it in Settings > Organization.",
  code: "org_full_access_disabled",
};
export const FULL_ACCESS_OWNER_ONLY: FullAccessRefusal = {
  status: 403,
  error: "Only the bot's owner, signed in, can turn on Full access for it.",
  code: "full_access_owner_only",
};
export const FULL_ACCESS_CONFIRM_REQUIRED: FullAccessRefusal = {
  status: 409,
  error: "Confirm the Full access warning for this bot first.",
  code: "full_access_confirm_required",
};

/** 2026-10-26: no organization switch any more. Full access on a
 * member's own bot stays in that person's environment (host tools withheld,
 * server commands still an admin's card, private threads, egress and payer
 * rules unchanged), so the owner's own confirmation is the only gate. A saved
 * `allowFullAccess` is ignored. */
export function orgFullAccessAllowed(_organization?: { allowFullAccess?: unknown }): boolean {
  return true;
}

/** The marker of the one-time pass below, in the data directory. */
export const ORG_FULL_ACCESS_DEFAULT_MARKER = "org-full-access-default.v1";

interface FullAccessHolder {
  approvalMode?: unknown;
  fullAccessConsent?: unknown;
  tasks?: Array<{ approvalMode?: unknown }>;
}

/** 2026-10-11, once per data directory of an organization server: Full
 * access used to be allowed unless an admin turned it off, and is now off
 * until one turns it on. An organization that never saved the setting and
 * whose bots already run Full (a bot or a thread on Full, with its owner's
 * consent) keeps it: the caller writes `allowFullAccess: true`. Any saved
 * value, true or false, is left alone. */
export function orgFullAccessGrandfathered(
  organization: { allowFullAccess?: unknown } | undefined,
  bots: readonly FullAccessHolder[],
): boolean {
  if (organization?.allowFullAccess !== undefined) return false;
  return bots.some((bot) => parseFullAccessConsent(bot.fullAccessConsent) !== null &&
    (bot.approvalMode === "full" || (bot.tasks ?? []).some((task) => task.approvalMode === "full")));
}

/** The approval level a new bot starts on, on an organization server.
 * 2026-10-27 (#1098): Approve for me, as on a solo server, the person's
 * bot working in the person's own environment. Only an explicit Ask the
 * organization chose as its New bot default (`defaults.approvalMode`,
 * `newBotDefaults.profile.approvalMode`) starts on Ask. Full and Custom need
 * the owner's own confirmation for that bot, which a bot that does not exist
 * yet cannot have, so they start on Approve for me. */
export function orgNewBotApprovalMode(policy: unknown): "ask" | "auto" {
  return policy === "ask" ? "ask" : "auto";
}

export function parseFullAccessConsent(value: unknown): FullAccessConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { principalId, at } = value as Record<string, unknown>;
  if (typeof principalId !== "string" || !principalId.trim() || typeof at !== "number" || !Number.isFinite(at)) return null;
  return { principalId: principalId.trim().toLowerCase(), at };
}

/** Whether a principal already confirmed Full access for this bot. */
export function fullAccessConsentedBy(consent: unknown, principalId: string | null | undefined): boolean {
  const parsed = parseFullAccessConsent(consent);
  return Boolean(parsed && principalId && parsed.principalId === principalId.trim().toLowerCase());
}

/** Why an HTTP request may not turn Full access on for a bot on an
 * organization server, or null when it may. */
export function orgFullAccessGrantRefusal(input: {
  policyAllowed: boolean;
  /** The signed-in person asking; null for loopback, a service or a bot. */
  callerPrincipalId: string | null;
  ownerPrincipalId: string;
  confirmed: boolean;
  consent: unknown;
}): FullAccessRefusal | null {
  if (!input.policyAllowed) return ORG_FULL_ACCESS_DISABLED;
  const caller = input.callerPrincipalId?.trim().toLowerCase();
  if (!caller || caller !== input.ownerPrincipalId.trim().toLowerCase()) return FULL_ACCESS_OWNER_ONLY;
  if (!input.confirmed && !fullAccessConsentedBy(input.consent, caller)) return FULL_ACCESS_CONFIRM_REQUIRED;
  return null;
}

/** #1098 (2026-10-28): Full access asked through the desktop app's trusted
 * channel (the app confirms the warning itself) for a member's bot of an
 * organization follows the HTTP route's rule (orgFullAccessGrantRefusal):
 * the bot's owner, who is this desktop's person, turns it on; anyone else
 * is refused. `mayFullAccess`: the person holds bots.fullAccess (or is an
 * admin). Null: allowed, and the grant records the owner's consent. */
export function trustedChannelFullRefusal(input: {
  policyAllowed: boolean;
  localPrincipalId: string | null;
  ownerPrincipalId: string;
  mayFullAccess: boolean;
}): FullAccessRefusal | null {
  if (!input.mayFullAccess) return FULL_ACCESS_OWNER_ONLY;
  return orgFullAccessGrantRefusal({
    policyAllowed: input.policyAllowed,
    callerPrincipalId: input.localPrincipalId,
    ownerPrincipalId: input.ownerPrincipalId,
    confirmed: true,
    consent: undefined,
  });
}

/** 2026-10-27 (#1098): whether a new conversation may open on Full access
 * for this bot: its owner, who already confirmed Full access for this bot
 * (`fullAccessConsent`), asks, from any of their apps. On an organization
 * server the signed-in owner (orgFullAccessGrantRefusal with no new
 * confirmation); on a solo server the operator (`soloOwner`: this computer
 * or one of their admin devices), once the desktop app confirmed it for this
 * bot. Anyone else, or a bot never confirmed, keeps the old answer. */
export function newConversationFullAllowed(input: {
  identity: "solo" | "perspicax";
  /** Organization: the signed-in person asking, null for anyone else. */
  callerPrincipalId: string | null;
  ownerPrincipalId: string;
  /** Solo: the caller is the operator (loopback, or an admin session). */
  soloOwner: boolean;
  /** Solo: the operator's own principal, who confirms in the desktop app. */
  localPrincipalId: string;
  consent: unknown;
}): boolean {
  if (input.identity === "perspicax") {
    return orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: input.callerPrincipalId, ownerPrincipalId: input.ownerPrincipalId, confirmed: false, consent: input.consent }) === null;
  }
  return input.soloOwner && fullAccessConsentedBy(input.consent, input.localPrincipalId);
}

/** Whether a stored Full runs as Full for one turn on an organization
 * server: the policy is on and the bot's current owner confirmed it. */
export function orgFullAccessHolds(input: { policyAllowed: boolean; ownerPrincipalId: string; consent: unknown }): boolean {
  return input.policyAllowed && fullAccessConsentedBy(input.consent, input.ownerPrincipalId);
}

const FULL_BODY_ERROR = "send { approvalMode: \"full\", confirmFullAccess } alone";

/** The Full grant body on an organization server. `threadId` names the open
 * conversation (audited; every thread follows the bot's level). Anything
 * else riding along is refused. */
export function parseOrgFullAccessBody(body: Record<string, unknown>): { confirm: boolean; threadId?: string } | { error: string } {
  // applyToAllThreads (older apps): every thread follows its bot's level now
  // (#1169), so it changes nothing and is accepted.
  const extra = Object.keys(body).filter((key) => key !== "approvalMode" && key !== "confirmFullAccess" && key !== "threadId" && key !== "applyToAllThreads");
  if (body.applyToAllThreads !== undefined && typeof body.applyToAllThreads !== "boolean") return { error: FULL_BODY_ERROR };
  if (body.approvalMode !== "full" || extra.length) return { error: FULL_BODY_ERROR };
  if (body.confirmFullAccess !== undefined && typeof body.confirmFullAccess !== "boolean") return { error: FULL_BODY_ERROR };
  if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]{1,128}$/.test(body.threadId))) return { error: FULL_BODY_ERROR };
  return {
    confirm: body.confirmFullAccess === true,
    ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
  };
}

/** The open conversation follows the bot's Full grant. A missing thread is
 * left alone. A busy one keeps the level it started the turn with. */
export function threadFollowsFullGrant(input: { threadId?: string; knownThread: boolean; threadBusy: boolean }): string | null {
  if (!input.threadId || !input.knownThread || input.threadBusy) return null;
  return input.threadId;
}
