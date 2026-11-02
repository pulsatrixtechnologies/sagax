// What the harness does with a provider's permission request.
//
// Nothing here decides whether an action is safe. Each approval level is a
// provider's own permission mode passed straight through (Grok
// `--permission-mode`, Codex `approvalsReviewer`, …; Claude's Auto since
// 2026-10-19 is Auto-accept edits plus a fixed allowlist, never the CLI's
// silent classifier: drivers/claude.ts claudeAutoAllowedTools), and a request that
// reaches this process is one the provider left for a person. The grants the
// app applies are Full access and the person's exact saved commands. Approve
// for me also allows a web search, and that is the one action the app itself
// grants. Questions never come through here: a bot's question always reaches
// a human.

import { supportsApprovalMode, type ApprovalMode } from "../shared/approval-mode.ts";
import { outboundMailNeedsDraftCard } from "../shared/email-draft-send.ts";
import { isOutboundTool } from "../shared/outbound.ts";
import type { ProviderAdapter, RequestOutcome } from "./contracts.ts";
import { standingGrantsAllowed } from "./custom-rules-org.ts";

/** A failed delivery is a runtime error, not another permission decision.
 * An expired ask must never become a fresh Allow/Deny card. */
export async function deliverFullAccessApproval(
  adapter: Pick<ProviderAdapter, "respondToRequest" | "interruptTurn"> | undefined,
  threadId: string,
  requestId: string,
  turnId?: string,
  isCurrent: () => boolean = () => false,
): Promise<RequestOutcome | "failed"> {
  if (!adapter) return "failed";
  try {
    return await adapter.respondToRequest(threadId, requestId, { behavior: "allow" });
  } catch {
    // Some adapters ignore the optional native turn id. Recheck the
    // server's owning generation before interrupting that thread.
    if (turnId && isCurrent()) await adapter.interruptTurn(threadId, turnId).catch(() => {});
    return "failed";
  }
}

/** Full access is the person's explicit grant to this receiving bot, including
 * delegated work. It never inherits the sender's mode or elevates another bot
 * — with the one exception below (delegatedApprovalMode), applied
 * where a Primary Bot's delegated thread is created rather than here.
 * Custom is a provider-config choice rather than an app Full-access grant, so
 * peer-started Custom turns use Auto. Provider support and grant confirmation
 * are checked by the caller. */
export function approvalModeForOrigin(mode: ApprovalMode, origin: { peerInitiated: boolean }): ApprovalMode {
  if (mode === "custom" && origin.peerInitiated) return "auto";
  return mode;
}

/** Levels by how much runs without asking. Custom is a provider config of
 * its own and is never compared. */
const LEVEL_RANK: Partial<Record<ApprovalMode, number>> = { ask: 0, edits: 1, auto: 2, full: 3 };

/** The level work a bot hands to a teammate starts at, or null to keep the
 * teammate's own. A Primary Bot's level flows down: the person set it on
 * the Primary Bot so the team's work runs that way, and switching every
 * thread it opens with a teammate back off "Ask for approval" was the
 * friction people reported. Only a Primary Bot passes its level on, only the
 * level of the conversation it delegates from, and only upward: a teammate
 * already on a higher level keeps it, and one on Custom keeps its own config.
 * The level is capped at what the teammate's engine implements (Full or
 * Auto-accept edits are not everywhere), stepping down to the next level it
 * has, and a bot a member owns on an organization server never gets Full.
 * A bot never raises itself this way. */
export function delegatedApprovalMode(input: {
  senderIsChief: boolean;
  /** The Chief's level in the conversation it is delegating from. */
  senderMode: ApprovalMode;
  sameBot: boolean;
  /** The teammate's own level for the thread the work runs in. */
  recipientMode: ApprovalMode;
  recipientDriverKind: string | undefined;
  /** The recipient is a bot a member owns on an organization server: it never
   * runs with Full access (rule until per-owner containers), whoever
   * delegates to it; a Full Primary Bot's level steps down past Full. */
  recipientMemberOwned?: boolean;
}): ApprovalMode | null {
  if (!input.senderIsChief || input.sameBot) return null;
  // A Primary Bot's Custom config is its own; for a teammate it reads as
  // Approve for me, as for any peer-started Custom turn (approvalModeForOrigin).
  const sender = LEVEL_RANK[approvalModeForOrigin(input.senderMode, { peerInitiated: true })] ?? 0;
  const own = LEVEL_RANK[input.recipientMode];
  if (own === undefined) return null;
  for (const mode of ["full", "auto", "edits"] as const) {
    const rank = LEVEL_RANK[mode]!;
    if (rank > sender) continue;
    if (rank <= own) return null;
    if (mode === "full" && input.recipientMemberOwned) continue;
    if (supportsApprovalMode(input.recipientDriverKind, mode)) return mode;
  }
  return null;
}

