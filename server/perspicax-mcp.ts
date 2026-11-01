// Perspicax MCP for the person who speaks (slice 5, spec section 4).
//
// A bot on an organization server lists Perspicax profiles
// (server/bot-perspicax.ts). When a turn starts, the harness takes the
// speaker's current sign-in access token (server/idp-session.ts, memory
// only) and exchanges it at Perspicax (RFC 8693, server/perspicax-link.ts)
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
import { guardToolCall, type GuardOptions } from "./mcp-permissions.ts";
import { telephonyRefusal, voiceToolCall } from "./telephony-guard.ts";
import { placeArgsFromVoiceCall } from "../shared/outbound-call.ts";
import type { SubjectTokenOutcome } from "./idp-session.ts";
import type { DirectoryProfile, ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "./drivers/acp/grok-read-only-tools.ts";
import { executionKey, WriteOnce } from "./write-once.ts";

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
  /** The thread is on a live voice call: a turn's tokens are kept for its
   * next turn instead of revoked, so the call's tools stay mounted from turn
   * to turn without a new exchange (server/voice-call-session.ts). */
  keepWarm?(threadId: string): boolean;
  /** Pulsa Bot's version, sent in `clientInfo`. */
  version: string;
  /** Permission check for tools/call frames (server/mcp-permissions.ts). Null
   * or absent: no check. The audit hook never carries arguments or results. */
  permissionGuard?(input: { botId: string; principalId: string }): GuardOptions | null;
  /** The scope a write of this turn is made once in (server/write-once.ts),
   * or null for no guard: two unattended runs (routine passes, coordinated
   * bots) of one person that send the same write with the same arguments
   * at the same time make one call, the other gets its answer. */
  writeOnceScope?(turn: { threadId: string; botId: string; principalId: string }): string | null;
  /** Every remote_support_* answer of a turn (server/remote-session-register.ts):
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
export const PERSPICAX_ACCESS_ENDED = "Perspicax access for this turn ended";
/** A call Sagax did not replay after Perspicax dropped the MCP session: it can
 * change data, so the bot decides (the call never reached Perspicax's tool). */
export const PERSPICAX_SESSION_RESET = "Perspicax had dropped this MCP session (idle or restarted). Sagax opened a new one, but did not replay this call because it can change data: it did not run. Call it again if it is still wanted.";

/** The answer a write that was not sent again carries in front of the first one's. */
export const PERSPICAX_WRITE_REPLAYED = "Not sent again: another run made this same write with the same arguments moments ago (one write per execution key). Its answer follows; the record already exists.";
/** The tools whose name says they change data: a connector's `<api>__write`,
 * `__action` or `__<x>_write`, its named writes (`log_time`, `book_*`,
 * `update_*`, `create_*`, `delete_*`), and the host's own. Reads, polls
 * (await_turn) and leases (claim*, per holder, renewals must reach
 * Perspicax) are never answered from a previous call. */
const WRITE_SUFFIX = /^(write|action|log_time|(book|update|create|delete)_[a-z0-9_]+|[A-Za-z0-9_]+_write)$/;
const HOST_WRITES = new Set(["memory_write", "memory_propose", "memory_promote", "memory_forget", "create_agent", "delete_agent",
  "sagax_send", "sagax_routine_run", "sagax_nudge", "remote_support_open", "remote_support_close"]);
export function perspicaxWriteOnceTool(name: string): boolean {
  const at = name.lastIndexOf("__");
  return at > 0 ? WRITE_SUFFIX.test(name.slice(at + 2)) : HOST_WRITES.has(name);
}

/** Requests that only read, safe to send again on a new session. */
const READ_ONLY_METHODS = new Set(["tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get", "ping", "completion/complete"]);

/** Whether a frame may be sent again after a new session: a read-only method,
 * or tools/call of a Perspicax tool reviewed as read-only (grok-read-only-tools.ts).
 * Writes, actions, sends and unknown tools are never replayed. */
export function perspicaxReplayable(frame: Record<string, unknown>): boolean {
  const method = frame.method;
  if (typeof method !== "string") return false;
  if (READ_ONLY_METHODS.has(method)) return true;
  if (method !== "tools/call") return false;
  const params = frame.params;
  const name = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>).name : undefined;
  return typeof name === "string" && PERSPICAX_READ_ONLY_TOOLS.has(name);
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
  /** One re-initialize at a time (relay, a session Perspicax dropped). */
  reopening?: Promise<boolean>;
  /** The person is out, or the access could not be renewed: every call ends. */
  ended?: boolean;
  renewing?: Promise<boolean>;
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
 * call that waits on the client's answer can go on. */
async function readBounded(response: Response, max: number, onRequest?: (request: Json) => Promise<void>): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error("the Perspicax answer is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stream = onRequest !== undefined && (response.headers.get("content-type") ?? "").includes("text/event-stream");
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
      if (isObject(frame) && typeof frame.method === "string" && (typeof frame.id === "string" || typeof frame.id === "number")) {
        pending.push(onRequest(frame).catch(() => {}));
      }
    }
    scanned = end + 1;
  }
  await Promise.all(pending);
  return text + decoder.decode();
}

