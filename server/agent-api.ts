// The agent-to-agent API: twelve tools that let one agent (a Sagax bot, or a
// person's AI client attached to Perspicax) find, create, prompt and read
// other Sagax bots, with the semantics, parameters and limits of the reference design's
// own agent tools (docs/agent-api.md):
//
//   list_agents, find_agents, get_agent, create_agent, delete_agent,
//   send_prompt, await_turn, read_transcript, read_transcript_page,
//   read_latest_page, read_latest_page_with_threads, read_transcript_cold
//
// create_agent makes a temporary agent and delete_agent archives one
// (server/temporary-agents.ts, Perspicax #321).
//
// This file is the core only: validation, the turn handle, waiting for a
// turn, transcript paging, rate limits, scopes and the audit hook. It reads
// no store and starts no turn itself. Two transports feed it a caller and a
// set of dependencies (server/index.ts):
//   - a bot, through its "agents" MCP server (/api/internal/agent-api/*):
//     it reaches the peers its team and allow-list let it reach;
//   - a person's AI client, through the member API
//     (/api/org/member/agents/*, Perspicax's tools of the same names): it
//     reaches the bots that person can use in Sagax.
// A bot's send lands in the agent's single chat with the person the caller
// works for (#1170, like the reference design): the sender rides on the line
// and the chat folds the exchange (#291). A person's AI client is another
// agent (2026-10-29): its send lands in its own conversation with the bot,
// drawn like a bot-to-bot one and silent for the person
// (shared/agent-conversation.ts); the turn still runs as the person.
import type { GuardDecision, GuardPolicy, GuardTarget, ToolGuardMode } from "./tool-guard.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { parseWakePriority, planPriorityWake, releasePriorityNow, wakeSenderId, type PriorityDelivery } from "./priority-wake.ts";
import { TEMP_AGENT_IDLE_HOURS_MAX } from "./temporary-agents.ts";

