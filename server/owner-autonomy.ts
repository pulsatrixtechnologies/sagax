// A bot owner's own setup runs like it did on Grok Bot (JC, 2026-10-19).
//
// Since #797, Approve for me on Claude is Auto-accept edits plus a short
// allowlist: every other call reaches Sagax as a card. Sagax then answered
// only what an owner had set up by hand (an owner mode "auto" or a rule), so
// a bot at Approve for me asked about every read of ConnectWise, every
// `memory_recall`, every GitHub `get_me` and every command in the owner's
// own cloud computer as soon as a teammate had handed it the work. Prod GOX,
// 6 hours after 0.5.27: 104 cards for JC's own bots, 98 of them answered
// Allow by JC, the one he left expired a dispatch lease (claim) and stopped
// a routine. The Chief, whose owner mode was "auto", had none.
//
// Three rules, all bounded to the owner's own work. None of them answers an
// admin card, a guest's turn, a call in someone else's destination, a safety
// hold, a sandbox widening, a call a security key protects, a person's ask or
// deny rule, or a send: those stay where they are (auto-approve.ts,
// owner-approval.ts, index.ts request.opened).
//
// 1. Approve for me means approve for me. At Approve for me (or Full
//    access), the owner's mode "approval" reads as "auto" for the owner's
//    own work: what no rule covers runs, except a destructive call (a
//    delete, a bulk change, an external email or SMS), which keeps its card
//    (ownerDecision). An organization that turned automatic levels off for
//    members' bots keeps them off (the caller checks it).
// 2. Owner lineage. A teammate's hop or the bot's own scheduled or manual
//    routine is the owner's own work when every link of it is: the owner's
//    own bots, started by the owner's own words (or the routine they wrote),
//    never by a webhook, an email, another person or an unknown source.
//    Such a turn counts as the owner's own for their cloud computer too,
//    which it did not before: one bot asked 32 times in a row to run a
//    command in its owner's own cloud computer because the owner's Primary
//    Bot had handed it the work.
// 3. Perspicax reads and leases. A Perspicax tool that only reads (the
//    reviewed list Grok already skips its classifier for, plus the reads of
//    the same surface) runs unasked at any level that already runs work
//    unasked; a coordination lease (claim, claim_renew, claim_release) is
//    never a card: it exists so that two runs do not write the same record,
//    and a routine whose lease waited on a person stopped (prod 2026-10-19).
//    Recognized only on Sagax's own Perspicax mount (`perspicax_*`, names
//    reserved for Sagax, mcp-registry.ts) and never when another server of
//    the turn could have spelled the name.
import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { BotPermissionMode } from "./owner-approval.ts";
import type { TurnSpeaker } from "./engine-access.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "./drivers/acp/grok-read-only-tools.ts";

/** Whose work a turn is, for the owner's own setup: "owner" when the owner
 * (signed in as themselves) wrote it, or when every hop leads back to the owner's own words or the
 * owner's own scheduled or manual routine through the owner's own bots. */
export function ownerLineageOrigin(input: {
  speaker: TurnSpeaker | undefined;
  ownerPrincipalId: string;
  /** The owner of the bot a peer hop comes from, when that bot exists. */
  peerFromOwner?: string;
  /** What started the turn when it was an automation: a routine's trigger
   * ("schedule", "manual", "webhook") or another source. */
  automation?: string;
  /** A turn from a webhook is never the owner's own words. */
  unattended?: boolean;
}): "owner" | "other" {
  const owner = input.ownerPrincipalId.trim().toLowerCase();
  if (!owner) return "other";
  const same = (id: string | undefined) => Boolean(id) && id!.trim().toLowerCase() === owner;
  if (input.automation !== undefined && input.automation !== "schedule" && input.automation !== "manual") return "other";
  const speaker = input.speaker;
  if (!speaker) return "other";
  switch (speaker.origin) {
    // The operator at this machine is not a person the bot's owner is known
    // to be (a shared workspace's loopback): their cards keep the owner's
    // own mode.
    case "operator": return "other";
    case "person": return same(speaker.principalId) && !input.unattended ? "owner" : "other";
    // Only a routine whose trigger is known to be its schedule or a manual run.
    case "owner-routine": return (input.automation === "schedule" || input.automation === "manual")
      && (speaker.principalId === undefined || same(speaker.principalId)) ? "owner" : "other";
    case "peer":
      // A hop from a routine may carry what a webhook brought in: only a hop
      // from the owner's own words counts.
      if (speaker.routine) return "other";
      return same(input.peerFromOwner) && same(speaker.principalId) && !input.unattended ? "owner" : "other";
  }
  return "other";
}

/** The owner mode Sagax applies to one card of the owner route (rule 1). */
export function ownerModeForTurn(input: {
  /** The owner's own mode for this bot (owner-approval.ts). */
  ownerMode: BotPermissionMode;
  /** The bot's approval level for this turn. */
  approvalMode: ApprovalMode;
  lineage: "owner" | "other";
  /** False when an admin turned automatic levels off for members' bots and
   * this bot is a member's. */
  autoAllowed: boolean;
}): BotPermissionMode {
  if (input.ownerMode !== "approval") return input.ownerMode;
  if (!input.autoAllowed || input.lineage !== "owner") return input.ownerMode;
  return input.approvalMode === "auto" || input.approvalMode === "full" ? "auto" : input.ownerMode;
}

/** Reads of the Perspicax surface beyond the reviewed Grok list: the
 * catalog, the identity lookup, the agents directory and transcripts, the
 * lease list, and ConnectWise's named finds and gets. */
