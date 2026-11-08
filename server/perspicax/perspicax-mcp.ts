// Perspicax MCP for the person who speaks.
//
// Every authenticated account gets one main Perspicax MCP connection. When a
// turn starts, the harness exchanges the speaker's current sign-in access
// token (server/auth/idp-session.ts, memory only) at Perspicax (RFC 8693,
// server/perspicax/perspicax-link.ts) for one short `/mcp` token. The token
// stays here: the engine mounts one stdio bridge (server/perspicax-mcp-bridge.ts)
// that holds only this turn's capability and posts every JSON-RPC frame to
// POST /api/internal/perspicax/mcp, which lands in `relay` below. The
// tokens are revoked when the turn's generation ends.
//
//   - a person speaking uses their own access, never the owner's (T2); a
//     peer hop speaks for its root human; `operator` is the owner;
//   - a routine, and anything it starts (a bot it asks, a thread it opens, a
//     room goal it runs: routine lineage), uses the routine delegation of the
//     person it runs as (slice 6), never a sign-in; without one, nothing;
//   - a peer hop whose source speaker is not known is an unknown speaker,
//     never the asking bot's owner;
//   - a token near its end, or refused by /mcp, is exchanged again once with
//     a fresh subject; when that fails the call answers "Perspicax access
//     for this turn ended" (a disabled person mid-turn, S5-10);
//   - no token is ever logged or put in an error.
import { servedSpelling, twilioToolsOf, apiNamesOf, reviewedReadsOf, parseMcpBody, withFailureWords, withElicitation, isGoForm } from "./perspicax-mcp-helpers.ts";
import { randomUUID } from "node:crypto";
import { guardToolCall, type GuardOptions } from "../mcp/mcp-permissions.ts";
import { MiB, warmResources, type WarmResourceBudget, type WarmResourceLease } from "../resources/warm-resources.ts";
import { telephonyRefusal, voiceToolCall } from "../telephony-guard.ts";
import { placeArgsFromVoiceCall } from "../../shared/outbound-call.ts";
import type { SubjectTokenOutcome } from "../auth/idp-session.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "../drivers/acp/grok-read-only-tools.ts";
import { executionKey, WriteOnce } from "../write-once.ts";
import { PerspicaxIdentity, identityFailureReason, identityLapsed, identityValue, type IdentityFailure } from "./perspicax-identity.ts";
import type { RoutineFlowInput } from "../routines/routine-flow-input.ts";
import type { ReadinessFlow } from "../routines/routine-readiness.ts";
import { ME_ROLE, actingAsOf, cwPermissionFor, heldRolesOf, roleRefusalOf, type CwPermission, type HeldRole, type RoleReason, type ToolRole } from "../../shared/perspicax-roles.ts";
import { reportBackgroundError } from "../background-error.ts";
import { PERSPICAX_ROUTINE_RETRY_MS, perspicaxUnsent, REMOTE_SUPPORT_OPEN_UNAVAILABLE, VOICE_CALL_REDIRECTED, VOICE_CALL_UNAVAILABLE, PERSPICAX_TOKEN_MIN_LIFE_MS, PERSPICAX_RELAY_TIMEOUT_MS, PERSPICAX_RELAY_MAX_BYTES, PERSPICAX_KEEPALIVE_MS, PERSPICAX_KEEPALIVE_JITTER_MS, PERSPICAX_KEEPALIVE_PER_PERSON, PERSPICAX_ACCESS_ENDED, PERSPICAX_SESSION_RESET, PERSPICAX_WRITE_REPLAYED, perspicaxWriteOnceTool } from "./perspicax-mcp-rules.ts";
export { PERSPICAX_ROUTINE_RETRY_MS, perspicaxUnsent, REMOTE_SUPPORT_OPEN_UNAVAILABLE, VOICE_CALL_REDIRECTED, VOICE_CALL_UNAVAILABLE, PERSPICAX_TOKEN_MIN_LIFE_MS, PERSPICAX_RELAY_TIMEOUT_MS, PERSPICAX_RELAY_MAX_BYTES, PERSPICAX_KEEPALIVE_MS, PERSPICAX_KEEPALIVE_JITTER_MS, PERSPICAX_KEEPALIVE_PER_PERSON, PERSPICAX_ACCESS_ENDED, PERSPICAX_SESSION_RESET, PERSPICAX_WRITE_REPLAYED, perspicaxWriteOnceTool } from "./perspicax-mcp-rules.ts";

export type PerspicaxUnavailableReason = "not_held" | "no_session" | "unreachable" | "rate_limited" | "no_delegation" | "unknown_speaker";

/** Why a profile is not mounted, as the system note and the activity row say it. */
export const PERSPICAX_UNAVAILABLE_WHY: Record<PerspicaxUnavailableReason, string> = {
  not_held: "Perspicax did not authorize the account's main MCP connection",
  no_session: "the person speaking has no live Perspicax sign-in on this server",
  unreachable: "Perspicax could not be reached",
  rate_limited: "Perspicax is rate limiting this server; try again in a minute",
  no_delegation: "the person it runs as has no recent sign-in to Sagax, so Perspicax gave this run no access in their name; once they sign in to Sagax again (web, desktop or phone), the next run gets it",
  unknown_speaker: "the person speaking is not known to Perspicax",
};

/** The sentence shown for an unavailable profile. Prefers Perspicax's own
 * error_description when the exchange returned not_held with one. */
export function perspicaxUnavailableWhy(reason: PerspicaxUnavailableReason, detail?: string): string {
  if (reason === "not_held" && detail) return detail;
  return PERSPICAX_UNAVAILABLE_WHY[reason];
}

/** The activity row when one reason left the connection out of a turn. A rate
 * limit says its sentence, so the person knows to wait; the other reasons
 * keep their code. A not_held detail from Perspicax is shown when present. */
export function perspicaxUnavailableRow(names: readonly string[], speakerName: string, reason: PerspicaxUnavailableReason, detail?: string): string {
  const head = `Perspicax: ${names.join(", ")} unavailable for ${speakerName}`;
  if (reason === "rate_limited") return `${head}: ${PERSPICAX_UNAVAILABLE_WHY.rate_limited}`;
  if (reason === "not_held" && detail) return `${head}: ${detail}`;
  return `${head} (${reason})`;
}

export interface PerspicaxMountedConnection { name: "Perspicax" }

export interface PerspicaxTurnPlan {
  mounted: PerspicaxMountedConnection[];
  unavailable: Array<{ name: string; reason: PerspicaxUnavailableReason; detail?: string }>;
}

/** The link client calls this module needs (PerspicaxDirectory). */
export interface PerspicaxMcpLink {
  exchangeToken(subjectToken: string): Promise<ExchangeResult>;
  revokeExchanged(token: string): Promise<boolean>;
  mcpEndpoint(): string;
}

export interface PerspicaxMcpOptions {
  warmBudget?: WarmResourceBudget;
  /** SAGAX_PERSPICAX_ISSUER; a speaker's subject must come from it. */
  issuer: string;
  /** 2026-10-26: the GO a Perspicax server guard asks for during a call (MCP
   * elicitation, `elicitation/create`, the Flow guard's dry run, GO, read
   * back), shown to the person as an approval card on the turn's thread.
   * Only "allow" is a GO. Set: every session declares the `elicitation`
   * capability. Unset: none is declared and Perspicax refuses the write. */
  askGo?(input: { threadId: string; botId: string; message: string }): Promise<"allow" | "deny" | "timeout">;
  /** The link client, or null while this server is not linked (solo mode, no
   * link file): nothing mounts then. */
  link(): PerspicaxMcpLink | null;
  /** The speaker's Perspicax subject, and whether they are out now. */
  subjectOf(principalId: string): { iss: string; sub: string; disabled: boolean } | null;
  /** IdpSessionManager.subjectToken. */
  subjectToken(subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome>;
  /** Slice 6: RoutineConsents.subjectToken, the subject of routine lineage. */
  routineSubjectToken?(principalId: string): Promise<SubjectTokenOutcome>;
  /** Slice 6: an exchange refused a delegation subject: forget its cache
   * (RoutineConsents.dropCache), so the next run learns the end at once. */
  delegationRefused?(principalId: string): void;
  /** False when the bot was deleted while its turn was still alive. */
  botExists?(botId: string): boolean;
  onIdentityWarning?(input: { threadId: string; botId: string; principalId: string; reason: IdentityFailure }): void;
  /** 2026-11-05 (visible roles): the role of every engine tools/call, a read
   * that fell back to "Moi", a refused write, a lapse
   * (server/perspicax/role-journal.ts). Never changes the answer itself. */
  onRole?(event: PerspicaxRoleEvent): void;
  /** The role a turn starts under: the person's composer pick (fixed for the
   * turn) or the routine's "Au nom de". Undefined: the default surface. */
  turnRole?(turn: { threadId: string; botId: string; principalId: string; routine: boolean }): { slug: string; reason: "person" | "routine" } | undefined;
  /** What a read refused (403) under `from` does: one fallback to "Moi"
   * with a card, the owner's saved rule (no card), or stay. Absent: fallback. */
  roleFallback?(turn: { threadId: string; botId: string; principalId: string; from: string; path: string; to?: string }): "fallback" | "rule" | "stay";
  /** #2581: a read refused (403) under `from` that another held role `to`
   * may read: the person's approval card for this one call (with its
   * Always allow). Absent: the switch is never run. */
  askRoleSwitch?(input: { threadId: string; botId: string; principalId: string; from: { slug: string; name: string }; to: { slug: string; name: string }; tool: string; permission: CwPermission }): Promise<"allow" | "deny" | "timeout">;
  /** #2581: the journal already saw `slug` refused (403) for a read on
   * `path`: that role is not offered again. */
  knownReadRefusal?(input: { principalId: string; botId: string; slug: string; path: string }): boolean;
  /** Writing as "Moi" in a routine that runs under a role changes the
   * vendor attribution: the person's GO, on the approval card family.
   * Absent: such a write is refused. */
  askMeWrite?(input: { threadId: string; botId: string; principalId: string; role: { slug: string; name: string }; tool: string; permission: CwPermission }): Promise<"allow" | "deny" | "timeout">;
  /** The thread is on a live voice call: a turn's tokens are kept for its
   * next turn instead of revoked, so the call's tools stay mounted from turn
   * to turn without a new exchange (server/voice/voice-call-session.ts). */
  keepWarm?(threadId: string): boolean;
  /** The thread's engine session is still warm (idle pool, running turn, or
   * a pooled ACP/Claude process): Perspicax MCP entries stay and are pinged
   * so Perspicax's 120 s idle close does not fire (#1955). */
  engineWarm?(threadId: string): boolean;
  /** One-shot timer for keep-alive (tests inject a fake clock). Default:
   * setTimeout, unref'd. `fn` may return a Promise; tests await it. */
  after?(ms: number, fn: () => void | Promise<void>): { cancel: () => void };
  /** Keep-alive base delay (default PERSPICAX_KEEPALIVE_MS). */
  keepaliveMs?: number;
  /** Keep-alive jitter (default PERSPICAX_KEEPALIVE_JITTER_MS). */
  keepaliveJitterMs?: number;
  /** Per-person pinged-entry cap (default PERSPICAX_KEEPALIVE_PER_PERSON). */
  maxPingedPerPerson?: number;
  /** Pulsa Bot's version, sent in `clientInfo`. */
  version: string;
  /** Permission check for tools/call frames (server/mcp/mcp-permissions.ts). Null
   * or absent: no check. The audit hook never carries arguments or results. */
  permissionGuard?(input: { botId: string; principalId: string }): GuardOptions | null;
  /** The scope a write of this turn is made once in (server/write-once.ts),
   * or null for no guard: two unattended runs (routine passes, coordinated
   * bots) of one person that send the same write with the same arguments
   * at the same time make one call, the other gets its answer. */
  writeOnceScope?(turn: { threadId: string; botId: string; principalId: string }): string | null;
  /** Every remote_support_* answer of a turn (server/remote-support/remote-session-register.ts):
   * a session the bot opened becomes a Sagax session row and chat card. It
   * never changes the answer and its failures are its own. */
  onRemoteSupport?(call: { threadId: string; botId: string; principalId?: string; name: string; args: unknown; result: unknown }): void;
  /** 2026-10-28: a bot's own voice_call (direct, call_tool or use_tool)
   * goes to place_phone_call with its arguments: the same card, AI
   * disclosure, pilot and do-not-call list. Absent: refused. */
  placeCall?(turn: { threadId: string; generation: string; botId: string }, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>;
  /** 2026-11-01: direct MCP remote_support_open. Sagax fills host_id from
   * the bot's attached owned hosts and generates nodekey/session itself;
   * model-supplied values are ignored or refused. Absent: the frame is
   * refused (never forwarded raw). */
  openRemoteSupport?(turn: {
    threadId: string;
    generation: string;
    botId: string;
    principalId: string;
    args: Record<string, unknown>;
  }): Promise<{ text: string; isError?: boolean }>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  /** The waits between tries of a routine's transient Perspicax failure
   * (PERSPICAX_ROUTINE_RETRY_MS); replaced in tests. */
  routineRetryMs?: readonly number[];
  /** Waits that long (tests replace it). */
  sleep?: (ms: number) => Promise<void>;
}
/** HTTP answers of an edge whose upstream is down for a moment. */
const TRANSIENT_HTTP = new Set([502, 503]);
/** Requests that only read, safe to send again on a new session. */
const READ_ONLY_METHODS = new Set(["tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get", "ping", "completion/complete"]);

/** Whether a frame may be sent again after a new session: a read-only method,
 * tools/call of a Perspicax tool reviewed as read-only (grok-read-only-tools.ts)
 * or one Perspicax itself lists as read-only (`readOnly`: its tools/list
 * `readOnlyHint`, not destructive), or a Pulsatrix Flow action call that
 * cannot write (no `confirm: true`: Perspicax sends an action's writes only
 * on a confirmed call holding its batch key, so a call without it answers
 * reads, a dry run, a choice or needs_confirmation).
 * 2026-11-03 (production): a session dropped during a long turn, and
 * cw_psa_find_schedule_entries, cw_psa_get_ticket and flow_action
 * free-slot-find, all reads, came back "did not replay this call because it
 * can change data". Writes, sends and unknown tools are still never replayed. */
export function perspicaxReplayable(frame: Record<string, unknown>, readOnly?: ReadonlySet<string>): boolean {
  const method = frame.method;
  if (typeof method !== "string") return false;
  if (READ_ONLY_METHODS.has(method)) return true;
  if (method !== "tools/call") return false;
  const params = frame.params;
  const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  const name = record.name;
  if (typeof name !== "string") return false;
  if (PERSPICAX_READ_ONLY_TOOLS.has(name) || readOnly?.has(name) === true) return true;
  const args = record.arguments && typeof record.arguments === "object" && !Array.isArray(record.arguments) ? record.arguments as Record<string, unknown> : {};
  return name === "flow_action" && args.confirm !== true;
}

/** Calls that let the caller inspect or replace a role after its explicit
 * selection could not be restored. Everything else must keep that selection
 * or remain unsent; silently using the account's default surface can have
 * different vendor permissions. */
function roleRecoveryFrame(frame: Json): boolean {
  if (frame.method === "tools/list") return true;
  if (frame.method !== "tools/call" || !isObject(frame.params)) return false;
  return frame.params.name === "identity_switch" || frame.params.name === "profile_use";
}

/** The tools a tools/list answer marks read-only (`readOnlyHint` true and
 * not `destructiveHint`): Perspicax derives them from the vendor method. */
export function perspicaxReadOnlyToolsOf(body: unknown): string[] {
  const result = isObject(body) && isObject(body.result) ? body.result : null;
  const tools = result && Array.isArray(result.tools) ? result.tools : [];
  return tools
    .filter((tool): tool is Json => isObject(tool) && typeof tool.name === "string" && isObject(tool.annotations)
      && tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint !== true)
    .map((tool) => String(tool.name));
}

/** Perspicax (rmcp streamable HTTP, legacy session mode) answers 404
 * "Session not found" for a session it no longer has (idle past its keep-alive,
 * or a restart), and 422 "Unexpected message, expect initialize request" for a
 * call that carries no session. Both mean: initialize again. */
export function perspicaxSessionLost(status: number, text: string): boolean {
  if (status === 404) return true;
  return status === 422 && /expect initialize/i.test(text);
}

interface Entry {
  budget?: WarmResourceLease;
  threadId: string;
  generation: string;
  botId: string;
  principalId: string;
  subject: { iss: string; sub: string };
  /** Slice 6: whose grant the subject came from, and so how to renew it. */
  source: "session" | "delegation";
  token: string;
  expiresAt: number;
  mcpSessionId?: string;
  initialized?: boolean;
  identity?: PerspicaxIdentity;
  identityWarning?: IdentityFailure;
  /** A successful `profile_use` choice for this generation. Distinct from
   * the expiring identity_switch lease above. */
  profileChoice?: string;
  profileChoiceNeedsRestore?: boolean;
  profileChoiceRestoreFailed?: boolean;
  /** Visible roles (2026-11-05): the held roles this turn's listing named. */
  heldRoles?: HeldRole[];
  /** slug → profile id learned from act-as token scopes (visible roles) */
  roleIds?: Map<string, string>;
  /** cw_member:<identifier> (or credential:) behind the acting role. */
  targetIdentity?: string;
  /** Why the current role is the current one. */
  roleReason?: RoleReason;
  /** The person picked the role for this turn: the bot may not switch away. */
  roleLocked?: boolean;
  /** The routine's "Au nom de" role (a write as "Moi" then asks the person). */
  routineRole?: string;
  /** A write was refused (403): no switch to get around it in this turn. */
  writeRefused?: boolean;
  /** A read was refused (403) for good (#2577/#2581): its one role switch is
   * spent (declined, or tried and still refused), no other switch now. */
  readRefused?: boolean;
  /** #2581 (decided 2026-11-07): after a read 403, the one held role offered for
   * that call. The bot switching to it means the person already allowed it
   * (in the conversation or a saved instruction); the same call again asks
   * the person with a card. */
  roleOffer?: { from: string; to: string; tool: string; path: string; permission: CwPermission; needs: string };
  /** The bot switched to the offered role: the next vendor call runs under
   * it, then Sagax puts `back` again. */
  oneCall?: { back: string; via: string };
  /** Permission paths whose one role switch this turn is spent (no loop). */
  switchedPaths?: Set<string>;
  /** Role switches the bot made in this turn: one is allowed (#2577). */
  switches?: number;
  /** Tools the person allowed to write as "Moi" in this routine turn. */
  meWritesAllowed?: Set<string>;
  /** The role lapsed during the last call and could not be renewed. */
  lapsedNow?: boolean;
  /** A remote `tools/list_changed` that the stdio bridge must forward to its
   * MCP client before the response which caused it. */
  toolsChangedPending?: boolean;
  servedTools?: Set<string>;
  /** The served tools Perspicax lists as read-only (perspicaxReadOnlyToolsOf). */
  readOnlyTools?: Set<string>;
  twilioTools?: Set<string>;
  /** Full JSON-RPC tools/list body for this MCP session and identity.
   * Serves a later tools/list on the same session (engine after Sagax's
   * identity list) without a second round trip. Cleared on reopen, identity
   * invalidate/clear, list_changed, and retire. Never shared across persons:
   * it lives on this Entry only. */
  toolsListBody?: unknown;
  /** The MCP server name the engine sees the main connection under. */
  mount?: string;
  /** One re-initialize at a time (relay, a session Perspicax dropped). */
  reopening?: Promise<ReopenedSession | null>;
  /** The person is out, or the access could not be renewed: every call ends. */
  ended?: boolean;
  renewing?: Promise<boolean>;
  /** Idle keep-alive timer (#1955): one per entry, unref'd. */
  keepAlive?: { cancel: () => void } | null;
  /** When this entry's keep-alive was last armed (per-person newest cap). */
  keepAliveArmedAt?: number;
  /** True while a keep-alive ping is in flight (do not re-arm over it). */
  keepAlivePing?: boolean;
}

/** One role fact of an engine tools/call (visible roles, 2026-11-05). */
export interface PerspicaxRoleEvent {
  threadId: string;
  botId: string;
  principalId: string;
  /** the turn runs on a routine delegation */
  routine: boolean;
  /** step: the call ran under `role`; read_refused / write_refused: a 403
   * Sagax did not get around; lapsed: the role lapsed and the call stopped. */
  kind: "step" | "read_refused" | "write_refused" | "lapsed";
  tool: string;
  role: ToolRole;
  /** refusals: the CW permission the call needed */
  permission?: CwPermission;
  /** refusals and fallbacks: the role that was refused */
  refusedRole?: { slug: string; name: string };
  /** cw_member:<identifier> behind the role, when Perspicax said */
  target?: string;
  /** the roles held, as this turn's listing said (names) */
  held?: HeldRole[];
}

/** Tools whose writes reach a vendor under the acting role (attribution). */
const VENDOR_TOOL = /^(cw_|sentinelone_|twilio_|x360recover_|bookstack_|voice_|connectwise_)/;
function vendorWriteTool(name: string): boolean {
  return VENDOR_TOOL.test(name) || name === "flow_action";
}

/** The note a model reads in front of an answer (a text block first). */
function withNote(answer: PerspicaxRelayAnswer, note: string): PerspicaxRelayAnswer {
  if (!isObject(answer.body) || !isObject(answer.body.result)) return answer;
  const result = answer.body.result;
  const content = Array.isArray(result.content) ? result.content : [];
  return { ...answer, body: { ...answer.body, result: { ...result, content: [{ type: "text", text: note }, ...content] } } };
}

/** A refusal the model must read as a block (#2577): the note in front of a
 * tool result, or a JSON-RPC error turned into a tool error with it. */
function blockWith(answer: PerspicaxRelayAnswer, id: unknown, note: string): PerspicaxRelayAnswer {
  if (isObject(answer.body) && isObject(answer.body.result)) return withNote(answer, note);
  const error = isObject(answer.body) && isObject(answer.body.error) ? answer.body.error : null;
  const message = error && typeof error.message === "string" ? error.message.slice(0, 300) : "";
  return toolError(id, message ? `${note}\nVendor answer: ${message}` : note);
}

function toolError(id: unknown, text: string): PerspicaxRelayAnswer {
  return { status: 200, body: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } } };
}