/** Whether work a bot hands to a teammate runs with Full access: the Full
 * case of delegatedApprovalMode, kept for callers that only ask about Full.
 * Only a Primary Bot passes access on, only the Full access the person gave
 * it for the conversation it is delegating from, never to a bot a member
 * owns on an organization server, and only to an engine that implements
 * Full. A bot never elevates itself this way. */
export function delegationInheritsFullAccess(input: {
  senderIsChief: boolean;
  senderHasFullAccess: boolean;
  sameBot: boolean;
  recipientDriverKind: string | undefined;
  recipientMemberOwned: boolean;
}): boolean {
  return input.senderIsChief && input.senderHasFullAccess && !input.sameBot && !input.recipientMemberOwned
    && supportsApprovalMode(input.recipientDriverKind, "full");
}

// Tools that ask a PERSON something. A question exists so that a human
// decides; any mode answering one on their behalf defeats the only reason
// it was asked. They normally arrive typed as questions and never reach a
// verdict at all — this is the backstop for the path where one arrives
// mis-typed as a permission (a malformed AskUserQuestion call falls back to
// the permission path in permission-proxy). Approving it there does not
// produce an answer: the CLI runs the tool with none and the model is told
// "The user did not answer the questions." — a question silently lost.
const ASKS_A_PERSON = new Set(["askuserquestion", "ask_user"]);

// A web search is a low-level read. Approve for me allows these names and
// nothing wider: a bare search, a page fetch, and every other tool stay a
// prompt. The name is the same shape as a question — one mcp__<server>__
// prefix removed, then compared case-insensitively.
const WEB_SEARCH = new Set(["websearch", "web_search", "web-search", "search_web"]);

function bareToolName(tool: string): string {
  return tool.replace(/^mcp__[^_]+__/, "").toLowerCase();
}

/** Why a permission request landed where it did — the decision log's "which
 * rule". `full-access` and `command-allowlist` are explicit user grants;
 * `web-search` is the one action Approve for me grants itself;
 * `native-approval` is a card the provider's own reviewer (Auto, or Custom's
 * config) left for the person; `explicit-approval-block` is a sandbox
 * widening only Full may answer; `no-grant` is an Ask or Edits card, where
 * asking is the whole point. */
export type AutoVerdictSource =
  | "full-access"
  | "command-allowlist"
  | "web-search"
  | "native-approval"
  | "explicit-approval-block"
  | "outbound-guard"
  /** Unrequested outbound mail: write a draft card; do not send directly. */
  | "email-draft-required"
  | "allow-rule"
  | "safety-hold"
  | "safety-read"
  | "widget-approval"
  /** 2026-10-14 (bot owner permissions): the owner's own rule, the bot's
   * automatic approval mode, its bypass mode, or a Deny rule. */
  | "owner-rule"
  | "owner-auto"
  | "owner-bypass"
  | "owner-rule-deny"
  /** 2026-10-26 (one approval level): the owner's ask rule kept the card
   * the level would have answered. */
  | "owner-rule-ask"
  /** 2026-10-19 ("Toujours permettre" on every card): an allow rule an
   * organization admin (or a holder of host.commands, for their own bot)
   * saved on an admin card of a member's bot; checked again at each use. */
  | "admin-rule"
  /** 2026-10-16 (custom auto-review rules, shared/custom-rules.ts): the
   * person's own words allowed it, held it for a card, or refused it. */
  | "custom-rule"
  | "custom-rule-ask"
  | "custom-rule-deny"
  /** The person allowed this exact email draft on its approval card
   * (server/email-draft-send.ts): one send, these recipients and subject. */
  | "email-draft-approval"
  /** 2026-10-16: one of Sagax's own person-scoped tools
   * (server/sagax-internal-tools.ts: Data, the agents tools in the bot's own
   * scope), which never ask. */
  | "sagax-internal"
  /** 2026-10-16: a tool of the bot owner's own isolated environment (their
   * server environment, their Local VM), server/member-environment.ts. */
  | "own-environment"
  | "own-attachment"
  | "own-computer-choice"
  /** 2026-10-19 (owner setup, server/owner-autonomy.ts): a Perspicax read
   * on Sagax's own mount at a level that runs work unasked, and a
   * coordination lease (claim, claim_renew, claim_release) at any level. */
  | "perspicax-read"
  | "perspicax-lease"
  | "own-read-only"
  /** 2026-10-21 (parité 1C): a message send whose every recipient is on the
   * bot's allowed recipients (shared/allowed-recipients.ts). */
  | "allowed-recipient"
  | "reach-me"
  /** 2026-10-30: a read of the person's own engine account connector (their
   * grok.com Outlook, Teams, calendar...), at any level. */
  | "connector-read"
  | "no-grant";