export const AGENT_TOOL_NAMES = [
  "list_agents",
  "find_agents",
  "get_agent",
  "create_agent",
  "delete_agent",
  "send_prompt",
  "await_turn",
  "read_transcript",
  "read_transcript_page",
  "read_latest_page",
  "read_latest_page_with_threads",
  "read_transcript_cold",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const isAgentToolName = (name: string): name is AgentToolName => (AGENT_TOOL_NAMES as readonly string[]).includes(name);

/** The three scopes a caller may hold. */
export type AgentScope = "agents.read" | "agents.send" | "agents.create";

export interface AgentToolPolicy {
  scope: AgentScope;
  /** read: changes nothing; write: sends work; admin: creates something lasting. */
  access: "read" | "write" | "admin";
  readOnly: boolean;
  /** Calls per caller per window (RATE_WINDOW_MS[access]). */
  rate: number;
}

/** The tool-policy row of an agent tool (docs/tool-policy.md). */
export function agentToolGuardPolicy(policy: AgentToolPolicy, tool?: AgentToolName): GuardPolicy {
  // 2026-10-26: archiving one's own agent is theirs, no grant needed
  // (tool-guard.ts ownerScoped); anyone else's stays admin
  const ownerScoped = tool === "delete_agent" && policy.access === "admin";
  return { tier: policy.access, scope: `agents:${policy.access}`, readOnly: policy.readOnly, defaultEnabled: policy.access !== "admin", ...(ownerScoped ? { ownerScoped: true } : {}) };
}

export const RATE_WINDOW_MS = { read: 60_000, write: 60_000, admin: 3_600_000 } as const;

export const AGENT_TOOL_POLICY: Record<AgentToolName, AgentToolPolicy> = {
  list_agents: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  find_agents: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  get_agent: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  create_agent: { scope: "agents.create", access: "admin", readOnly: false, rate: 5 },
  // Archives a temporary agent: the same scope as creating one.
  delete_agent: { scope: "agents.create", access: "admin", readOnly: false, rate: 30 },
  send_prompt: { scope: "agents.send", access: "write", readOnly: false, rate: 30 },
  // await_turn waits on a turn the caller already started: a read.
  await_turn: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript_page: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_latest_page: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_latest_page_with_threads: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript_cold: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
};

// Limits, the reference's where it names one.
export const FIND_LIMIT_MAX = 64;
export const FIND_LIMIT_DEFAULT = 8;
export const PROMPT_MAX_CHARS = 32_000;
export const SEND_FILES_MAX = 8;
export const SEND_FILE_MAX_BYTES = 25 * 1024 * 1024;

/** The prompt a send_prompt turn sees after its files are staged under
 * workspaces/<bot>/inbox/<sender>/ (`staged` is relative to that workspace).
 * #1169: it names both ways in. workspace_read takes the relative path and
 * is the bot's own reviewed read, whatever the computer. The full path is
 * for the bot's file tools (a read of its own workspace is the owner's card,
 * answered at the bot's level). Never "host file tools": an organization
 * server withholds them. */
export function agentPromptWithFiles(prompt: string, staged: readonly string[], workspaceRoot: string): string {
  if (!staged.length) return prompt;
  const full = staged.map((rel) => join(workspaceRoot, rel));
  return `${prompt}\n\n[Files sent with this message, now in your Sagax workspace folder: ${staged.join(", ")}. Read them with workspace_read using those paths (relative to your workspace; it reads text), or with your file tools at the full paths: ${full.join(", ")}. If you work on a VM or cloud computer, they are not there until you copy them over (read here, then write them there).]`;
}
export const TIMEOUT_MS_MIN = 1_000;
export const TIMEOUT_MS_MAX = 600_000;
export const TIMEOUT_MS_DEFAULT = 120_000;
/**
 * await_turn waits: engines and relays often cut a tool call at ~60 s.
 * Return a structured still_working result under that ceiling so the caller
 * can resume with the same handle (and wait_cursor) instead of an error.
 * Pattern matches PHONE_TOOL_CALL_WAIT_MS in shared/phone-tools.ts.
 */
export const AWAIT_TIMEOUT_MS_MIN = 0;
export const AWAIT_TIMEOUT_MS_DEFAULT = 45_000;
export const AWAIT_TIMEOUT_MS_MAX = 55_000;
/** Suggested timeout_ms on the next await_turn when the turn is still going. */
export const AWAIT_RECOMMENDED_WAIT_MS = 45_000;
/** How many recent steps a still_working answer carries. */
export const AWAIT_STEPS_MAX = 32;
export const PAGE_LIMIT_MAX = 200;
export const PAGE_LIMIT_DEFAULT = 20;
export const COLD_PAGE_SIZE = 50;
/** read_transcript answers at most this many entries, newest kept, with a cursor for the rest. */
export const FULL_TRANSCRIPT_MAX = 2_000;
/** One answer's entries stay under this many bytes (JSON), so an MCP
 * gateway reading at most 1 MiB always gets it whole. A page that would be
 * larger keeps its newest entries and continues with next_cursor. */
export const PAGE_MAX_BYTES = 800_000;
export const AGENT_NAME_MAX = 80;
export const AGENT_DESCRIPTION_MAX = 1_000;
export const ENTRY_TEXT_MAX = 16_000;
export const REPLY_MAX_CHARS = 32_000;
/** create_agent's workspace: where its Auto turns start (server/auto-computer.ts). */
export type AgentWorkspace = "this_computer" | "browser" | "cloud" | "local_vm";
const AGENT_WORKSPACES: readonly AgentWorkspace[] = ["this_computer", "browser", "cloud", "local_vm"];
/** create_agent's idle_hours (server/temporary-agents.ts). */
export const IDLE_HOURS_MAX = TEMP_AGENT_IDLE_HOURS_MAX;
/** How long a turn handle stays valid. */
export const HANDLE_TTL_MS = 7 * 24 * 3_600_000;
const POLL_MS = 400;
/** Idle looks in a row that end a wait with no words (a turn that said nothing or failed). */
const IDLE_LOOKS_DONE = 3;
/** Refusal codes a caller can usefully retry (same args or after a short wait). */
const RETRYABLE_REFUSAL_CODES = new Set([
  "busy",
  "rate_limited",
  "server_error",
]);

export type SendMode = "fire_and_forget" | "blocking" | "async";
export type OnBusy = "supersede" | "reject" | "queue";
export type AgentStatus = "running" | "idle";
/** A conversation's live state; queued counts as running (its turn is coming). */
export type TurnState = "running" | "waiting" | "queued" | "idle";

export interface AgentCaller {
  kind: "bot" | "person";
  /** The bot id, or the person's principal id. */
  id: string;
  name: string;
  scopes: ReadonlySet<AgentScope>;
  /** For the audit row: perspicax-mcp, console, agents-mcp. */
  via: string;
  /** A bot caller's own conversation (the turn that called). */
  sourceThreadId?: string;
  /** A bot caller's comms depth: a turn another agent started is 1. */
  depth?: number;
  /** A person caller: their Perspicax user id, and whether this call was
   * signed as an organization admin. */
  sub?: string;
  admin?: boolean;
  /** A person caller: the AI client or connection that made the call, as
   * Perspicax signed it (`client_name`); names the outside agent's
   * conversation (shared/agent-conversation.ts). */
  client?: string;
  /** Bot callers: the person the source turn spoke for, when known (the
   * transport fills it; the core only carries it to notify). */
  speakerPrincipalId?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  /** A temporary agent (create_agent): it expires when idle and can be deleted. */
  temporary?: boolean;
  /** The person who owns this agent, as get_agent answers it. Null when none
   * is known to the caller. `principal_id` is the value to pass to sagax_nudge. */
  owner: { principal_id: string; name: string } | null;
}

/** What get_agent answers beyond the summary (the dependencies fill it). */
export interface AgentProfile {
  title: string;
  owner: { principal_id: string; name: string } | null;
  /** Null when the caller may use the agent but not read its instructions. */
  profile: {
    instructions: string;
    instructions_truncated: boolean;
    persona: string | null;
    rules: string | null;
    voice: string | null;
    anti_jobs: string | null;
    headings: string[];
    voice_settings: { voice: string | null; speak_replies: boolean; voice_notes: boolean };
  } | null;
  temporary: {
    created_at: number;
    idle_hours: number;
    expires_at: number | null;
    pinned: boolean;
  } | null;
  /** The agent's sheet, when the server can name one. */
  profile_url: string | null;
}

export interface TranscriptThread {
  threadId: string;
  title: string;
  hidden: boolean;
}

/** One stored message, as the dependencies hand it over. */
export interface StoredMessage {
  id: string;
  role: string;
  kind?: string;
  text?: string;
  at: number;
  sender?: string | null;
  tool?: { name?: string; ok?: boolean } | null;
  attachments?: Array<{ name?: string; path?: string }> | null;
}

export interface TranscriptEntry {
  cursor: string;
  id: string;
  thread_id: string;
  role: "user" | "agent";
  kind: "text" | "tool" | "note";
  text: string;
  at: number;
  from: string | null;
  files?: string[];
}

export interface FileInput {
  /** Workspace-relative path (bot caller) or the name the file is given (person caller). */
  path: string;
  /** Person callers send the bytes (base64); a bot's files are read from its workspace. */
  content_base64?: string;
}

export interface Refusal {
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

export const isRefusal = (value: unknown): value is Refusal =>
  Boolean(value) && typeof value === "object" && typeof (value as Refusal).code === "string" && typeof (value as Refusal).status === "number" && typeof (value as Refusal).message === "string";

/** Whether a refusal's code is worth retrying (busy, rate limit, transient). */
export const isRetryableRefusal = (code: string): boolean => RETRYABLE_REFUSAL_CODES.has(code);

export const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>): Refusal => {
  const retryable = typeof extra?.retryable === "boolean" ? extra.retryable : isRetryableRefusal(code);
  return {
    status,
    code,
    message,
    extra: { ...extra, retryable },
  };
};

export interface AuditEntry {
  tool: AgentToolName | string;
  agentId: string | null;
  outcome: "ok" | "refused" | "error";
  code?: string;
  /** Shape only: never a prompt, a reply or a file's content. */
  detail?: Record<string, unknown>;
}

export interface AgentApiDeps {
  /** Every agent the caller may reach (tenant/org isolation is applied here). */
  agents(caller: AgentCaller): AgentSummary[] | Promise<AgentSummary[]>;
  /** Create one temporary agent for the caller; it greets the user itself.
   * idleHours is the caller's expiry, else the server's default. */
  createAgent(caller: AgentCaller, input: { name: string; description: string; idleHours?: number; workspace?: AgentWorkspace }): Promise<AgentSummary | Refusal>;
  /** The full profile of a reachable agent, as this caller may read it. */
  profile(caller: AgentCaller, agentId: string): AgentProfile | Refusal | Promise<AgentProfile | Refusal>;
  /** Archive a temporary agent (its conversations are kept for a while). */
  deleteAgent(caller: AgentCaller, agentId: string): Promise<{ archived_at: number; purge_at: number } | Refusal>;
  /** The conversations with this agent the caller may read. */
  threads(caller: AgentCaller, agentId: string): TranscriptThread[];
  /** A conversation's stored messages, oldest first. Never wakes anything. */
  messages(threadId: string): StoredMessage[];
  /** The live state of one conversation. */
  turnState(agentId: string, threadId: string): TurnState;
  /** Where a send that names no thread goes. A bot caller: the agent's
   * single chat with the person it works for (#1170). A person's AI client:
   * its own conversation with the agent (2026-10-29,
   * shared/agent-conversation.ts), reused across sends. */
  conversation(caller: AgentCaller, agentId: string): Promise<{ threadId: string } | Refusal>;
  /** Put the prompt (and the staged files) into the conversation and start or
   * queue its turn. messageId is the stored prompt's id, when known. */
  post(caller: AgentCaller, agentId: string, threadId: string, prompt: string, files: FileInput[], wake?: PriorityDelivery): Promise<{ messageId: string | null } | Refusal>;
  /** Stop the conversation's running turn (on_busy supersede). */
  interrupt(agentId: string, threadId: string): Promise<void>;
  /** Async mode: tell the caller the turn ended (a bot is woken with the reply). */
  notify?(caller: AgentCaller, agent: AgentSummary, result: TurnResult): void;
  audit(caller: AgentCaller, entry: AuditEntry): void;
  /** The securable tool layer (server/tool-guard.ts): grants and the speaker.
   * Absent, or mode "off", skips it; "shadow" records the decision only. */
  guard?(caller: AgentCaller, policy: GuardPolicy, target?: GuardTarget): GuardDecision;
  /** The person who owns this agent, lowercased, or null (tool-guard.ts ownerScoped). */
  agentOwner?(agentId: string): string | null;
  guardMode?: ToolGuardMode;
  /** The HMAC key turn handles are signed with (at least 32 bytes). */
  secret: Buffer;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

/** One visible step of a turn (tool name or note), for still_working progress. */
export interface TurnStep {
  cursor: string;
  kind: "tool" | "note" | "text";
  text: string;
  at: number;
}

export interface TurnProgress {
  summary: string;
  turn_state: TurnState;
  steps: TurnStep[];
  steps_total: number;
}

export interface TurnResult {
  handle: string;
  agent_id: string;
  thread_id: string;
  finished: boolean;
  status: "finished" | "running" | "waiting_for_approval" | "queued" | "still_working";
  /** The agent's words in this turn; empty with finished=true means it said nothing. */
  reply: string;
  /** When finished is false after a wait: progress so far and where to resume. */
  progress?: TurnProgress;
  /** Pass as cursor on the next await_turn so steps are not repeated. */
  wait_cursor?: string | null;
  recommended_wait_ms?: number;
}

// ── validation ────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
const ID = /^[\w-]{1,128}$/;

const objectArgs = (value: unknown): Args | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Args : value === undefined || value === null ? {} : null;

function onlyKeys(args: Args, allowed: readonly string[]): Refusal | null {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key) && args[key] !== undefined && args[key] !== null);
  return extra.length ? refuse(400, "bad_request", `Unknown parameter: ${extra[0]}. Allowed: ${allowed.join(", ") || "none"}.`) : null;
}

