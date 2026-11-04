// Perspicax MCP for the person who speaks (slice 5, spec section 4).
//
// A bot on an organization server lists Perspicax profiles
// (server/bots/bot-perspicax.ts). When a turn starts, the harness takes the
// speaker's current sign-in access token (server/auth/idp-session.ts, memory
// only) and exchanges it at Perspicax (RFC 8693, server/perspicax/perspicax-link.ts)
// for one short MCP token per profile. Those tokens stay here: the engine
// mounts a stdio bridge per profile (server/perspicax-mcp-bridge.ts) that
// holds only this turn's capability and posts every JSON-RPC frame to
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
//   - a profile the speaker does not hold is not mounted: the turn gets a
//     note and an activity row instead (decided before the engine lists its
//     tools);
//   - a token near its end, or refused by /mcp, is exchanged again once with
//     a fresh subject; when that fails the call answers "Perspicax access
//     for this turn ended" (a disabled person mid-turn, S5-10);
//   - no token is ever logged or put in an error.
import { guardToolCall, type GuardOptions } from "../mcp/mcp-permissions.ts";
import { telephonyRefusal, voiceToolCall } from "../telephony-guard.ts";
import { placeArgsFromVoiceCall } from "../../shared/outbound-call.ts";
import type { SubjectTokenOutcome } from "../auth/idp-session.ts";
import type { DirectoryProfile, ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "../drivers/acp/grok-read-only-tools.ts";
import { executionKey, WriteOnce } from "../write-once.ts";
import { PerspicaxIdentity, identityLapsed, identityProfiles, identityValue, identityWarning, type IdentityFailure, type IdentityInventory } from "./perspicax-identity.ts";

export type PerspicaxUnavailableReason = "not_held" | "no_session" | "unreachable" | "rate_limited" | "no_delegation" | "unknown_speaker" | "unknown_profile";

/** Why a profile is not mounted, as the system note and the activity row say it. */
export const PERSPICAX_UNAVAILABLE_WHY: Record<PerspicaxUnavailableReason, string> = {
  not_held: "the person speaking does not hold this profile in Perspicax",
  no_session: "the person speaking has no live Perspicax sign-in on this server",
  unreachable: "Perspicax could not be reached",
  rate_limited: "Perspicax is rate limiting this server; try again in a minute",
  no_delegation: "the person it runs as has no recent sign-in to Sagax, so Perspicax gave this run no access in their name; once they sign in to Sagax again (web, desktop or phone), the next run gets it",
  unknown_speaker: "the person speaking is not known to Perspicax",
  unknown_profile: "Perspicax no longer lists this profile",
};

/** The sentence shown for an unavailable profile. Prefers Perspicax's own
 * error_description when the exchange returned not_held with one. */
export function perspicaxUnavailableWhy(reason: PerspicaxUnavailableReason, detail?: string): string {
  if (reason === "not_held" && detail) return detail;
  return PERSPICAX_UNAVAILABLE_WHY[reason];
}

/** The activity row of the profiles one reason left out of a turn. A rate
 * limit says its sentence, so the person knows to wait; the other reasons
 * keep their code. A not_held detail from Perspicax is shown when present. */
export function perspicaxUnavailableRow(names: readonly string[], speakerName: string, reason: PerspicaxUnavailableReason, detail?: string): string {
  const head = `Perspicax: ${names.join(", ")} unavailable for ${speakerName}`;
  if (reason === "rate_limited") return `${head}: ${PERSPICAX_UNAVAILABLE_WHY.rate_limited}`;
  if (reason === "not_held" && detail) return `${head}: ${detail}`;
  return `${head} (${reason})`;
}

export interface PerspicaxMountedProfile {
  profileId: string;
  slug: string;
  name: string;
}

export interface PerspicaxTurnPlan {
  mounted: PerspicaxMountedProfile[];
  unavailable: Array<{ profileId: string; name: string; reason: PerspicaxUnavailableReason; detail?: string }>;
}

/** The link client calls this module needs (PerspicaxDirectory). */
export interface PerspicaxMcpLink {
  exchangeToken(subjectToken: string, profileId: string): Promise<ExchangeResult>;
  revokeExchanged(token: string): Promise<boolean>;
  mcpEndpoint(): string;
  profileCatalog(): DirectoryProfile[];
}

export interface PerspicaxMcpOptions {
  /** SAGAX_PERSPICAX_ISSUER; a speaker's subject must come from it. */
  issuer: string;
  /** 2026-10-26: the GO a Perspicax server guard asks for during a call (MCP
   * elicitation, `elicitation/create`, the Flow guard's dry run, GO, read
   * back), shown to the person as an approval card on the turn's thread.
   * Only "allow" is a GO. Set: every session declares the `elicitation`
   * capability. Unset: none is declared and Perspicax refuses the write. */
  askGo?(input: { threadId: string; botId: string; profileId: string; message: string }): Promise<"allow" | "deny" | "timeout">;
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
  /** The bot's current profile ids (undefined: the bot is gone). */
  botProfiles(botId: string): readonly string[] | undefined;
  botActAs?(botId: string): { slug: string; name: string } | undefined;
  heldProfiles?(principalId: string): readonly string[];
  onIdentityWarning?(input: { threadId: string; botId: string; principalId: string; reason: IdentityFailure }): void;
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

/** 2026-11-02: a routine (nobody at the keyboard) waits out a short Perspicax
 * outage, such as a connector roll of about two minutes, instead of running
 * without its tools or failing a call: these waits, about 2 min 17 s in all,
 * between tries of a transient failure (unreachable, rate limited, HTTP 502
 * or 503, connection refused). A person's own turn keeps the single quick
 * retry: they are there to try again. */
export const PERSPICAX_ROUTINE_RETRY_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000];
/** HTTP answers of an edge whose upstream is down for a moment. */
const TRANSIENT_HTTP = new Set([502, 503]);
/** Network errors that mean the request never left (nothing was sent). */
const UNSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/** A failed fetch that never reached Perspicax (connection refused, name
 * not resolved): safe to send again, even a write. */
export function perspicaxUnsent(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at && depth < 4; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === "string" && UNSENT_CODES.has(code)) return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

export const REMOTE_SUPPORT_OPEN_UNAVAILABLE =
  "Refused by Sagax: remote_support_open goes through Sagax (it fills the host and the session key). That path is not available here. Nothing was sent.";

/** What a bot reads in front of the answer when its voice_call became a
 * place_phone_call. */
export const VOICE_CALL_REDIRECTED = "Sagax placed this voice_call through place_phone_call (every call does: its card, the AI disclosure, the organization's rules). Use place_phone_call next time.";
export const VOICE_CALL_UNAVAILABLE = "Refused by Sagax: a call goes through place_phone_call, which is not available here. Nothing was sent.";

/** A token with less than this left is exchanged again before a call. */
export const PERSPICAX_TOKEN_MIN_LIFE_MS = 60_000;
export const PERSPICAX_RELAY_TIMEOUT_MS = 10 * 60_000;
export const PERSPICAX_RELAY_MAX_BYTES = 20 * 1024 * 1024;
/** Idle keep-alive ping cadence: under Perspicax KEEP_ALIVE (120 s). */
export const PERSPICAX_KEEPALIVE_MS = 90_000;
/** Jitter added on top of PERSPICAX_KEEPALIVE_MS so many entries do not fire together. */
export const PERSPICAX_KEEPALIVE_JITTER_MS = 15_000;
/** At most this many entries of one person are pinged (newest kept). */
export const PERSPICAX_KEEPALIVE_PER_PERSON = 8;
export const PERSPICAX_ACCESS_ENDED = "Perspicax access for this turn ended";
/** A call Sagax did not replay after Perspicax dropped the MCP session: it can
 * change data, so the bot decides (the call never reached Perspicax's tool). */
export const PERSPICAX_SESSION_RESET = "Perspicax had dropped this MCP session (idle or restarted). Sagax opened a new one, but did not replay this call because it can change data: it did not run. Call it again if it is still wanted.";

/** The answer a write that was not sent again carries in front of the first one's. */
export const PERSPICAX_WRITE_REPLAYED = "Not sent again: another run made this same write with the same arguments moments ago (one write per execution key). Its answer follows; the record already exists.";
/** The tools whose name says they change data: a connector's `<api>_write`,
 * `_action` or `_<x>_write` (`__` before Perspicax 1.9.19), its named writes (`log_time`, `book_*`,
 * `update_*`, `create_*`, `delete_*`), and the host's own. Reads, polls
 * (await_turn) and leases (claim*, per holder, renewals must reach
 * Perspicax) are never answered from a previous call. */
const WRITE_SUFFIX = /^(write|action|log_time|(book|update|create|delete)_[a-z0-9_]+|[A-Za-z0-9_]+_write)$/;
const HOST_WRITES = new Set(["memory_write", "memory_propose", "memory_promote", "memory_forget", "create_agent", "delete_agent",
  "sagax_send", "sagax_routine_run", "sagax_nudge", "remote_support_open", "remote_support_close"]);
/** A connector's write with one `_` (Perspicax 1.9.19: `cw_psa_write`,
 * `cw_psa_time_entries_write`, `cw_psa_log_time`, `cw_psa_update_ticket`);
 * its read_action is a read. */
const PROFILE_WRITE = /_(?:write|action|log_time)$|_(?:book|update|create|delete)_[a-z0-9_]+$/;
export function perspicaxWriteOnceTool(name: string): boolean {
  const at = name.lastIndexOf("__");
  if (at > 0) return WRITE_SUFFIX.test(name.slice(at + 2));
  if (HOST_WRITES.has(name)) return true;
  return !name.endsWith("_read_action") && PROFILE_WRITE.test(name);
}

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
  threadId: string;
  generation: string;
  botId: string;
  profileId: string;
  principalId: string;
  subject: { iss: string; sub: string };
  /** Slice 6: whose grant the subject came from, and so how to renew it. */
  source: "session" | "delegation";
  token: string;
  expiresAt: number;
  mcpSessionId?: string;
  initialized?: boolean;
  identity?: PerspicaxIdentity;
  implicitIdentity?: string;
  servedTools?: Set<string>;
  /** The served tools Perspicax lists as read-only (perspicaxReadOnlyToolsOf). */
  readOnlyTools?: Set<string>;
  twilioTools?: Set<string>;
  /** Full JSON-RPC tools/list body for this MCP session and identity.
   * Serves a later tools/list on the same session (engine after Sagax's
   * identity list) without a second round trip. Cleared on reopen, identity
   * invalidate/clear, list_changed, and retire. Never shared across profiles
   * or persons: it lives on this Entry only. */
  toolsListBody?: unknown;
  /** #1935: the MCP server name the engine sees this profile under. */
  mount?: string;
  /** One re-initialize at a time (relay, a session Perspicax dropped). */
  reopening?: Promise<boolean>;
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

export interface PerspicaxRelayAnswer {
  status: number;
  /** A JSON body, absent for 202. */
  body?: unknown;
}

/** The answer of a Perspicax tool the harness calls itself (callTool): the
 * tool's structured result and whether it is a tool error, or why no call
 * was made. */
export type PerspicaxToolAnswer =
  | { ok: true; isError: boolean; value: unknown }
  | { ok: false; code: "profile_not_mounted" | "access_ended" | "unreachable" | "rpc_error"; error: string };

const key = (threadId: string, generation: string, profileId: string) => `${threadId}\u0000${generation}\u0000${profileId}`;
const initKey = (threadId: string, profileId: string) => `${threadId}\u0000${profileId}`;
/** Bounds the kept initialize params (one per thread and profile). */
const MAX_INIT_PARAMS = 2_000;
/** The protocol a reopened session asks for when the engine's own initialize
 * was never seen (a bridge initialized before this server started). */
export const PERSPICAX_PROTOCOL_VERSION = "2025-06-18";
const warmKey = (threadId: string, profileId: string, principalId: string, source: Entry["source"]) =>
  `${threadId}\u0000${profileId}\u0000${principalId}\u0000${source}`;
/** A refusal worth one more try a moment later. */
const TRANSIENT = new Set(["unreachable", "rate_limited"]);
const RETRY_EXCHANGE_MS = 400;

type Json = Record<string, unknown>;

/** The telephony guard's refusal for a bot's own Twilio call
 * (server/telephony-guard.ts), or null. */
function telephonyBlock(frame: Json, twilioTools: ReadonlySet<string> | undefined): string | null {
  if (frame.method !== "tools/call") return null;
  const params = isObject(frame.params) ? frame.params : {};
  return telephonyRefusal(String(params.name ?? ""), params.arguments, twilioTools ? { twilioTools } : {});
}

/** The spelling a Perspicax profile serves for a tool Sagax names with one
 * `_` (`twilio_api_write`): itself when served or when nothing is known,
 * else the served name that is the same tool with `__` (an earlier
 * Perspicax: `twilio_api__write`). */
export function servedSpelling(name: string, served: ReadonlySet<string> | undefined): string {
  if (!served || served.has(name)) return name;
  const folded = name.replace(/_{2,}/g, "_");
  for (const candidate of served) if (candidate.replace(/_{2,}/g, "_") === folded) return candidate;
  return name;
}

/** The tools of a tools/list answer that target Twilio under another name:
 * their description names Twilio or its API host. */
export function twilioToolsOf(body: unknown): string[] {
  const result = isObject(body) && isObject(body.result) ? body.result : null;
  const tools = result && Array.isArray(result.tools) ? result.tools : [];
  return tools
    .filter((tool): tool is Json => isObject(tool) && typeof tool.name === "string")
    .filter((tool) => /twilio/i.test(`${String(tool.description ?? "")} ${JSON.stringify(tool._meta ?? {})}`))
    .map((tool) => String(tool.name));
}

/** 2026-10-27: how long the product names of an api_list answer are kept. */
const API_NAMES_TTL_MS = 30 * 60_000;
/** Bounds the bots whose product names are kept. */
const API_NAMES_MAX = 500;

/** The product names an api_list answer declares, by API id: the
 * operator's display name, else the catalog's title. */
export function apiNamesOf(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const apis = isObject(value) && Array.isArray(value.apis) ? value.apis : [];
  for (const api of apis) {
    if (!isObject(api) || typeof api.id !== "string" || !api.id.trim()) continue;
    const declared = [api.display_name, api.title].find((name): name is string => typeof name === "string" && name.trim().length > 0);
    if (declared) names.set(api.id.trim().toLowerCase(), declared.trim().slice(0, 80));
  }
  return names;
}

/** The connectors whose reads an api_list answer marks as reviewed
 * (`reviewed_reads: true`: they return no credential), by the prefix of
 * their tools: each marked API id, and a served group (`group`) when every
 * listed member of it is marked. An API with no mark, as from a Perspicax
 * that declares none, is left out: its reads keep their card. */
export function reviewedReadsOf(value: unknown): Set<string> {
  const reviewed = new Set<string>();
  const groups = new Map<string, boolean>();
  const apis = isObject(value) && Array.isArray(value.apis) ? value.apis : [];
  for (const api of apis) {
    if (!isObject(api) || typeof api.id !== "string" || !api.id.trim()) continue;
    const marked = api.reviewed_reads === true;
    if (marked) reviewed.add(api.id.trim().toLowerCase());
    if (typeof api.group === "string" && api.group.trim()) {
      const group = api.group.trim().toLowerCase();
      groups.set(group, (groups.get(group) ?? true) && marked);
    }
  }
  for (const [group, marked] of groups) if (marked) reviewed.add(group);
  return reviewed;
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** One JSON-RPC answer out of a JSON or an SSE body (connector-proxy.ts). */
export function parseMcpBody(text: string, id: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as unknown;
  const frames = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Json];
      } catch {
        return [];
      }
    });
  return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}

