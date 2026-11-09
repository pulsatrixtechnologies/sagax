// A bot owner's own setup runs like it did on the reference design (2026-10-19).
//
// Since #797, Approve for me on Claude is Auto-accept edits plus a short
// allowlist: every other call reaches Sagax as a card. Sagax then answered
// only what an owner had set up by hand (an owner mode "auto" or a rule), so
// a bot at Approve for me asked about every read of ConnectWise, every
// `memory_recall`, every GitHub `get_me` and every command in the owner's
// own cloud computer as soon as a teammate had handed it the work. In production,
// 6 hours after 0.5.27: 104 cards for the maintainer's own bots, 98 of them answered
// Allow by the maintainer, the one he left expired a dispatch lease (claim) and stopped
// a routine. The Chief, whose owner mode was "auto", had none.
//
// Three rules, all bounded to the owner's own work. None of them answers an
// admin card, a guest's turn, a call in someone else's destination, a safety
// hold, a sandbox widening, a call a security key protects, a person's ask or
// deny rule, or a send: those stay where they are (auto-approve.ts,
// owner-approval.ts, index.ts request.opened).
//
// 1. Approve for me means approve for me. At Approve for me (or Full
//    access), the owner route reads as "auto" ("bypass" at Full) for the
//    owner's own work (2026-10-26: the level is the only setting): what no rule covers runs, except a destructive call (a
//    delete, a bulk change, an external email or SMS), which keeps its card
//    (ownerDecision). An organization that turned automatic levels off for
//    members' bots keeps them off (the caller checks it).
// 2. Owner lineage. A teammate's hop or the bot's own scheduled or manual
//    routine is the owner's own work when every link of it is: the owner's
//    own bots, started by the owner's own words (or the routine they wrote),
//    including an owner-authorized webhook routine. Webhook and email data
//    remain untrusted; another person or an unknown source grants nothing.
//    Such a turn counts as the owner's own for their cloud computer (and,
//    since 2026-10-26, their Local VM) too, which it did not before: one bot asked 32 times in a row to run a
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
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { BotPermissionMode } from "./owner-approval.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "../drivers/acp/grok-read-only-tools.ts";

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
  /** The live owner-written routine was verified by the server. Event data stays untrusted. */
  routineAuthorized?: boolean;
}): "owner" | "other" {
  const owner = input.ownerPrincipalId.trim().toLowerCase();
  if (!owner) return "other";
  const same = (id: string | undefined) => Boolean(id) && id!.trim().toLowerCase() === owner;
  const authorizedWebhook = input.automation === "webhook" && input.routineAuthorized === true;
  if (input.automation !== undefined && input.automation !== "schedule" && input.automation !== "manual" && !authorizedWebhook) return "other";
  const speaker = input.speaker;
  if (!speaker) return "other";
  switch (speaker.origin) {
    // The operator at this machine is not a person the bot's owner is known
    // to be (a shared workspace's loopback): their cards keep the owner's
    // own mode.
    case "operator": return "other";
    case "person": return same(speaker.principalId) && !input.unattended ? "owner" : "other";
    // Clock/manual runs, or a webhook whose owner routine the server verified.
    case "owner-routine": return (input.automation === "schedule" || input.automation === "manual" || authorizedWebhook)
      && (speaker.principalId === undefined || same(speaker.principalId)) ? "owner" : "other";
    case "peer": {
      // A hop from a routine may carry what a webhook brought in. 2026-10-27
      // (#1098): a hop between two of the owner's own bots from the owner's
      // own routine (its schedule or a manual run, the trigger the hop
      // carries) is the owner's too. A webhook additionally needs the live
      // routine authorization; an unknown source grants nothing.
      if (speaker.routine) {
        const trigger = speaker.routineTrigger ?? input.automation;
        return (trigger === "schedule" || trigger === "manual" || (trigger === "webhook" && input.routineAuthorized === true)) && same(input.peerFromOwner)
          && (speaker.principalId === undefined || same(speaker.principalId)) && (!input.unattended || input.routineAuthorized === true) ? "owner" : "other";
      }
      return same(input.peerFromOwner) && same(speaker.principalId) && !input.unattended ? "owner" : "other";
    }
  }
  return "other";
}