function agentIdArg(args: Args): string | Refusal {
  const id = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
  return ID.test(id) ? id : refuse(400, "bad_request", "agent_id is required: an id exactly as list_agents returned it.");
}

function intArg(args: Args, key: string, min: number, max: number, fallback: number | undefined): number | undefined | Refusal {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return refuse(400, "bad_request", `${key} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

function cursorArg(args: Args): CursorKey | null | Refusal {
  if (args.cursor === undefined || args.cursor === null || args.cursor === "") return null;
  if (typeof args.cursor !== "string") return refuse(400, "bad_request", "cursor is the next_cursor of a previous page.");
  const key = decodeCursor(args.cursor);
  return key ?? refuse(400, "bad_request", "cursor is not a cursor this API gave out.");
}

// ── cursors and handles ───────────────────────────────────────────────

interface CursorKey {
  at: number;
  threadId: string;
  id: string;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url").toString("utf8");

export function encodeCursor(key: CursorKey): string {
  return `c1.${b64(`${key.at}\n${key.threadId}\n${key.id}`)}`;
}

export function decodeCursor(cursor: string): CursorKey | null {
  if (!cursor.startsWith("c1.") || cursor.length > 600) return null;
  const parts = unb64(cursor.slice(3)).split("\n");
  if (parts.length !== 3) return null;
  const at = Number(parts[0]);
  if (!Number.isSafeInteger(at) || !ID.test(parts[1]!) || !parts[2] || parts[2].length > 160) return null;
  return { at, threadId: parts[1]!, id: parts[2]! };
}

/** Entry order: time, then conversation, then message id. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  return a.at - b.at || (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The claims inside a turn handle. Decision (audit 2026-10-29, B8): the
 * handle is opaque by contract. It is HMAC signed (never forged) and stays
 * base64url readable, because nothing in it is secret (the agent, the
 * conversation, the caller's own key) and a readable body costs nothing; but
 * its layout is not an interface and may change. Every value a caller needs
 * comes back as a result field: agent_id, thread_id and expires_at. */
interface HandleBody {
  /** agent id */
  a: string;
  /** conversation */
  t: string;
  /** the prompt's message id, when it was stored at once */
  m: string | null;
  /** issued at (ms): a queued prompt's turn is what follows it */
  i: number;
  /** caller key: a handle answers only the caller it was given to */
  c: string;
}

const callerKey = (caller: AgentCaller) => `${caller.kind}:${caller.id}`;

export function signHandle(secret: Buffer, body: HandleBody): string {
  const payload = b64(JSON.stringify(body));
  const mac = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
  return `turn_${payload}.${mac}`;
}

/** The same handle send_prompt returns, for a one-way send whose prompt is
 * stored when its turn starts (messageId null until then). */
export function signTurnHandle(secret: Buffer, input: {
  agentId: string;
  threadId: string;
  messageId: string | null;
  issuedAt: number;
  callerId: string;
  callerKind: "bot" | "person";
}): string {
  return signHandle(secret, {
    a: input.agentId,
    t: input.threadId,
    m: input.messageId,
    i: input.issuedAt,
    c: `${input.callerKind}:${input.callerId}`,
  });
}

/** Why await_turn refused a handle. verifyHandle yields format, signature or
 * age; await_turn adds other_agent and other_caller after a valid body. */
export type BadHandleReason = "signature" | "format" | "age" | "other_agent" | "other_caller";

/** The machine code of each refusal (audit 2026-10-29, Part A): a client
 * tells "expired" from "not yours" from "broken" by the code alone.
 * `details.family` stays `bad_handle` for a client that matched that code. */
export const BAD_HANDLE_CODE: Record<BadHandleReason, string> = {
  signature: "bad_handle",
  format: "bad_handle",
  age: "handle_expired",
  other_agent: "handle_agent_mismatch",
  other_caller: "handle_session_mismatch",
};

export type VerifyHandleResult =
  | { ok: true; body: HandleBody }
  /** age: the signature held, so the body is authentic and comes back. */
  | { ok: false; reason: "age"; body: HandleBody }
  | { ok: false; reason: "signature" | "format" };

const BAD_HANDLE_HINT =
  "Call read_latest_page with the agent_id and the thread_id send_prompt returned (it needs no handle), or await_turn without a handle.";

const BAD_HANDLE_MESSAGE: Record<BadHandleReason, string> = {
  signature: `That handle's signature does not match (it was altered or truncated). ${BAD_HANDLE_HINT}`,
  format: `That handle is not a turn handle. ${BAD_HANDLE_HINT}`,
  age: `That handle expired (a handle lasts ${HANDLE_TTL_MS / 3_600_000} hours, see expires_at in send_prompt's answer). ${BAD_HANDLE_HINT}`,
  other_agent: `That handle was issued for a different agent. ${BAD_HANDLE_HINT}`,
  other_caller: `That handle was issued to another caller or session. ${BAD_HANDLE_HINT}`,
};

/** The refusal of a handle. `threadId` is passed only when the handle was
 * authentic (its signature held) and names a conversation this caller may
 * read: the one-call recovery is then read_latest_page with it. */
export function badHandleRefusal(reason: BadHandleReason, threadId?: string | null): Refusal {
  return refuse(400, BAD_HANDLE_CODE[reason], BAD_HANDLE_MESSAGE[reason], {
    details: { reason, family: "bad_handle", ...(threadId ? { thread_id: threadId } : {}) },
    ...(threadId ? { thread_id: threadId } : {}),
    hint: BAD_HANDLE_HINT,
  });
}

/** When a handle stops being valid (ms since the epoch). */
export const handleExpiresAt = (issuedAt: number): number => issuedAt + HANDLE_TTL_MS;

export function verifyHandle(secret: Buffer, handle: string, now: number): VerifyHandleResult {
  if (typeof handle !== "string" || !handle.startsWith("turn_") || handle.length > 1_200) {
    return { ok: false, reason: "format" };
  }
  const [payload, mac] = handle.slice(5).split(".");
  if (!payload || !mac) return { ok: false, reason: "format" };
  const expected = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) {
    return { ok: false, reason: "signature" };
  }
  try {
    const body = JSON.parse(unb64(payload)) as HandleBody;
    if (typeof body.a !== "string" || typeof body.t !== "string" || typeof body.i !== "number" || typeof body.c !== "string") {
      return { ok: false, reason: "format" };
    }
    if (now - body.i > HANDLE_TTL_MS) return { ok: false, reason: "age", body };
    return { ok: true, body };
  } catch {
    return { ok: false, reason: "format" };
  }
}

// ── rate limits ───────────────────────────────────────────────────────