/** The `elicitation` capability added to a client's own (2026-10-26). */
export function withElicitation(capabilities: unknown): Json {
  const caps = isObject(capabilities) ? { ...capabilities } : {};
  const current = isObject(caps.elicitation) ? caps.elicitation : {};
  caps.elicitation = { ...current, form: isObject(current.form) ? current.form : {} };
  return caps;
}

/** The approval form of a Perspicax GO: a `decision` of allow or deny. */
export function isGoForm(schema: unknown): boolean {
  if (!isObject(schema) || !isObject(schema.properties)) return false;
  const decision = schema.properties.decision;
  if (!isObject(decision)) return false;
  const values = [
    ...(Array.isArray(decision.oneOf) ? decision.oneOf.map((o) => (isObject(o) ? o.const : undefined)) : []),
    ...(Array.isArray(decision.enum) ? decision.enum : []),
  ];
  return values.includes("allow") && values.includes("deny");
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
      await reader.cancel().catch(() => {});
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
        if (onRequest) pending.push(onRequest(frame).catch(() => {}));
      } else if (onNotification) {
        onNotification(frame);
      }
    }
    scanned = end + 1;
  }
  await Promise.all(pending);
  return text + decoder.decode();
}

/** Rebind a cached tools/list JSON-RPC result to the caller's request id. */
function rewriteToolsListId(body: unknown, id: unknown): unknown {
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
  /** tokens a call keeps between turns (keepWarm), by thread, profile and speaker */
  private readonly warm = new Map<string, Entry>();
  /** The engine's last initialize params per thread and profile (reopen). */
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
    void this.endWarm(threadId);
  }

  /** Engine session is warm again (idle pool): re-arm pings on kept entries. */
  noteEngineWarm(threadId: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.threadId === threadId && entry.mcpSessionId && !entry.ended) this.touchKeepAlive(entry);
    }
  }

  /** Open (or verify) the MCP session and identity lease for every mounted
   * profile of this turn, so the handshake can run beside setup (#1955). */
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
    entry.identity = new PerspicaxIdentity({
      slug,
      now: this.now,
      rpc: (method, params) => this.identityRpc(entry, method, params),
      warn: (reason) => this.options.onIdentityWarning?.({ threadId: entry.threadId, botId: entry.botId, principalId: entry.principalId, reason }),
    });
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

  /** Settings discovery has its own short-lived connection in the signed-in
   * person's name. It only lists identities, never chooses one. */
  async listIdentities(principalId: string, profileId: string): Promise<IdentityInventory> {
    const link = this.options.link();
    const subject = this.options.subjectOf(principalId);
    if (!link || !subject || subject.disabled || subject.iss !== this.options.issuer) throw new Error("Perspicax sign-in required");
    const signIn = await this.options.subjectToken(subject);
    if (!signIn.ok) throw new Error("Perspicax sign-in required");
    const exchanged = await link.exchangeToken(signIn.token, profileId);
    if (!exchanged.ok) throw new Error("Perspicax unavailable");
    const entry: Entry = { threadId: "identity-settings", generation: "listing", botId: "", profileId, principalId, subject, source: "session", token: exchanged.token, expiresAt: Math.min(exchanged.expiresAt, signIn.expiresAt) };
    try {
      const tools = await this.identityRpc(entry, "tools/list");
      if (!isObject(tools) || !isObject(tools.result) || !Array.isArray(tools.result.tools)) throw new Error("Perspicax unavailable");
      if (!tools.result.tools.some((tool) => isObject(tool) && tool.name === "identity_switch")) return { supported: false, profiles: [] };
      const body = await this.identityRpc(entry, "tools/call", { name: "identity_switch", arguments: {} });
      if (!isObject(body) || !isObject(body.result) || body.result.isError) throw new Error("Perspicax unavailable");
      return { supported: true, profiles: identityProfiles(body) };
    } finally { await this.close(entry); }
  }

  /** Cheap read on a separate, short-lived routine connection. No turn or identity switch. */
  async probeReadiness(principalId: string, profiles: readonly string[], signal: AbortSignal): Promise<{ refused?: boolean; profile?: string; detail?: string } | undefined> {
    const link = this.options.link();
    if (!link || !profiles.length) return undefined;
    const subject = this.options.subjectOf(principalId);
    if (!subject || subject.disabled) return undefined;
    for (const profileId of profiles) {
      if (signal.aborted) return { detail: "Perspicax readiness timed out; admission will retry reachability." };
      const profile = link.profileCatalog().find(profile => profile.id === profileId);
      let token: string | undefined;
      let session: string | null = null;
      try {
        const source = await this.subjectFor("delegation", principalId, subject);
        if (!source.ok) return { detail: "Perspicax routine access is not available yet; admission will retry." };
        const exchanged = await link.exchangeToken(source.token, profileId);
        if (!exchanged.ok) return { refused: exchanged.error === "subject" || exchanged.error === "not_held", profile: profile?.slug ?? profileId, detail: exchanged.error };
        token = exchanged.token;
        const post = async (frame: Json) => {
          const response = await this.fetcher(link.mcpEndpoint(), { method: "POST", redirect: "error", signal,
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(frame) });
          session = response.headers.get("mcp-session-id") ?? session;
          const text = await response.text();
          return { response, text };
        };
        const init = await post({ jsonrpc: "2.0", id: "readiness-init", method: "initialize", params: { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Sagax routine check", version: this.options.version } } });
        if (init.response.status === 401 || init.response.status === 403) return { refused: true, profile: profile?.slug ?? profileId, detail: `${init.response.status} invalid_token` };
        if (!init.response.ok) return { detail: `Perspicax readiness HTTP ${init.response.status}; admission will retry reachability.` };
        await post({ jsonrpc: "2.0", method: "notifications/initialized" });
        const listed = await post({ jsonrpc: "2.0", id: "readiness-list", method: "tools/list" });
        if (listed.response.status === 401 || listed.response.status === 403) return { refused: true, profile: profile?.slug ?? profileId, detail: `${listed.response.status} invalid_token` };
        if (!listed.response.ok) return { detail: `Perspicax readiness HTTP ${listed.response.status}; admission will retry reachability.` };
      } catch {
        return { detail: "Perspicax readiness is unreachable; admission will retry reachability." };
      } finally {
        if (token) {
          if (session) await this.fetcher(link.mcpEndpoint(), { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(200), headers: { authorization: `Bearer ${token}`, "mcp-session-id": session } }).then(response => response.body?.cancel()).catch(() => {});
          void link.revokeExchanged(token).catch(() => {});
        }
      }
    }
    return {};
  }

  /** Exchange the speaker's access for each profile of the bot, before the
   * engine starts. Never throws. */
  async prepareTurn(input: {
    threadId: string;
    generation: string;
    bot: { id: string; perspicax?: { profiles: readonly string[] }; perspicaxActAs?: { slug: string; name: string } };
    speakerPrincipalId: string;
    speakerOrigin: "person" | "operator" | "owner-routine" | "peer";
    /** The turn descends from a routine or other automation (a hop it
     * asked, a thread it opened, a room goal it runs). */
    routine?: boolean;
    /** #1941: when the speaker id is empty, mount as this bot's owner
     * (conversation uses the speaker; routine uses the owner; unresolved
     * falls back to the owner only, never another person). A named unknown
     * principal still refuses as unknown_speaker. */
    ownerPrincipalId?: string;
  }): Promise<PerspicaxTurnPlan> {
    const plan: PerspicaxTurnPlan = { mounted: [], unavailable: [] };
    const link = this.options.link();
    const selected = input.bot.perspicaxActAs;
    const profiles = [...new Set(input.bot.perspicax?.profiles ?? [])];
    // #1941: empty speaker → bot owner; a named unknown principal stays refused.
    const speakerTrimmed = input.speakerPrincipalId.trim();
    const ownerTrimmed = input.ownerPrincipalId?.trim() ?? "";
    const resolvedPrincipalId = speakerTrimmed || ownerTrimmed;
    if (!profiles.length && selected && link) {
      // The base connection needs a held profile even when the chosen identity
      // has since been removed. That lets identity_switch report the refusal
      // and keep the person's read plane available.
      const held = this.options.heldProfiles?.(resolvedPrincipalId);
      const profileId = held ? held[0] : link.profileCatalog().find((profile) => profile.slug === selected.slug)?.id;
      if (profileId) profiles.push(profileId);
    }
    if (!link || !profiles.length) return plan;
    const catalog = new Map(link.profileCatalog().map((profile) => [profile.id, profile] as const));
    const nameOf = (id: string) => catalog.get(id)?.name || catalog.get(id)?.slug || id;
    const refuse = (ids: readonly string[], reason: PerspicaxUnavailableReason, detail?: string) => {
      for (const id of ids) plan.unavailable.push({ profileId: id, name: nameOf(id), reason, ...(detail ? { detail } : {}) });
    };
    const known = profiles.filter((id) => catalog.has(id));
    refuse(profiles.filter((id) => !catalog.has(id)), "unknown_profile");
    if (!known.length) return plan;
    const source: Entry["source"] = input.speakerOrigin === "owner-routine" || input.routine === true ? "delegation" : "session";
    const principalId = resolvedPrincipalId;
    const subject = principalId ? this.options.subjectOf(principalId) : null;
    if (!subject || subject.iss !== this.options.issuer) {
      refuse(known, "unknown_speaker");
      return plan;
    }
    if (subject.disabled) {
      refuse(known, "no_session");
      return plan;
    }
    const who = { iss: subject.iss, sub: subject.sub };
    // On a live call, the tokens of the call's last turn are still good:
    // reuse them rather than exchange again for every sentence (a call's
    // quick turns hit Perspicax's rate limit, and a refused exchange left
    // the profile out of that turn: tools gone, then back).
    let need = known;
    const stay = this.sessionShouldStay(input.threadId);
    // the call or warm engine ended without saying so: its kept tokens go
    if (!stay) void this.endWarm(input.threadId);
    if (stay) {
      need = [];
      for (const profileId of known) {
        const at = warmKey(input.threadId, profileId, principalId, source);
        const kept = this.warm.get(at);
        if (kept && !kept.ended && kept.botId === input.bot.id && kept.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
          this.warm.delete(at);
          kept.generation = input.generation;
          const wanted = input.bot.perspicaxActAs?.slug;
          // Voice keep clears the identity lease each turn; an engine-warm
          // keep leaves the lease and tools/list cache so the next turn
          // skips the re-handshake (#1955).
          if (!kept.identity || (wanted && kept.identity.profile() !== wanted) || (!wanted && kept.identity.profile())) {
            this.setIdentity(kept, wanted);
          }
          const previous = this.entries.get(key(input.threadId, input.generation, profileId));
          if (previous && previous !== kept) void this.close(previous);
          this.entries.set(key(input.threadId, input.generation, profileId), kept);
          const profile = catalog.get(profileId)!;
          plan.mounted.push({ profileId, slug: profile.slug, name: profile.name || profile.slug || profileId });
          this.log(`perspicax mcp: profile ${profileId} kept for the ${this.options.keepWarm?.(input.threadId) ? "call" : "warm engine"}'s next turn`);
        } else need.push(profileId);
      }
      if (!need.length) return plan;
    }
    let signIn = await this.subjectFor(source, principalId, who);
    if (!signIn.ok) {
      refuse(need, signIn.error === "unreachable" || signIn.error === "rate_limited" ? signIn.error : source === "delegation" ? "no_delegation" : "no_session");
      return plan;
    }
    const exchangeAll = (token: string, ids: readonly string[] = need) => Promise.all(ids.map(async (profileId) => ({ profileId, result: await link.exchangeToken(token, profileId) })));
    let results = await exchangeAll(signIn.token);
    // a refusal that may pass a moment later (unreachable, rate limited) is
    // tried once more before the profile is left out of the turn
    const transient = results.filter(({ result }) => !result.ok && TRANSIENT.has(result.error)).map(({ profileId }) => profileId);
    if (transient.length) {
      this.log(`perspicax mcp: exchange for ${transient.join(", ")} refused for now; retrying once`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_EXCHANGE_MS));
      const again = await exchangeAll(signIn.token, transient);
      results = results.map((entry) => again.find((retry) => retry.profileId === entry.profileId) ?? entry);
    }
    // 2026-11-02: a routine waits out a short outage (a connector roll)
    // with backoff before a profile is left out of its turn.
    if (source === "delegation") {
      for (const wait of this.routineRetryMs) {
        const still = results.filter(({ result }) => !result.ok && TRANSIENT.has(result.error)).map(({ profileId }) => profileId);
        if (!still.length) break;
        this.log(`perspicax mcp: routine exchange for ${still.join(", ")} still refused; trying again in ${Math.round(wait / 1000)} s`);
        await this.sleep(wait);
        const again = await exchangeAll(signIn.token, still);
        results = results.map((entry) => again.find((retry) => retry.profileId === entry.profileId) ?? entry);
      }
    }
    if (source === "delegation" && results.some(({ result }) => !result.ok && result.error === "subject")) {
      // The cached delegation token was refused (revoked from the console,
      // for one): drop it and renew once now. A live family mounts the tools
      // for this very turn; an ended one is learned (and its routines
      // paused) now rather than at the next run.
      this.options.delegationRefused?.(principalId);
      const renewed = await this.subjectFor(source, principalId, who);
      if (renewed.ok) {
        for (const { result } of results) if (result.ok) void this.revoke(result.token);
        signIn = renewed;
        results = await exchangeAll(renewed.token);
      }
    }
    for (const { profileId, result } of results) {
      if (!result.ok) {
        const reason: PerspicaxUnavailableReason = result.error === "not_held" ? "not_held"
          : result.error === "subject" ? (source === "delegation" ? "no_delegation" : "no_session")
          : result.error === "rate_limited" ? "rate_limited" : "unreachable";
        this.log(`perspicax mcp: profile ${profileId} not mounted for this turn (${reason})`);
        refuse([profileId], reason, result.error === "not_held" ? result.description : undefined);
        continue;
      }
      const at = key(input.threadId, input.generation, profileId);
      const previous = this.entries.get(at);
      if (previous) void this.close(previous);
      const entry: Entry = {
        threadId: input.threadId,
        generation: input.generation,
        botId: input.bot.id,
        profileId,
        principalId,
        subject: who,
        source,
        ...(!input.bot.perspicax?.profiles.length && selected ? { implicitIdentity: selected.slug } : {}),
        token: result.token,
        expiresAt: Math.min(result.expiresAt, signIn.expiresAt),
      };
      this.setIdentity(entry, input.bot.perspicaxActAs?.slug);
      this.entries.set(at, entry);
      const profile = catalog.get(profileId)!;
      plan.mounted.push({ profileId, slug: profile.slug, name: profile.name || profile.slug || profileId });
    }
    return plan;
  }

  /** Relay one JSON-RPC frame from a bridge to Perspicax /mcp. `judged`:
   * the call comes from callTool, whose native tool the agents proxy already
   * put through the permission check, so it is not judged (nor audited) twice. */
  async relay(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
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

  private async relayKept(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const once = this.writeOnceKey(input);
    if (!once) return this.relayFrame(input);
    const kept = (answer: PerspicaxRelayAnswer) => answer.status === 200 && isObject(answer.body) && isObject(answer.body.result) && answer.body.result.isError !== true;
    const { value, replayed } = await this.writes.run(once, () => this.relayFrame(input), kept);
    if (!replayed || !isObject(value.body) || !isObject(value.body.result)) return value;
    this.log(`perspicax mcp: profile ${input.profileId} write not sent again (same execution key)`);
    const result = value.body.result;
    const content = Array.isArray(result.content) ? result.content : [];
    return { status: 200, body: { ...value.body, id: (input.frame as Json).id, result: { ...result, content: [{ type: "text", text: PERSPICAX_WRITE_REPLAYED }, ...content] } } };
  }

  /** The execution key of a write this turn makes once, or null. */
  private writeOnceKey(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown }): string | null {
    if (!this.options.writeOnceScope || !isObject(input.frame)) return null;
    const frame = input.frame;
    if (frame.method !== "tools/call" || frame.id === undefined || perspicaxReplayable(frame)) return null;
    const params = isObject(frame.params) ? frame.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    if (!perspicaxWriteOnceTool(name)) return null;
    const entry = this.entries.get(key(input.threadId, input.generation, input.profileId));
    if (!entry || entry.botId !== input.botId) return null;
    const scope = this.options.writeOnceScope({ threadId: input.threadId, botId: input.botId, principalId: entry.principalId });
    if (!scope) return null;
    return executionKey([scope, entry.principalId, input.profileId, entry.identity?.profile() ?? "default", name, params.arguments ?? {}]);
  }

  private async relayFrame(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const entry = this.entries.get(key(input.threadId, input.generation, input.profileId));
    if (!entry || entry.botId !== input.botId) return { status: 403, body: { error: "this Perspicax profile is not mounted in this turn", code: "profile_not_mounted" } };
    if (!isObject(input.frame)) return { status: 400, body: rpcError(null, -32600, "Invalid Request") };
    const frame: Json = { ...input.frame };
    const id = frame.id;
    const notification = id === undefined;
    const ended = (): PerspicaxRelayAnswer => (notification ? { status: 202 } : { status: 200, body: rpcError(id, -32001, PERSPICAX_ACCESS_ENDED) });
    if (!this.entryMounted(entry)) {
      return { status: 403, body: { error: "this bot no longer lists that Perspicax profile", code: "profile_not_mounted" } };
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
    if (frame.method !== "initialize" && !notification && !entry.initialized && !entry.mcpSessionId && (entry.identity || this.initParams.has(initKey(entry.threadId, entry.profileId)))) {
      await this.reopen(link, entry);
    }
    if (!notification && frame.method !== "initialize") {
      await entry.identity?.ensure();
      const params = isObject(frame.params) ? frame.params : {};
      if (frame.method === "tools/call" && entry.identity && !entry.identity.allows(String(params.name ?? ""))) {
        return { status: 200, body: this.identityRefusal(frame) };
      }
      // Same MCP session and identity already listed tools (Sagax identity
      // lease or an earlier engine list): serve that body. Invalidation is
      // reopen, identity clear/invalidate, list_changed, retire.
      if (frame.method === "tools/list" && entry.toolsListBody !== undefined && entry.mcpSessionId) {
        const body = entry.identity?.catalog(entry.toolsListBody) ?? entry.toolsListBody;
        return { status: 200, body: rewriteToolsListId(body, id) };
      }
    }
    const usedSession = entry.mcpSessionId;
    const sent = entry.source === "delegation" && !notification
      ? await this.sendForRoutine(link, entry, frame)
      : await this.send(link, entry, frame);
    if (sent === "ended") return ended();
    if (sent === "unreachable") return notification ? { status: 202 } : { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
    let { response, text } = sent;
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
      this.log(`perspicax mcp: profile ${entry.profileId} session lost (HTTP ${response.status}); ${reopened ? "a new one is open" : "a new one could not be opened"}; ${replay ? "read sent again" : notification ? "notification dropped" : "call not replayed"}`);
      if (notification) return { status: 202 };
      if (!reopened) return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
      if (!replay) return { status: 200, body: rpcError(id, -32000, PERSPICAX_SESSION_RESET) };
      await entry.identity?.ensure(true);
      const again = await this.send(link, entry, frame);
      if (again === "ended") return ended();
      if (again === "unreachable") return { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
      ({ response, text } = again);
    }
    // Client→server list_changed is unusual; clear before the 202 return so
    // a later tools/list cannot serve a stale body. Server→client clears in send().
    if (notification) {
      if (frame.method === "notifications/tools/list_changed") entry.toolsListBody = undefined;
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
        entry.toolsListBody = undefined;
        await entry.identity.ensure(true);
        const params = isObject(frame.params) ? frame.params : {};
        if (frame.method !== "tools/call" || entry.identity.allows(String(params.name ?? ""))) {
          // act_as_expired explicitly says the operation was refused. One retry,
          // including a write, is safe; never recurse if it lapses again.
          const retry = await this.send(link, entry, frame);
          if (typeof retry !== "string") body = parseMcpBody(retry.text, id);
        }
      }
      if (frame.method === "initialize" && isObject(body) && isObject(body.result)) entry.initialized = true;
      if (frame.method === "tools/call" && isObject(frame.params) && frame.params.name === "identity_switch") {
        const value = identityValue(body);
        if (!entry.identity && isObject(value.acting_as) && typeof value.acting_as.slug === "string") this.setIdentity(entry, value.acting_as.slug);
        const args = isObject(frame.params.arguments) ? frame.params.arguments : {};
        if (!entry.identity && typeof args.profile === "string" && (entry.servedTools?.has("identity_switch") || /switch_not_consented|params_invalid/.test(JSON.stringify(body)))) this.setIdentity(entry, args.profile);
        await entry.identity?.observe(body);
      }
      if (frame.method === "tools/list" && body !== null) {
        body = entry.identity?.catalog(body) ?? body;
        const served = isObject(body) && isObject(body.result) && Array.isArray(body.result.tools)
          ? body.result.tools.filter((tool): tool is Json => isObject(tool) && typeof tool.name === "string").map((tool) => String(tool.name)) : [];
        entry.servedTools = new Set(served.slice(0, 2000));
        entry.readOnlyTools = new Set(perspicaxReadOnlyToolsOf(body).slice(0, 2000));
        const named = twilioToolsOf(body);
        entry.twilioTools = new Set(named.slice(0, 500));
        entry.toolsListBody = body;
      }
      return body === null ? { status: 200, body: rpcError(id, -32000, "Perspicax sent no answer") } : { status: 200, body };
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

  /** The live entry of a turn the bot can still use: the first mounted
   * profile its bot still lists. */
  private turnEntry(threadId: string, generation: string, botId: string): Entry | undefined {
    const prefix = `${threadId}\u0000${generation}\u0000`;
    for (const [at, entry] of this.entries) {
      if (at.startsWith(prefix) && entry.botId === botId && !entry.ended && this.entryMounted(entry)) return entry;
    }
    return undefined;
  }

  private entryMounted(entry: Entry): boolean {
    const profiles = this.options.botProfiles(entry.botId);
    if (!profiles) return false;
    if (profiles.includes(entry.profileId)) return true;
    const identity = this.options.botActAs?.(entry.botId);
    return profiles.length === 0 && !!identity && entry.implicitIdentity === identity.slug;
  }

  private identityRefusal(frame: Json): Json {
    return { jsonrpc: "2.0", id: frame.id, result: { isError: true, content: [{ type: "text", text: identityWarning("unavailable", "en") }] } };
  }

  /** #1935: the MCP server name this turn gives a mounted profile, so a
   * tool name from a gateway answer can be sent to the server that runs it. */
  setMount(threadId: string, generation: string, profileId: string, server: string): void {
    const entry = this.entries.get(key(threadId, generation, profileId));
    if (entry) entry.mount = server;
  }

  /** #1935: the MCP server of this turn that runs `name`: the mount of the
   * profile that lists it (`served`), else, while no listing is known for
   * it, the mount of the profile the gateway tools answer from. */
  toolHome(threadId: string, generation: string, botId: string, name?: string): { server: string; served: boolean } | undefined {
    const prefix = `${threadId}\u0000${generation}\u0000`;
    if (name) {
      for (const [at, entry] of this.entries) {
        if (!at.startsWith(prefix) || entry.botId !== botId || entry.ended || !entry.mount || !entry.servedTools || !this.entryMounted(entry)) continue;
        if (entry.servedTools.has(servedSpelling(name, entry.servedTools))) return { server: entry.mount, served: true };
      }
    }
    const first = this.turnEntry(threadId, generation, botId);
    return first?.mount ? { server: first.mount, served: false } : undefined;
  }

  /** The person this turn's Perspicax tokens speak for, if a profile is mounted. */
  turnPrincipal(threadId: string, generation: string, botId: string): string | undefined {
    return this.turnEntry(threadId, generation, botId)?.principalId || undefined;
  }

  /** Whether this turn of the bot has a Perspicax profile mounted, so the
   * harness may call a Perspicax tool in the speaker's name (callTool). */
  hasMounted(threadId: string, generation: string, botId: string): boolean {
    return this.turnEntry(threadId, generation, botId) !== undefined;
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
    if (!entry) return { ok: false, code: "profile_not_mounted", error: "no Perspicax profile is mounted in this turn" };
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
      profileId: entry.profileId,
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
  private async sendForRoutine(link: PerspicaxMcpLink, entry: Entry, frame: Json): Promise<{ response: Response; text: string } | "ended" | "unreachable"> {
    const replayable = perspicaxReplayable(frame, entry.readOnlyTools) || frame.method === "initialize";
    for (let attempt = 0; ; attempt += 1) {
      const note: { unsent?: boolean } = {};
      const sent = await this.send(link, entry, frame, note);
      if (sent === "ended") return sent;
      const status = sent === "unreachable" ? 0 : sent.response.status;
      const retry = sent === "unreachable"
        ? replayable || note.unsent === true
        : TRANSIENT_HTTP.has(status) && (replayable || status === 503);
      const wait = this.routineRetryMs[attempt];
      if (!retry || wait === undefined) return sent;
      this.log(`perspicax mcp: profile ${entry.profileId} ${status ? `answered HTTP ${status}` : "could not be reached"} during a routine; trying again in ${Math.round(wait / 1000)} s`);
      await this.sleep(wait);
      if (entry.ended) return "ended";
    }
  }

  /** POST one frame with the entry's token and session; a 401 renews the
   * token once. The answer is read whole (bounded); the session it names is kept. */
  private async send(link: PerspicaxMcpLink, entry: Entry, frame: Json, note?: { unsent?: boolean }, identityInternal = false): Promise<{ response: Response; text: string } | "ended" | "unreachable"> {
    let response: Response;
    try {
      response = await this.post(link.mcpEndpoint(), entry, frame);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        if (!(await this.renew(entry))) return "ended";
        if (!identityInternal && frame.id !== undefined && frame.method !== "initialize") await entry.identity?.ensure(true);
        if (!identityInternal && frame.method === "tools/call" && isObject(frame.params) && entry.identity && !entry.identity.allows(String(frame.params.name))) {
          return { response: new Response(null, { status: 200 }), text: JSON.stringify(this.identityRefusal(frame)) };
        }
        response = await this.post(link.mcpEndpoint(), entry, frame);
        if (response.status === 401) {
          void response.body?.cancel().catch(() => {});
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
        entry.toolsListBody = undefined;
      }
      entry.mcpSessionId = session;
    }
    try {
      const onRequest = this.options.askGo ? (request: Json) => this.answerServerRequest(link, entry, request) : undefined;
      const onNotification = (note: Json) => {
        if (note.method === "notifications/tools/list_changed") entry.toolsListBody = undefined;
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
        answer = await this.options.askGo({ threadId: entry.threadId, botId: entry.botId, profileId: entry.profileId, message: message.slice(0, 2000) });
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
      void response.body?.cancel().catch(() => {});
    } catch {
      this.log(`perspicax mcp: an answer to Perspicax for profile ${entry.profileId} could not be sent`);
    }
  }

  /** Open a new MCP session for the entry (initialize, then initialized),
   * one at a time; true when Perspicax named a session. */
  private reopen(link: PerspicaxMcpLink, entry: Entry): Promise<boolean> {
    entry.reopening ??= this.reopenOnce(link, entry).finally(() => { entry.reopening = undefined; });
    return entry.reopening;
  }

  private async reopenOnce(link: PerspicaxMcpLink, entry: Entry): Promise<boolean> {
    if (entry.ended) return false;
    entry.mcpSessionId = undefined;
    entry.initialized = false;
    entry.toolsListBody = undefined;
    entry.identity?.invalidate();
    const params = this.initParams.get(initKey(entry.threadId, entry.profileId)) ?? {
      protocolVersion: PERSPICAX_PROTOCOL_VERSION,
      capabilities: this.options.askGo ? withElicitation({}) : {},
      clientInfo: { name: `Pulsa Bot (${entry.botId})`, version: this.options.version },
    };
    const id = `sagax-reopen-${++this.reopens}`;
    const opened = await this.send(link, entry, { jsonrpc: "2.0", id, method: "initialize", params });
    if (typeof opened === "string" || !opened.response.ok) return false;
    const body = parseMcpBody(opened.text, id);
    if (!isObject(body) || !isObject(body.result)) return false;
    entry.initialized = true;
    const done = await this.send(link, entry, { jsonrpc: "2.0", method: "notifications/initialized" });
    return typeof done !== "string";
  }

  /** The engine's own initialize, kept so a new session looks like its first. */
  private rememberInit(entry: Entry, params: Json): void {
    const at = initKey(entry.threadId, entry.profileId);
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
   * next turn (prepareTurn takes them over), revoked otherwise. */
  private async retire(prefix: string, threadId: string): Promise<void> {
    const done: Promise<unknown>[] = [];
    const voiceKeep = this.options.keepWarm?.(threadId) === true;
    const engineKeep = this.options.engineWarm?.(threadId) === true;
    const keep = voiceKeep || engineKeep;
    for (const [at, entry] of this.entries) {
      if (!at.startsWith(prefix)) continue;
      this.entries.delete(at);
      // Voice turns clear the identity lease each time (AGENTS.md). An
      // engine-warm keep leaves the lease and tools/list cache so the next
      // turn skips the re-handshake; keep-alive pings continue.
      if (voiceKeep || !engineKeep) {
        this.disarmKeepAlive(entry);
        await entry.identity?.clear();
        entry.identity = undefined;
        entry.servedTools = undefined;
        entry.readOnlyTools = undefined;
        entry.twilioTools = undefined;
        entry.toolsListBody = undefined;
      }
      if (keep && !entry.ended && entry.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
        const warm = warmKey(entry.threadId, entry.profileId, entry.principalId, entry.source);
        const previous = this.warm.get(warm);
        if (previous && previous !== entry) done.push(this.close(previous));
        this.warm.set(warm, entry);
        if (engineKeep && entry.mcpSessionId) this.touchKeepAlive(entry);
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
    const result = signIn.ok ? await link.exchangeToken(signIn.token, entry.profileId) : null;
    if (entry.source === "delegation" && result && !result.ok && result.error === "subject") this.options.delegationRefused?.(entry.principalId);
    if (entry.ended) {
      if (result?.ok) void this.revoke(result.token);
      return false;
    }
    if (!signIn.ok || !result?.ok) {
      this.log(`perspicax mcp: the access for profile ${entry.profileId} could not be renewed (${signIn.ok ? (result && !result.ok ? result.error : "error") : signIn.error})`);
      this.end(entry);
      return false;
    }
    const old = entry.token;
    entry.token = result.token;
    entry.expiresAt = Math.min(result.expiresAt, signIn.expiresAt);
    entry.identity?.invalidate();
    entry.toolsListBody = undefined;
    void this.revoke(old);
    return true;
  }

  private end(entry: Entry): void {
    if (entry.ended) return;
    entry.ended = true;
    this.disarmKeepAlive(entry);
    void entry.identity?.clear();
    void this.revoke(entry.token);
  }

  private async close(entry: Entry): Promise<void> {
    const link = this.options.link();
    if (entry.ended) return;
    this.disarmKeepAlive(entry);
    await entry.identity?.clear();
    entry.ended = true;
    // The session goes first, while its token still opens it; then the token.
    if (link && entry.mcpSessionId) {
      await this.fetcher(link.mcpEndpoint(), {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { authorization: `Bearer ${entry.token}`, "mcp-session-id": entry.mcpSessionId },
      }).then((response) => { void response.body?.cancel().catch(() => {}); }, () => {});
    }
    await this.revoke(entry.token);
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