const PERSPICAX_EXTRA_READS: ReadonlySet<string> = new Set([
  "api_list", "identity", "list_agents", "find_agents", "get_agent",
  "read_transcript", "read_transcript_cold", "read_transcript_page", "read_latest_page", "read_latest_page_with_threads",
  "list_pending_approvals", "claim_list",
  "cw_psa__get_ticket",
]);

/** The connectors whose generic read (`<api>__query`) holds no credential
 * field: ConnectWise (already reviewed, cw_psa__query) and BookStack. The
 * other connectors (one of them returns an account's token) keep the
 * owner's own mode (rule 1) or their card. */
const CONNECTOR_QUERY = /^(?:cw_psa|bookstack)__query$/;
/** ConnectWise's named finds (cw_psa__find_tickets, ...). */
const CW_FIND = /^cw_psa__find_[a-z0-9_]+$/;

/** Coordination leases: they keep two runs off one record. */
const PERSPICAX_LEASES: ReadonlySet<string> = new Set(["claim", "claim_renew", "claim_release"]);

/** The Perspicax tool a provider's name designates on Sagax's own mount, or
 * null: `mcp__perspicax_<slug>__<tool>` (Claude) or `perspicax_<slug>__<tool>`. */
function perspicaxTool(name: string | undefined): string | null {
  // the slug never holds `__`, so the tool is everything after the first `__`
  const match = /^(?:mcp__)?(perspicax_[a-z0-9-]+(?:_[a-z0-9-]+)*)__([a-z0-9][a-z0-9_]{0,127})$/i.exec(name?.trim() ?? "");
  return match ? match[2]!.toLowerCase() : null;
}

export type PerspicaxSelfAnswer = "read" | "lease";

/** Whether Sagax answers a Perspicax call itself (rule 3), and why. The
 * caller has already checked that no other server of the turn could have
 * spelled the name (sagax-internal-tools.ts foreignToolSpelling). */
export function perspicaxSelfAnswer(name: string | undefined): PerspicaxSelfAnswer | null {
  const tool = perspicaxTool(name);
  if (!tool) return null;
  if (PERSPICAX_LEASES.has(tool)) return "lease";
  if (PERSPICAX_READ_ONLY_TOOLS.has(tool) || PERSPICAX_EXTRA_READS.has(tool) || CONNECTOR_QUERY.test(tool) || CW_FIND.test(tool)) return "read";
  return null;
}

/** Whether a Perspicax self-answer applies at this level: a lease at every
 * level; a read at a level that already runs work unasked (never Ask, where
 * the person asked to see every call). */
export function perspicaxSelfAnswerAt(kind: PerspicaxSelfAnswer, mode: ApprovalMode): boolean {
  if (kind === "lease") return true;
  return mode === "auto" || mode === "edits" || mode === "full";
}

/** What a command line names that holds a login, a key or a token: a
 * credential dot name, a credential folder under .config, a key file or a
 * process's secrets under /proc. */
/** A command line of a hop that reaches outside the work folders: any
 * hidden name (a token starting with a dot and a letter, whatever its
 * quoting: `.s'sh'`, `.config/g?`), the home folder walked or archived by a
 * search, copy or archive tool, or a process's environment. A denylist
 * cannot see every spelling, so it errs wide: such a line keeps its card. */
const COMMAND_HIDDEN = /(?:^|[\s/"'=@:(`])\.[A-Za-z_'"*?[]/;
const COMMAND_HOME_WALK = /\b(?:find|tar|zip|rsync|scp|cp|base64|xxd|od|strings|grep|cat|less|head|tail)\b[^|;&]*(?:~(?:\/|\s|$)|\$\{?HOME\}?|\/home\/|\/root\b|\/proc\/)/;
const COMMAND_CREDENTIAL = /(?:^|[\s"'=@:/])(?:\.(?:ssh|gnupg|aws|azure|kube|docker|netrc|npmrc|pypirc|git-credentials|password-store|vault-token|pgpass|env)\b|\.config\/(?:gh|gcloud|hub|git|op|rclone|doctl|helm)\b|[\w.-]+\.(?:pem|key|p12|pfx|kdbx)\b|id_(?:rsa|dsa|ecdsa|ed25519)\b|\/proc\/[^\s/]+\/(?:environ|cmdline|mem)\b|\b(?:printenv|env)\s*(?:$|[|;&>])|\bgh\s+auth\s+token\b|credential\s+fill\b)/i;

/** Rule 2's bound for the owner's own environment: a call a hop or a
 * routine of the owner's own lineage may run unasked. Only the server
 * environment (the owner's cloud computer; the Local VM on their own
 * computer keeps today's rule), and never a call that reaches a credential:
 * a read of a dotfile or a credential path (member-environment.ts
 * ownEnvironmentSensitiveRead), a command line that names one, or input that
 * cannot be read. Those keep their card, as the 2026-10-16 security review
 * asked for anything a hand-off may have brought in. */
export function lineageEnvironmentCall(tool: string | undefined, input: string | undefined,
  sensitiveRead: (input: string | undefined) => boolean): boolean {
  const match = /^(?:mcp__)?sagax-environment__([a-z_]+)$/.exec(tool?.trim() ?? "");
  if (!match) return false;
  if (sensitiveRead(input)) return false;
  if (match[1] !== "run_command") return true;
  let command: unknown;
  try { command = (JSON.parse(input ?? "{}") as Record<string, unknown>).command; } catch { return false; }
  if (typeof command !== "string" || !command.trim()) return false;
  return !COMMAND_CREDENTIAL.test(command) && !COMMAND_HIDDEN.test(command) && !COMMAND_HOME_WALK.test(command);
}