/** 2026-10-26 (one approval level): the owner route's mode is read
 * from the bot's one approval level; there is no second setting. Ask for
 * approval, Auto-accept edits and Custom: rules, then a card. Approve for
 * me: rules, then what no rule covers runs unless it is destructive. Full
 * access: the same, plus the owner's own computer from their own turn
 * (#1065). Rules (deny, ask, allow) come first at every level. */
export function ownerModeForLevel(level: ApprovalMode): BotPermissionMode {
  return level === "full" ? "bypass" : level === "auto" ? "auto" : "approval";
}

/** The owner mode Sagax applies to one card of the owner route (rule 1). */
export function ownerModeForTurn(input: {
  /** The bot's approval level for this turn. */
  approvalMode: ApprovalMode;
  lineage: "owner" | "other";
  /** False when an admin turned automatic levels off for members' bots and
   * this bot is a member's. */
  autoAllowed: boolean;
  /** False when the organization's Full access policy (or the owner's
   * profile) does not let this owner run Full: Full then reads as Approve
   * for me. */
  bypassAllowed: boolean;
}): BotPermissionMode {
  if (!input.autoAllowed || input.lineage !== "owner") return "approval";
  const mode = ownerModeForLevel(input.approvalMode);
  return mode === "bypass" && !input.bypassAllowed ? "auto" : mode;
}

/** Reads of the Perspicax surface beyond the reviewed Grok list: the
 * catalog, the identity lookup, the agents directory and transcripts, and
 * the lease list. */
const PERSPICAX_EXTRA_READS: ReadonlySet<string> = new Set([
  "api_list", "identity", "list_agents", "find_agents", "get_agent",
  "read_transcript", "read_transcript_cold", "read_transcript_page", "read_latest_page", "read_latest_page_with_threads",
  "read_transcript_attachment", "list_pending_approvals", "claim_list",
]);

/** The reads a connector serves by name, after its `<api>_`: the generic
 * query and the named finds and gets of its recipes. Answered by Sagax only
 * for a connector Perspicax marks as reviewed (api_list `reviewed_reads`:
 * its reads return no credential); every other connector keeps the owner's
 * own mode (rule 1) or its card. */
const CONNECTOR_READ = /^(?:query|(?:find|get)(?:_[a-z0-9]+)+)$/;
const NAMED_WRITE_WORD = /_(?:write|action|update|create|delete|remove|book|log|send|set)(?:_|$)/;

/** Whether a tool is a named read of a connector whose reads Perspicax
 * marked as reviewed. */
function reviewedConnectorRead(tool: string, reviewedReads: (api: string) => boolean): boolean {
  // `<api>_query` since Perspicax 1.9.19, `<api>__query` before: every split
  // at a `_` is tried, and only an api Perspicax marked reviewed answers.
  const legacy = tool.indexOf("__");
  if (legacy >= 0) return legacy > 0 && CONNECTOR_READ.test(tool.slice(legacy + 2)) && reviewedReads(tool.slice(0, legacy));
  for (let split = tool.indexOf("_"); split > 0; split = tool.indexOf("_", split + 1)) {
    const read = tool.slice(split + 1);
    // a find or get that names a write later (`find_x_write`) is not a read
    if (CONNECTOR_READ.test(read) && !NAMED_WRITE_WORD.test(read) && reviewedReads(tool.slice(0, split))) return true;
  }
  return false;
}

/** Coordination leases: they keep two runs off one record. */
const PERSPICAX_LEASES: ReadonlySet<string> = new Set(["claim", "claim_renew", "claim_release"]);

/** The Perspicax tool a provider's name designates on Sagax's fixed account
 * mount, or a legacy profile mount from an already-open turn. */
function perspicaxTool(name: string | undefined): string | null {
  const match = /^(?:mcp__)?(perspicax(?:_[a-z0-9-]+)*)__([a-z0-9][a-z0-9_]{0,127})$/i.exec(name?.trim() ?? "");
  return match ? match[2]!.toLowerCase() : null;
}