export interface AutoVerdict {
  /** Chip text when the app answers for the person, null when a human
   * decides. The string becomes the chip in the transcript, so an
   * auto-approved action is never invisible. */
  approve: string | null;
  source: AutoVerdictSource;
}

export function autoVerdict(
  mode: ApprovalMode,
  tool: string,
  context?: {
    /** The provider is asking to widen its configured sandbox rather than
     * perform one ordinary action. Only explicit Full may synthesize this. */
    requiresExplicitApproval?: boolean;
    /** Exact bot/provider/folder/command match against the person's saved rules. */
    commandAllowed?: boolean;
    /** A Sagax approval-gate card: the broker runs the call only on a
     * person's allow, so an automatic answer would silently decline it. */
    sagaxGate?: boolean;
    /** The person saved an Allow rule for this exact gated MCP tool
     * (BotRecord.alwaysAllow "mcp:<server>__<tool>"). */
    ruleAllowed?: boolean;
    /** Safety review: the person must accept this call. Full and Auto do not. */
    safetyHold?: boolean;
    /** Safety review: a read-only call may run without a card. */
    safetyAllow?: boolean;
    /** The person allowed this exact ConnectWise change on a widget's
     * approval card (server/cw-widget-actions.ts): one write, one record. */
    widgetApproved?: boolean;
    /** The person's custom rule that decided this call
     * (shared/custom-rules.ts evaluateCustomRules, risk scope already
     * checked). A deny is refused by the caller before any card. */
    customRule?: { behavior: "allow" | "ask" | "deny"; id: string };
    /** The person allowed this exact email draft on its own card. */
    emailDraftApproved?: boolean;
    /** This outbound mail send was asked for by the person in their own
     * turn: usual approval level applies. Absent or false: force a draft
     * card. */
    personAskedMail?: boolean;
    ownerTurn?: boolean;
    /** One of Sagax's own person-scoped tools (sagax-internal-tools.ts):
     * approved after a safety hold, the person's rules and the outbound
     * guard had their say, never for a sandbox widening or a gate card. */
    sagaxInternal?: boolean;
    /** The call acts in the bot owner's own isolated environment, the
     * organization allows it and the turn is the owner's own
     * (server/member-environment.ts ownEnvironmentAutonomy). Answered only
     * at Auto or Auto-accept edits, never at Ask. */
    ownEnvironment?: boolean;
    /** 2026-10-19: a read of the person's own attachments in their own
     * destination, from the owner's own turn
     * (member-environment.ts ownAttachmentRead). Answered at any level,
     * after the safety hold and the person's own rules, never when a
     * security key protects it. */
    ownAttachmentRead?: boolean;
    /** 2026-10-19 (#810 follow-up): Sagax's own computer_select choosing
     * among the places of the person this turn is for
     * (member-environment.ts ownComputerChoiceCall). The bot decides where it
     * works: answered at any level, after the safety hold and the person's
     * own rules, never when a security key protects it. */
    ownComputerChoice?: boolean;
    /** 2026-10-20: a command that only reads (shared/read-only-command.ts)
     * on the person's own computer (their PC, its Local VM, their cloud
     * computer). Answered at any level and from any turn, after the safety
     * hold and the person's own rules, never when a security key protects it. */
    ownReadOnlyCommand?: boolean;
    /** 2026-10-19 (owner setup, server/owner-autonomy.ts): a Perspicax read
     * or lease on Sagax's own mount that the caller found applies at this
     * level (perspicaxSelfAnswerAt). Answered after the safety hold and the
     * person's own rules, never for a send, a sandbox widening or a call a
     * security key protects. */
    perspicaxSelf?: "read" | "lease";
    /** The engine's own `<server>__<tool>` name when `tool` is a kind (ACP
     * "other") or a bare name: what the outbound guard reads for Sagax's own
     * tools and the owner's environment. */
    toolName?: string;
    /** The security key classes (shared/step-up.ts) the bot owner (or the
     * person the turn speaks for) chose that this call falls in. Non-empty:
     * no automatic answer from Sagax's own tools or the owner's environment,
     * the card shows and its Allow needs the key (#648). */
    stepUpRequired?: readonly string[];
    /** 2026-10-21 (parité 1C): a message send (an email, a text) whose
     * every recipient is on the bot's allowed recipients
     * (sendRecipientsAllowed). Answered at any level after the safety hold
     * and the person's own rules, never for a sandbox widening, a call a
     * security key protects, or while standing grants are off. */
    recipientsAllowed?: boolean;
    /** 2026-10-26 "Me joindre": the one call of a "Reach me (Teams)" run
     * the person chose as their channel (server/reach-me/teams.ts
     * answersConnectorCall): the send of the card's message to their own
     * Teams chat, or a read of their own connector for the reply. Answered
     * after the safety hold and the person's own rules, never for a call a
     * security key protects or one that needs an explicit approval. */
    reachMeSelf?: boolean;
    /** The engine's driver read the ask as outward-facing (an engine
     * connector call that is not plainly a read, review of #943): held by
     * the outbound guard like a send, never answered as read-only. */
    outbound?: boolean;
    /** 2026-10-30 (the operator: reads pass with no card, writes keep it): a
     * call to one of the cloud connectors of the person's own engine account
     * (Grok's managed gateway, the person's own grok.com sign-in) that the
     * driver read as a plain read (connector-ask.ts, never outward).
     * Answered at any level after the safety hold and the person's own deny
     * and ask rules, never a widening or a call a security key protects. */
    connectorRead?: boolean;
    /** The call is one of Sagax's own tools that must never answer itself:
     * a rule change (rules_update and the like, "rule-change" class). */
    ruleChange?: boolean;
    /** 2026-10-27 (#1098): the call runs in the person's own sandbox (their
     * cloud computer, their Local VM): the organization's "Toujours
     * permettre" switch does not take their standing grants away there. */
    ownSandbox?: boolean;
  },
): AutoVerdict {
  // A question is for a person, whatever channel it arrived on — and
  // whatever the mode: even Full has no answer to give, only an approval
  // that would run the tool with none.
  if (ASKS_A_PERSON.has(bareToolName(tool))) {
    return { approve: null, source: "no-grant" };
  }
  // A safety hold is an explicit accept. It is checked before Full, before a
  // saved Allow rule, and before a gate, so none of those answer it.
  if (context?.safetyHold) return { approve: null, source: "safety-hold" };
  // 2026-10-21 (server/custom-rules-org.ts): while the organization turned
  // "Toujours permettre" off, no standing grant answers (a saved Allow rule
  // of a gate, a saved command, an allow rule in the person's words); each
  // call is approved on its card.
  if (context && !standingGrantsAllowed({ ownSandbox: context.ownSandbox === true }) && (context.ruleAllowed || context.commandAllowed || context.customRule?.behavior === "allow" || context.recipientsAllowed)) {
    context = {
      ...context,
      ruleAllowed: false,
      commandAllowed: false,
      recipientsAllowed: false,
      ...(context.customRule?.behavior === "allow" ? { customRule: undefined } : {}),
    };
  }
  // An organization admin's Refuse rule (server/custom-rules-org.ts) is
  // mandatory: even a draft the person approved is refused.
  if (context?.customRule?.behavior === "deny" && context.customRule.id.startsWith("orule_")) return { approve: null, source: "custom-rule-deny" };
  // A send the person approved on the draft's own card is that person's
  // answer, not a rule: it is not held again by an "ask me" rule.
  if (context?.emailDraftApproved) return { approve: `approved ${tool} (your approved email draft)`, source: "email-draft-approval" };
  // The person's own words win over every grant: a deny refuses, an ask
  // keeps the card even under Full access or a saved command.
  if (context?.customRule?.behavior === "deny") return { approve: null, source: "custom-rule-deny" };
  if (context?.customRule?.behavior === "ask") return { approve: null, source: "custom-rule-ask" };
  const outward = isOutboundTool(tool) || context?.outbound === true || (context?.toolName !== undefined && isOutboundTool(context.toolName));
  if (context?.safetyAllow && !outward) return { approve: `approved ${tool} (read-only)`, source: "safety-read" };
  if (context?.connectorRead && !outward && !context.requiresExplicitApproval && !(context.stepUpRequired?.length)) {
    return { approve: `approved ${tool} (read of your own connector)`, source: "connector-read" };
  }
  if (context?.widgetApproved) return { approve: `approved ${tool} (approved in the ConnectWise widget)`, source: "widget-approval" };
  // An allow rule never answers a sandbox widening (only Full may), and its
  // risk scope was checked against the call before it got here.
  if (context?.customRule?.behavior === "allow" && !context.requiresExplicitApproval) {
    return { approve: `approved ${tool} (your rule)`, source: "custom-rule" };
  }
  // The bot's allowed recipients (2026-10-21: « dans la liste = part sans
  // carte »): the send is to people the person named ahead of time. It
  // answers the outbound guard and a gate card alike, never a widening or a
  // class the person protects with a security key.
  if (context?.recipientsAllowed && !context.requiresExplicitApproval && !(context.stepUpRequired?.length)) {
    return { approve: `approved ${tool} (allowed recipients)`, source: "allowed-recipient" };
  }
  if (context?.reachMeSelf && !context.requiresExplicitApproval && !(context.stepUpRequired?.length)) {
    return { approve: `approved ${tool} (Reach me: your own Teams chat)`, source: "reach-me" };
  }
  // Sagax's own person-scoped tools (sagax-internal-tools.ts, a reviewed
  // list of exact names) and the owner's own environment answer only after
  // the grant guard, the safety review and the person's own rules above,
  // and never: a sandbox widening, a send (send_to_bot, post_to_room,
  // send_voice_note keep the outbound guard), a call in a class the person
  // protects with a security key (the card then needs the key), or a rule
  // change. A Grok gate card is answered too: the gate holds these calls and
  // routes them here (grok-approval-gate.ts), so the same rules apply.
  const sendsOut = outward;
  const selfAnswerable = !context?.requiresExplicitApproval && !sendsOut && !(context?.stepUpRequired?.length);
  if (context?.sagaxInternal && selfAnswerable && !context.ruleChange) {
    return { approve: `approved ${tool} (Sagax tool)`, source: "sagax-internal" };
  }
  if (context?.ownAttachmentRead && selfAnswerable) {
    return { approve: `approved ${tool} (your own attachment)`, source: "own-attachment" };
  }
  if (context?.ownReadOnlyCommand && selfAnswerable) {
    return { approve: `approved ${tool} (read-only command on your own computer)`, source: "own-read-only" };
  }
  if (context?.ownComputerChoice && selfAnswerable) {
    return { approve: `approved ${tool} (choosing among your own computers)`, source: "own-computer-choice" };
  }
  if (context?.perspicaxSelf === "lease" && selfAnswerable) {
    return { approve: `approved ${tool} (coordination lease)`, source: "perspicax-lease" };
  }
  if (context?.perspicaxSelf === "read" && selfAnswerable) {
    return { approve: `approved ${tool} (read-only)`, source: "perspicax-read" };
  }
  // The owner's own environment: only at a level that already runs work
  // unasked (Auto, Auto-accept edits). At Ask the person asked to see every
  // call, so the card shows (and a key protects it when they chose one).
  if (context?.ownEnvironment && selfAnswerable && (mode === "auto" || mode === "edits")) {
    return { approve: `approved ${tool} (your own environment)`, source: "own-environment" };
  }
  // Full's promise is literal: even a sandbox widening is approved. Entering
  // Full is separately consent-gated by the bot PATCH endpoint, and the
  // request.opened caller invokes this for permissions only, never questions.
  if (context?.sagaxGate && context.ruleAllowed) return { approve: `approved ${tool} (your Allow rule)`, source: "allow-rule" };
  if (mode === "full" && !(context?.sagaxGate && context.stepUpRequired?.length)) return { approve: `approved ${tool} (full access)`, source: "full-access" };
  if (context?.sagaxGate) return { approve: null, source: mode === "auto" || mode === "custom" ? "native-approval" : "no-grant" };
  if (context?.requiresExplicitApproval) return { approve: null, source: "explicit-approval-block" };
  // Unrequested outbound mail (routine / proactive / other bot): refuse the
  // direct send so the bot writes a draft card. Person-asked mail in the
  // owner's turn follows the usual approval level below.
  if (sendsOut && isMailSendName(tool, context?.toolName) && outboundMailNeedsDraftCard({
    personAsked: context?.personAskedMail === true,
    ownerTurn: context?.ownerTurn === true,
  })) {
    return { approve: null, source: "email-draft-required" };
  }
  if (isOutboundTool(tool) || context?.outbound === true || ((context?.sagaxInternal || context?.ownEnvironment) && sendsOut)) {
    // Person-asked mail in the owner's own turn: skip the blanket outbound
    // hold so Ask / Auto / Full apply as usual.
    if (!(sendsOut && isMailSendName(tool, context?.toolName) && context?.personAskedMail === true && context?.ownerTurn === true)) {
      return { approve: null, source: "outbound-guard" };
    }
  }
  if (context?.commandAllowed) return { approve: `approved ${tool} (saved command)`, source: "command-allowlist" };
  // The one action the app itself grants. A fetch of an arbitrary URL is not
  // a search and stays a prompt, in this mode and every other.
  if (mode === "auto" && WEB_SEARCH.has(bareToolName(tool))) {
    return { approve: `approved ${tool} (web search)`, source: "web-search" };
  }
  if (mode === "auto" || mode === "custom") return { approve: null, source: "native-approval" };
  return { approve: null, source: "no-grant" };
}