export interface PerspicaxRelayAnswer {
  status: number;
  /** A JSON body, absent for 202. */
  body?: unknown;
  /** The bridge emits notifications/tools/list_changed before this body. */
  toolsChanged?: true;
}

type SentFrame =
  | { response: Response; text: string }
  | "ended"
  | "unreachable"
  | "selection_unavailable";

interface ReopenedSession { body: Json }

/** The answer of a Perspicax tool the harness calls itself (callTool): the
 * tool's structured result and whether it is a tool error, or why no call
 * was made. */
export type PerspicaxToolAnswer =
  | { ok: true; isError: boolean; value: unknown }
  | { ok: false; code: "profile_not_mounted" | "access_ended" | "unreachable" | "rpc_error"; error: string };

const key = (threadId: string, generation: string) => `${threadId}\u0000${generation}\u0000perspicax`;
const initKey = (threadId: string) => threadId;
/** Bounds the kept initialize params (one per thread). */
const MAX_INIT_PARAMS = 2_000;
/** The protocol a reopened session asks for when the engine's own initialize
 * was never seen (a bridge initialized before this server started). */
export const PERSPICAX_PROTOCOL_VERSION = "2025-06-18";
const warmKey = (threadId: string, principalId: string, source: Entry["source"]) =>
  `${threadId}\u0000${principalId}\u0000${source}`;
/** A refusal worth one more try a moment later. */
const TRANSIENT = new Set(["unreachable", "rate_limited"]);
const RETRY_EXCHANGE_MS = 400;
/** How long a call's next turn waits for the last turn's retire (its MCP
 * session DELETE is bounded at 5 s) before it exchanges a token of its own. */
const RETIRE_WAIT_MS = 6_000;

type Json = Record<string, unknown>;

/** The telephony guard's refusal for a bot's own Twilio call
 * (server/telephony-guard.ts), or null. */
function telephonyBlock(frame: Json, twilioTools: ReadonlySet<string> | undefined): string | null {
  if (frame.method !== "tools/call") return null;
  const params = isObject(frame.params) ? frame.params : {};
  return telephonyRefusal(String(params.name ?? ""), params.arguments, twilioTools ? { twilioTools } : {});
}

/** 2026-10-27: how long the product names of an api_list answer are kept. */
const API_NAMES_TTL_MS = 30 * 60_000;
/** Bounds the bots whose product names are kept. */
const API_NAMES_MAX = 500;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The body of an answer, bounded. On an SSE stream, each request the server
 * sends (`method` and `id`) is handed to `onRequest` as it arrives, so a
 * call that waits on the client's answer can go on. Notifications (no id)
 * such as tools/list_changed go to `onNotification`. */
async function readBounded(
  response: Response,
  max: number,
  onRequest?: (request: Json) => Promise<void>,
  onNotification?: (frame: Json) => void,
): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error("the Perspicax answer is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stream = (onRequest !== undefined || onNotification !== undefined)
    && (response.headers.get("content-type") ?? "").includes("text/event-stream");
  let size = 0;
  let text = "";
  let scanned = 0;
  const pending: Promise<void>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(reportBackgroundError);
      throw new Error("the Perspicax answer is too large");
    }
    text += decoder.decode(value, { stream: true });
    if (!stream) continue;
    // every complete line since the last read
    const end = text.lastIndexOf("\n");
    if (end < scanned) continue;
    for (const line of text.slice(scanned, end).split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      let frame: unknown;
      try { frame = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (!isObject(frame) || typeof frame.method !== "string") continue;
      if (typeof frame.id === "string" || typeof frame.id === "number") {
        if (onRequest) pending.push(onRequest(frame).catch(reportBackgroundError));
      } else if (onNotification) {
        onNotification(frame);
      }
    }
    scanned = end + 1;
  }
  await Promise.all(pending);
  return text + decoder.decode();
}

/** Rebind a cached or internally reopened JSON-RPC result to the caller's request id. */
function rewriteResponseId(body: unknown, id: unknown): unknown {
  if (!isObject(body)) return body;
  return { ...body, id };
}