export type PerspicaxSelfAnswer = "read" | "lease";

/** Whether Sagax answers a Perspicax call itself (rule 3), and why. The
 * caller has already checked that no other server of the turn could have
 * spelled the name (sagax-internal-tools.ts foreignToolSpelling).
 * `reviewedReads` says whether Perspicax marked a connector's reads as
 * reviewed for this bot (perspicax-mcp.ts reviewedReads); without it, or
 * before api_list was read, no connector read is answered (its card stays). */
export function perspicaxSelfAnswer(name: string | undefined,
  reviewedReads: (api: string) => boolean = () => false): PerspicaxSelfAnswer | null {
  const tool = perspicaxTool(name);
  if (!tool) return null;
  if (PERSPICAX_LEASES.has(tool)) return "lease";
  if (PERSPICAX_READ_ONLY_TOOLS.has(tool) || PERSPICAX_EXTRA_READS.has(tool) || reviewedConnectorRead(tool, reviewedReads)) return "read";
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
 * routine of the owner's own lineage may run unasked. The server
 * environment (the owner's cloud computer) and, since 2026-10-26 (the
 * person's own environment is theirs), the Local VM on their own computer
 * (`sagax-desktop__local_vm`, never another tool of This computer). Never a
 * call that reaches a credential: a read of a dotfile or a credential path
 * (member-environment.ts ownEnvironmentSensitiveRead), a command line (or a
 * Local VM screen action's arguments) that names one, or input that cannot
 * be read. Those keep their card, as the 2026-10-16 security review asked
 * for anything a hand-off may have brought in. The caller still checks
 * that Sagax mounted that environment for this owner (ownEnvironmentCall). */
export function lineageEnvironmentCall(tool: string | undefined, input: string | undefined,
  sensitiveRead: (input: string | undefined) => boolean): boolean {
  const name = tool?.trim() ?? "";
  if (/^(?:mcp__)?sagax-desktop__local_vm$/.test(name)) return lineageLocalVmCall(input, sensitiveRead);
  const match = /^(?:mcp__)?sagax-environment__([a-z_]+)$/.exec(name);
  if (!match) return false;
  if (sensitiveRead(input)) return false;
  if (match[1] !== "run_command") return true;
  let command: unknown;
  try { command = (JSON.parse(input ?? "{}") as Record<string, unknown>).command; } catch { return false; }
  return plainCommand(command);
}

function plainCommand(command: unknown): boolean {
  if (typeof command !== "string" || !command.trim()) return false;
  return !COMMAND_CREDENTIAL.test(command) && !COMMAND_HIDDEN.test(command) && !COMMAND_HOME_WALK.test(command);
}

/** The Local VM's actions (server/desktop/desktop-bridge.ts desktopToolOperation). */
const LOCAL_VM_PLAIN_ACTIONS: ReadonlySet<string> = new Set(["status", "start", "create", "tools"]);

/** A Local VM call of the owner's lineage: a plain action, a command line
 * with the same bounds as the server environment's, or a screen action
 * whose arguments name no credential. Anything else keeps its card. */
function lineageLocalVmCall(input: string | undefined, sensitiveRead: (input: string | undefined) => boolean): boolean {
  if (sensitiveRead(input)) return false;
  let args: unknown;
  try { args = JSON.parse(input ?? "{}"); } catch { return false; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const { action, command, arguments: screen } = args as Record<string, unknown>;
  if (typeof action !== "string") return false;
  if (LOCAL_VM_PLAIN_ACTIONS.has(action)) return true;
  if (action === "run") return plainCommand(command);
  if (action === "use") {
    if (screen === undefined) return true;
    let text: string;
    try { text = JSON.stringify(screen); } catch { return false; }
    return !COMMAND_CREDENTIAL.test(text) && !COMMAND_HIDDEN.test(text) && !COMMAND_HOME_WALK.test(text);
  }
  return false;
}