/** A sliding window per caller and tool. Memory only: a restart forgives. */
export class AgentRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Null when admitted, else how long until the next call is. */
  admit(caller: AgentCaller, tool: AgentToolName, now: number): number | null {
    const policy = AGENT_TOOL_POLICY[tool];
    const windowMs = RATE_WINDOW_MS[policy.access];
    const key = `${callerKey(caller)}|${tool}`;
    const kept = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (kept.length >= policy.rate) {
      this.hits.set(key, kept);
      return Math.max(1, windowMs - (now - kept[0]!));
    }
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > 10_000) this.prune(now);
    return null;
  }

  private prune(now: number): void {
    for (const [key, list] of this.hits) if (!list.some((at) => now - at < RATE_WINDOW_MS.admin)) this.hits.delete(key);
  }
}

// ── transcript ────────────────────────────────────────────────────────

/** A stored message as a transcript entry; null for what a caller never
 * reads (reasoning, cards' internals, empty rows). Tool rows keep the tool's
 * name and outcome only, never its input or output. */
export function toEntry(threadId: string, message: StoredMessage): TranscriptEntry | null {
  if (!message || typeof message.id !== "string" || typeof message.at !== "number") return null;
  const role = message.role === "user" ? "user" : message.role === "bot" ? "agent" : null;
  if (!role) return null;
  const kind = message.kind ?? "text";
  const files = (message.attachments ?? []).map((file) => file?.name ?? file?.path?.split(/[\\/]/).at(-1) ?? "").filter(Boolean);
  const base = { cursor: encodeCursor({ at: message.at, threadId, id: message.id }), id: message.id, thread_id: threadId, role, at: message.at, from: message.sender ?? null } as const;
  if (kind === "activity") {
    const name = message.tool?.name?.trim();
    if (!name) return null;
    return { ...base, kind: "tool", text: `${name}${message.tool?.ok === false ? " (failed)" : ""}`.slice(0, 300) };
  }
  if (kind === "text" || kind === "nudge" || kind === "access") {
    const text = typeof message.text === "string" ? message.text : "";
    if (!text.trim() && !files.length) return null;
    return { ...base, kind: kind === "text" ? "text" : "note", text: text.length > ENTRY_TEXT_MAX ? `${text.slice(0, ENTRY_TEXT_MAX)}\n[...]` : text, ...(files.length ? { files } : {}) };
  }
  return null;
}

function collectEntries(deps: AgentApiDeps, threads: readonly TranscriptThread[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const thread of threads) {
    for (const message of deps.messages(thread.threadId)) {
      const entry = toEntry(thread.threadId, message);
      if (entry) out.push(entry);
    }
  }
  out.sort((a, b) => compareKeys({ at: a.at, threadId: a.thread_id, id: a.id }, { at: b.at, threadId: b.thread_id, id: b.id }));
  return out;
}

/** An agent as list_agents, find_agents and create_agent answer it. */
const wireSummary = (agent: AgentSummary) => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  status: agent.status,
  temporary: agent.temporary === true,
  owner: agent.owner ?? null,
});

const keyOf = (entry: TranscriptEntry): CursorKey => ({ at: entry.at, threadId: entry.thread_id, id: entry.id });

/** The newest `limit` entries strictly before `before` (all when null), and
 * the cursor of the next older page (null when none is left). */
function pageBefore(entries: readonly TranscriptEntry[], before: CursorKey | null, limit: number) {
  const eligible = before ? entries.filter((entry) => compareKeys(keyOf(entry), before) < 0) : entries;
  const picked = eligible.slice(Math.max(0, eligible.length - limit));
  // Newest first until the byte budget is spent; always at least one entry.
  const page: TranscriptEntry[] = [];
  let bytes = 0;
  for (let index = picked.length - 1; index >= 0; index--) {
    const entry = picked[index]!;
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (page.length && bytes + size > PAGE_MAX_BYTES) break;
    page.unshift(entry);
    bytes += size;
  }
  const more = eligible.length > page.length;
  return { entries: page, next_cursor: more && page[0] ? page[0].cursor : null };
}

// ── turns ─────────────────────────────────────────────────────────────

/** Index of the prompt that anchors a handle, or -1 when it is not in the transcript yet. */
function turnAnchorIndex(messages: readonly StoredMessage[], anchor: { id: string | null; at: number }): number {
  if (anchor.id) {
    const byId = messages.findIndex((message) => message.id === anchor.id);
    if (byId >= 0) return byId;
  }
  // A queued prompt is stored when its turn starts: the newest user line
  // at or after the handle's time is the prompt.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.at < anchor.at - 1_000) break;
    if (message.role === "user") return index;
  }
  return -1;
}

/** The agent's words after the anchor, and whether its turn has ended. */
function turnReply(messages: readonly StoredMessage[], anchor: { id: string | null; at: number }): { reply: string; sawAnchor: boolean } {
  const start = turnAnchorIndex(messages, anchor);
  if (start < 0) return { reply: "", sawAnchor: false };
  const texts: string[] = [];
  for (const message of messages.slice(start + 1)) {
    if (message.role === "user" && (message.kind ?? "text") === "text") break;
    if (message.role === "bot" && (message.kind ?? "text") === "text" && typeof message.text === "string" && message.text.trim()) texts.push(message.text.trim());
  }
  const joined = texts.join("\n\n");
  return { reply: joined.length > REPLY_MAX_CHARS ? `${joined.slice(0, REPLY_MAX_CHARS)}\n[...]` : joined, sawAnchor: true };
}

/** Visible steps of the turn after the anchor, optionally after a wait_cursor. */
function turnSteps(
  threadId: string,
  messages: readonly StoredMessage[],
  anchor: { id: string | null; at: number },
  after: CursorKey | null,
): TurnStep[] {
  const start = turnAnchorIndex(messages, anchor);
  if (start < 0) return [];
  const steps: TurnStep[] = [];
  for (const message of messages.slice(start + 1)) {
    if (message.role === "user" && (message.kind ?? "text") === "text") break;
    const entry = toEntry(threadId, message);
    if (!entry || (entry.kind !== "tool" && entry.kind !== "note" && !(entry.kind === "text" && entry.role === "agent"))) continue;
    const key = keyOf(entry);
    if (after && compareKeys(key, after) <= 0) continue;
    steps.push({ cursor: entry.cursor, kind: entry.kind, text: entry.text.slice(0, 300), at: entry.at });
  }
  return steps;
}

function progressSummary(state: TurnState, stepsTotal: number, reply: string): string {
  const live = state === "waiting" ? "waiting for approval" : state === "queued" ? "queued" : state === "running" ? "running" : "idle";
  const parts = [live];
  if (stepsTotal > 0) parts.push(`${stepsTotal} step${stepsTotal === 1 ? "" : "s"} so far`);
  if (reply.trim()) parts.push("partial reply ready");
  return parts.join("; ");
}

function buildProgress(
  threadId: string,
  messages: readonly StoredMessage[],
  anchor: { id: string | null; at: number },
  state: TurnState,
  reply: string,
  after: CursorKey | null,
): { progress: TurnProgress; wait_cursor: string | null } {
  const all = turnSteps(threadId, messages, anchor, null);
  const fresh = after ? turnSteps(threadId, messages, anchor, after) : all;
  const shown = fresh.slice(-AWAIT_STEPS_MAX);
  const last = all.at(-1);
  return {
    progress: {
      summary: progressSummary(state, all.length, reply),
      turn_state: state,
      steps: shown,
      steps_total: all.length,
    },
    wait_cursor: last?.cursor ?? (after ? encodeCursor(after) : null),
  };
}

// ── the API ───────────────────────────────────────────────────────────

export interface AgentApiAnswer {
  status: number;
  body: Record<string, unknown>;
}

export interface AgentApi {
  call(caller: AgentCaller, tool: string, rawArgs: unknown, signal?: AbortSignal): Promise<AgentApiAnswer>;
}

/** Ranks agents for a query: the name first, then the description. Zero
 * means no match. */