function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export class PerspicaxMcp {
  private readonly options: PerspicaxMcpOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
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
  /** Per profile: tools whose tools/list entry names Twilio (telephony guard). */
  private readonly twilioTools = new Map<string, Set<string>>();
  /** "At the same time": a 5 minute window, then a write is sent again. */
  private readonly writes = new WriteOnce<PerspicaxRelayAnswer>({ ttlMs: 5 * 60_000 });

  constructor(options: PerspicaxMcpOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Exchange the speaker's access for each profile of the bot, before the
   * engine starts. Never throws. */
  async prepareTurn(input: {
    threadId: string;
    generation: string;
    bot: { id: string; perspicax?: { profiles: readonly string[] } };
    speakerPrincipalId: string;
    speakerOrigin: "person" | "operator" | "owner-routine" | "peer";
    /** The turn descends from a routine or other automation (a hop it
     * asked, a thread it opened, a room goal it runs). */
    routine?: boolean;
  }): Promise<PerspicaxTurnPlan> {
    const plan: PerspicaxTurnPlan = { mounted: [], unavailable: [] };
    const link = this.options.link();
    const profiles = [...new Set(input.bot.perspicax?.profiles ?? [])];
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
    const principalId = input.speakerPrincipalId.trim();
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
    const keepWarm = this.options.keepWarm?.(input.threadId) === true;
    // the call ended (or expired) without saying so: its kept tokens go
    if (!keepWarm) void this.endWarm(input.threadId);
    if (keepWarm) {
      need = [];
      for (const profileId of known) {
        const at = warmKey(input.threadId, profileId, principalId, source);
        const kept = this.warm.get(at);
        if (kept && !kept.ended && kept.botId === input.bot.id && kept.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
          this.warm.delete(at);
          kept.generation = input.generation;
          const previous = this.entries.get(key(input.threadId, input.generation, profileId));
          if (previous && previous !== kept) void this.revoke(previous.token);
          this.entries.set(key(input.threadId, input.generation, profileId), kept);
          const profile = catalog.get(profileId)!;
          plan.mounted.push({ profileId, slug: profile.slug, name: profile.name || profile.slug || profileId });
          this.log(`perspicax mcp: profile ${profileId} kept for the call's next turn`);
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
      if (previous) void this.revoke(previous.token);
      this.entries.set(at, {
        threadId: input.threadId,
        generation: input.generation,
        botId: input.bot.id,
        profileId,
        principalId,
        subject: who,
        source,
        token: result.token,
        expiresAt: Math.min(result.expiresAt, signIn.expiresAt),
      });
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
    return executionKey([scope, entry.principalId, input.profileId, name, params.arguments ?? {}]);
  }

  private async relayFrame(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown; judged?: boolean }): Promise<PerspicaxRelayAnswer> {
    const entry = this.entries.get(key(input.threadId, input.generation, input.profileId));
    if (!entry || entry.botId !== input.botId) return { status: 403, body: { error: "this Perspicax profile is not mounted in this turn", code: "profile_not_mounted" } };
    if (!isObject(input.frame)) return { status: 400, body: rpcError(null, -32600, "Invalid Request") };
    const frame: Json = { ...input.frame };
    const id = frame.id;
    const notification = id === undefined;
    const ended = (): PerspicaxRelayAnswer => (notification ? { status: 202 } : { status: 200, body: rpcError(id, -32001, PERSPICAX_ACCESS_ENDED) });
    if (!(this.options.botProfiles(input.botId) ?? []).includes(input.profileId)) {
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
    const blocked = input.judged ? null : telephonyBlock(frame, this.twilioTools.get(input.profileId)) ?? await this.permissionBlock(entry, frame);
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
    if (frame.method !== "initialize" && !notification && !entry.mcpSessionId && this.initParams.has(initKey(entry.threadId, entry.profileId))) {
      await this.reopen(link, entry);
    }
    const usedSession = entry.mcpSessionId;
    const sent = await this.send(link, entry, frame);
    if (sent === "ended") return ended();
    if (sent === "unreachable") return notification ? { status: 202 } : { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
    let { response, text } = sent;
    if (frame.method !== "initialize" && perspicaxSessionLost(response.status, text)) {
      // Perspicax dropped the session (idle past its keep-alive, a restart):
      // initialize again, once; send a read again, never a write.
      // a concurrent call may have opened the new session already
      const reopened = entry.mcpSessionId !== undefined && entry.mcpSessionId !== usedSession ? true : await this.reopen(link, entry);
      const replay = reopened && !notification && perspicaxReplayable(frame);
      this.log(`perspicax mcp: profile ${entry.profileId} session lost (HTTP ${response.status}); ${reopened ? "a new one is open" : "a new one could not be opened"}; ${replay ? "read sent again" : notification ? "notification dropped" : "call not replayed"}`);
      if (notification) return { status: 202 };
      if (!reopened) return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
      if (!replay) return { status: 200, body: rpcError(id, -32000, PERSPICAX_SESSION_RESET) };
      const again = await this.send(link, entry, frame);
      if (again === "ended") return ended();
      if (again === "unreachable") return { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
      ({ response, text } = again);
    }
    if (notification) return { status: 202 };
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
      const body = parseMcpBody(text, id);
      if (frame.method === "tools/list" && body !== null) {
        const named = twilioToolsOf(body);
        if (named.length) this.twilioTools.set(input.profileId, new Set([...(this.twilioTools.get(input.profileId) ?? []), ...named].slice(-500)));
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
    const listed = this.options.botProfiles(botId) ?? [];
    for (const [at, entry] of this.entries) {
      if (at.startsWith(prefix) && entry.botId === botId && !entry.ended && listed.includes(entry.profileId)) return entry;
    }
    return undefined;
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
  async callTool(input: { threadId: string; generation: string; botId: string; name: string; args: Json }): Promise<PerspicaxToolAnswer> {
    const entry = this.turnEntry(input.threadId, input.generation, input.botId);
    if (!entry) return { ok: false, code: "profile_not_mounted", error: "no Perspicax profile is mounted in this turn" };
    const link = this.options.link();
    if (!link) return { ok: false, code: "access_ended", error: PERSPICAX_ACCESS_ENDED };
    if (!entry.mcpSessionId && !(await this.reopen(link, entry))) {
      return entry.ended
        ? { ok: false, code: "access_ended", error: PERSPICAX_ACCESS_ENDED }
        : { ok: false, code: "unreachable", error: "Perspicax is unavailable" };
    }
    const id = `sagax-native-${++this.nativeCalls}`;
    const answer = await this.relay({
      threadId: input.threadId,
      generation: input.generation,
      botId: input.botId,
      profileId: entry.profileId,
      frame: { jsonrpc: "2.0", id, method: "tools/call", params: { name: input.name, arguments: input.args } },
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

  /** POST one frame with the entry's token and session; a 401 renews the
   * token once. The answer is read whole (bounded); the session it names is kept. */
  private async send(link: PerspicaxMcpLink, entry: Entry, frame: Json): Promise<{ response: Response; text: string } | "ended" | "unreachable"> {
    let response: Response;
    try {
      response = await this.post(link.mcpEndpoint(), entry, frame);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        if (!(await this.renew(entry))) return "ended";
        response = await this.post(link.mcpEndpoint(), entry, frame);
        if (response.status === 401) {
          void response.body?.cancel().catch(() => {});
          this.end(entry);
          return "ended";
        }
      }
    } catch (error) {
      this.log(`perspicax mcp: a call could not reach Perspicax (${error instanceof Error ? error.name : "error"})`);
      return "unreachable";
    }
    const session = response.headers.get("mcp-session-id");
    if (session && session.length <= 256) entry.mcpSessionId = session;
    try {
      const onRequest = this.options.askGo ? (request: Json) => this.answerServerRequest(link, entry, request) : undefined;
      return { response, text: await readBounded(response, PERSPICAX_RELAY_MAX_BYTES, onRequest) };
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
    const params = this.initParams.get(initKey(entry.threadId, entry.profileId)) ?? {
      protocolVersion: PERSPICAX_PROTOCOL_VERSION,
      capabilities: this.options.askGo ? withElicitation({}) : {},
      clientInfo: { name: `Pulsa Bot (${entry.botId})`, version: this.options.version },
    };
    const opened = await this.send(link, entry, { jsonrpc: "2.0", id: `sagax-reopen-${++this.reopens}`, method: "initialize", params });
    if (typeof opened === "string" || !opened.response.ok || !entry.mcpSessionId) return false;
    const done = await this.send(link, entry, { jsonrpc: "2.0", method: "notifications/initialized" });
    return typeof done !== "string" && Boolean(entry.mcpSessionId);
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
   * turn). On a live call its tokens are kept for the call's next turn. */
  async endThread(threadId: string): Promise<void> {
    const keep = this.options.keepWarm?.(threadId) === true;
    await Promise.all([this.retire(`${threadId}\u0000`, threadId), ...(keep ? [] : [this.endWarm(threadId)])]);
  }

  /** End the entries under `prefix`: kept for a live call's next turn
   * (prepareTurn takes them over), revoked otherwise. */
  private async retire(prefix: string, threadId: string): Promise<void> {
    const done: Promise<unknown>[] = [];
    const keep = this.options.keepWarm?.(threadId) === true;
    for (const [at, entry] of this.entries) {
      if (!at.startsWith(prefix)) continue;
      this.entries.delete(at);
      if (keep && !entry.ended && entry.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
        const warm = warmKey(entry.threadId, entry.profileId, entry.principalId, entry.source);
        const previous = this.warm.get(warm);
        if (previous && previous !== entry) done.push(this.close(previous));
        this.warm.set(warm, entry);
        continue;
      }
      done.push(this.close(entry));
    }
    await Promise.all(done);
  }

  /** Shutdown: revoke everything. */
  async endAll(): Promise<void> {
    const all = [...this.entries.values(), ...this.warm.values()];
    this.entries.clear();
    this.warm.clear();
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
    void this.revoke(old);
    return true;
  }

  private end(entry: Entry): void {
    if (entry.ended) return;
    entry.ended = true;
    void this.revoke(entry.token);
  }

  private async close(entry: Entry): Promise<void> {
    const link = this.options.link();
    if (entry.ended) return;
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