/** Every fixed note a held card can show, by catalog key.
 *
 * The card is the last thing between a bot and someone's filesystem, so the
 * one line explaining why it stopped should not be the one line still in
 * English. The client translates by key and falls back to this text, which
 * the server keeps sending: cards saved before the key existed still render,
 * and so do the free-text apply errors that have no key at all. */
/** Whether this tool name is an email send (not creating a provider draft,
 * and not a chat / SMS / Teams post). */
function isMailSendName(tool: string, alias?: string): boolean {
  const names = [tool, alias].filter((value): value is string => typeof value === "string" && value.length > 0);
  return names.some((name) => {
    const tokens = bareToolName(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.includes("draft") || tokens.includes("drafts")) return false;
    if (tokens.some((token) => ["chat", "sms", "teams", "slack", "tweet", "dm"].includes(token))) return false;
    if (!tokens.includes("send") && !tokens.includes("sends")) return false;
    return tokens.some((token) => token === "email" || token === "mail")
      || /(?:^|[_\-.])(?:gmail|outlook|graph)(?:[_\-.]|$)/i.test(name);
  });
}

export const HELD_NOTE = {
  "approval.held.outbound": "This sends something on your behalf, so it always asks first.",
  "approval.held.emailDraft": "Write this email as a draft card for the person to approve. Do not send it directly.",
  "approval.held.native": "The provider requires your approval for this action.",
  "approval.held.sandbox":
    "This changes the provider sandbox, so only Full access can approve it automatically.",
  "approval.held.undeliveredFull": "Full access couldn't deliver this approval.",
  "approval.held.undelivered": "Approve for me couldn't answer this one.",
  "approval.held.customRule": "Your rule asks you first for this.",
  "approval.held.connectorNoDetails": "Grok did not share this call's details. Allow it only if you asked for it.",
} as const;

export type HeldNoteKey = keyof typeof HELD_NOTE;

/** Which note, as a key. approvalHeldReason is this plus the English text, so
 * the branching that decides the note lives in exactly one place. */
export function approvalHeldNote(context: {
  source?: AutoVerdictSource;
  /** Questions are not permissions and are never held for a mode reason. */
  permission: boolean;
}): HeldNoteKey | undefined {
  if (!context.permission) return undefined;
  if (context.source === "email-draft-required") return "approval.held.emailDraft";
  if (context.source === "outbound-guard") return "approval.held.outbound";
  if (context.source === "safety-hold") return "approval.held.native";
  if (context.source === "custom-rule-ask" || context.source === "owner-rule-ask") return "approval.held.customRule";
  if (context.source === "explicit-approval-block") return "approval.held.sandbox";
  if (context.source === "native-approval") return "approval.held.native";
  return undefined;
}

/** The note a card shows above its buttons, explaining why the bot stopped
 * rather than answering for itself. */
export function approvalHeldReason(context: {
  source?: AutoVerdictSource;
  permission: boolean;
}): string | undefined {
  const key = approvalHeldNote(context);
  return key && HELD_NOTE[key];
}