export function matchScore(agent: AgentSummary, query: string): number {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return 0;
  const name = agent.name.toLocaleLowerCase();
  const description = agent.description.toLocaleLowerCase();
  const words = q.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  let score = 0;
  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 40;
  if (description.includes(q)) score += 25;
  for (const word of words) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(name)) score += 15;
    else if (name.includes(word)) score += 8;
    if (description.includes(word)) score += 5;
  }
  return score;
}

/** A short label for a turn, for a person to read beside its handle:
 * the agent's name and the prompt's first words. */
export function turnLabel(agentName: string, prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim();
  const short = words.length > 60 ? `${words.slice(0, 59).replace(/\s+\S*$/, "")}...` : words;
  return `${agentName}: ${short}`;
}

export function createAgentApi(deps: AgentApiDeps): AgentApi {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const limiter = new AgentRateLimiter();
  if (deps.secret.length < 32) throw new Error("the agent API secret must be at least 32 bytes");
  /** #1170: the prompt each caller last started in a conversation. In the
   * bot's single chat the running turn may be the person's own or another
   * caller's: supersede stops only a turn this caller started. */
  const startedBy = new Map<string, { messageId: string; caller: string }>();
  const ownsRunningTurn = (caller: AgentCaller, threadId: string): boolean => {
    const mine = startedBy.get(threadId);
    if (!mine || mine.caller !== callerKey(caller)) return false;
    const lastUser = [...deps.messages(threadId)].reverse().find((message) => message.role === "user");
    return lastUser?.id === mine.messageId;
  };

  const ok = (body: Record<string, unknown>): AgentApiAnswer => ({ status: 200, body });
  // One error envelope (audit 2026-10-29, B5): {code, message, hint,
  // details} on every refusal, details.status the HTTP status; the extra
  // fields a refusal carried before stay at the top level too, and `error`
  // repeats the message for older clients.
  const asAnswer = (refusal: Refusal): AgentApiAnswer => {
    const { hint, details, ...rest } = refusal.extra ?? {};
    const retryable = typeof rest.retryable === "boolean" ? rest.retryable : isRetryableRefusal(refusal.code);
    const detailObj = details && typeof details === "object" ? details as Record<string, unknown> : {};
    return {
      status: refusal.status,
      body: {
        error: refusal.message, code: refusal.code, message: refusal.message,
        hint: typeof hint === "string" ? hint : "",
        details: { ...rest, ...detailObj, retryable, status: refusal.status },
        ...rest,
        retryable,
      },
    };
  };

  /** The agent, when the caller may reach it; one answer for "no such agent" and "not yours". */
  const reachable = async (caller: AgentCaller, agentId: string): Promise<AgentSummary | Refusal> => {
    const agent = (await deps.agents(caller)).find((candidate) => candidate.id === agentId);
    return agent ?? refuse(404, "unknown_agent", "No agent with that id is reachable. Its id must come from list_agents or find_agents.");
  };

  const unfinished = (
    body: HandleBody,
    handle: string,
    state: TurnState,
    reply: string,
    after: CursorKey | null,
    status: TurnResult["status"],
  ): TurnResult => {
    const live = state === "idle" ? "queued" : state;
    const { progress, wait_cursor } = buildProgress(body.t, deps.messages(body.t), { id: body.m, at: body.i }, live, reply, after);
    return {
      handle,
      agent_id: body.a,
      thread_id: body.t,
      finished: false,
      status,
      reply,
      progress,
      wait_cursor,
      recommended_wait_ms: AWAIT_RECOMMENDED_WAIT_MS,
    };
  };

  const waitTurn = async (
    body: HandleBody,
    handle: string,
    timeoutMs: number,
    signal?: AbortSignal,
    after: CursorKey | null = null,
  ): Promise<TurnResult> => {
    const deadline = now() + timeoutMs;
    let idleLooks = 0;
    for (;;) {
      const state = deps.turnState(body.a, body.t);
      const messages = deps.messages(body.t);
      const read = turnReply(messages, { id: body.m, at: body.i });
      if (state === "idle" && read.sawAnchor) {
        idleLooks += 1;
        if (read.reply || idleLooks >= IDLE_LOOKS_DONE) {
          return { handle, agent_id: body.a, thread_id: body.t, finished: true, status: "finished", reply: read.reply };
        }
      } else if (state === "idle") {
        // The prompt is not in the conversation yet (queued behind a slot).
        idleLooks += 1;
        if (idleLooks >= IDLE_LOOKS_DONE * 25) {
          return unfinished(body, handle, "queued", "", after, "queued");
        }
      } else {
        idleLooks = 0;
        if (state === "waiting") {
          // A card waits for a person: waiting longer only burns the timeout.
          return unfinished(body, handle, state, read.reply, after, "waiting_for_approval");
        }
      }
      // Return still_working before the caller's (or gateway) ceiling so the
      // answer is a structured resume, never a killed tool call.
      if (signal?.aborted || now() >= deadline) {
        return unfinished(body, handle, state === "idle" ? "queued" : state, read.reply, after, "still_working");
      }
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - now())));
    }
  };

  const stillWorkingNext =
    "The turn is still going (still_working). Call await_turn again with this handle and pass wait_cursor as cursor; use recommended_wait_ms as timeout_ms. Never send the prompt again.";
  const timeoutNote = stillWorkingNext;
  const resultBody = (result: TurnResult): Record<string, unknown> => ({
    ...result,
    ...(result.finished
      ? (result.reply ? {} : { note: "The turn finished without text." })
      : {
          next: result.status === "waiting_for_approval"
            ? "An approval waits in that conversation: a person answers it (in Sagax, or from an AI client with sagax_approve); then call await_turn with this handle and wait_cursor as cursor."
            : timeoutNote,
        }),
  });

  const handlers: Record<AgentToolName, (caller: AgentCaller, args: Args, signal?: AbortSignal) => Promise<AgentApiAnswer | Refusal>> = {
    async list_agents(caller, args) {
      const bad = onlyKeys(args, []);
      if (bad) return bad;
      const agents = await deps.agents(caller);
      return ok({ agents: agents.map(wireSummary) });
    },

    async find_agents(caller, args) {
      const bad = onlyKeys(args, ["query", "status", "limit"]);
      if (bad) return bad;
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query || query.length > 200) return refuse(400, "bad_request", "query is 1 to 200 characters: words of the agent's name or description.");
      if (args.status !== undefined && args.status !== null && args.status !== "running" && args.status !== "idle") {
        return refuse(400, "bad_request", "status is running or idle.");
      }
      const limit = intArg(args, "limit", 1, FIND_LIMIT_MAX, FIND_LIMIT_DEFAULT);
      if (isRefusal(limit)) return limit;
      const scored = (await deps.agents(caller))
        .filter((agent) => !args.status || agent.status === args.status)
        .map((agent) => ({ agent, score: matchScore(agent, query) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
      // Best matches only: within reach of the top score.
      const top = scored[0]?.score ?? 0;
      const best = scored.filter((hit) => hit.score >= top * 0.4).slice(0, limit);
      return ok({ agents: best.map(({ agent }) => wireSummary(agent)) });
    },

    async get_agent(caller, args) {
      const bad = onlyKeys(args, ["agent_id"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const profile = await deps.profile(caller, agentId);
      if (isRefusal(profile)) return profile;
      return ok({
        agent: { ...wireSummary(agent), title: profile.title },
        owner: profile.owner,
        profile: profile.profile,
        temporary: profile.temporary,
        profile_url: profile.profile_url,
        ...(profile.profile ? {} : { note: "You may use this agent, but only its owner, a person who can edit it or an organization admin reads its instructions." }),
      });
    },

    async delete_agent(caller, args) {
      const bad = onlyKeys(args, ["agent_id"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      if (!agent.temporary) return refuse(409, "not_temporary", `${agent.name} was not created with create_agent: only its owner deletes it, in the Sagax app.`);
      const archived = await deps.deleteAgent(caller, agentId);
      if (isRefusal(archived)) return archived;
      return ok({
        agent_id: agentId, archived: true, ...archived,
        note: "The agent is archived: it no longer answers or appears in list_agents. Its conversations are kept until purge_at, then deleted with it.",
      });
    },

    async create_agent(caller, args) {
      const bad = onlyKeys(args, ["name", "description", "idle_hours", "workspace"]);
      if (bad) return bad;
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name || name.length > AGENT_NAME_MAX || /[\r\n]/.test(name)) return refuse(400, "bad_request", `name is the display name: one line, 1 to ${AGENT_NAME_MAX} characters.`);
      if (args.description !== undefined && args.description !== null && typeof args.description !== "string") return refuse(400, "bad_request", "description is text.");
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (description.length > AGENT_DESCRIPTION_MAX) return refuse(400, "bad_request", `description is at most ${AGENT_DESCRIPTION_MAX} characters.`);
      const idleHours = intArg(args, "idle_hours", 1, IDLE_HOURS_MAX, undefined);
      if (isRefusal(idleHours)) return idleHours;
      const workspace = args.workspace === undefined || args.workspace === null ? undefined : AGENT_WORKSPACES.find((value) => value === args.workspace);
      if (args.workspace !== undefined && args.workspace !== null && !workspace) return refuse(400, "bad_request", `workspace is one of ${AGENT_WORKSPACES.join(", ")}.`);
      const existing = (await deps.agents(caller)).find((agent) => agent.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existing) return refuse(409, "agent_exists", `An agent named ${existing.name} already exists (id ${existing.id}). Use it instead of creating another${existing.temporary ? ", or delete it first with delete_agent" : ""}.`);
      const created = await deps.createAgent(caller, { name, description, ...(idleHours !== undefined ? { idleHours } : {}), ...(workspace ? { workspace } : {}) });
      if (isRefusal(created)) return created;
      return ok({
        agent: wireSummary(created),
        greeted: true,
        note: "The new agent is temporary: it is archived after its idle expiry unless a person pins it, and delete_agent archives it now. It greets the user itself. Do not send it a first prompt unless asked, and never quote its id to the user.",
      });
    },

    async send_prompt(caller, args, signal) {
      const bad = onlyKeys(args, ["agent_id", "prompt", "mode", "timeout_ms", "on_busy", "files", "priority", "thread_id"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const continued = args.thread_id === undefined || args.thread_id === null || args.thread_id === "" ? null : args.thread_id;
      if (continued !== null && (typeof continued !== "string" || !ID.test(continued))) {
        return refuse(400, "bad_request", "thread_id is a conversation id, as send_prompt or await_turn returned it.", {
          retryable: false,
          details: { reason: "invalid_thread_id" },
          hint: "Omit thread_id to use the default conversation, or pass the thread_id a previous send_prompt or await_turn returned.",
        });
      }
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (!prompt.trim() || prompt.length > PROMPT_MAX_CHARS) {
        return refuse(400, "bad_request", `prompt is 1 to ${PROMPT_MAX_CHARS} characters.`, {
          retryable: false,
          details: { reason: "invalid_prompt", max_chars: PROMPT_MAX_CHARS },
        });
      }
      const mode = (args.mode ?? "fire_and_forget") as SendMode;
      if (!["fire_and_forget", "blocking", "async"].includes(mode)) {
        return refuse(400, "bad_request", "mode is fire_and_forget, blocking or async.", {
          retryable: false,
          details: { reason: "invalid_mode", allowed: ["fire_and_forget", "blocking", "async"] },
        });
      }
      // 2026-10-17: queue by default. supersede stopped a running turn (and
      // its approval) the caller often did not know was still going.
      const onBusy = (args.on_busy ?? "queue") as OnBusy;
      if (!["supersede", "reject", "queue"].includes(onBusy)) {
        return refuse(400, "bad_request", "on_busy is queue (default), reject or supersede.", {
          retryable: false,
          details: { reason: "invalid_on_busy", allowed: ["queue", "reject", "supersede"] },
          hint: "Use on_busy queue to wait your turn, reject to refuse when busy, or supersede to stop a turn you started.",
        });
      }
      const asked = parseWakePriority(args.priority);
      if (asked === "invalid") {
        return refuse(400, "bad_request", "priority is now or normal.", {
          retryable: false,
          details: { reason: "invalid_priority", allowed: ["now", "normal"] },
        });
      }
      const timeoutMs = intArg(args, "timeout_ms", TIMEOUT_MS_MIN, TIMEOUT_MS_MAX, TIMEOUT_MS_DEFAULT);
      if (isRefusal(timeoutMs)) return timeoutMs;
      const files = args.files ?? [];
      if (!Array.isArray(files) || files.length > SEND_FILES_MAX) {
        return refuse(400, "bad_request", `files is a list of at most ${SEND_FILES_MAX} workspace-relative paths.`, {
          retryable: false,
          details: { reason: "invalid_files", max_files: SEND_FILES_MAX },
        });
      }
      const fileInputs: FileInput[] = [];
      for (const raw of files) {
        const file: FileInput | null = typeof raw === "string" ? { path: raw } : raw && typeof raw === "object" && typeof (raw as FileInput).path === "string" ? raw as FileInput : null;
        if (!file) {
          return refuse(400, "bad_request", "each file is a workspace-relative path.", {
            retryable: false,
            details: { reason: "invalid_file_entry" },
          });
        }
        const path = file.path.trim().replace(/\\/g, "/");
        if (!path || path.length > 512 || path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.split("/").some((part) => part === ".." || part === "")) {
          return refuse(400, "bad_request", `${file.path} is not a workspace-relative path (no leading /, no ..).`, {
            retryable: false,
            details: { reason: "invalid_file_path" },
          });
        }
        if (file.content_base64 !== undefined) {
          if (typeof file.content_base64 !== "string" || Math.floor(file.content_base64.length * 3 / 4) > SEND_FILE_MAX_BYTES + 3) {
            return refuse(413, "file_too_large", `${path} is larger than 25 MiB.`, {
              retryable: false,
              details: { reason: "file_too_large", max_bytes: SEND_FILE_MAX_BYTES },
            });
          }
        }
        fileInputs.push({ path, ...(file.content_base64 !== undefined ? { content_base64: file.content_base64 } : {}) });
      }
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      // The conversation the caller's sends go to (deps.conversation), unless
      // it names one of its own conversations to continue.
      let conversation: { threadId: string } | Refusal;
      if (continued !== null) {
        if (!deps.threads(caller, agentId).some((thread) => thread.threadId === continued)) {
          return refuse(404, "unknown_thread", "No conversation of yours with this agent has that id. Use the thread_id send_prompt or await_turn returned, or leave it out to start a new one.", {
            retryable: false,
            details: { reason: "unknown_thread" },
            hint: "Omit thread_id for the default conversation, or use a thread_id this caller already received.",
          });
        }
        conversation = { threadId: continued };
      } else {
        conversation = await deps.conversation(caller, agentId);
      }
      if (isRefusal(conversation)) return conversation;
      const { threadId } = conversation;
      const state = deps.turnState(agentId, threadId);
      if (state !== "idle") {
        if (onBusy === "reject") {
          const turnLabel = state === "waiting" ? "waiting for approval" : state === "queued" ? "queued" : "running";
          return refuse(409, "busy", `${agent.name} is still working in this conversation (${turnLabel}). Retry with on_busy queue (waits its turn), on_busy supersede (stops the running turn you started), or await_turn on the open handle first.`, {
            thread_id: threadId,
            retryable: true,
            details: {
              reason: "busy_thread",
              turn_state: state,
              on_busy: "reject",
              options: ["queue", "supersede", "await_turn"],
            },
            hint: "Pass on_busy: \"queue\" to wait your turn, on_busy: \"supersede\" to stop your own running turn, or call await_turn with the handle you already have. Do not re-send the same prompt as a new fire_and_forget without a decision.",
          });
        }
        // priority now never stops a turn that is already running, even when
        // the caller also asked to supersede.
        // #1170: only a turn this caller started; another's (the person's
        // own, another bot's) is never stopped: the prompt waits its turn.
        if (onBusy === "supersede" && asked !== "now" && (state === "running" || state === "waiting") && ownsRunningTurn(caller, threadId)) await deps.interrupt(agentId, threadId);
      }
      const slotFree = deps.turnState(agentId, threadId) === "idle";
      const senderId = wakeSenderId(caller);
      const plan = planPriorityWake({ asked, applies: true, slotFree, needsApproval: false, senderId, now: now() });
      const issuedAt = now();
      const wake: PriorityDelivery | undefined = plan.wakeNow
        ? { priorityNow: true }
        : plan.queueFront
          ? { front: true, priorityNow: true }
          : undefined;
      const posted = await deps.post(caller, agentId, threadId, prompt, fileInputs, wake);
      if (isRefusal(posted)) {
        if (plan.reported === "now") releasePriorityNow(senderId);
        return posted;
      }
      if (posted.messageId) startedBy.set(threadId, { messageId: posted.messageId, caller: callerKey(caller) });
      const body: HandleBody = { a: agentId, t: threadId, m: posted.messageId, i: issuedAt, c: callerKey(caller) };
      const handle = signHandle(deps.secret, body);
      const accepted = {
        handle, expires_at: handleExpiresAt(issuedAt), label: turnLabel(agent.name, prompt), agent_id: agentId, thread_id: threadId, mode, accepted: true, files: fileInputs.length,
        ...(plan.reported ? { priority: plan.reported, ...(plan.downgraded ? { downgraded: true, priority_note: plan.note } : {}) } : {}),
      };
      if (mode === "fire_and_forget") return ok({ ...accepted, finished: false, status: "accepted" });
      if (mode === "async") {
        if (deps.notify) {
          const notify = deps.notify;
          // Watch in the background; the caller is told when the turn ends.
          void waitTurn(body, handle, TIMEOUT_MS_MAX * 6).then((result) => {
            if (result.finished || result.status === "waiting_for_approval") notify(caller, agent, result);
          }).catch(() => undefined);
        }
        return ok({ ...accepted, finished: false, status: "accepted", next: "You are notified when the turn ends; or call await_turn with this handle. Never send the prompt again." });
      }
      // Cap the blocking wait under engine/gateway ceilings so the answer
      // (handle + still_working) reaches the caller; resume with await_turn.
      const waitMs = Math.min(timeoutMs as number, AWAIT_TIMEOUT_MS_MAX);
      const result = await waitTurn(body, handle, waitMs, signal);
      return ok({ ...accepted, ...resultBody(result) });
    },

    async await_turn(caller, args, signal) {
      const bad = onlyKeys(args, ["agent_id", "handle", "timeout_ms", "cursor"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      // Cap under engine/gateway ceilings (~60 s) so a long turn answers
      // still_working instead of dying as a tool timeout.
      const timeoutMs = intArg(args, "timeout_ms", AWAIT_TIMEOUT_MS_MIN, AWAIT_TIMEOUT_MS_MAX, AWAIT_TIMEOUT_MS_DEFAULT);
      if (isRefusal(timeoutMs)) return timeoutMs;
      const after = cursorArg(args);
      if (isRefusal(after)) return after;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      if (args.handle !== undefined && args.handle !== null && args.handle !== "") {
        if (typeof args.handle !== "string") return badHandleRefusal("format");
        const verified = verifyHandle(deps.secret, args.handle, now());
        // Altered or not a handle: nothing in it is trusted, nothing is read.
        if (!verified.ok && verified.reason !== "age") return badHandleRefusal(verified.reason);
        const body = verified.body;
        if (body.a !== agentId) return badHandleRefusal("other_agent");
        const reason: BadHandleReason | null = !verified.ok ? "age" : body.c !== callerKey(caller) ? "other_caller" : null;
        if (!reason) return ok({ ...resultBody(await waitTurn(body, args.handle, timeoutMs!, signal, after)), expires_at: handleExpiresAt(body.i) });
        // The handle is authentic (its signature held). A conversation of the
        // caller's own (deps.threads) is one it may read anyway with
        // read_latest_page: naming it, or answering from it, discloses nothing.
        if (!deps.threads(caller, agentId).some((thread) => thread.threadId === body.t)) return badHandleRefusal(reason);
        // Expired, or issued to another session of a caller who may read the
        // conversation: answer that turn as read_latest_page would, without a
        // handle (a new one would anchor at the wrong time).
        const result = await waitTurn(body, "", timeoutMs!, signal, after);
        return ok({
          ...resultBody(result),
          handle: null,
          recovered_from: BAD_HANDLE_CODE[reason],
          note: `${reason === "age" ? "The handle expired" : "The handle was issued to another session"}; this answer was read from thread_id ${body.t}. ${result.finished ? "" : "The turn is still going: call await_turn without a handle, or read_latest_page with this thread_id. "}Never send the prompt again.`,
        });
      }
      // No handle: the in-flight turn of the caller's newest conversation
      // with this agent, else its last message.
      const threads = deps.threads(caller, agentId);
      const entries = collectEntries(deps, threads);
      const lastUser = [...entries].reverse().find((entry) => entry.role === "user");
      const threadId = lastUser?.thread_id ?? entries.at(-1)?.thread_id ?? null;
      if (!threadId) return ok({ agent_id: agentId, finished: true, status: "idle", reply: "", note: "You have no conversation with this agent yet." });
      const body: HandleBody = { a: agentId, t: threadId, m: lastUser?.id ?? null, i: lastUser?.at ?? now(), c: callerKey(caller) };
      const handle = signHandle(deps.secret, body);
      if (deps.turnState(agentId, threadId) === "idle") {
        const last = [...entries].reverse().find((entry) => entry.thread_id === threadId && entry.role === "agent" && entry.kind === "text");
        return ok({ handle, expires_at: handleExpiresAt(body.i), agent_id: agentId, thread_id: threadId, finished: true, status: "idle", reply: last?.text ?? "" });
      }
      return ok({ ...resultBody(await waitTurn(body, handle, timeoutMs!, signal, after)), expires_at: handleExpiresAt(body.i) });
    },

    async read_transcript(caller, args) {
      const bad = onlyKeys(args, ["agent_id"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const all = collectEntries(deps, deps.threads(caller, agentId));
      const page = pageBefore(all, null, FULL_TRANSCRIPT_MAX);
      const truncated = all.length > page.entries.length;
      return ok({
        agent_id: agentId, status: agent.status, entries: page.entries, total: all.length, truncated, next_cursor: page.next_cursor,
        ...(truncated ? { next: "Older entries did not fit in one answer: read them with read_latest_page or read_transcript_cold, passing next_cursor as cursor, until next_cursor is null." } : {}),
      });
    },

    async read_transcript_page(caller, args) {
      const bad = onlyKeys(args, ["agent_id", "limit", "before_ms", "after_ms", "cursor"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const limit = intArg(args, "limit", 1, PAGE_LIMIT_MAX, undefined);
      if (isRefusal(limit)) return limit;
      if (limit === undefined) return refuse(400, "bad_request", `limit is required: 1 to ${PAGE_LIMIT_MAX}.`);
      const upper = args.before_ms;
      if (typeof upper !== "number" || !Number.isSafeInteger(upper) || upper < 0) return refuse(400, "bad_request", "before_ms is required: the inclusive upper bound, in unix milliseconds.");
      const lower = args.after_ms;
      if (lower !== undefined && lower !== null && (typeof lower !== "number" || !Number.isSafeInteger(lower) || lower < 0 || lower > upper)) {
        return refuse(400, "bad_request", "after_ms is the inclusive lower bound in unix milliseconds, at most before_ms.");
      }
      const cursor = cursorArg(args);
      if (isRefusal(cursor)) return cursor;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const all = collectEntries(deps, deps.threads(caller, agentId)).filter((entry) => entry.at <= upper && (typeof lower !== "number" || entry.at >= lower));
      const page = pageBefore(all, cursor, limit as number);
      return ok({ agent_id: agentId, entries: page.entries, next_cursor: page.next_cursor });
    },

    async read_latest_page(caller, args) {
      return latest(caller, args, false);
    },

    async read_latest_page_with_threads(caller, args) {
      return latest(caller, args, true);
    },

    async read_transcript_cold(caller, args) {
      const bad = onlyKeys(args, ["agent_id", "cursor"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const cursor = cursorArg(args);
      if (isRefusal(cursor)) return cursor;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      // Cold: the stored transcript only. No live state is read and nothing
      // of the agent is started (turnState is never called).
      const page = pageBefore(collectEntries(deps, deps.threads(caller, agentId)), cursor, COLD_PAGE_SIZE);
      return ok({ agent_id: agentId, entries: page.entries, next_cursor: page.next_cursor, cold: true });
    },
  };

  const latest = async (caller: AgentCaller, args: Args, withThreads: boolean): Promise<AgentApiAnswer | Refusal> => {
    const bad = onlyKeys(args, ["agent_id", "limit", "cursor", "thread_id"]);
    if (bad) return bad;
    const agentId = agentIdArg(args);
    if (isRefusal(agentId)) return agentId;
    const limit = intArg(args, "limit", 1, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT);
    if (isRefusal(limit)) return limit;
    const cursor = cursorArg(args);
    if (isRefusal(cursor)) return cursor;
    const wanted = args.thread_id === undefined || args.thread_id === null || args.thread_id === "" ? null : args.thread_id;
    if (wanted !== null && (typeof wanted !== "string" || !ID.test(wanted))) return refuse(400, "bad_request", "thread_id is a conversation id, as send_prompt or await_turn returned it.");
    const agent = await reachable(caller, agentId);
    if (isRefusal(agent)) return agent;
    const allThreads = deps.threads(caller, agentId);
    // One conversation only, when asked: one of the caller's own.
    const threads = wanted === null ? allThreads : allThreads.filter((thread) => thread.threadId === wanted);
    if (wanted !== null && !threads.length) return refuse(404, "unknown_thread", "No conversation of yours with this agent has that id. Use the thread_id send_prompt or await_turn returned.");
    const all = collectEntries(deps, threads);
    const page = pageBefore(all, cursor, limit!);
    const body: Record<string, unknown> = { agent_id: agentId, status: agent.status, entries: page.entries, next_cursor: page.next_cursor };
    if (withThreads) {
      body.threads = threads.map((thread) => {
        const own = all.filter((entry) => entry.thread_id === thread.threadId);
        const state = deps.turnState(agentId, thread.threadId);
        return {
          thread_id: thread.threadId,
          title: thread.title,
          hidden: thread.hidden,
          count: own.length,
          in_page: page.entries.filter((entry) => entry.thread_id === thread.threadId).length,
          last_at: own.at(-1)?.at ?? null,
          status: state === "idle" ? "idle" : "running",
        };
      });
    }
    return ok(body);
  };

  return {
    async call(caller, tool, rawArgs, signal) {
      if (!isAgentToolName(tool)) return asAnswer(refuse(404, "unknown_tool", `Unknown tool ${tool}.`));
      const args = objectArgs(rawArgs);
      const agentId = args && typeof args.agent_id === "string" ? args.agent_id : null;
      const policy = AGENT_TOOL_POLICY[tool];
      const guardMode = deps.guard ? deps.guardMode ?? "shadow" : "off";
      const guardPolicy = agentToolGuardPolicy(policy, tool);
      let guarded: GuardDecision | null = null;
      const finish = (answer: AgentApiAnswer, detail?: Record<string, unknown>): AgentApiAnswer => {
        const outcome = answer.status < 400 ? "ok" : answer.status >= 500 ? "error" : "refused";
        deps.audit(caller, {
          tool,
          agentId,
          outcome,
          ...(outcome !== "ok" && typeof answer.body.code === "string" ? { code: answer.body.code } : {}),
          detail: {
            access: policy.access, readOnly: policy.readOnly, scope: guardPolicy.scope,
            ...(guarded ? { guard: guarded.reason, guardAllow: guarded.allow, guardMode } : {}),
            ...detail,
          },
        });
        return answer;
      };
      if (!args) return finish(asAnswer(refuse(400, "bad_request", "Arguments are a JSON object.")));
      if (!caller.scopes.has(policy.scope)) {
        return finish(asAnswer(refuse(403, "forbidden_scope", `This caller does not hold the ${policy.scope} scope that ${tool} needs.`, { scope: policy.scope })));
      }
      if (guardMode !== "off") {
        const ownerPrincipalId = guardPolicy.ownerScoped && agentId ? deps.agentOwner?.(agentId) ?? null : null;
        guarded = deps.guard!(caller, guardPolicy, ownerPrincipalId ? { ownerPrincipalId } : undefined);
        if (!guarded.allow && guardMode === "enforce") {
          return finish(asAnswer(refuse(403, "not_granted", `${tool} needs a ${guardPolicy.scope} grant${guarded.reason === "speaker_not_granted" ? " for the person this turn speaks for" : ""}; ask the owner in Settings.`, { scope: guardPolicy.scope })));
        }
      }
      const wait = limiter.admit(caller, tool, now());
      if (wait !== null) {
        return finish(asAnswer(refuse(429, "rate_limited", `Too many ${tool} calls; try again in ${Math.ceil(wait / 1000)} s.`, {
          retry_after_ms: wait,
          retryable: true,
          hint: `Wait ${Math.ceil(wait / 1000)} s, then call ${tool} again with the same arguments.`,
        })));
      }
      try {
        const answer = await handlers[tool](caller, args, signal);
        const shaped = isRefusal(answer) ? asAnswer(answer) : answer;
        const detail: Record<string, unknown> = {};
        if (tool === "send_prompt") {
          detail.mode = args.mode ?? "fire_and_forget";
          detail.onBusy = args.on_busy ?? "queue";
          detail.files = Array.isArray(args.files) ? args.files.length : 0;
          if (typeof shaped.body.thread_id === "string") detail.threadId = shaped.body.thread_id;
          if (typeof args.priority === "string") detail.priority = args.priority;
        }
        if (tool === "create_agent" && shaped.status < 400) {
          detail.created = (shaped.body.agent as { id?: string } | undefined)?.id ?? null;
          detail.temporary = true;
          if (typeof args.idle_hours === "number") detail.idleHours = args.idle_hours;
          if (typeof args.workspace === "string") detail.workspace = args.workspace;
        }
        if (tool === "delete_agent" && shaped.status < 400) {
          detail.archived = true;
          detail.purgeAt = shaped.body.purge_at ?? null;
        }
        return finish(shaped, detail);
      } catch (error) {
        console.error(`[agent-api] ${tool}: ${error instanceof Error ? error.message : String(error)}`);
        return finish(asAnswer(refuse(500, "server_error", "The server could not do this; its log has the details.")));
      }
    },
  };
}