function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export class PerspicaxMcp {
  private readonly options: PerspicaxMcpOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly routineRetryMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly entries = new Map<string, Entry>();
  /** tokens a call keeps between turns (keepWarm), by thread and speaker */
  private readonly warm = new Map<string, Entry>();
  /** A thread's retire still clearing roles and closing sessions: the next
   * turn of a live call or warm engine waits for it, so the token it parks
   * is taken over instead of a second exchange (a call's first sentence
   * landed while the warm turn's session was still closing). */
  private readonly retiring = new Map<string, Promise<void>>();
  /** The engine's last initialize params per thread (reopen). */
  private readonly initParams = new Map<string, Json>();
  private reopens = 0;
  private nativeCalls = 0;
  /** 2026-10-27, by bot: the product names Perspicax declares for its
   * APIs (api_list), so a step row names the product as the server does,
   * and the connectors whose reads it marks as reviewed. */
  private readonly apiNames = new Map<string, { at: number; names: Map<string, string>; reviewed: Set<string> }>();
  private readonly apiNamesPending = new Set<string>();
  /** "At the same time": a 5 minute window, then a write is sent again. */
  private readonly writes = new WriteOnce<PerspicaxRelayAnswer>({ ttlMs: 5 * 60_000 });

  private readonly keepaliveMs: number;
  private readonly keepaliveJitterMs: number;
  private readonly maxPingedPerPerson: number;
  private disposed = false;

  constructor(options: PerspicaxMcpOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
    this.routineRetryMs = options.routineRetryMs ?? PERSPICAX_ROUTINE_RETRY_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.keepaliveMs = options.keepaliveMs ?? PERSPICAX_KEEPALIVE_MS;
    this.keepaliveJitterMs = options.keepaliveJitterMs ?? PERSPICAX_KEEPALIVE_JITTER_MS;
    this.maxPingedPerPerson = Math.max(1, options.maxPingedPerPerson ?? PERSPICAX_KEEPALIVE_PER_PERSON);
  }

  /** Voice call or a still-warm engine session: entries stay across turns. */
  private sessionShouldStay(threadId: string): boolean {
    return this.options.keepWarm?.(threadId) === true || this.options.engineWarm?.(threadId) === true;
  }

  private scheduleAfter(ms: number, fn: () => void | Promise<void>): { cancel: () => void } {
    if (this.options.after) return this.options.after(ms, fn);
    const timer = setTimeout(() => { void fn(); }, ms);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  }

  private disarmKeepAlive(entry: Entry): void {
    entry.keepAlive?.cancel();
    entry.keepAlive = null;
    entry.keepAliveArmedAt = undefined;
  }

  /** Arm (or re-arm) a keep-alive ping when the engine session is warm.
   * Never for a cold thread; at most maxPingedPerPerson per person (newest). */
  private touchKeepAlive(entry: Entry): void {
    this.disarmKeepAlive(entry);
    if (this.disposed || entry.ended || entry.keepAlivePing) return;
    if (!entry.mcpSessionId || !this.sessionShouldStay(entry.threadId)) return;
    if (entry.expiresAt - this.now() < PERSPICAX_TOKEN_MIN_LIFE_MS) return;
    entry.keepAliveArmedAt = this.now();
    this.enforcePingCap(entry);
    if (!entry.keepAliveArmedAt) return; // dropped by the per-person cap
    const delay = this.keepaliveMs + (this.keepaliveJitterMs > 0 ? Math.floor(Math.random() * this.keepaliveJitterMs) : 0);
    entry.keepAlive = this.scheduleAfter(delay, () => this.pingKeepAlive(entry));
  }

  /** Drop the oldest pinged entries of this person until the cap holds. */
  private enforcePingCap(newest: Entry): void {
    const pinged = [...this.entries.values(), ...this.warm.values()]
      .filter((entry) => entry.principalId === newest.principalId && entry.keepAliveArmedAt !== undefined && !entry.ended);
    if (pinged.length <= this.maxPingedPerPerson) return;
    pinged.sort((a, b) => (a.keepAliveArmedAt ?? 0) - (b.keepAliveArmedAt ?? 0));
    const drop = pinged.length - this.maxPingedPerPerson;
    for (let i = 0; i < drop; i += 1) {
      const old = pinged[i]!;
      this.disarmKeepAlive(old);
    }
  }

  private async pingKeepAlive(entry: Entry): Promise<void> {
    entry.keepAlive = null;
    if (this.disposed || entry.ended || entry.keepAlivePing) return;
    if (!this.sessionShouldStay(entry.threadId) || !entry.mcpSessionId) {
      this.disarmKeepAlive(entry);
      return;
    }
    if (entry.expiresAt - this.now() < PERSPICAX_TOKEN_MIN_LIFE_MS) {
      if (!(await this.renew(entry))) {
        this.disarmKeepAlive(entry);
        return;
      }
    }
    const link = this.options.link();
    if (!link) {
      this.disarmKeepAlive(entry);
      return;
    }
    entry.keepAlivePing = true;
    try {
      const id = `sagax-keepalive-${++this.nativeCalls}`;
      const sent = await this.send(link, entry, { jsonrpc: "2.0", id, method: "ping", params: {} }, undefined, true);
      if (typeof sent === "string" || !sent.response.ok) {
        this.disarmKeepAlive(entry);
        this.end(entry);
        return;
      }
      // A lost session answered as 404/422: treat as a failed ping.
      if (perspicaxSessionLost(sent.response.status, sent.text)) {
        this.disarmKeepAlive(entry);
        this.end(entry);
        return;
      }
    } catch {
      this.disarmKeepAlive(entry);
      this.end(entry);
      return;
    } finally {
      entry.keepAlivePing = false;
    }
    if (!entry.ended) this.touchKeepAlive(entry);
  }

  /** Engine session went cold: stop pings and drop kept tokens for this thread. */
  noteEngineCold(threadId: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.threadId === threadId) this.disarmKeepAlive(entry);
    }
    if (this.options.keepWarm?.(threadId) === true) return;
    void this.endWarm(threadId).catch(reportBackgroundError);
  }

  /** Engine session is warm again (idle pool): re-arm pings on kept entries. */
  noteEngineWarm(threadId: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.threadId === threadId && entry.mcpSessionId && !entry.ended) this.touchKeepAlive(entry);
    }
  }

  /** Open (or verify) the main MCP session of this turn, so the handshake can
   * run beside setup. An explicit identity lease is renewed when one exists. */
  async ensureTurnSessions(threadId: string, generation: string): Promise<void> {
    const prefix = `${threadId}\u0000${generation}\u0000`;
    const work: Promise<void>[] = [];
    for (const [at, entry] of this.entries) {
      if (!at.startsWith(prefix) || entry.ended) continue;
      work.push((async () => {
        const link = this.options.link();
        if (!link || entry.ended) return;
        if (!entry.initialized && !entry.mcpSessionId) await this.reopen(link, entry);
        if (entry.identity) await entry.identity.ensure();
        else if (!entry.toolsListBody && entry.mcpSessionId) {
          await this.identityRpc(entry, "tools/list").catch(() => undefined);
        }
        if (entry.mcpSessionId && !entry.ended) this.touchKeepAlive(entry);
      })());
    }
    await Promise.all(work);
  }

  private setIdentity(entry: Entry, slug: string | undefined): void {
    if (!slug) return;
    entry.profileChoice = undefined;
    entry.profileChoiceNeedsRestore = false;
    entry.profileChoiceRestoreFailed = false;
    entry.identity = new PerspicaxIdentity({
      slug,
      now: this.now,
      rpc: (method, params) => this.identityRpc(entry, method, params),
      warn: (reason) => this.options.onIdentityWarning?.({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, reason }),
    });
  }

  /** Forget every view derived from the role served by this MCP session.
   * `toolsListBody` is the response cache; the three sets also drive native
   * spelling, replay safety and the telephony guard, so keeping only those
   * sets across a role/session change would still use the previous surface. */
  private clearToolCatalog(entry: Entry): void {
    entry.servedTools = undefined;
    entry.readOnlyTools = undefined;
    entry.twilioTools = undefined;
    entry.toolsListBody = undefined;
  }

  /** Internal identity traffic uses the very same token and session as the
   * engine's calls. It never enters the identity gate recursively. */
  private async identityRpc(entry: Entry, method: string, params?: Json): Promise<unknown> {
    const link = this.options.link();
    if (!link || entry.ended) throw new Error("Perspicax unavailable");
    const speaker = this.options.subjectOf(entry.principalId);
    if (!speaker || speaker.disabled) { this.end(entry); throw new Error("Perspicax access ended"); }
    if (entry.expiresAt - this.now() < PERSPICAX_TOKEN_MIN_LIFE_MS && !await this.renew(entry)) throw new Error("Perspicax access ended");
    if (!entry.initialized && !entry.mcpSessionId && !await this.reopen(link, entry)) throw new Error("Perspicax unavailable");
    const id = `sagax-identity-${++this.nativeCalls}`;
    const sent = await this.send(link, entry, { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, undefined, true);
    if (typeof sent === "string" || !sent.response.ok) throw new Error("Perspicax unavailable");
    const body = parseMcpBody(sent.text, id);
    if (method === "tools/list" && isObject(body) && isObject(body.result) && Array.isArray(body.result.tools)) {
      entry.servedTools = new Set(body.result.tools.filter(isObject).map((tool) => String(tool.name)).slice(0, 2000));
      entry.readOnlyTools = new Set(perspicaxReadOnlyToolsOf(body).slice(0, 2000));
      entry.twilioTools = new Set(twilioToolsOf(body).slice(0, 500));
      entry.toolsListBody = body;
    }
    return body;
  }

  /** Cheap read on a separate, short-lived routine connection. No turn or
   * identity switch. The account connection exists independently of roles. */
  async probeReadiness(principalId: string, signal: AbortSignal): Promise<{ refused?: boolean; detail?: string } | undefined> {
    const link = this.options.link();
    if (!link) return undefined;
    const subject = this.options.subjectOf(principalId);
    if (!subject || subject.disabled) return undefined;
    if (signal.aborted) return { detail: "Perspicax readiness timed out; admission will retry reachability." };
    let token: string | undefined;
    let session: string | null = null;
    try {
      const source = await this.subjectFor("delegation", principalId, subject);
      if (!source.ok) return { detail: "Perspicax routine access is not available yet; admission will retry." };
      const exchanged = await link.exchangeToken(source.token);
      if (!exchanged.ok) return { refused: exchanged.error === "subject" || exchanged.error === "not_held", detail: exchanged.error };
      token = exchanged.token;
      const post = async (frame: Json) => {
        const response = await this.fetcher(link.mcpEndpoint(), { method: "POST", redirect: "error", signal,
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(frame) });
        session = response.headers.get("mcp-session-id") ?? session;
        const text = await response.text();
        return { response, text };
      };
      const init = await post({ jsonrpc: "2.0", id: "readiness-init", method: "initialize", params: { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Sagax routine check", version: this.options.version } } });
      if (init.response.status === 401 || init.response.status === 403) return { refused: true, detail: `${init.response.status} invalid_token` };
      if (!init.response.ok) return { detail: `Perspicax readiness HTTP ${init.response.status}; admission will retry reachability.` };
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      const listed = await post({ jsonrpc: "2.0", id: "readiness-list", method: "tools/list" });
      if (listed.response.status === 401 || listed.response.status === 403) return { refused: true, detail: `${listed.response.status} invalid_token` };
      if (!listed.response.ok) return { detail: `Perspicax readiness HTTP ${listed.response.status}; admission will retry reachability.` };
      return {};
    } catch {
      return { detail: "Perspicax readiness is unreachable; admission will retry reachability." };
    } finally {
      if (token) {
        if (session) await this.fetcher(link.mcpEndpoint(), { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(200), headers: { authorization: `Bearer ${token}`, "mcp-session-id": session } }).then(response => response.body?.cancel()).catch(reportBackgroundError);
        void link.revokeExchanged(token).catch(reportBackgroundError);
      }
    }
  }

  /** Check Flow init and an explicit plan on a private account connection backed by
   * the run-as person's routine delegation. Flow is supplied by the active
   * organization pack, never by a bot profile or a stored role choice. */
  async probeFlowReadiness(principalId: string, botId: string, input: RoutineFlowInput, signal: AbortSignal): Promise<ReadinessFlow> {
    const link = this.options.link();
    const subject = this.options.subjectOf(principalId);
    if (!link || !subject || subject.disabled || subject.iss !== this.options.issuer) throw new Error("Perspicax routine access is unavailable.");
    signal.throwIfAborted();
    const source = await this.subjectFor("delegation", principalId, subject);
    if (!source.ok) throw new Error("Perspicax routine delegation is unavailable.");
    const exchanged = await link.exchangeToken(source.token);
    if (!exchanged.ok) throw new Error(`Perspicax routine account exchange failed: ${exchanged.error}`);
    let session: string | null = null;
    /** A run this probe proved it created. Never release an unnamed or
     * already-live run on the same account connection. */
    let ownedRun: { id: string; routine: string } | undefined;
    let result: ReadinessFlow | undefined;
    let problem: unknown;
    const rpc = async (method: string, params: Json, callSignal = signal): Promise<Json> => {
      callSignal.throwIfAborted();
      const id = `sagax-flow-check-${++this.nativeCalls}`;
      const response = await this.fetcher(link.mcpEndpoint(), { method: "POST", redirect: "error", signal: callSignal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${exchanged.token}`, ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...(method === "notifications/initialized" ? {} : { id }), method, params }) });
      session = response.headers.get("mcp-session-id") ?? session;
      const text = await response.text();
      if (!response.ok) throw new Error(`Perspicax Flow check HTTP ${response.status}`);
      if (method === "notifications/initialized") return {};
      const body = parseMcpBody(text, id);
      if (!isObject(body)) throw new Error("Perspicax Flow check returned an invalid MCP response.");
      return body;
    };
    const call = async (command: string, args: Json, callSignal = signal): Promise<{ value: unknown; isError: boolean }> => {
      const body = await rpc("tools/call", { name: "flow_run", arguments: { command, args } }, callSignal);
      if (isObject(body.error)) return { value: body.error, isError: true };
      if (!isObject(body.result)) throw new Error("Perspicax Flow check returned no tool result.");
      const tool = body.result;
      let value: unknown = tool.structuredContent;
      if (value === undefined && Array.isArray(tool.content)) {
        const block = tool.content.find(block => isObject(block) && block.type === "text");
        if (isObject(block) && typeof block.text === "string") {
          try { value = JSON.parse(block.text); } catch { value = block.text; }
        }
      }
      if (value === undefined) throw new Error("Perspicax Flow check returned an empty tool result.");
      return { value, isError: tool.isError === true };
    };
    const failure = (answer: { value: unknown; isError: boolean }, step: string): ReadinessFlow | undefined => {
      const value = isObject(answer.value) ? answer.value : {};
      const output = isObject(value.output) ? value.output : value;
      if (value.reason === "runner_unavailable") throw new Error("The Flow runner is unavailable.");
      if (!answer.isError && value.ok !== false && output.ok !== false && !output.error && ![value.status, output.status].some(status => ["blocked", "failed", "error"].includes(String(status)))) {
        if (value.status !== "ok" && value.ok !== true) throw new Error("Perspicax Flow check returned an invalid engine result.");
        return undefined;
      }
      const error = isObject(output.error) ? output.error : output;
      const code = error.code ?? output.error ?? value.reason ?? value.code ?? value.status ?? "flow_error";
      const message = error.message ?? output.detail ?? value.detail ?? (typeof value.output === "string" ? value.output : typeof answer.value === "string" ? answer.value : "");
      return { step, error: `${typeof code === "object" ? "flow_error" : code} ${message}`.trim() };
    };
    try {
      await rpc("initialize", { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: `Sagax Flow check (${botId}; ${input.routine ?? "catalogue"}; ${randomUUID()})`, version: this.options.version } });
      await rpc("notifications/initialized", {});
      const listed = await rpc("tools/list", {});
      if (!isObject(listed.result) || !Array.isArray(listed.result.tools)) throw new Error("Perspicax Flow tools could not be listed.");
      if (!listed.result.tools.some(tool => isObject(tool) && tool.name === "flow_run")) {
        result = { step: "tools/list", error: "tool_missing flow_run is not available on this account connection." };
      } else if (!input.routine) {
        // The model may choose a recipe during the real turn. With no
        // explicit recipe there is no honest plan to shadow: connection and
        // catalogue readiness are the complete pre-flight.
        result = {};
      } else {
        const init = await call("run.init", { shadow: true, routine: input.routine });
        const value = isObject(init.value) ? init.value : {};
        if (value.reason === "already_running" || value.code === "already_running") {
          result = { live: true };
        } else {
          result = failure(init, "run.init");
          if (!result) {
            const runId = typeof value.run_id === "string" && value.run_id.trim() ? value.run_id : undefined;
            if (!runId) throw new Error("Perspicax Flow check opened no identifiable shadow run.");
            ownedRun = { id: runId, routine: input.routine };
            result = input.plan
              ? failure(await call("plan", { ...input.plan, routine: input.routine, run_id: runId }), "plan") ?? {}
              : {};
          }
        }
      }
    } catch (error) { problem = error; }
    finally {
      if (ownedRun) {
        try {
          // A readiness plan is deliberately not an executed recipe: release
          // its exact lease without asking Flow's business close to accept a
          // plan that has no journal.pass lines.
          const released = failure(await call("release", { routine: ownedRun.routine, run_id: ownedRun.id }, AbortSignal.timeout(1_000)), "release");
          if (!result?.error && released) result = released;
        } catch (error) { if (!result?.error) problem ??= error; }
      }
      if (session) await this.fetcher(link.mcpEndpoint(), { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(200), headers: { authorization: `Bearer ${exchanged.token}`, "mcp-session-id": session } }).then(response => response.body?.cancel()).catch(reportBackgroundError);
      void link.revokeExchanged(exchanged.token).catch(reportBackgroundError);
    }
    if (problem) throw problem;
    return result ?? { step: "tools/list", error: "tool_missing flow_run is not available on this account connection." };
  }

  /** Visible roles (composer picker, 2026-11-05): the roles THIS person
   * holds now, from a live `identity_switch` with no argument. On the live
   * connection of this thread and person when there is one (and `current`,
   * the role it acts as), else on a short-lived account connection of the
   * person's own session, closed and revoked at once. Never a listing kept
   * from another turn or another person. Null: Perspicax is not mounted
   * for this person (no link, no session). */
  async heldRolesFor(principalId: string, botId: string, threadId: string | undefined, signal: AbortSignal): Promise<{ roles: HeldRole[]; current?: string } | null> {
    const principal = principalId.trim();
    const link = this.options.link();
    const subject = principal ? this.options.subjectOf(principal) : null;
    if (!link || !subject || subject.disabled || subject.iss !== this.options.issuer) return null;
    if (threadId) {
      for (const entry of this.entries.values()) {
        if (entry.ended || entry.threadId !== threadId || entry.botId !== botId || entry.principalId !== principal) continue;
        if (entry.servedTools && !entry.servedTools.has("identity_switch")) return { roles: [], current: this.currentRole(entry) };
        try {
          const body = await this.identityRpc(entry, "tools/call", { name: "identity_switch", arguments: {} });
          const value = identityValue(body);
          this.noteListing(entry, value);
          return { roles: heldRolesOf(value), current: this.currentRole(entry) };
        } catch { break; /* the short-lived connection below answers */ }
      }
    }
    signal.throwIfAborted();
    const source = await this.subjectFor("session", principal, { iss: subject.iss, sub: subject.sub });
    if (!source.ok) return null;
    const exchanged = await link.exchangeToken(source.token);
    if (!exchanged.ok) return null;
    let session: string | null = null;
    const rpc = async (method: string, params: Json): Promise<unknown> => {
      signal.throwIfAborted();
      const id = `sagax-roles-${++this.nativeCalls}`;
      const response = await this.fetcher(link.mcpEndpoint(), { method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${exchanged.token}`, ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...(method === "notifications/initialized" ? {} : { id }), method, params }) });
      session = response.headers.get("mcp-session-id") ?? session;
      const text = await response.text();
      if (!response.ok) throw new Error(`Perspicax roles HTTP ${response.status}`);
      return method === "notifications/initialized" ? {} : parseMcpBody(text, id);
    };
    try {
      await rpc("initialize", { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: `Sagax roles (${botId}; ${randomUUID()})`, version: this.options.version } });
      await rpc("notifications/initialized", {});
      const body = await rpc("tools/call", { name: "identity_switch", arguments: {} });
      if (!isObject(body) || isObject(body.error) || (isObject(body.result) && body.result.isError === true)) return { roles: [] };
      return { roles: heldRolesOf(identityValue(body)) };
    } finally {
      if (session) await this.fetcher(link.mcpEndpoint(), { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(200), headers: { authorization: `Bearer ${exchanged.token}`, "mcp-session-id": session } }).then(response => response.body?.cancel()).catch(reportBackgroundError);
      void link.revokeExchanged(exchanged.token).catch(reportBackgroundError);
    }
  }


  /** 2026-11-05 (visible roles, routine "Au nom de"): the roles the run-as
   * person holds now (`identity_switch` without argument, a read) and, for
   * a Flow recipe, its card (`flow` describe: standing_mandate and
   * server_profiles), on a private short-lived account connection backed by
   * that person's routine delegation. It never switches a role. */
  async probeRoutineRoles(principalId: string, botId: string, recipe: string | undefined, signal: AbortSignal): Promise<{ held: HeldRole[]; card?: unknown; flowError?: string }> {
    const link = this.options.link();
    const subject = this.options.subjectOf(principalId);
    if (!link || !subject || subject.disabled || subject.iss !== this.options.issuer) throw new Error("Perspicax routine access is unavailable.");
    signal.throwIfAborted();
    const source = await this.subjectFor("delegation", principalId, subject);
    if (!source.ok) throw new Error("Perspicax routine delegation is unavailable.");
    const exchanged = await link.exchangeToken(source.token);
    if (!exchanged.ok) throw new Error(`Perspicax routine account exchange failed: ${exchanged.error}`);
    let session: string | null = null;
    const rpc = async (method: string, params: Json): Promise<Json> => {
      signal.throwIfAborted();
      const id = `sagax-role-coverage-${++this.nativeCalls}`;
      const response = await this.fetcher(link.mcpEndpoint(), { method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${exchanged.token}`, ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...(method === "notifications/initialized" ? {} : { id }), method, params }) });
      session = response.headers.get("mcp-session-id") ?? session;
      const text = await response.text();
      if (!response.ok) throw new Error(`Perspicax role coverage HTTP ${response.status}`);
      if (method === "notifications/initialized") return {};
      const body = parseMcpBody(text, id);
      if (!isObject(body)) throw new Error("Perspicax role coverage returned an invalid MCP response.");
      return body;
    };
    try {
      await rpc("initialize", { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: `Sagax role coverage (${botId}; ${recipe ?? "no recipe"}; ${randomUUID()})`, version: this.options.version } });
      await rpc("notifications/initialized", {});
      const listed = await rpc("tools/list", {});
      const names = new Set(isObject(listed.result) && Array.isArray(listed.result.tools) ? listed.result.tools.filter(isObject).map((tool) => String(tool.name)) : []);
      const held = names.has("identity_switch") ? heldRolesOf(identityValue(await rpc("tools/call", { name: "identity_switch", arguments: {} }))) : [];
      if (!recipe) return { held };
      const describe = names.has("flow") ? "flow" : names.has("flow_run") ? "flow_run" : undefined;
      if (!describe) return { held, flowError: "flow is not available on this account connection." };
      const body = await rpc("tools/call", { name: describe, arguments: { command: "describe", args: { name: recipe } } });
      if (isObject(body.error) || (isObject(body.result) && body.result.isError === true)) return { held, flowError: `Flow could not describe ${recipe}.` };
      return { held, card: identityValue(body) };
    } finally {
      if (session) await this.fetcher(link.mcpEndpoint(), { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(200), headers: { authorization: `Bearer ${exchanged.token}`, "mcp-session-id": session } }).then(response => response.body?.cancel()).catch(reportBackgroundError);
      void link.revokeExchanged(exchanged.token).catch(reportBackgroundError);
    }
  }

  /** Exchange the speaker's access for the account's one main connection
   * before the engine starts. Never throws and never chooses a role. */
  async prepareTurn(input: {
    threadId: string;
    generation: string;
    bot: { id: string };
    speakerPrincipalId: string;
    speakerOrigin: "person" | "operator" | "owner-routine" | "peer";
    /** The turn descends from a routine or other automation (a hop it
     * asked, a thread it opened, a room goal it runs). */
    routine?: boolean;
  /** The bot owner is the speaker only for an operator or owner-routine
   * origin. An unresolved person or peer is unknown, never the owner. */
    ownerPrincipalId?: string;
  }): Promise<PerspicaxTurnPlan> {
    const plan: PerspicaxTurnPlan = { mounted: [], unavailable: [] };
    const link = this.options.link();
    // Speaker origin is authoritative. An operator and an owner-routine are
    // the owner's own work; an unresolved person or peer must not borrow it.
    const speakerTrimmed = input.speakerPrincipalId.trim();
    const ownerTrimmed = input.ownerPrincipalId?.trim() ?? "";
    const ownerOrigin = input.speakerOrigin === "operator" || input.speakerOrigin === "owner-routine";
    const resolvedPrincipalId = speakerTrimmed || (ownerOrigin ? ownerTrimmed : "");
    if (!link) return plan;
    const refuse = (reason: PerspicaxUnavailableReason, detail?: string) => {
      plan.unavailable.push({ name: "Perspicax", reason, ...(detail ? { detail } : {}) });
    };
    const source: Entry["source"] = input.speakerOrigin === "owner-routine" || input.routine === true ? "delegation" : "session";
    const principalId = resolvedPrincipalId;
    const subject = principalId ? this.options.subjectOf(principalId) : null;
    if (!subject || subject.iss !== this.options.issuer) {
      refuse("unknown_speaker");
      return plan;
    }
    if (subject.disabled) {
      refuse("no_session");
      return plan;
    }
    const who = { iss: subject.iss, sub: subject.sub };
    // On a live call or warm engine, the last turn's parent token is still
    // good. Its MCP session is closed at the generation boundary, so role
    // state never crosses into this turn; only the account token is reused.
    const stay = this.sessionShouldStay(input.threadId);
    const retiring = stay ? this.retiring.get(input.threadId) : undefined;
    if (retiring) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([retiring, new Promise<void>((resolve) => { timer = setTimeout(resolve, RETIRE_WAIT_MS); timer.unref?.(); })]);
      if (timer) clearTimeout(timer);
    }
    // the call or warm engine ended without saying so: its kept tokens go
    if (!stay) void this.endWarm(input.threadId).catch(reportBackgroundError);
    if (stay) {
      const at = warmKey(input.threadId, principalId, source);
      const kept = this.warm.get(at);
      if (kept && !kept.ended && kept.botId === input.bot.id && kept.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS
          && (kept.budget?.active() ?? true)) {
        this.warm.delete(at);
        kept.generation = input.generation;
        const previous = this.entries.get(key(input.threadId, input.generation));
        if (previous && previous !== kept) void this.close(previous).catch(reportBackgroundError);
        this.entries.set(key(input.threadId, input.generation), kept);
        this.applyTurnRole(kept, source === "delegation");
        plan.mounted.push({ name: "Perspicax" });
        this.log(`perspicax mcp: account token kept for the ${this.options.keepWarm?.(input.threadId) ? "call" : "warm engine"}'s next turn; opening a fresh session`);
        return plan;
      }
    }
    let signIn = await this.subjectFor(source, principalId, who);
    if (!signIn.ok) {
      refuse(signIn.error === "unreachable" || signIn.error === "rate_limited" ? signIn.error : source === "delegation" ? "no_delegation" : "no_session");
      return plan;
    }
    let result = await link.exchangeToken(signIn.token);
    // a refusal that may pass a moment later (unreachable, rate limited) is
    // tried once more before the connection is left out of the turn
    if (!result.ok && TRANSIENT.has(result.error)) {
      this.log("perspicax mcp: main exchange refused for now; retrying once");
      await this.sleep(RETRY_EXCHANGE_MS);
      result = await link.exchangeToken(signIn.token);
    }
    // 2026-11-02: a routine waits out a short outage (a connector roll)
    // with backoff before a profile is left out of its turn.
    if (source === "delegation") {
      for (const wait of this.routineRetryMs) {
        if (result.ok || !TRANSIENT.has(result.error)) break;
        this.log(`perspicax mcp: routine exchange still refused; trying again in ${Math.round(wait / 1000)} s`);
        await this.sleep(wait);
        result = await link.exchangeToken(signIn.token);
      }
    }
    if (source === "delegation" && !result.ok && result.error === "subject") {
      // The cached delegation token was refused (revoked from the console,
      // for one): drop it and renew once now. A live family mounts the tools
      // for this very turn; an ended one is learned (and its routines
      // paused) now rather than at the next run.
      this.options.delegationRefused?.(principalId);
      const renewed = await this.subjectFor(source, principalId, who);
      if (renewed.ok) {
        signIn = renewed;
        result = await link.exchangeToken(renewed.token);
      }
    }
    if (!result.ok) {
      const reason: PerspicaxUnavailableReason = result.error === "not_held" ? "not_held"
        : result.error === "subject" ? (source === "delegation" ? "no_delegation" : "no_session")
        : result.error === "rate_limited" ? "rate_limited" : "unreachable";
      this.log(`perspicax mcp: main connection not mounted for this turn (${reason})`);
      refuse(reason, result.error === "not_held" ? result.description : undefined);
      return plan;
    }
    const at = key(input.threadId, input.generation);
    const previous = this.entries.get(at);
    if (previous) void this.close(previous).catch(reportBackgroundError);
    const entry: Entry = {
      threadId: input.threadId,
      generation: input.generation,
      botId: input.bot.id,
      principalId,
      subject: who,
      source,
      token: result.token,
      expiresAt: Math.min(result.expiresAt, signIn.expiresAt),
    };
    this.entries.set(at, entry);
    entry.budget = (this.options.warmBudget ?? warmResources).register({
      person: entry.principalId, kind: "perspicax",
      bytes: () => MiB + Buffer.byteLength(JSON.stringify(entry.toolsListBody ?? null)),
      protected: () => entry.keepAlivePing === true,
      evict: () => {
        const warm = warmKey(entry.threadId, entry.principalId, entry.source);
        if (this.warm.get(warm) === entry) this.warm.delete(warm);
        return this.close(entry);
      },
    });
    this.applyTurnRole(entry, source === "delegation");
    plan.mounted.push({ name: "Perspicax" });
    return plan;
  }

  /** Visible roles: the role this turn starts under. The person's composer
   * pick fixes it for the turn; a routine's "Au nom de" is its one pick at
   * the start (the relay switches once more only on a refused read). No
   * pick: the default surface ("Moi"), never a stored choice. */
  private applyTurnRole(entry: Entry, routine: boolean): void {
    entry.writeRefused = false;
    entry.readRefused = false;
    entry.switches = 0;
    entry.roleOffer = undefined;
    // a one-call switch the last turn left open goes back first
    if (entry.oneCall) this.putBack(entry, entry.oneCall.back);
    entry.oneCall = undefined;
    entry.switchedPaths = undefined;
    entry.meWritesAllowed = undefined;
    entry.lapsedNow = false;
    entry.roleLocked = false;
    entry.routineRole = undefined;
    entry.roleReason = routine ? "routine" : "default";
    let picked: { slug: string; reason: "person" | "routine" } | undefined;
    try { picked = this.options.turnRole?.({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, routine }); } catch { picked = undefined; }
    if (!picked) return;
    const slug = picked.slug.trim();
    entry.roleReason = picked.reason;
    entry.roleLocked = picked.reason === "person";
    if (picked.reason === "routine" && slug) entry.routineRole = slug;
    if (slug && slug !== this.currentRole(entry)) this.setIdentity(entry, slug);
  }

  /** #2581: the role a one-call switch left goes back to `back` (applied by
   * the next call's identity ensure, like "Rester en …"). */
  private putBack(entry: Entry, back: string): void {
    if (this.currentRole(entry) === back) return;
    if (back) this.setIdentity(entry, back);
    else {
      const identity = entry.identity;
      entry.identity = undefined;
      void identity?.clear().catch(() => undefined);
      if (entry.profileChoice) {
        entry.profileChoice = undefined;
        void this.identityRpc(entry, "tools/call", { name: "profile_use", arguments: { clear: true } }).catch(() => undefined);
      }
    }
    this.clearToolCatalog(entry);
    entry.toolsChangedPending = true;
  }

  /** "Rester en …" on an "Agit comme" card: every live connection of this
   * thread goes back to (or stays in) `slug` and the bot may not switch away
   * for the rest of the turn. The next call applies it (identity ensure). */
  stayInRole(threadId: string, slug: string): void {
    for (const entry of this.entries.values()) {
      if (entry.threadId !== threadId || entry.ended) continue;
      if (this.currentRole(entry) !== slug) {
        if (slug) this.setIdentity(entry, slug);
        else {
          const identity = entry.identity;
          entry.identity = undefined;
          void identity?.clear().catch(() => undefined);
          if (entry.profileChoice) {
            entry.profileChoice = undefined;
            void this.identityRpc(entry, "tools/call", { name: "profile_use", arguments: { clear: true } }).catch(() => undefined);
          }
        }
        this.clearToolCatalog(entry);
        entry.toolsChangedPending = true;
      }
      entry.roleLocked = true;
      entry.roleReason = "person";
    }
  }

  /** The role the connection acts as now ("" = Moi, the default surface). */
  private currentRole(entry: Entry): string {
    return entry.identity ? entry.identity.profile() : entry.profileChoice ?? ME_ROLE;
  }

  private roleView(entry: Entry, slug: string): { slug: string; name: string } {
    // "" is "Moi": the client words it in the reader's language
    if (!slug) return { slug: ME_ROLE, name: "" };
    return { slug, name: entry.heldRoles?.find((role) => role.slug === slug)?.name ?? slug };
  }

  /** The held roles' names, read once per turn when a role must be named
   * (identity_switch without argument: a read, on this very connection). */
  private async ensureHeldRoles(entry: Entry): Promise<void> {
    if (entry.heldRoles || (entry.servedTools && !entry.servedTools.has("identity_switch"))) return;
    entry.heldRoles = [];
    try {
      const body = await this.identityRpc(entry, "tools/call", { name: "identity_switch", arguments: {} });
      this.noteListing(entry, identityValue(body));
    } catch { /* names fall back to the slug */ }
  }

  private noteListing(entry: Entry, value: Json): void {
    const held = heldRolesOf(value);
    if (held.length) entry.heldRoles = held;
    // a listing that serves no profile id still names the acting one in its
    // act-as token scope (profile:<id>): the Roles tab joins journal rows by it
    const actingRole = actingAsOf(value);
    if (actingRole?.id) (entry.roleIds ??= new Map()).set(actingRole.slug, actingRole.id);
    if (entry.roleIds && entry.heldRoles) entry.heldRoles = entry.heldRoles.map((role) => role.id || !entry.roleIds!.has(role.slug) ? role : { ...role, id: entry.roleIds!.get(role.slug)! });
    const acting = isObject(value.acting_as) ? value.acting_as : null;
    if (acting && typeof acting.target_identity === "string") entry.targetIdentity = acting.target_identity.slice(0, 200);
  }

  private emitRole(entry: Entry, kind: PerspicaxRoleEvent["kind"], tool: string, role: ToolRole, extra: Partial<PerspicaxRoleEvent> = {}): void {
    try {
      this.options.onRole?.({
        threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, routine: entry.source === "delegation",
        kind, tool, role, ...(entry.targetIdentity ? { target: entry.targetIdentity } : {}),
        ...(entry.heldRoles?.length ? { held: entry.heldRoles } : {}), ...extra,
      });
    } catch { /* a role note never changes the answer */ }
  }

  /** Relay one JSON-RPC frame from a bridge to Perspicax /mcp. `judged`:
   * the call comes from callTool, whose native tool the agents proxy already
   * put through the permission check, so it is not judged (nor audited) twice. */
  async relay(input: { threadId: string; generation: string; botId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const answer = await this.relayKept(input);
    this.noteRemoteSupport(input, answer);
    return answer;
  }

  /** Hand a remote_support_* answer to onRemoteSupport, without waiting for it. */
  private noteRemoteSupport(input: { threadId: string; generation: string; botId: string; frame: unknown }, answer: PerspicaxRelayAnswer) {
    const hook = this.options.onRemoteSupport;
    if (!hook || !isObject(input.frame) || input.frame.method !== "tools/call") return;
    const params = isObject(input.frame.params) ? input.frame.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    if (!name.startsWith("remote_support_")) return;
    if (answer.status !== 200 || !isObject(answer.body) || !isObject(answer.body.result)) return;
    try {
      // the person whose token made the call: the session is theirs
      const principalId = this.turnPrincipal(input.threadId, input.generation, input.botId);
      hook({ threadId: input.threadId, botId: input.botId, ...(principalId ? { principalId } : {}), name, args: params.arguments ?? {}, result: answer.body.result });
    } catch {
      /* the answer goes back unchanged */
    }
  }

  private async relayKept(input: { threadId: string; generation: string; botId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const once = this.writeOnceKey(input);
    if (!once) return this.relayFrame(input);
    const kept = (answer: PerspicaxRelayAnswer) => answer.status === 200 && isObject(answer.body) && isObject(answer.body.result) && answer.body.result.isError !== true;
    const { value, replayed } = await this.writes.run(once, () => this.relayFrame(input), kept);
    if (!replayed || !isObject(value.body) || !isObject(value.body.result)) return value;
    this.log("perspicax mcp: write not sent again (same execution key)");
    const result = value.body.result;
    const content = Array.isArray(result.content) ? result.content : [];
    return { status: 200, body: { ...value.body, id: (input.frame as Json).id, result: { ...result, content: [{ type: "text", text: PERSPICAX_WRITE_REPLAYED }, ...content] } } };
  }

  /** The execution key of a write this turn makes once, or null. */
  private writeOnceKey(input: { threadId: string; generation: string; botId: string; frame: unknown }): string | null {
    if (!this.options.writeOnceScope || !isObject(input.frame)) return null;
    const frame = input.frame;
    if (frame.method !== "tools/call" || frame.id === undefined || perspicaxReplayable(frame)) return null;
    const params = isObject(frame.params) ? frame.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    if (!perspicaxWriteOnceTool(name)) return null;
    const entry = this.entries.get(key(input.threadId, input.generation));
    if (!entry || entry.botId !== input.botId) return null;
    const scope = this.options.writeOnceScope({ threadId: input.threadId, botId: input.botId, principalId: entry.principalId });
    if (!scope) return null;
    return executionKey([scope, entry.principalId, entry.identity?.profile() || entry.profileChoice || "default", name, params.arguments ?? {}]);
  }

  /** Visible roles around one engine frame: the identity tools keep the
   * role rules (a role the person fixed, a refused write), a write as "Moi"
   * in a routine under a role asks the person, a read refused (403) under a
   * role is read once more as "Moi", a refused write stops, a lapse stops
   * the call; every call's role is reported (onRole). */
  private async relayFrame(input: { threadId: string; generation: string; botId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const entry = this.entries.get(key(input.threadId, input.generation));
    const frame = isObject(input.frame) ? input.frame : null;
    const params = frame && isObject(frame.params) ? frame.params : null;
    const name = params && typeof params.name === "string" ? params.name : "";
    if (input.judged || !this.options.onRole || !entry || entry.botId !== input.botId || !frame || frame.method !== "tools/call" || frame.id === undefined || !name) {
      return this.relayFrameCore(input);
    }
    const id = frame.id;
    const args = params && isObject(params.arguments) ? params.arguments : {};
    const before = this.currentRole(entry);
    if (name === "identity_switch" || name === "profile_use") {
      const target = typeof args.profile === "string" && args.profile.trim() ? args.profile.trim() : args.clear === true ? ME_ROLE : undefined;
      // #2581 (decided 2026-11-07): the role Sagax offered after a read 403. The
      // bot takes it itself only when the person already allowed it (said so
      // in the conversation, or a saved instruction): one call, then back.
      const offer = entry.roleOffer;
      if (offer && target === offer.to && before === offer.from && !entry.roleLocked && !entry.writeRefused) {
        entry.roleOffer = undefined;
        (entry.switchedPaths ??= new Set()).add(offer.path);
        const answer = await this.relayFrameCore(input);
        this.noteListing(entry, identityValue(answer.body));
        const after = this.currentRole(entry);
        if (after !== before) { entry.roleReason = "switch"; entry.oneCall = { back: before, via: name }; }
        if (after) await this.ensureHeldRoles(entry);
        this.emitRole(entry, "step", name, { ...this.roleView(entry, after), reason: entry.roleReason ?? "default", ...(after !== before ? { previous: this.roleView(entry, before) } : {}) });
        if (after === before) return answer;
        const back = this.roleView(entry, before).name || "the person's own account";
        return withNote(answer, `Sagax runs only your next call as ${this.roleView(entry, after).name || "the person's own account"}, then puts ${back} back by itself. Send the refused read again now; no other call in between.`);
      }
      if (target !== undefined && target !== before && (entry.roleLocked || entry.writeRefused || entry.readRefused || (entry.switches ?? 0) >= 1)) {
        await this.ensureHeldRoles(entry);
        const now = this.roleView(entry, before);
        const why = entry.roleLocked
          ? `Refused by Sagax: the person fixed the role for this turn (${now.name || "their own account"}). Keep working under it; do not switch roles.`
          : entry.writeRefused
            ? "Refused by Sagax: a write was refused (403) in this turn. Stop and report the missing permission; switching roles to get around it is not allowed."
            : entry.readRefused
              ? "Refused by Sagax: a read was refused (403) in this turn and its one role switch is spent (the person declined it, or the other role was refused too). Report what could not be read and the missing permission; do not try other roles."
              : `Refused by Sagax: one role switch per turn, and this turn already switched (now ${now.name || "the person's own account"}). Keep working under it, or report what is blocked.`;
        this.emitRole(entry, "step", name, { ...now, reason: entry.roleReason ?? "default" });
        return toolError(id, why);
      }
      const answer = await this.relayFrameCore(input);
      this.noteListing(entry, identityValue(answer.body));
      const after = this.currentRole(entry);
      if (after !== before) { entry.roleReason = "switch"; entry.switches = (entry.switches ?? 0) + 1; }
      if (after) await this.ensureHeldRoles(entry);
      this.emitRole(entry, "step", name, { ...this.roleView(entry, after), reason: entry.roleReason ?? "default", ...(after !== before ? { previous: this.roleView(entry, before) } : {}) });
      return answer;
    }
    // a role change forgets the catalogue: read it again on this very
    // connection before telling a read from a write
    if (!entry.readOnlyTools && !PERSPICAX_READ_ONLY_TOOLS.has(name)) await this.identityRpc(entry, "tools/list").catch(() => undefined);
    const read = perspicaxReplayable(frame, entry.readOnlyTools);
    // #2581: the offered read sent again: the person decides with a card
    const offered = entry.roleOffer;
    if (read && offered && offered.tool === name && offered.from === before) {
      entry.roleOffer = undefined;
      return this.switchOnceWithCard(entry, frame, id, name, offered);
    }
    if (!read && entry.source === "delegation" && entry.routineRole && before === ME_ROLE && vendorWriteTool(name) && !entry.meWritesAllowed?.has(name)) {
      await this.ensureHeldRoles(entry);
      const role = this.roleView(entry, entry.routineRole);
      const permission = cwPermissionFor(name, args, false);
      let answer: "allow" | "deny" | "timeout" = "deny";
      try { answer = this.options.askMeWrite ? await this.options.askMeWrite({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, role, tool: name, permission }) : "deny"; } catch { answer = "deny"; }
      if (answer !== "allow") {
        return toolError(id, `Not sent: this routine runs as ${role.name}; writing in the person's own name changes who the vendor records as the author, and the person did not approve it. Switch back to ${role.name} (identity_switch) or report what is missing.`);
      }
      (entry.meWritesAllowed ??= new Set()).add(name);
    }
    const answer = await this.relayFrameCore(input);
    // #2581: the one call the bot ran under the offered role is done: back
    const oneCall = entry.oneCall;
    if (oneCall && before !== oneCall.back) { entry.oneCall = undefined; this.putBack(entry, oneCall.back); }
    if (entry.lapsedNow || (isObject(answer.body) && isObject(answer.body.error) && /could not restore the explicitly selected/.test(String(answer.body.error.message ?? "")))) {
      const lapsed = entry.lapsedNow;
      entry.lapsedNow = false;
      await this.ensureHeldRoles(entry);
      this.emitRole(entry, "lapsed", name, { ...this.roleView(entry, before), reason: entry.roleReason ?? "default" });
      if (lapsed) return toolError(id, `Stopped by Sagax: the role ${this.roleView(entry, before).name || before} lapsed and could not be renewed, so this call did not run under it. Tell the person; do not retry under another role.`);
      return answer;
    }
    const refusal = answer.status === 200 ? roleRefusalOf(answer.body) : null;
    if (!refusal) {
      if (before) await this.ensureHeldRoles(entry);
      this.emitRole(entry, "step", name, { ...this.roleView(entry, before), reason: entry.roleReason ?? "default" });
      return answer;
    }
    if (before) await this.ensureHeldRoles(entry);
    const permission = cwPermissionFor(name, args, read);
    const refusedRole = this.roleView(entry, before);
    const label = refusedRole.name || "the person's own account";
    const needs = `${permission.module ? `${permission.module} > ${permission.func}` : permission.func}${permission.path ? ` (${permission.path})` : ""}, ${permission.operation}`;
    if (!read) {
      entry.writeRefused = true;
      this.emitRole(entry, "write_refused", name, { ...refusedRole, reason: entry.roleReason ?? "default" }, { permission, refusedRole });
      return withNote(answer, `STOP: this write was refused (403) under ${label}. Missing permission: ${needs}. Do not retry it under another role; report the missing permission to the person.`);
    }
    // #2577/#2581: a refusal is never "no data"; decided 2026-11-07: the bot's
    // limited role is wanted, so a read refused looks for one held role that
    // may read it (live listing), switches for this one call only when the
    // person allowed it (a rule, or what they said), else asks with a card.
    const readStop = (why: string) => `STOP: this read was refused (403) under ${label}${why}. Missing permission: ${needs}. This is a permission block, not missing data: do not retry the same records with other tools or another connection, and do not answer as if the records were empty. Tell the person the read is blocked and which permission the account needs; never say it needs an admin or that nothing can be done.`;
    const blocked = (why: string) => {
      entry.readRefused = true;
      this.emitRole(entry, "read_refused", name, { ...refusedRole, reason: entry.roleReason ?? "default" }, { permission, refusedRole });
      return blockWith(answer, id, readStop(why));
    };
    if (oneCall && before !== oneCall.back) return blocked(", the one role switch for it");
    if (entry.switchedPaths?.has(permission.path)) return blocked(", and its one role switch in this turn is spent");
    const candidate = await this.switchCandidate(entry, before, permission.path);
    const decision = this.options.roleFallback?.({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, from: before, path: permission.path, ...(candidate ? { to: candidate.slug } : {}) }) ?? "fallback";
    if (decision === "stay") return blocked(", and the person asked to stay in that role: no switch");
    if (!candidate) return blocked(", and no other role you hold can be tried");
    if (candidate.slug !== ME_ROLE && decision !== "rule") {
      // no rule: the bot decides whether the person already allowed it
      entry.roleOffer = { from: before, to: candidate.slug, tool: name, path: permission.path, permission, needs };
      this.emitRole(entry, "read_refused", name, { ...refusedRole, reason: entry.roleReason ?? "default" }, { permission, refusedRole });
      const other = candidate.name || candidate.slug;
      return blockWith(answer, id, `REFUSED: this read was refused (403) under ${label}. Missing permission: ${needs}. This is a permission block, not missing data: never answer as if the records were empty. Another role you hold, ${other} (profile "${candidate.slug}"), may read it. Run this one call as ${other}, exactly one of:\n- the person already allowed it (said so in this conversation, or a saved instruction says so): call identity_switch with profile "${candidate.slug}", then this same call; Sagax runs that one call as ${other} and puts ${label} back by itself;\n- otherwise: call this same tool again with the same arguments; Sagax asks the person with an approval card to run it once as ${other}.\nIf the person declines, tell them what could not be read and the missing permission. Do not try any other role or tool for it.`);
    }
    (entry.switchedPaths ??= new Set()).add(permission.path);
    const again = await this.readAs(entry, frame, before, candidate.slug);
    if (!again || again.status !== 200 || roleRefusalOf(again.body) || (isObject(again.body) && isObject(again.body.error))) {
      return blocked(candidate.slug ? ` and again as ${candidate.name || candidate.slug}` : " and again in the person's own name");
    }
    const reason = decision === "rule" ? "rule" : "fallback";
    this.emitRole(entry, "step", name, { slug: candidate.slug, name: candidate.name, reason, refusedTool: name, previous: refusedRole }, { permission, refusedRole });
    return withNote(again, candidate.slug
      ? `Sagax read this once as ${candidate.name || candidate.slug} (the person's saved rule): ${label} was refused (403) for it (missing ${needs}). The next call runs under ${label} again.`
      : `Sagax read this once in the person's own name: ${label} was refused (403) for it (missing ${needs}). The next call runs under ${label} again.`);
  }

  /** #2581: the one held role worth one try after a read 403 under `from`,
   * from the live listing: "Moi" (the default surface) under a role; under
   * "Moi", a role the person holds that reads and that the journal has not
   * seen refused for this path, explicit-only ones first (the default
   * surface leaves them out). Null: none. */
  private async switchCandidate(entry: Entry, from: string, path: string): Promise<{ slug: string; name: string } | null> {
    await this.ensureHeldRoles(entry);
    if (from !== ME_ROLE) return { slug: ME_ROLE, name: "" };
    const held = (entry.heldRoles ?? []).filter((role) => role.slug !== from && role.reachable && role.can?.read !== false
      && !this.options.knownReadRefusal?.({ principalId: entry.principalId, botId: entry.botId, slug: role.slug, path }));
    const pick = held.find((role) => role.explicitOnly) ?? held[0];
    return pick ? { slug: pick.slug, name: pick.name } : null;
  }

  /** #2581: the offered read, after the person's card: run once as the
   * offered role and put the role back, or report the read not done. */
  private async switchOnceWithCard(entry: Entry, frame: Json, id: unknown, name: string, offer: NonNullable<Entry["roleOffer"]>): Promise<PerspicaxRelayAnswer> {
    const from = this.roleView(entry, offer.from);
    const to = this.roleView(entry, offer.to);
    const label = from.name || "the person's own account";
    const other = to.name || to.slug;
    (entry.switchedPaths ??= new Set()).add(offer.path);
    let answer: "allow" | "deny" | "timeout" = "deny";
    try { answer = this.options.askRoleSwitch ? await this.options.askRoleSwitch({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, from, to, tool: name, permission: offer.permission }) : "deny"; } catch { answer = "deny"; }
    const stop = (why: string) => {
      entry.readRefused = true;
      this.emitRole(entry, "read_refused", name, { ...from, reason: entry.roleReason ?? "default" }, { permission: offer.permission, refusedRole: from });
      return toolError(id, `STOP: not read. ${label} was refused (403) for it (missing ${offer.needs}) and ${why}. This is a permission block, not missing data: tell the person what could not be read and which permission ${label} needs; do not try other roles or tools.`);
    };
    if (answer !== "allow") return stop(`the person did not approve reading it once as ${other}`);
    const again = await this.readAs(entry, frame, offer.from, offer.to);
    if (!again || again.status !== 200 || roleRefusalOf(again.body) || (isObject(again.body) && isObject(again.body.error))) return stop(`it was refused again as ${other}`);
    this.emitRole(entry, "step", name, { slug: to.slug, name: to.name, reason: "fallback", refusedTool: name, previous: from }, { permission: offer.permission, refusedRole: from });
    return withNote(again, `Sagax read this once as ${other} with the person's approval: ${label} was refused (403) for it (missing ${offer.needs}). The next call runs under ${label} again.`);
  }

  /** One read sent again as `target` ("" = the person's own name, "Moi")
   * after a 403 under `previous`, then `previous` put back for the next call.
   * Never a write; never more than once per call. */
  private async readAs(entry: Entry, frame: Json, previous: string, target: string): Promise<PerspicaxRelayAnswer | null> {
    const link = this.options.link();
    if (!link || entry.ended) return null;
    const viaChoice = !entry.identity && entry.profileChoice === previous;
    const tool = viaChoice ? "profile_use" : "identity_switch";
    try {
      await this.identityRpc(entry, "tools/call", { name: tool, arguments: target ? { profile: target } : { clear: true } });
      this.clearToolCatalog(entry);
      const sent = await this.send(link, entry, { ...frame }, undefined, true);
      if (typeof sent === "string" || !sent.response.ok) return null;
      return { status: 200, body: parseMcpBody(sent.text, frame.id) };
    } catch {
      return null;
    } finally {
      try {
        const back = await this.identityRpc(entry, "tools/call", { name: tool, arguments: previous ? { profile: previous } : { clear: true } });
        if (!viaChoice) await entry.identity?.observe(back);
        else entry.profileChoiceNeedsRestore = false;
      } catch {
        entry.identity?.invalidate();
        if (viaChoice) entry.profileChoiceNeedsRestore = true;
      }
      this.clearToolCatalog(entry);
    }
  }

  private async relayFrameCore(input: { threadId: string; generation: string; botId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const entry = this.entries.get(key(input.threadId, input.generation));
    if (!entry || entry.botId !== input.botId) return { status: 403, body: { error: "the Perspicax connection is not mounted in this turn", code: "profile_not_mounted" } };
    if (!isObject(input.frame)) return { status: 400, body: rpcError(null, -32600, "Invalid Request") };
    const frame: Json = { ...input.frame };
    const id = frame.id;
    const notification = id === undefined;
    const ended = (): PerspicaxRelayAnswer => (notification ? { status: 202 } : { status: 200, body: rpcError(id, -32001, PERSPICAX_ACCESS_ENDED) });
    if (!this.entryMounted(entry)) {
      return { status: 403, body: { error: "this bot is no longer available for the Perspicax connection", code: "profile_not_mounted" } };
    }
    // a tools/call is always a request: one without an id would run with no
    // answer and no guard (re-review of #956)
    if (frame.method === "tools/call" && notification) return { status: 400, body: rpcError(null, -32600, "tools/call needs an id") };
    // a bot's own voice_call, whatever the path, is a place_phone_call; a
    // dry run sends nothing and goes as it is
    if (!input.judged && frame.method === "tools/call") {
      const params = isObject(frame.params) ? frame.params : {};
      const voice = voiceToolCall(String(params.name ?? ""), params.arguments);
      if (voice?.tool === "voice_call" && voice.args.dry_run !== true && voice.args._dry_run !== true) {
        const placed = this.options.placeCall
          ? await this.options.placeCall({ threadId: input.threadId, generation: input.generation, botId: input.botId }, placeArgsFromVoiceCall(voice.args))
          : { text: VOICE_CALL_UNAVAILABLE, isError: true };
        const text = this.options.placeCall ? `${VOICE_CALL_REDIRECTED}\n\n${placed.text}` : placed.text;
        return { status: 200, body: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(placed.isError ? { isError: true } : {}) } } };
      }
      // remote_support_open: never forward model-chosen host_id / nodekey /
      // session. Sagax fills them (attached owned hosts + a key of its own).
      if (String(params.name ?? "") === "remote_support_open") {
        const args = isObject(params.arguments) ? params.arguments as Record<string, unknown> : {};
        const opened = this.options.openRemoteSupport
          ? await this.options.openRemoteSupport({
            threadId: input.threadId,
            generation: input.generation,
            botId: input.botId,
            principalId: entry.principalId,
            args,
          })
          : { text: REMOTE_SUPPORT_OPEN_UNAVAILABLE, isError: true };
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: opened.text }], ...(opened.isError ? { isError: true } : {}) },
          },
        };
      }
    }
    const blocked = input.judged ? null : telephonyBlock(frame, entry.twilioTools) ?? await this.permissionBlock(entry, frame);
    if (blocked) return { status: 200, body: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: blocked }], isError: true } } };
    const speaker = this.options.subjectOf(entry.principalId);
    if (!speaker || speaker.disabled) this.end(entry);
    if (entry.ended) return ended();
    if (entry.expiresAt - this.now() < PERSPICAX_TOKEN_MIN_LIFE_MS && !(await this.renew(entry))) return ended();
    if (frame.method === "initialize") {
      const params = isObject(frame.params) ? { ...frame.params } : {};
      params.clientInfo = { name: `Pulsa Bot (${input.botId})`, version: this.options.version };
      if (this.options.askGo) params.capabilities = withElicitation(params.capabilities);
      frame.params = params;
      this.rememberInit(entry, params);
    }
    const link = this.options.link();
    if (!link) return ended();
    // A turn's entry starts without a session while the engine may keep the
    // bridge it initialized on an earlier turn: open one first, or Perspicax
    // answers 422 "expect initialize request".
    if (frame.method !== "initialize" && !notification && !entry.initialized && !entry.mcpSessionId && (entry.identity || this.initParams.has(initKey(entry.threadId)))) {
      await this.reopen(link, entry);
    }
    if (!notification && frame.method !== "initialize") {
      if (!roleRecoveryFrame(frame)) {
        await entry.identity?.ensure();
        if (entry.identity && !entry.identity.active()) {
          return { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected identity; this call was not sent") };
        }
        if (entry.profileChoiceRestoreFailed) {
          return { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected role; this call was not sent") };
        }
        if (entry.profileChoice && entry.profileChoiceNeedsRestore && !await this.restoreProfileChoice(link, entry)) {
          return { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected role; this call was not sent") };
        }
      }
      // Same MCP session and identity already listed tools (Sagax identity
      // lease or an earlier engine list): serve that body. Invalidation is
      // reopen, identity clear/invalidate, list_changed, retire.
      if (frame.method === "tools/list" && entry.toolsListBody !== undefined && entry.mcpSessionId) {
        return { status: 200, body: rewriteResponseId(entry.toolsListBody, id) };
      }
    }
    const usedSession = entry.mcpSessionId;
    const sent = entry.source === "delegation" && !notification
      ? await this.sendForRoutine(link, entry, frame)
      : await this.send(link, entry, frame);
    if (sent === "ended") return ended();
    if (sent === "selection_unavailable") {
      return notification
        ? { status: 202 }
        : { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected identity or role; this call was not sent") };
    }
    if (sent === "unreachable") return notification ? { status: 202 } : { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
    let { response, text } = sent;
    if (frame.method === "initialize" && perspicaxSessionLost(response.status, text)) {
      // Turn setup may prewarm the remote session before a cold Cloud
      // environment is ready. Perspicax closes an idle session after 120 s,
      // so the real engine initialize can arrive with that expired id. Open
      // one fresh session from the initialize we just remembered and return
      // its result under the engine's id. This retry is bounded by reopen's
      // single flight and never replays a tool call.
      const reopened = await this.reopen(link, entry);
      this.log(`perspicax mcp: prewarmed session expired before client initialize (HTTP ${response.status}); ${reopened ? "a fresh one is open" : "a fresh one could not be opened"}`);
      if (!reopened) return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
      return { status: 200, body: rewriteResponseId(reopened.body, id) };
    }
    if (frame.method !== "initialize" && perspicaxSessionLost(response.status, text)) {
      // Perspicax dropped the session (idle past its keep-alive, a restart):
      // initialize again, once; send a read again, never a write.
      // a concurrent call may have opened the new session already
      const reopened = entry.mcpSessionId !== undefined && entry.mcpSessionId !== usedSession ? true : await this.reopen(link, entry);
      // an entry that never saw a tools/list (the engine listed on an earlier
      // turn) reads it on the new session to know which tools only read
      if (reopened && !notification && frame.method === "tools/call" && !entry.readOnlyTools && !perspicaxReplayable(frame)) {
        await this.identityRpc(entry, "tools/list").catch(() => undefined);
      }
      const replay = reopened && !notification && perspicaxReplayable(frame, entry.readOnlyTools);
      this.log(`perspicax mcp: main session lost (HTTP ${response.status}); ${reopened ? "a new one is open" : "a new one could not be opened"}; ${replay ? "read sent again" : notification ? "notification dropped" : "call not replayed"}`);
      if (notification) return { status: 202 };
      if (!reopened) return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
      if (!replay) return { status: 200, body: rpcError(id, -32000, PERSPICAX_SESSION_RESET) };
      await entry.identity?.ensure(true);
      if (entry.identity && !entry.identity.active()) {
        return { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected identity; this call was not sent") };
      }
      const again = await this.send(link, entry, frame);
      if (again === "ended") return ended();
      if (again === "selection_unavailable") {
        return { status: 200, body: rpcError(id, -32000, "Perspicax could not restore the explicitly selected identity or role; this call was not sent") };
      }
      if (again === "unreachable") return { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
      ({ response, text } = again);
    }
    // Client→server list_changed is unusual; clear before the 202 return so
    // a later tools/list cannot serve a stale body. Server→client clears in send().
    if (notification) {
      if (frame.method === "notifications/tools/list_changed") this.clearToolCatalog(entry);
      return { status: 202 };
    }
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = parseMcpBody(text, id);
      } catch {
        body = null;
      }
      if (isObject(body) && isObject(body.error)) return { status: 200, body };
      return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
    }
    try {
      let body = parseMcpBody(text, id);
      if (entry.identity && identityLapsed(body)) {
        entry.identity.invalidate();
        this.clearToolCatalog(entry);
        await entry.identity.ensure(true);
        if (!entry.identity.active()) {
          // Visible roles: a lapsed role stops the call (relayFrame says so).
          entry.lapsedNow = true;
          return { status: 200, body };
        }
        // act_as_expired explicitly says the operation was refused. One retry,
        // including a write, is safe; never recurse if it lapses again.
        const retry = await this.send(link, entry, frame);
        if (typeof retry !== "string") body = parseMcpBody(retry.text, id);
      }
      if (frame.method === "initialize" && isObject(body) && isObject(body.result)) entry.initialized = true;
      if (frame.method === "tools/call" && isObject(frame.params) && frame.params.name === "identity_switch") {
        const value = identityValue(body);
        const failed = Boolean(isObject(body) && (body.error || (isObject(body.result) && body.result.isError === true)));
        const args = isObject(frame.params.arguments) ? frame.params.arguments : {};
        const changesIdentity = args.clear === true || (typeof args.profile === "string" && args.profile.trim().length > 0);
        if (failed) {
          const reason = identityFailureReason(body);
          if (entry.identityWarning !== reason) {
            entry.identityWarning = reason;
            this.options.onIdentityWarning?.({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, reason });
          }
        } else if (changesIdentity && isObject(value.acting_as) && typeof value.acting_as.slug === "string") {
          this.clearToolCatalog(entry);
          if (value.changed === true) entry.toolsChangedPending = true;
          if (!entry.identity) this.setIdentity(entry, value.acting_as.slug);
          await entry.identity?.observe(body);
          entry.identityWarning = undefined;
          entry.profileChoice = undefined;
          entry.profileChoiceNeedsRestore = false;
          entry.profileChoiceRestoreFailed = false;
        } else if (changesIdentity && Object.hasOwn(value, "acting_as") && value.acting_as === null) {
          this.clearToolCatalog(entry);
          if (value.changed === true) entry.toolsChangedPending = true;
          await entry.identity?.observe(body);
          await entry.identity?.detach();
          entry.identity = undefined;
          entry.identityWarning = undefined;
          entry.profileChoice = undefined;
          entry.profileChoiceNeedsRestore = false;
          entry.profileChoiceRestoreFailed = false;
        }
      }
      if (frame.method === "tools/call" && isObject(frame.params) && frame.params.name === "profile_use") {
        const value = identityValue(body);
        const failed = !isObject(body) || Boolean(body.error) || (isObject(body.result) && body.result.isError === true);
        const args = isObject(frame.params.arguments) ? frame.params.arguments : {};
        const changesProfile = args.clear === true || (typeof args.profile === "string" && args.profile.trim().length > 0);
        if (!failed && changesProfile) {
          const chosen = typeof value.in_use === "string" && value.in_use.trim() ? value.in_use.trim() : undefined;
          await entry.identity?.detach();
          entry.identity = undefined;
          entry.profileChoice = chosen;
          entry.profileChoiceNeedsRestore = false;
          entry.profileChoiceRestoreFailed = false;
          this.clearToolCatalog(entry);
          if (value.changed === true) entry.toolsChangedPending = true;
        }
      }
      if (frame.method === "tools/list" && body !== null) {
        const served = isObject(body) && isObject(body.result) && Array.isArray(body.result.tools)
          ? body.result.tools.filter((tool): tool is Json => isObject(tool) && typeof tool.name === "string").map((tool) => String(tool.name)) : [];
        entry.servedTools = new Set(served.slice(0, 2000));
        entry.readOnlyTools = new Set(perspicaxReadOnlyToolsOf(body).slice(0, 2000));
        const named = twilioToolsOf(body);
        entry.twilioTools = new Set(named.slice(0, 500));
        entry.toolsListBody = body;
      }
      if (frame.method === "tools/call") body = withFailureWords(body, isObject(frame.params) ? String(frame.params.name ?? "") : "");
      const answer: PerspicaxRelayAnswer = body === null
        ? { status: 200, body: rpcError(id, -32000, "Perspicax sent no answer") }
        : { status: 200, body };
      if (entry.toolsChangedPending) {
        entry.toolsChangedPending = false;
        answer.toolsChanged = true;
      }
      return answer;
    } catch {
      return { status: 200, body: rpcError(id, -32000, "Perspicax sent an answer that is not JSON") };
    }
  }

  /** The refusal sentence when permissions are enforced and deny this
   * tools/call; null otherwise (shadow audits and lets it through). */
  private async permissionBlock(entry: Entry, frame: Json): Promise<string | null> {
    if (frame.method !== "tools/call" || frame.id === undefined) return null;
    const options = this.options.permissionGuard?.({ botId: entry.botId, principalId: entry.principalId });
    if (!options) return null;
    const params = isObject(frame.params) ? frame.params : {};
    const pass = { text: "" };
    const result = await guardToolCall(options, String(params.name ?? ""), isObject(params.arguments) ? params.arguments : {}, async () => pass);
    return result === pass ? null : result.text;
  }

  /** The live main connection of a turn whose bot still exists. */
  private turnEntry(threadId: string, generation: string, botId: string): Entry | undefined {
    const entry = this.entries.get(key(threadId, generation));
    return entry && entry.botId === botId && !entry.ended && this.entryMounted(entry) ? entry : undefined;
  }

  private entryMounted(entry: Entry): boolean {
    return this.options.botExists?.(entry.botId) !== false;
  }

  /** The MCP server name this turn gives its main connection, so a
   * tool name from a gateway answer can be sent to the server that runs it. */
  setMount(threadId: string, generation: string, server: string): void {
    const entry = this.entries.get(key(threadId, generation));
    if (entry) entry.mount = server;
  }

  /** The MCP server of this turn that runs `name`: the main mount when it
   * lists the tool, or the same main mount before a listing is known. */
  toolHome(threadId: string, generation: string, botId: string, name?: string): { server: string; served: boolean } | undefined {
    const entry = this.turnEntry(threadId, generation, botId);
    if (!entry?.mount) return undefined;
    return { server: entry.mount, served: Boolean(name && entry.servedTools?.has(servedSpelling(name, entry.servedTools))) };
  }

  /** The person this turn's Perspicax token speaks for, if connected. */
  turnPrincipal(threadId: string, generation: string, botId: string): string | undefined {
    return this.turnEntry(threadId, generation, botId)?.principalId || undefined;
  }

  /** Whether this turn of the bot has its Perspicax connection mounted, so the
   * harness may call a Perspicax tool in the speaker's name (callTool). */
  hasMounted(threadId: string, generation: string, botId: string): boolean {
    return this.turnEntry(threadId, generation, botId) !== undefined;
  }

  /** The Perspicax role / profile slug this thread acts as now (routine
   * act-as, profile_use, identity_switch). Empty "Moi" and a missing
   * connection are undefined so the Grok gateway catalog keeps the first
   * connector (Perspicax #1050, Sagax #2258). */
  activeProfileFor(threadId: string, botId?: string): string | undefined {
    const want = threadId.trim();
    if (!want) return undefined;
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.ended || entry.threadId !== want) continue;
      if (botId && entry.botId !== botId) continue;
      if (!this.entryMounted(entry)) continue;
      const role = this.currentRole(entry).trim();
      if (role) return role;
    }
    return undefined;
  }

  /** Read the product names Perspicax declares for this bot's APIs
   * (api_list), at most once per API_NAMES_TTL_MS per bot. Never throws;
   * the turn never waits on it. */
  async refreshApiNames(input: { threadId: string; generation: string; botId: string }): Promise<void> {
    const cached = this.apiNames.get(input.botId);
    if ((cached && Date.now() - cached.at < API_NAMES_TTL_MS) || this.apiNamesPending.has(input.botId)) return;
    this.apiNamesPending.add(input.botId);
    try {
      const answer = await this.callTool({ ...input, name: "api_list", args: {} });
      if (!answer.ok || answer.isError) return;
      this.apiNames.delete(input.botId);
      this.apiNames.set(input.botId, { at: Date.now(), names: apiNamesOf(answer.value), reviewed: reviewedReadsOf(answer.value) });
      while (this.apiNames.size > API_NAMES_MAX) this.apiNames.delete(this.apiNames.keys().next().value!);
    } catch {
      // a name is a nicety: the row reads a generic name without it
    } finally {
      this.apiNamesPending.delete(input.botId);
    }
  }

  /** The product name Perspicax declared for this API id, for this bot. */
  apiName(botId: string, apiId: string): string | undefined {
    return this.apiNames.get(botId)?.names.get(apiId.trim().toLowerCase());
  }

  /** Whether Perspicax marked this connector's reads (an API id or a served
   * group) as reviewed for this bot; false until api_list was read. */
  reviewedReads(botId: string, apiId: string): boolean {
    return this.apiNames.get(botId)?.reviewed.has(apiId.trim().toLowerCase()) ?? false;
  }

  /** 2026-10-27 (#1220): every API Perspicax declared for this bot, with
   * its name (the products a custom rule may name), or undefined while
   * api_list has not answered for it. */
  declaredApis(botId: string): Array<{ id: string; name: string }> | undefined {
    const names = this.apiNames.get(botId)?.names;
    return names ? [...names].map(([id, name]) => ({ id, name })) : undefined;
  }

  /** Call one Perspicax tool from the harness itself (a native tool, such
   * as the claims), as the person who speaks in this turn: the token of the
   * turn's first mounted profile, so Perspicax sees that person as the
   * authenticated caller. A session is opened first when the entry has
   * none, since a call that can change data is never replayed on a new one.
   * Never throws; no token is logged or returned. */
  async callTool(input: { threadId: string; generation: string; botId: string; name: string; args: Json; legacyName?: string }): Promise<PerspicaxToolAnswer> {
    const answer = await this.callToolOnce(input, input.name);
    // A server before Perspicax 1.9.19 serves the `__` spelling only; when
    // this turn never listed its tools, the one `_` name is unknown there.
    if (input.legacyName && !answer.ok && answer.code === "rpc_error" && /unknown tool/i.test(answer.error)) {
      return this.callToolOnce(input, input.legacyName);
    }
    return answer;
  }

  private async callToolOnce(input: { threadId: string; generation: string; botId: string; args: Json }, requested: string): Promise<PerspicaxToolAnswer> {
    const entry = this.turnEntry(input.threadId, input.generation, input.botId);
    if (!entry) return { ok: false, code: "profile_not_mounted", error: "the Perspicax connection is not mounted in this turn" };
    const link = this.options.link();
    if (!link) return { ok: false, code: "access_ended", error: PERSPICAX_ACCESS_ENDED };
    if (!entry.initialized && !entry.mcpSessionId && !(await this.reopen(link, entry))) {
      return entry.ended
        ? { ok: false, code: "access_ended", error: PERSPICAX_ACCESS_ENDED }
        : { ok: false, code: "unreachable", error: "Perspicax is unavailable" };
    }
    const id = `sagax-native-${++this.nativeCalls}`;
    await entry.identity?.ensure();
    const name = servedSpelling(requested, entry.servedTools);
    const answer = await this.relay({
      threadId: input.threadId,
      generation: input.generation,
      botId: input.botId,
      frame: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input.args } },
      judged: true,
    });
    const body = answer.body;
    if (answer.status !== 200 || !isObject(body)) {
      const error = isObject(body) && typeof body.error === "string" ? body.error : `Perspicax answered HTTP ${answer.status}`;
      return { ok: false, code: answer.status === 403 ? "profile_not_mounted" : "unreachable", error };
    }
    if (isObject(body.error)) {
      const message = typeof body.error.message === "string" ? body.error.message : "Perspicax refused the call";
      return { ok: false, code: message === PERSPICAX_ACCESS_ENDED ? "access_ended" : "rpc_error", error: message };
    }
    const result = isObject(body.result) ? body.result : {};
    let value: unknown = result.structuredContent;
    if (value === undefined && Array.isArray(result.content)) {
      const text = result.content.find((block): block is Json => isObject(block) && block.type === "text");
      try {
        value = typeof text?.text === "string" ? (JSON.parse(text.text) as unknown) : null;
      } catch {
        value = text?.text ?? null;
      }
    }
    return { ok: true, isError: result.isError === true, value: value ?? null };
  }

  /** 2026-11-02: send for a routine, with backoff over a transient failure
   * (PERSPICAX_ROUTINE_RETRY_MS). A read, or anything that never left
   * (connection refused), is tried again on unreachable, HTTP 502 or 503.
   * A call that can change data is tried again only when it surely did not
   * run: never sent, or answered 503 (unavailable, not processed); a 502 or
   * a cut answer may have run it, so the bot gets the failure instead. */
  private async sendForRoutine(link: PerspicaxMcpLink, entry: Entry, frame: Json): Promise<SentFrame> {
    const replayable = perspicaxReplayable(frame, entry.readOnlyTools) || frame.method === "initialize";
    for (let attempt = 0; ; attempt += 1) {
      const note: { unsent?: boolean } = {};
      const sent = await this.send(link, entry, frame, note);
      if (sent === "ended" || sent === "selection_unavailable") return sent;
      const status = sent === "unreachable" ? 0 : sent.response.status;
      const retry = sent === "unreachable"
        ? replayable || note.unsent === true
        : TRANSIENT_HTTP.has(status) && (replayable || status === 503);
      const wait = this.routineRetryMs[attempt];
      if (!retry || wait === undefined) return sent;
      this.log(`perspicax mcp: main connection ${status ? `answered HTTP ${status}` : "could not be reached"} during a routine; trying again in ${Math.round(wait / 1000)} s`);
      await this.sleep(wait);
      if (entry.ended) return "ended";
    }
  }

  /** POST one frame with the entry's token and session; a 401 renews the
   * token once. The answer is read whole (bounded); the session it names is kept. */
  private async send(link: PerspicaxMcpLink, entry: Entry, frame: Json, note?: { unsent?: boolean }, identityInternal = false): Promise<SentFrame> {
    let response: Response;
    try {
      response = await this.post(link.mcpEndpoint(), entry, frame);
      if (response.status === 401) {
        void response.body?.cancel().catch(reportBackgroundError);
        if (!(await this.renew(entry))) return "ended";
        if (!identityInternal && frame.id !== undefined && frame.method !== "initialize" && !roleRecoveryFrame(frame)) {
          await entry.identity?.ensure(true);
          if (entry.identity && !entry.identity.active()) return "selection_unavailable";
          if (entry.profileChoice && !await this.restoreProfileChoice(link, entry)) return "selection_unavailable";
        }
        response = await this.post(link.mcpEndpoint(), entry, frame);
        if (response.status === 401) {
          void response.body?.cancel().catch(reportBackgroundError);
          this.end(entry);
          return "ended";
        }
      }
    } catch (error) {
      this.log(`perspicax mcp: a call could not reach Perspicax (${error instanceof Error ? error.name : "error"})`);
      if (note && perspicaxUnsent(error)) note.unsent = true;
      return "unreachable";
    }
    const session = response.headers.get("mcp-session-id");
    if (session && session.length <= 256) {
      if (session !== entry.mcpSessionId) {
        entry.identity?.invalidate();
        if (entry.profileChoice) {
          entry.profileChoiceNeedsRestore = true;
          entry.profileChoiceRestoreFailed = false;
        }
        this.clearToolCatalog(entry);
      }
      entry.mcpSessionId = session;
    }
    try {
      const onRequest = this.options.askGo ? (request: Json) => this.answerServerRequest(link, entry, request) : undefined;
      const onNotification = (note: Json) => {
        if (note.method === "notifications/tools/list_changed") {
          this.clearToolCatalog(entry);
          entry.toolsChangedPending = true;
        }
      };
      const text = await readBounded(response, PERSPICAX_RELAY_MAX_BYTES, onRequest, onNotification);
      // A real exchange (and a successful keep-alive ping) refreshes the idle
      // timer so Perspicax's 120 s close does not fire while the engine is warm.
      if (!entry.keepAlivePing && response.ok) this.touchKeepAlive(entry);
      return { response, text };
    } catch {
      return "unreachable";
    }
  }

  /** A request Perspicax sends on a call's stream. `elicitation/create` with
   * the approval form (`decision`: allow or deny) is the Flow guard's GO:
   * an approval card for the person, then the answer on the session. Any
   * other request, or another form, is declined. */
  private async answerServerRequest(link: PerspicaxMcpLink, entry: Entry, request: Json): Promise<void> {
    const params = isObject(request.params) ? request.params : {};
    if (request.method === "ping") {
      await this.postAnswer(link, entry, { jsonrpc: "2.0", id: request.id, result: {} });
      return;
    }
    if (request.method !== "elicitation/create") {
      await this.postAnswer(link, entry, { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not supported by this client" } });
      return;
    }
    const message = typeof params.message === "string" ? params.message.trim() : "";
    let result: Json;
    if (!isGoForm(params.requestedSchema) || !message || !this.options.askGo) {
      result = { action: "decline" };
    } else {
      let answer: "allow" | "deny" | "timeout";
      try {
        answer = await this.options.askGo({ threadId: entry.threadId, botId: entry.botId, message: message.slice(0, 2000) });
      } catch {
        answer = "deny";
      }
      result = answer === "allow"
        ? { action: "accept", content: { decision: "allow" } }
        : answer === "timeout" ? { action: "cancel" } : { action: "decline" };
    }
    await this.postAnswer(link, entry, { jsonrpc: "2.0", id: request.id, result });
  }

  /** A client response on the entry's session (Perspicax answers 202). */
  private async postAnswer(link: PerspicaxMcpLink, entry: Entry, frame: Json): Promise<void> {
    if (entry.ended) return;
    try {
      const response = await this.post(link.mcpEndpoint(), entry, frame);
      void response.body?.cancel().catch(reportBackgroundError);
    } catch {
      this.log("perspicax mcp: an answer to Perspicax could not be sent");
    }
  }

  /** Open a new MCP session for the entry (initialize, then initialized),
   * one at a time; returns its initialize answer when Perspicax named a session. */
  private reopen(link: PerspicaxMcpLink, entry: Entry): Promise<ReopenedSession | null> {
    entry.reopening ??= this.reopenOnce(link, entry).finally(() => { entry.reopening = undefined; });
    return entry.reopening;
  }

  private async reopenOnce(link: PerspicaxMcpLink, entry: Entry): Promise<ReopenedSession | null> {
    if (entry.ended) return null;
    entry.mcpSessionId = undefined;
    entry.initialized = false;
    this.clearToolCatalog(entry);
    entry.identity?.invalidate();
    if (entry.profileChoice) {
      entry.profileChoiceNeedsRestore = true;
      entry.profileChoiceRestoreFailed = false;
    }
    const params = this.initParams.get(initKey(entry.threadId)) ?? {
      protocolVersion: PERSPICAX_PROTOCOL_VERSION,
      capabilities: this.options.askGo ? withElicitation({}) : {},
      clientInfo: { name: `Pulsa Bot (${entry.botId})`, version: this.options.version },
    };
    const id = `sagax-reopen-${++this.reopens}`;
    const opened = await this.send(link, entry, { jsonrpc: "2.0", id, method: "initialize", params });
    if (typeof opened === "string" || !opened.response.ok) return null;
    const body = parseMcpBody(opened.text, id);
    if (!isObject(body) || !isObject(body.result)) return null;
    entry.initialized = true;
    const done = await this.send(link, entry, { jsonrpc: "2.0", method: "notifications/initialized" });
    if (typeof done === "string") return null;
    // A dropped remote session forgot its profile_use choice. Restore the
    // choice before any replay so both the vendor surface and write-once key
    // still describe the role the caller selected in this generation.
    if (entry.profileChoice && !await this.restoreProfileChoice(link, entry)) return null;
    return { body };
  }

  /** Put a remembered profile_use choice on the current token/session.
   * Failure remains sticky for vendor operations until identity_switch or
   * profile_use explicitly recovers it; listings stay available. */
  private async restoreProfileChoice(link: PerspicaxMcpLink, entry: Entry): Promise<boolean> {
    const wanted = entry.profileChoice;
    if (!wanted) {
      entry.profileChoiceNeedsRestore = false;
      entry.profileChoiceRestoreFailed = false;
      return true;
    }
    const switchId = `sagax-profile-${++this.nativeCalls}`;
    const selected = await this.send(link, entry, {
      jsonrpc: "2.0",
      id: switchId,
      method: "tools/call",
      params: { name: "profile_use", arguments: { profile: wanted } },
    }, undefined, true);
    let selectedBody: unknown = null;
    if (typeof selected !== "string" && selected.response.ok) {
      try { selectedBody = parseMcpBody(selected.text, switchId); } catch { /* handled as a failed restore below */ }
    }
    const value = identityValue(selectedBody);
    const failed = !isObject(selectedBody)
      || Boolean(selectedBody.error)
      || (isObject(selectedBody.result) && selectedBody.result.isError === true)
      || value.in_use !== wanted;
    entry.profileChoiceNeedsRestore = false;
    entry.profileChoiceRestoreFailed = failed;
    if (!failed) return true;
    this.clearToolCatalog(entry);
    this.log(`perspicax mcp: the selected role ${JSON.stringify(wanted)} could not be restored; the pending call was not sent under another role`);
    return false;
  }

  /** The engine's own initialize, kept so a new session looks like its first. */
  private rememberInit(entry: Entry, params: Json): void {
    const at = initKey(entry.threadId);
    this.initParams.delete(at);
    this.initParams.set(at, params);
    while (this.initParams.size > MAX_INIT_PARAMS) this.initParams.delete(this.initParams.keys().next().value!);
  }

  /** The turn's generation ended: revoke every token it holds and close its
   * MCP sessions (best effort). */
  async endGeneration(threadId: string, generation: string): Promise<void> {
    await this.retire(`${threadId}\u0000${generation}\u0000`, threadId);
  }

  /** The call on this thread ended: the tokens it kept are revoked. */
  async endWarm(threadId: string): Promise<void> {
    const prefix = `${threadId}\u0000`;
    const done: Promise<unknown>[] = [];
    for (const [at, entry] of this.warm) {
      if (!at.startsWith(prefix)) continue;
      this.warm.delete(at);
      done.push(this.close(entry));
    }
    await Promise.all(done);
  }

  /** Every generation of a thread (stop, delete, the backstop before a new
   * turn). On a live call or warm engine its tokens are kept for the next turn. */
  async endThread(threadId: string): Promise<void> {
    const keep = this.sessionShouldStay(threadId);
    await Promise.all([this.retire(`${threadId}\u0000`, threadId), ...(keep ? [] : [this.endWarm(threadId)])]);
  }

  /** End the entries under `prefix`: kept for a live call or warm engine's
   * next turn (prepareTurn takes the parent token over), revoked otherwise.
   * Every kept entry closes its MCP session first. Perspicax stores an
   * identity_switch choice on that session, so a new generation must never
   * inherit the old session even when clearing the role itself fails. */
  private retire(prefix: string, threadId: string): Promise<void> {
    const run = this.retireNow(prefix, threadId);
    const previous = this.retiring.get(threadId);
    const settled: Promise<void> = Promise.allSettled([previous, run]).then(() => {
      if (this.retiring.get(threadId) === settled) this.retiring.delete(threadId);
    });
    this.retiring.set(threadId, settled);
    return run;
  }

  private async retireNow(prefix: string, threadId: string): Promise<void> {
    const done: Promise<unknown>[] = [];
    const voiceKeep = this.options.keepWarm?.(threadId) === true;
    const engineKeep = this.options.engineWarm?.(threadId) === true;
    const keep = voiceKeep || engineKeep;
    for (const [at, entry] of this.entries) {
      if (!at.startsWith(prefix)) continue;
      this.entries.delete(at);
      // A role is scoped to one generation. Even when the MCP session stays
      // warm, clear the explicit identity and every role-dependent catalogue
      // before a later interactive or routine turn can reuse the connection.
      this.disarmKeepAlive(entry);
      await entry.identity?.clear();
      entry.identity = undefined;
      this.clearToolCatalog(entry);
      entry.profileChoice = undefined;
      entry.profileChoiceNeedsRestore = false;
      entry.profileChoiceRestoreFailed = false;
      if (keep && !entry.ended && entry.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
        await this.closeSession(entry);
        // The engine (or the call) may have gone cold while the role and the
        // session were cleared: its noteEngineCold found nothing parked yet,
        // so a token parked now would outlive the turn until it expires.
        if (entry.ended || !this.sessionShouldStay(threadId)) {
          done.push(this.close(entry));
          continue;
        }
        const warm = warmKey(entry.threadId, entry.principalId, entry.source);
        const previous = this.warm.get(warm);
        if (previous && previous !== entry) done.push(this.close(previous));
        this.warm.set(warm, entry);
        if (engineKeep && entry.mcpSessionId) this.touchKeepAlive(entry);
        entry.budget?.idle();
        continue;
      }
      done.push(this.close(entry));
    }
    await Promise.all(done);
  }

  /** Shutdown: revoke everything. */
  async endAll(): Promise<void> {
    this.disposed = true;
    const all = [...this.entries.values(), ...this.warm.values()];
    this.entries.clear();
    this.warm.clear();
    for (const entry of all) this.disarmKeepAlive(entry);
    await Promise.all(all.map((entry) => this.close(entry)));
  }

  /** The person is out (back-channel logout, directory): every token of
   * theirs is revoked now, and their running turns' calls end. */
  forgetSubject(iss: string, sub: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.subject.iss === iss && entry.subject.sub === sub) this.end(entry);
    }
  }

  /** Slice 6: the person's routine delegation ended: every token exchanged
   * from it is revoked now, and those turns' calls end. */
  forgetPrincipal(principalId: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.source === "delegation" && entry.principalId === principalId) this.end(entry);
    }
  }

  /** The subject token of a turn: the sign-in's for a person, the routine
   * delegation's for routine lineage. */
  private subjectFor(source: Entry["source"], principalId: string, subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome> {
    if (source === "session") return this.options.subjectToken(subject);
    if (!this.options.routineSubjectToken) return Promise.resolve({ ok: false, error: "no_session" });
    return this.options.routineSubjectToken(principalId);
  }

  /** How many turns hold tokens (tests, health). */
  size(): number {
    return this.entries.size;
  }

  private post(endpoint: string, entry: Entry, frame: Json): Promise<Response> {
    return this.fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(PERSPICAX_RELAY_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${entry.token}`,
        ...(entry.mcpSessionId ? { "mcp-session-id": entry.mcpSessionId } : {}),
      },
      body: JSON.stringify(frame),
    });
  }

  /** Exchange again with a fresh subject, once at a time per entry. */
  private renew(entry: Entry): Promise<boolean> {
    entry.renewing ??= this.renewOnce(entry).finally(() => { entry.renewing = undefined; });
    return entry.renewing;
  }

  private async renewOnce(entry: Entry): Promise<boolean> {
    if (entry.ended) return false;
    const link = this.options.link();
    const speaker = this.options.subjectOf(entry.principalId);
    if (!link || !speaker || speaker.disabled) {
      this.end(entry);
      return false;
    }
    const signIn = await this.subjectFor(entry.source, entry.principalId, entry.subject);
    const result = signIn.ok ? await link.exchangeToken(signIn.token) : null;
    if (entry.source === "delegation" && result && !result.ok && result.error === "subject") this.options.delegationRefused?.(entry.principalId);
    if (entry.ended) {
      if (result?.ok) void this.revoke(result.token).catch(reportBackgroundError);
      return false;
    }
    if (!signIn.ok || !result?.ok) {
      this.log(`perspicax mcp: the main connection could not be renewed (${signIn.ok ? (result && !result.ok ? result.error : "error") : signIn.error})`);
      this.end(entry);
      return false;
    }
    const old = entry.token;
    entry.token = result.token;
    entry.expiresAt = Math.min(result.expiresAt, signIn.expiresAt);
    entry.identity?.invalidate();
    if (entry.profileChoice) {
      entry.profileChoiceNeedsRestore = true;
      entry.profileChoiceRestoreFailed = false;
    }
    this.clearToolCatalog(entry);
    void this.revoke(old).catch(reportBackgroundError);
    return true;
  }

  private end(entry: Entry): void {
    if (entry.ended) return;
    entry.ended = true;
    entry.budget?.forget();
    this.disarmKeepAlive(entry);
    void entry.identity?.clear();
    void Promise.resolve(this.revoke(entry.token)).catch(reportBackgroundError);
  }

  private async close(entry: Entry): Promise<void> {
    const link = this.options.link();
    if (entry.ended) return;
    this.disarmKeepAlive(entry);
    await entry.identity?.clear();
    entry.ended = true;
    // The session goes first, while its token still opens it; then the token.
    if (link) await this.closeSession(entry, link);
    await this.revoke(entry.token);
    entry.budget?.forget();
  }

  /** Close only the remote MCP session while retaining the parent account
   * token. The local state is cleared before the best-effort DELETE, so even
   * an unreachable old session can never be addressed by a later turn. */
  private async closeSession(entry: Entry, linked = this.options.link()): Promise<void> {
    const session = entry.mcpSessionId;
    entry.mcpSessionId = undefined;
    entry.initialized = false;
    this.clearToolCatalog(entry);
    if (!linked || !session) return;
    await this.fetcher(linked.mcpEndpoint(), {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${entry.token}`, "mcp-session-id": session },
    }).then((response) => { void response.body?.cancel().catch(reportBackgroundError); }, () => {});
  }

  private async revoke(token: string): Promise<void> {
    const link = this.options.link();
    if (!link) return;
    try {
      await link.revokeExchanged(token);
    } catch {
      /* logged by the link client, never with the token */
    }
  }
}

export { servedSpelling, twilioToolsOf, apiNamesOf, reviewedReadsOf, parseMcpBody, withFailureWords, withElicitation, isGoForm } from "./perspicax-mcp-helpers.ts";
