// The organization member API (Perspicax master plan 2026-10-09, lot C.1):
// what a person may do with their own bots from an AI client attached to
// Perspicax (Claude Code, claude.ai, Cursor), under their own identity.
//
//   GET  /api/org/member/capabilities          the version and the routes
//   GET  /api/org/member/bots                  the bots the person can see
//   POST /api/org/member/bots/{id}/messages    send, optionally wait (120 s)
//   GET  /api/org/member/threads/{id}          messages since a cursor
//   GET  /api/org/member/routines              the person's own routines
//   GET  /api/org/member/routines/{id}         one routine, full instructions
//   PATCH /api/org/member/routines/{id}        enable/disable, rename, schedule, instructions
//   POST /api/org/member/routines/{id}/run     run a routine now
//   GET  /api/org/member/routines/runs/{id}    one run
//   GET  /api/org/member/bots/{id}/rules       the owner's rules
//   GET  /api/org/member/bots/{id}/docs        the owner's documents
//   GET  /api/org/member/bots/{id}/memory      the owner's memory
//   GET  /api/org/member/bots/{id}/connectors  connector names of an owned bot
//   GET  /api/org/member/approvals?status=pending  the cards waiting on the person
//   GET  /api/org/member/approvals/{id}        may the person answer it
//   POST /api/org/member/approvals/{id}        allow, deny or pick an option
//   POST /api/org/member/people/{id}/nudge     nudge a person
//   GET  /api/org/member/threads/{id}/stream   watch a running turn (NDJSON)
//   POST /api/org/member/agents/{tool}          the agent-to-agent API
//                                               (server/agent-api.ts, docs/agent-api.md)
//
// Lot C.3 (the subagent experience): `POST bots/{id}/messages` with
// `stream: true`, and `GET threads/{id}/stream`, answer NDJSON: progress at
// most every MEMBER_PROGRESS_MIN_MS (status, steps, the words being
// written), one `approval` event when a card waits (the stream then ends, so
// the client asks its person and answers through `POST approvals/{id}`),
// and a `final` event with the structured summary of the turn (reply, tool
// calls, files, cost, approvals and who answered them, the thread link).
//
// Answered before the session gate and before loopback trust, like the admin
// API (server/org-admin-routes.ts): the only credential is an assertion
// Perspicax signs per request for the acting person (typ
// `pulsabot-console+jwt`, `act.sub` `perspicax-mcp` or `console`, at most
// 120 s, single use). The person must be known here, active in the
// directory and not turned off in Sagax.
//
// Each route then checks its `clients.*` permission (shared/permissions.ts)
// and performs the matching Sagax route AS that person, through a 60 s
// session of theirs (SessionRegistry.actAs): every rule the person meets in
// Sagax (visibility, private threads, who may answer a card, Run now) holds
// here unchanged, and a refusal from that route passes through. Every write
// leaves one admin activity row, category `client`, actor the person,
// `via: "perspicax-mcp"`. No row carries message text. Reads are not
// audited. A routine or a bot file is answered only when the catalogue
// says the person owns it; anyone else's is 404, an admin's included.
import type { IncomingMessage, ServerResponse } from "node:http";

import { formatQuestionAnswers, MAX_CUSTOM_ANSWER, MAX_OPTIONS, parseAskQuestions, parseChoices, type AskQuestion } from "../shared/ask-question.ts";
import { meetingRequestBehavior } from "../shared/meeting-request.ts";
import { can, permissionLabel, type PermissionKey, type PermissionPrincipal } from "../shared/permissions.ts";
import { mask, redactSecretsInText } from "../shared/redact.ts";
import { skillRequestBehavior } from "../shared/skill-request.ts";
import { terminalRequestBehavior } from "../shared/terminal-request.ts";
import { parseMemoryPath } from "./memory-store.ts";
import type { ConsoleAssertion } from "./oidc-rp.ts";
import { AssertionReplayCache } from "./org-admin-routes.ts";
import { compileRoutes, matchRoutes } from "./org-admin-console.ts";

export const ORG_MEMBER_PREFIX = "/api/org/member/";
/** The `act.sub` values the member API accepts: never `perspicax-mail` nor
 * `perspicax-voice` (those actors are the inbound mail route's and the
 * inbound telephony route's alone, server/bot-inbound-mail.ts and
 * server/bot-inbound-telephony.ts). */
export const ORG_MEMBER_ASSERTION_ACTORS: readonly ConsoleAssertion["actor"][] = ["console", "perspicax-mcp"];
/** The version `GET capabilities` reports. */
export const ORG_MEMBER_API_VERSION = 1;
export const MEMBER_WAIT_MAX_SECONDS = 120;
export const MEMBER_TEXT_MAX = 32_000;
export const MEMBER_THREAD_LIMIT_MAX = 200;
export const MEMBER_THREAD_LIMIT_DEFAULT = 50;
/** How often a wait looks at the thread. */
export const MEMBER_WAIT_POLL_MS = 400;
/** The longest reply text answered at once; the thread read has the rest. */
export const MEMBER_REPLY_MAX = 32_000;
/** The shortest gap between two progress events of a streamed turn. */
export const MEMBER_PROGRESS_MIN_MS = 2_000;
/** A progress event is sent at least this often, even when nothing moved. */
export const MEMBER_HEARTBEAT_MS = 10_000;
/** The most of the words being written a progress event carries. */
export const MEMBER_PARTIAL_MAX = 600;
/** The most tool calls and files a turn summary lists. */
export const MEMBER_SUMMARY_LIST_MAX = 50;
const MAX_BODY_BYTES = 64 * 1024;
/** send_prompt carries files (base64): up to 8 of 25 MiB each is checked by
 * the tool; one request is capped here. */
const AGENT_SEND_BODY_BYTES = 64 * 1024 * 1024;
const MAX_TOKEN_CHARS = 8_192;
const SEND_ID = /^[A-Za-z0-9_-]{8,80}$/;
const THREAD_ID = /^[\w-]{1,160}$/;

/** The acting person, once the assertion verified. */
export interface MemberPerson {
  principalId: string;
  /** The Perspicax user id. */
  sub: string;
  name: string;
  /** An organization admin (Perspicax role admin). */
  admin: boolean;
  /** The assertion's actor, for the audit row. */
  actor: ConsoleAssertion["actor"];
  /** The AI client or connection that made the call (the signed
   * `client_name`), when Perspicax sent one: it names the outside agent's
   * conversation with a bot (shared/agent-conversation.ts). */
  client?: string;
}

/** One Sagax route performed as the person. */
export interface MemberRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface MemberReply {
  status: number;
  body: unknown;
}

export type ThreadStatus = "idle" | "working" | "waiting";

export interface OrgMemberRouteDeps {
  identity: "solo" | "perspicax";
  issuer: string;
  publicOrigin(): string | null;
  linkServerId(): string | null;
  /** Throws on any failure; accepts the `console` and `perspicax-mcp` actors. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  /** The person behind (issuer, sub): known, else null; `active` false when
   * Perspicax lists them out or Sagax turned them off. */
  personFor(iss: string, sub: string): { principalId: string; name: string; active: boolean; admin: boolean } | null;
  /** What the person holds (server/org-permissions.ts). */
  permissions(principalId: string): PermissionPrincipal;
  /** Perform one Sagax route as this person (a 60 s session of theirs). */
  perform(person: MemberPerson, request: MemberRequest): Promise<MemberReply>;
  /** The live state of a thread the person already reached through
   * `perform`: busy, waiting on a card, or idle. Null when gone. */
  threadStatus(threadId: string): ThreadStatus | null;
  /** A principal id from a principal id or a Perspicax user id. */
  resolvePerson(ref: string): string | null;
  /** The words the bot is writing in this thread right now, or null
   * (server/member-live-text.ts). */
  liveText?(threadId: string): string | null;
  /** The link that opens the thread in Sagax, or null. */
  threadLink?(threadId: string, botId: string | null): string | null;
  /** A card the person answered through this API: mark its recorded
   * answerer `via: "ai-client"` (the name is the person's). */
  noteAnsweredVia?(person: MemberPerson, threadId: string, requestId: string): void;
  /** Who may answer a card (lot C.3): null when the thread has no such
   * card. */
  approvalAnswerer?(threadId: string, requestId: string): ApprovalAnswerer | null;
  /** The bot whose thread this is, or null (a room, or gone). */
  botOfThread?(threadId: string): string | null;
  /** A confidential thread (server/confidential-threads.ts): an AI client
   * never reads, streams, writes or answers a card in one; it reads as
   * missing. */
  confidential?(threadId: string): boolean;
  /** The person's single chat with this bot (#1170); null when they have
   * none yet. */
  hiddenThreadOf?(botId: string, principalId: string): string | null;
  /** 2026-10-29: the outside agent's conversation with this bot
   * (shared/agent-conversation.ts), where an AI client's message lands when
   * it names no thread: reused, or opened for this person and client
   * (`fresh`: a new one). Null when it cannot be opened. */
  agentConversation?(botId: string, person: MemberPerson, fresh: boolean): string | null;
  /** The outside agents' conversations of this person with this bot. */
  agentConversationsOf?(botId: string, principalId: string): string[];
  /** #291: stamp a line an AI client sent, so the chat folds it with the
   * bot's answer instead of showing it as the person typing. */
  markAiClientLine?(threadId: string, messageId: string): void;
  /** MEMORY.md of a bot the caller already owns. Null when it cannot be
   * read. The admin memory route is not used: it has no owner check. */
  readBotMemory?(botId: string): { text: string } | null;
  /** One admin activity row, category `client`, actor the person. */
  record(person: MemberPerson, entry: { action: string; target: { kind: string; id?: string; name?: string }; after?: Record<string, unknown> }): void;
  /** The agent-to-agent API (server/agent-api.ts) for this person: the
   * tool checks its scope (from the person's clients.* keys), its rate and
   * audits every call itself. */
  agentApi?(person: MemberPerson, tool: string, args: unknown, signal?: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }>;
  version?(): string;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

interface Answer {
  status: number;
  body: unknown;
}

/** A card and who may answer it, as Sagax records it. */
export interface ApprovalAnswerer {
  found: boolean;
  /** Not answered, dismissed or expired. */
  open: boolean;
  /** The owner of the bot that raised it, or null (no live bot). */
  ownerPrincipalId: string | null;
  ownerName: string | null;
  /** A server command of a member's bot: an organization admin's. */
  adminOnly: boolean;
}

/** Who can approve a card, for a client that cannot. */
export interface WhoCanApprove {
  kind: "owner" | "admin";
  principalId: string | null;
  name: string | null;
  sentence: string;
}

/** One event of a streamed answer (one NDJSON line). */
export type StreamEvent = Record<string, unknown> & { event: string };

/** A streamed answer: `run` writes events and returns the final body. */
interface StreamAnswer {
  stream: (emit: (event: StreamEvent) => void, closed: () => boolean) => Promise<Record<string, unknown>>;
}

interface MemberContext {
  person: MemberPerson;
  params: Record<string, string>;
  url: URL;
  body: unknown;
  /** Aborted when the client goes away. */
  signal?: AbortSignal;
}

interface MemberRoute {
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** The permission the route needs; none for capabilities. */
  permission?: PermissionKey;
  handle(ctx: MemberContext): Promise<Answer | StreamAnswer>;
}

/** Caps for a member routine PATCH (match Sagax / agents catalog). */
const MEMBER_ROUTINE_NAME_MAX = 80;
const MEMBER_ROUTINE_INSTRUCTIONS_MAX = 20_000;
const MEMBER_ROUTINE_PATCH_FIELDS = ["enabled", "name", "instructions", "schedule"] as const;

const answer = (body: unknown, status = 200): Answer => ({ status, body });

/** A refusal: `{code, message, reason, error}` like the admin API. */
function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Answer {
  return { status, body: { code, message, reason: message, error: message, ...extra } };
}

/** A Sagax route's refusal, passed through: its status, its code when it
 * has one, its sentence and its permission when it names one. */
function passThrough(reply: MemberReply, fallback: string): Answer {
  const body = reply.body && typeof reply.body === "object" && !Array.isArray(reply.body) ? reply.body as Record<string, unknown> : {};
  const message = typeof body.message === "string" && body.message ? body.message : typeof body.error === "string" && body.error ? body.error : fallback;
  const permission = typeof body.permission === "string" ? body.permission : undefined;
  // A start refused because a run is under way names that run (2026-11-01).
  const runId = typeof body.runId === "string" ? body.runId : undefined;
  const code = permission ? "forbidden_permission" : typeof body.code === "string" ? body.code : reply.status === 404 ? "not_found" : reply.status === 403 ? "forbidden" : reply.status === 409 ? "conflict" : reply.status >= 500 ? "server_error" : "refused";
  const status = reply.status >= 400 && reply.status < 600 ? reply.status : 502;
  return fail(status, code, message.slice(0, 500), { ...(permission ? { permission } : {}), ...(runId ? { runId } : {}) });
}

const okStatus = (reply: MemberReply) => reply.status >= 200 && reply.status < 300;

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Names that must never leave this API, whatever their value looks like. */
const SECRET_FIELD = /^(?:secret|signingsecret|webhookkey|pendingtoken|secrethash|token|password|credentials|authorization|apikey|accesstoken|refreshtoken|clientsecret)$/;
const WEBHOOK_KEY = /\bwhsec_[A-Za-z0-9_-]+/g;

function scrubText(value: string): string {
  return redactSecretsInText(value).replace(WEBHOOK_KEY, (match) => mask(match));
}

/** Drop secret-shaped fields and mask secret-shaped text. Depth and width
 * are capped so a hostile listing cannot grow the answer without bound. */
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => scrubValue(item, depth + 1));
  const obj = objectOf(value);
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj).slice(0, 40)) {
    if (SECRET_FIELD.test(key.toLowerCase().replace(/[_-]/g, ""))) continue;
    out[key] = scrubValue(child, depth + 1);
  }
  return out;
}

/** A document path (`docs/<name>.md`) or null. Anything else, including a
 * traversal, is refused before a file is opened. */
function docPath(path: string): string | null {
  try {
    const ref = parseMemoryPath(path);
    return ref.kind === "doc" ? ref.path : null;
  } catch {
    return null;
  }
}

function lastRunOf(runs: readonly Record<string, unknown>[], routineId: string) {
  const mine = runs.filter((run) => run.routineId === routineId);
  // A run that has not started yet (queued) is the newest too (2026-11-01).
  const at = (run: Record<string, unknown>) => typeof run.startedAt === "number" ? run.startedAt : typeof run.createdAt === "number" ? run.createdAt : 0;
  mine.sort((a, b) => at(b) - at(a));
  const run = mine[0];
  if (!run || typeof run.id !== "string") return null;
  return {
    id: run.id,
    status: str(run.status),
    startedAt: typeof run.startedAt === "number" ? run.startedAt : null,
    endedAt: typeof run.finishedAt === "number" ? run.finishedAt : typeof run.endedAt === "number" ? run.endedAt : null,
    ...(typeof run.problems === "string" && run.problems ? { problems: scrubText(run.problems).slice(0, 1_000) } : {}),
  };
}

/** The list shape. `detail` adds the full instructions; the list never does. */
function projectRoutine(row: Record<string, unknown>, runs: readonly Record<string, unknown>[], detail: boolean) {
  const suspended = objectOf(row.suspended);
  return {
    id: str(row.id),
    name: scrubText(str(row.name) ?? ""),
    botId: str(row.botId),
    enabled: row.enabled === true,
    suspended: suspended
      ? { reason: scrubText(str(suspended.reason) ?? ""), at: typeof suspended.at === "number" ? suspended.at : null }
      : false,
    schedule: scrubValue(row.schedule),
    nextRunAt: typeof row.nextRunAt === "number" ? row.nextRunAt : null,
    lastRun: lastRunOf(runs, str(row.id) ?? ""),
    ...(detail ? { instructions: scrubText(typeof row.prompt === "string" ? row.prompt : "") } : {}),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "x-sagax-member-api": "1", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readSmallJson(req: IncomingMessage, max = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > max) {
        over = true;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (over) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

/** One message as an AI client reads it: text messages only, never a tool's
 * input or output. */
export interface MemberMessage {
  id: string;
  role: "user" | "bot";
  kind: string;
  text: string;
  at: number | null;
  sender: { name: string } | null;
}

/** How a card is answered (2026-10-17, the AI-client approval loop):
 * `permission` and `request` cards take a decision (allow or deny);
 * `question` cards (ask_user, AskUserQuestion) take one of their options,
 * or words of the person's own when `freeText`. */
export type ApprovalKind = "permission" | "question" | "request";

/** One option of a card: `id` is its position from 1, `label` its words. */
export interface ApprovalChoice {
  id: string;
  label: string;
}

/** A question of a card that asks several at once. */
export interface ApprovalQuestion {
  question: string;
  multiSelect: boolean;
  options: ApprovalChoice[];
}

export interface MemberApproval {
  id: string;
  threadId: string;
  title: string;
  subtitle: string;
  tool: string | null;
  /** The card's option labels (older clients read these). */
  options: string[];
  kind: ApprovalKind;
  /** decision: send allow or deny; option: send one of `choices`. */
  answerWith: "decision" | "option";
  /** The options to choose from, with their ids; empty for a decision. */
  choices: ApprovalChoice[];
  /** A card with several questions: one option per question. */
  questions?: ApprovalQuestion[];
  /** Words of the person's own are accepted (`text`). */
  freeText: boolean;
  createdAt: number | null;
  expiresAt: number | null;
}

/** The sentence a question gets when the person declines it: an answer (a
 * question takes no deny), which closes the card and tells the bot. */
export const QUESTION_DECLINED_MESSAGE = "The person declined to answer this question from their AI client. Do not go ahead with what it asked; continue without it, or say what you need.";

/** How long an answer waits for its card to close before it says so. */
export const APPROVAL_CLOSE_WAIT_MS = 3_000;
const APPROVAL_CLOSE_POLL_MS = 100;
/** The most threads one pending list reads. */
export const PENDING_THREADS_MAX = 50;

const YES_LABELS = new Set(["yes", "yeah", "yep", "yup", "oui", "ouais", "allow", "ok", "okay", "oké", "oke", "confirm", "confirmer", "approve", "approuver", "continue", "continuer", "go", "proceed", "accept", "accepter", "vas-y", "vas y", "allez-y", "allez y"]);
const NO_LABELS = new Set(["no", "non", "deny", "refuser", "cancel", "annuler", "stop", "decline", "reject", "rejeter"]);
const normalLabel = (label: string) => label.trim().toLocaleLowerCase().replace(/[.!?]+$/, "");

/** How a card is answered: the card decides, never its labels (src/lib/card-answer.ts). */
export function approvalKind(card: Record<string, unknown>): ApprovalKind {
  if (card.requestType === "question" || objectOf(card.questionRequest)) return "question";
  if (card.requestType === "permission" || typeof card.tool === "string") return "permission";
  return "request";
}

const choicesOf = (labels: readonly string[]): ApprovalChoice[] => labels.map((label, index) => ({ id: String(index + 1), label }));

/** The questions of a card that carries a structured set (AskUserQuestion). */
function cardQuestions(card: Record<string, unknown>): AskQuestion[] | null {
  const request = objectOf(card.questionRequest);
  return request ? parseAskQuestions({ questions: request.questions }) : null;
}

/** A card as an AI client reads it. Not shared/approval-describe's tool-card
 * wording: this builds the MemberApproval shape for the member API. */
export function describeMemberApproval(threadId: string, message: Record<string, unknown>, card: Record<string, unknown>): MemberApproval {
  const kind = approvalKind(card);
  const labels = parseChoices(card.options, MAX_OPTIONS) ?? [];
  const questions = kind === "question" ? cardQuestions(card) : null;
  const several = questions && questions.length > 1 ? questions : null;
  const single = questions && questions.length === 1 ? questions[0]! : null;
  const choices = kind === "permission" ? [] : several ? [] : choicesOf(single ? single.options.map((o) => o.label) : labels);
  return {
    id: str(card.requestId) ?? "",
    threadId,
    title: str(card.title) ?? "",
    subtitle: str(card.subtitle) ?? "",
    tool: str(card.tool),
    options: labels,
    kind,
    answerWith: kind === "question" ? "option" : "decision",
    choices,
    ...(several ? { questions: several.map((q) => ({ question: q.question, multiSelect: q.multiSelect === true, options: choicesOf(q.options.map((o) => o.label)) })) } : {}),
    freeText: kind === "question" && (questions ? questions.every((q) => q.custom !== false) : true),
    createdAt: typeof message.at === "number" ? message.at : null,
    expiresAt: typeof card.expiresAt === "number" ? card.expiresAt : null,
  };
}

/** What `POST approvals/{id}` asks Sagax's respond route, or why it cannot. */
export type AnswerPlan =
  | { ok: true; body: { behavior: "allow" | "deny" | "answer"; message?: string }; decision: "allow" | "deny"; picked: string | null; via: "decision" | "option" | "text" }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

export interface AnswerInput {
  decision?: "allow" | "deny";
  option?: string | string[];
  text?: string;
}

const optionList = (choices: readonly ApprovalChoice[]) => choices.map((c) => `${c.id}. ${c.label}`).join("; ");

/** One option by its id or its exact label (case and a trailing point aside). */
function matchChoice(choices: readonly ApprovalChoice[], wanted: string): ApprovalChoice | null {
  const exact = choices.find((c) => c.label === wanted);
  if (exact) return exact;
  const loose = choices.find((c) => normalLabel(c.label) === normalLabel(wanted));
  return loose ?? choices.find((c) => c.id === wanted.trim()) ?? null;
}

/** The yes of a yes/no pair, or the only option: what a bare allow means. */
function impliedChoice(choices: readonly ApprovalChoice[]): ApprovalChoice | null {
  if (choices.length === 1) return choices[0]!;
  if (choices.length !== 2) return null;
  const [a, b] = choices as [ApprovalChoice, ApprovalChoice];
  if (YES_LABELS.has(normalLabel(a.label)) && NO_LABELS.has(normalLabel(b.label))) return a;
  if (YES_LABELS.has(normalLabel(b.label)) && NO_LABELS.has(normalLabel(a.label))) return b;
  return null;
}

/** The no of a yes/no pair, when a bare deny should pick it. */
function declineChoice(choices: readonly ApprovalChoice[]): ApprovalChoice | null {
  if (choices.length !== 2) return null;
  const yes = impliedChoice(choices);
  return yes ? choices.find((c) => c !== yes) ?? null : null;
}

/** Plans the answer of one card from what the client sent. */
export function planAnswer(approval: MemberApproval, card: Record<string, unknown>, input: AnswerInput): AnswerPlan {
  const needOption = (code: string, message: string): AnswerPlan => ({
    ok: false, status: 409, code, message,
    extra: { options: approval.choices, ...(approval.questions ? { questions: approval.questions } : {}), freeText: approval.freeText },
  });
  const options = Array.isArray(input.option) ? input.option : input.option !== undefined ? [input.option] : [];
  if (approval.kind === "permission") {
    let decision = input.decision;
    if (options.length) {
      if (options.length > 1) return { ok: false, status: 400, code: "bad_request", message: "A permission takes one option: allow or deny." };
      const word = normalLabel(options[0]!);
      const label = approval.options.find((o) => normalLabel(o) === word) ?? null;
      const picked: "allow" | "deny" | null = word === "allow" || word === "deny" ? word : label ? (normalLabel(label) === "deny" ? "deny" : "allow") : null;
      if (!picked) return needOption("option_unknown", `This approval is answered allow or deny${approval.options.length ? ` (its buttons: ${approval.options.join(", ")})` : ""}.`);
      if (decision && decision !== picked) return { ok: false, status: 400, code: "bad_request", message: "decision and option disagree." };
      decision = picked;
    }
    if (!decision) return { ok: false, status: 400, code: "decision_required", message: "Send decision allow or deny." };
    return { ok: true, decision, picked: null, via: options.length ? "option" : "decision",
      body: decision === "deny" && input.text ? { behavior: "deny", message: input.text } : { behavior: decision } };
  }
  if (approval.kind === "request") {
    let decision = input.decision;
    if (options.length && !decision) {
      const choice = options.length === 1 ? matchChoice(approval.choices, options[0]!) : null;
      if (!choice) return needOption("option_unknown", `No such option. This card's options: ${optionList(approval.choices) || "none"}; or send decision allow or deny.`);
      const label = choice.label;
      decision = card.skillRequest ? skillRequestBehavior(label)
        : card.terminalRequest ? terminalRequestBehavior(label)
          : card.meetingRequest ? meetingRequestBehavior(label)
            : approval.choices.length === 2 ? (choice === approval.choices[0] ? "allow" : "deny")
              : undefined;
      if (!decision) return { ok: false, status: 409, code: "decision_required", message: "This card is answered with decision allow or deny." };
    }
    if (!decision) return { ok: false, status: 400, code: "decision_required", message: "Send decision allow or deny." };
    return { ok: true, decision, picked: null, via: options.length ? "option" : "decision", body: { behavior: decision } };
  }
  // A question: an answer, never allow or deny (the broker refuses those
  // and the card would stay open; server/drivers/claude.ts).
  const questions = cardQuestions(card);
  const several = questions && questions.length > 1 ? questions : null;
  const single = questions && questions.length === 1 ? questions : null;
  const words = (labels: string[]): string => {
    if (several) return formatQuestionAnswers(several, labels.map((label) => [label]));
    if (single) return formatQuestionAnswers(single, [labels]);
    return labels.join(", ");
  };
  if (input.text !== undefined) {
    if (options.length) return { ok: false, status: 400, code: "bad_request", message: "Send option or text, not both." };
    if (!approval.freeText) return needOption("free_text_refused", `This question takes one of its options only: ${optionList(approval.choices)}.`);
    const text = input.text.trim();
    return { ok: true, decision: input.decision ?? "allow", picked: null, via: "text", body: { behavior: "answer", message: several ? text : words([text]) } };
  }
  if (several) {
    if (!options.length) {
      if (input.decision === "deny") return { ok: true, decision: "deny", picked: null, via: "decision", body: { behavior: "answer", message: QUESTION_DECLINED_MESSAGE } };
      return needOption("option_required", `This card asks ${several.length} questions: send option as a list, one option per question, in order.`);
    }
    if (options.length !== several.length) return needOption("option_required", `Send ${several.length} options, one per question, in order.`);
    const labels: string[] = [];
    for (const [index, question] of several.entries()) {
      const choice = matchChoice(choicesOf(question.options.map((o) => o.label)), options[index]!);
      if (!choice) return needOption("option_unknown", `No such option for question ${index + 1} (${question.question.slice(0, 120)}).`);
      labels.push(choice.label);
    }
    return { ok: true, decision: "allow", picked: labels.join(" | "), via: "option", body: { behavior: "answer", message: words(labels) } };
  }
  if (!options.length) {
    if (input.decision === "deny") {
      const no = declineChoice(approval.choices);
      if (no) return { ok: true, decision: "deny", picked: no.label, via: "decision", body: { behavior: "answer", message: words([no.label]) } };
      return { ok: true, decision: "deny", picked: null, via: "decision", body: { behavior: "answer", message: QUESTION_DECLINED_MESSAGE } };
    }
    const implied = impliedChoice(approval.choices);
    if (!implied) {
      return needOption("option_required", approval.choices.length
        ? `This approval has options: choose one of ${optionList(approval.choices)} (send option with its id or its label).`
        : "This question has no options: send text with the answer.");
    }
    return { ok: true, decision: "allow", picked: implied.label, via: "decision", body: { behavior: "answer", message: words([implied.label]) } };
  }
  const multi = single?.[0]?.multiSelect === true;
  if (options.length > 1 && !multi) return needOption("option_required", "This question takes one option.");
  const labels: string[] = [];
  for (const wanted of options) {
    const choice = matchChoice(approval.choices, wanted);
    if (!choice) return needOption("option_unknown", `No such option: ${wanted.slice(0, 120)}. Choose one of ${optionList(approval.choices)}.`);
    labels.push(choice.label);
  }
  return { ok: true, decision: "allow", picked: labels.join(", "), via: "option", body: { behavior: "answer", message: words(labels) } };
}

/** Where a card stands, in one word. */
export type ApprovalState = "pending" | "allowed" | "denied" | "answered" | "dismissed" | "expired" | "unavailable";

export function approvalState(card: Record<string, unknown> | null, declined = false): ApprovalState {
  if (!card) return "answered";
  const answered = str(card.answered);
  if (card.expired === true) return "expired";
  if (answered === "allow") return "allowed";
  if (answered === "deny") return "denied";
  if (answered === "unavailable") return "unavailable";
  if (answered) return declined ? "denied" : "answered";
  if (card.dismissed === true) return "dismissed";
  return "pending";
}

interface ThreadRead {
  messages: MemberMessage[];
  steps: { count: number; recent: Array<{ tool: string; ok: boolean | null }> };
  approvals: MemberApproval[];
  cursor: string | null;
  /** The cursor was not in the page read: older messages may be missing. */
  gap: boolean;
}

/** Reads a Sagax message page (as the person saw it) after a cursor. */
export function readThreadPage(threadId: string, raw: unknown, since: string | null): ThreadRead {
  const list = Array.isArray(objectOf(raw)?.messages) ? (objectOf(raw)!.messages as unknown[]) : [];
  const all = list.map(objectOf).filter((m): m is Record<string, unknown> => Boolean(m) && typeof m!.id === "string");
  const index = since ? all.findIndex((m) => m.id === since) : -1;
  const after = since && index >= 0 ? all.slice(index + 1) : all;
  const messages: MemberMessage[] = [];
  const recent: Array<{ tool: string; ok: boolean | null }> = [];
  let count = 0;
  for (const m of after) {
    const kind = str(m.kind) ?? "text";
    if (kind === "activity") {
      count += 1;
      const tool = objectOf(m.tool);
      recent.push({ tool: str(tool?.name) ?? "tool", ok: typeof tool?.ok === "boolean" ? tool.ok : null });
      continue;
    }
    const text = str(m.text);
    if ((kind === "text" || kind === "nudge" || kind === "access") && text !== null && (m.role === "user" || m.role === "bot")) {
      const sender = objectOf(m.sender);
      messages.push({ id: m.id as string, role: m.role, kind, text, at: typeof m.at === "number" ? m.at : null, sender: str(sender?.name) ? { name: sender!.name as string } : null });
    }
  }
  // Pending cards are read from the whole page: a card raised before the
  // cursor may still wait.
  const approvals: MemberApproval[] = [];
  for (const m of all) {
    const card = objectOf(m.card);
    const requestId = str(card?.requestId);
    if (!card || !requestId || card.answered !== undefined || card.dismissed === true || card.expired === true) continue;
    approvals.push(describeMemberApproval(threadId, m, card));
  }
  const last = all.at(-1);
  return {
    messages,
    steps: { count, recent: recent.slice(-10) },
    approvals,
    cursor: typeof last?.id === "string" ? last.id : since,
    gap: Boolean(since) && index < 0,
  };
}

/** The bot's words after the person's message: every bot text that follows
 * it, joined, at most MEMBER_REPLY_MAX characters. */
export function replyAfter(messages: readonly MemberMessage[], userMessageId: string | null): string | null {
  const start = userMessageId ? messages.findIndex((m) => m.id === userMessageId) : -1;
  const after = start >= 0 ? messages.slice(start + 1) : userMessageId ? [] : messages;
  const texts = after.filter((m) => m.role === "bot" && m.kind === "text" && m.text.trim()).map((m) => m.text.trim());
  if (!texts.length) return null;
  const joined = texts.join("\n\n");
  return joined.length > MEMBER_REPLY_MAX ? `${joined.slice(0, MEMBER_REPLY_MAX)}\n[...]` : joined;
}

/** One approval of a turn, as the summary reports it. */
export interface SummaryApproval {
  id: string;
  tool: string | null;
  title: string;
  /** allow or deny; `answered` for another answer (a question), else
   * `pending`, `dismissed` or `expired`. */
  decision: "allow" | "deny" | "answered" | "pending" | "dismissed" | "expired";
  /** Who answered, as the organization knows them; null when nobody did. */
  by: string | null;
  /** `ai-client` when answered from an AI client, `call` by voice. */
  via: string | null;
}

/** The structured summary of a turn an AI client reads at the end. */
export interface TurnSummary {
  text: string | null;
  toolCalls: Array<{ tool: string; ok: boolean | null }>;
  toolCallCount: number;
  files: string[];
  /** Summed over the turns after the person's message; null when no turn
   * reported usage yet. `costUsd` is null when the engine reports none. */
  cost: { inputTokens: number; outputTokens: number; costUsd: number | null; turns: number } | null;
  approvals: SummaryApproval[];
  threadUrl: string | null;
}

/** The summary of what followed `anchor` (the person's message) in a raw
 * Sagax message page: the reply, the tool calls (name and outcome, never
 * input or output), the files the calls wrote, the usage of the finished
 * turns and every card with its outcome and answerer. */
export function summarizeTurn(raw: unknown, anchor: string | null, threadUrl: string | null): TurnSummary {
  const list = Array.isArray(objectOf(raw)?.messages) ? (objectOf(raw)!.messages as unknown[]) : [];
  const all = list.map(objectOf).filter((m): m is Record<string, unknown> => Boolean(m) && typeof m!.id === "string");
  const start = anchor ? all.findIndex((m) => m.id === anchor) : -1;
  const after = start >= 0 ? all.slice(start + 1) : all;
  const texts: MemberMessage[] = [];
  const toolCalls: Array<{ tool: string; ok: boolean | null }> = [];
  const files = new Set<string>();
  const addFiles = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const path of value) if (typeof path === "string" && path.trim() && files.size < MEMBER_SUMMARY_LIST_MAX) files.add(path.trim());
  };
  let usage: { inputTokens: number; outputTokens: number; costUsd: number | null; turns: number } | null = null;
  const approvals: SummaryApproval[] = [];
  for (const m of after) {
    const kind = str(m.kind) ?? "text";
    if (kind === "activity") {
      const tool = objectOf(m.tool);
      const ok = typeof tool?.ok === "boolean" ? tool.ok : null;
      toolCalls.push({ tool: str(tool?.name) ?? "tool", ok });
      if (ok !== false) addFiles(tool?.files);
    } else if (kind === "digest") {
      const digest = objectOf(m.digest);
      const digestFiles = objectOf(digest?.files);
      addFiles(digestFiles?.added);
      addFiles(digestFiles?.changed);
      const used = objectOf(digest?.usage);
      if (used) {
        const input = typeof used.input === "number" ? used.input : 0;
        const output = typeof used.output === "number" ? used.output : 0;
        const cost = typeof used.costUsd === "number" ? used.costUsd : null;
        usage = usage ?? { inputTokens: 0, outputTokens: 0, costUsd: null, turns: 0 };
        usage.inputTokens += input;
        usage.outputTokens += output;
        usage.turns += 1;
        if (cost !== null) usage.costUsd = Math.round(((usage.costUsd ?? 0) + cost) * 1e6) / 1e6;
      }
    } else if ((kind === "text" || kind === "nudge" || kind === "access") && typeof m.text === "string" && (m.role === "user" || m.role === "bot")) {
      texts.push({ id: m.id as string, role: m.role, kind, text: m.text, at: null, sender: null });
    }
    const card = objectOf(m.card);
    const requestId = str(card?.requestId);
    if (card && requestId) {
      const answered = str(card.answered);
      const by = objectOf(card.answeredBy);
      approvals.push({
        id: requestId,
        tool: str(card.tool),
        title: str(card.title) ?? "",
        decision: answered === "allow" || answered === "deny" ? answered
          : answered && answered !== "unavailable" ? "answered"
          : card.expired === true || answered === "unavailable" ? "expired"
          : card.dismissed === true ? "dismissed" : "pending",
        by: by ? str(by.name) ?? (by.kind === "loopback" ? "this computer" : by.kind === "worker" ? "a local service" : null) : null,
        via: by ? str(by.via) : null,
      });
    }
  }
  return {
    text: replyAfter(texts, null),
    toolCalls: toolCalls.slice(-MEMBER_SUMMARY_LIST_MAX),
    toolCallCount: toolCalls.length,
    files: [...files],
    cost: usage,
    approvals,
    threadUrl,
  };
}

function botStatus(bot: Record<string, unknown> | undefined, archived: boolean): "idle" | "working" | "waiting" | "archived" {
  if (archived) return "archived";
  if (!bot) return "idle";
  if (bot.activity === "waiting-on-you") return "waiting";
  return bot.busy === true ? "working" : "idle";
}

/** The routes, in one table. */
function memberRoutes(deps: OrgMemberRouteDeps): MemberRoute[] {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const readThread = async (person: MemberPerson, threadId: string, since: string | null, limit: number): Promise<ThreadRead | Answer> => {
    const reply = await deps.perform(person, { method: "GET", path: `/api/threads/${encodeURIComponent(threadId)}/messages`, query: { limit: String(limit) } });
    if (!okStatus(reply)) return passThrough(reply, "This conversation cannot be read.");
    return readThreadPage(threadId, reply.body, since);
  };
  const isRead = (value: ThreadRead | Answer): value is ThreadRead => "messages" in value;

  /** Lot C.3: the answer permission for one card. The bot's owner holds it
   * for the cards of their own bots (derived here, nothing stored); anyone
   * else needs clients.approvalsAnswer; an admin holds every key. */
  const holdsAnswerPermission = (person: MemberPerson, info: ApprovalAnswerer | null): boolean =>
    person.admin
    || Boolean(info?.ownerPrincipalId && info.ownerPrincipalId === person.principalId)
    || can(deps.permissions(person.principalId), "clients.approvalsAnswer");

  /** Whether the person may answer this card through this API, with Sagax's
   * own rule on top of the permission: a server command of a member's bot is
   * an organization admin's, any other card its bot owner's. */
  const answerCheck = (person: MemberPerson, info: ApprovalAnswerer): { canAnswer: boolean; reason: string | null; permission: string | null; whoCanApprove: WhoCanApprove } => {
    const whoCanApprove: WhoCanApprove = info.adminOnly
      ? { kind: "admin", principalId: null, name: null, sentence: "An organization admin (this command would run on the server)." }
      : { kind: "owner", principalId: info.ownerPrincipalId, name: info.ownerName, sentence: info.ownerName ? `The bot's owner, ${info.ownerName}.` : "The bot's owner." };
    if (!info.open) return { canAnswer: false, reason: "This approval is no longer open.", permission: null, whoCanApprove };
    if (!holdsAnswerPermission(person, info)) {
      return { canAnswer: false, reason: "Your profile does not include answering approvals of bots that are not yours.", permission: "clients.approvalsAnswer", whoCanApprove };
    }
    const byRule = info.adminOnly ? person.admin : !info.ownerPrincipalId || info.ownerPrincipalId === person.principalId;
    if (!byRule) return { canAnswer: false, reason: info.adminOnly ? "Only an organization admin can approve this command." : "Only the bot owner can answer this approval.", permission: null, whoCanApprove };
    return { canAnswer: true, reason: null, permission: null, whoCanApprove };
  };

  /** The raw page of a thread as the person reads it, or a refusal. */
  const rawPage = async (person: MemberPerson, threadId: string): Promise<{ raw: unknown } | Answer> => {
    const reply = await deps.perform(person, { method: "GET", path: `/api/threads/${encodeURIComponent(threadId)}/messages`, query: { limit: String(MEMBER_THREAD_LIMIT_MAX) } });
    if (!okStatus(reply)) return passThrough(reply, "This conversation cannot be read.");
    return { raw: reply.body };
  };

  /** Wait on a thread's turn: until the bot answered after `anchor`, a card
   * waits, or `wait` seconds passed. With `emit` (a streamed answer), a
   * progress event at most every MEMBER_PROGRESS_MIN_MS and at least every
   * MEMBER_HEARTBEAT_MS, and one `approval` event per open card, which ends
   * the wait. Returns the final body, with its summary. */
  const watchTurn = async (input: {
    person: MemberPerson;
    botId: string | null;
    threadId: string;
    anchor: string | null;
    wait: number;
    emit?: (event: StreamEvent) => void;
    closed?: () => boolean;
  }): Promise<Record<string, unknown>> => {
    const { person, botId, threadId, wait, emit, closed } = input;
    const startedAt = now();
    const deadline = startedAt + wait * 1000;
    let status: ThreadStatus = deps.threadStatus(threadId) ?? "idle";
    // A queued message has no id yet: its answer is whatever the bot says
    // after the person's newest line.
    // Done when the thread is idle and the bot answered after the message,
    // or idle three looks in a row (a turn that failed or said nothing); a
    // card stops the wait at once.
    let idleLooks = 0;
    let lastEmit = Number.NEGATIVE_INFINITY;
    let lastKey = "";
    const announced = new Set<string>();
    const anchorOf = (read: ThreadRead) => input.anchor ?? read.messages.findLast((m) => m.role === "user")?.id ?? null;
    while (wait > 0 && now() < deadline) {
      if (closed?.()) break;
      status = deps.threadStatus(threadId) ?? "idle";
      if (status === "waiting") {
        if (!emit) break;
        const read = await readThread(person, threadId, null, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(read)) break;
        const fresh = read.approvals.filter((approval) => !announced.has(approval.id));
        for (const approval of fresh) {
          announced.add(approval.id);
          emit({ event: "approval", approval });
        }
        // A card waits: the client asks its person. A waiting flag with no
        // open card is a card just answered: keep watching.
        if (read.approvals.length) break;
      } else if (status === "idle") {
        idleLooks += 1;
        if (idleLooks >= 3) break;
        const read = await readThread(person, threadId, null, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(read)) break;
        if (replyAfter(read.messages, anchorOf(read)) !== null) break;
      } else {
        idleLooks = 0;
      }
      if (emit && now() - lastEmit >= MEMBER_PROGRESS_MIN_MS) {
        const read = await readThread(person, threadId, input.anchor, MEMBER_THREAD_LIMIT_MAX);
        const steps = isRead(read) ? read.steps : { count: 0, recent: [] };
        const live = deps.liveText?.(threadId) ?? null;
        const partial = live ? (live.length > MEMBER_PARTIAL_MAX ? `[...]${live.slice(-MEMBER_PARTIAL_MAX)}` : live) : null;
        const key = JSON.stringify([status, steps.count, partial]);
        if (key !== lastKey || now() - lastEmit >= MEMBER_HEARTBEAT_MS) {
          emit({ event: "progress", status, steps, partial, elapsedMs: now() - startedAt });
          lastKey = key;
          lastEmit = now();
        }
      }
      await sleep(Math.min(MEMBER_WAIT_POLL_MS, Math.max(0, deadline - now())));
    }
    status = deps.threadStatus(threadId) ?? "idle";
    const page = await rawPage(person, threadId);
    if (!("raw" in page)) return { botId, threadId, messageId: input.anchor, status, pending: true, reply: null, approvals: [], cursor: null, summary: null };
    const read = readThreadPage(threadId, page.raw, null);
    const anchor = anchorOf(read);
    const reply = status === "idle" ? replyAfter(read.messages, anchor) : null;
    // Idle after a wait is done even without words (a failed turn says why
    // in the thread); without a wait, only an answer is.
    const done = status === "idle" && (reply !== null || wait > 0);
    // A waiting flag with no open card is not waiting for anyone.
    const shownStatus = done ? "done" : status === "waiting" && !read.approvals.length ? "working" : status;
    return {
      botId,
      threadId,
      messageId: input.anchor,
      status: shownStatus,
      pending: !done,
      reply,
      approvals: read.approvals,
      // The card the turn waits on, in line: answer it with POST
      // approvals/{id} without reading the thread first.
      ...(shownStatus === "waiting" ? { approval: read.approvals[0] ?? null } : {}),
      cursor: read.cursor,
      summary: summarizeTurn(page.raw, anchor, deps.threadLink?.(threadId, botId) ?? null),
    };
  };

  /** A card in a raw page, with the message that carries it. */
  const cardIn = (raw: unknown, requestId: string): { message: Record<string, unknown>; card: Record<string, unknown> } | null => {
    const list = Array.isArray(objectOf(raw)?.messages) ? (objectOf(raw)!.messages as unknown[]) : [];
    for (const entry of list) {
      const message = objectOf(entry);
      const card = objectOf(message?.card);
      if (message && card && card.requestId === requestId) return { message, card };
    }
    return null;
  };

  /** One answer at a time per card: a second call while the first runs
   * gets the first one's outcome (dedupe by card id). */
  const answering = new Map<string, Promise<Answer>>();

  /** Answer one card, then wait until Sagax really closed it. */
  const answerCard = async (person: MemberPerson, threadId: string, requestId: string, input: AnswerInput): Promise<Answer> => {
    const page = await rawPage(person, threadId);
    if (!("raw" in page)) return page;
    const found = cardIn(page.raw, requestId);
    const approval = found ? describeMemberApproval(threadId, found.message, found.card) : null;
    // A card older than the page read: answered by decision, as before.
    const plan = approval && found ? planAnswer(approval, found.card, input)
      : input.decision ? { ok: true as const, decision: input.decision, picked: null, via: "decision" as const, body: { behavior: input.decision } }
        : { ok: false as const, status: 400, code: "decision_required", message: "Send decision allow or deny." };
    if (!plan.ok) return fail(plan.status, plan.code, plan.message, plan.extra);
    const reply = await deps.perform(person, { method: "POST", path: `/api/threads/${encodeURIComponent(threadId)}/respond`, body: { requestId, ...plan.body } });
    if (!okStatus(reply)) return passThrough(reply, "This card cannot be answered.");
    // Answered means closed: Sagax said yes, now the card must say so too.
    const deadline = now() + APPROVAL_CLOSE_WAIT_MS;
    let open = deps.approvalAnswerer?.(threadId, requestId)?.open ?? false;
    while (open && now() < deadline) {
      await sleep(APPROVAL_CLOSE_POLL_MS);
      open = deps.approvalAnswerer?.(threadId, requestId)?.open ?? false;
    }
    if (open) {
      return fail(409, "not_closed", "Sagax took the answer, but this approval is still open. Answer it in the Sagax app, or read it again and send one of its options.", {
        closed: false, ...(approval ? { options: approval.choices, kind: approval.kind } : {}),
      });
    }
    deps.noteAnsweredVia?.(person, threadId, requestId);
    deps.record(person, { action: "client.approval", target: { kind: "thread", id: threadId }, after: { requestId, decision: plan.decision, answer: plan.via } });
    const after = await rawPage(person, threadId);
    const settled = "raw" in after ? cardIn(after.raw, requestId)?.card ?? null : null;
    const state = approvalState(settled, plan.decision === "deny" && plan.body.behavior === "answer");
    return answer({
      answered: state !== "unavailable",
      closed: true,
      decision: plan.decision,
      state,
      ...(plan.picked ? { option: plan.picked } : {}),
      ...(state === "unavailable" ? { message: "The approval closed, but the bot's turn had already ended: the answer did not reach it. Send it a new prompt if the work still matters." } : {}),
    });
  };

  /** Threads where a card may wait for this person: each bot's threads the
   * person sees in Sagax, and their hidden AI-client conversation with it. */
  const pendingApprovals = async (person: MemberPerson): Promise<Answer> => {
    const listed = await deps.perform(person, { method: "GET", path: "/api/bots", query: { messages: "0" } });
    if (!okStatus(listed)) return passThrough(listed, "Your bots cannot be read.");
    const threads = new Map<string, { botId: string; botName: string }>();
    for (const raw of (objectOf(listed.body)?.bots as unknown[] | undefined) ?? []) {
      const bot = objectOf(raw);
      if (!bot || typeof bot.id !== "string") continue;
      const about = { botId: bot.id, botName: str(bot.name) ?? "" };
      const ids = [str(bot.threadId), deps.hiddenThreadOf?.(bot.id, person.principalId) ?? null,
        ...(deps.agentConversationsOf?.(bot.id, person.principalId) ?? []),
        ...((bot.tasks as unknown[] | undefined) ?? []).map((task) => str(objectOf(task)?.threadId))];
      for (const id of ids) if (id && THREAD_ID.test(id) && !threads.has(id)) threads.set(id, about);
    }
    const approvals: Array<MemberApproval & { botId: string; botName: string; canAnswer: boolean; whoCanApprove: WhoCanApprove | null }> = [];
    let read = 0;
    for (const [threadId, about] of threads) {
      // A confidential thread is answered in Sagax only (#683): never listed.
      if (deps.confidential?.(threadId) || deps.threadStatus(threadId) !== "waiting") continue;
      if (read >= PENDING_THREADS_MAX) break;
      read += 1;
      // The person's own read: a thread they cannot see stays out.
      const page = await readThread(person, threadId, null, MEMBER_THREAD_LIMIT_MAX);
      if (!isRead(page)) continue;
      for (const approval of page.approvals) {
        const info = deps.approvalAnswerer?.(threadId, approval.id) ?? null;
        const check = info ? answerCheck(person, info) : null;
        approvals.push({ ...approval, ...about, canAnswer: check?.canAnswer ?? false, whoCanApprove: check?.whoCanApprove ?? null });
      }
    }
    approvals.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
    return answer({ approvals, count: approvals.length });
  };

  /** An agent tool that stopped on a card (send_prompt, await_turn): the
   * card in line, so the client answers it without reading the thread. */
  const withApproval = async (person: MemberPerson, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const threadId = str(body.thread_id);
    if (body.status !== "waiting_for_approval" || !threadId || !THREAD_ID.test(threadId) || deps.confidential?.(threadId)) return body;
    const page = await readThread(person, threadId, null, MEMBER_THREAD_LIMIT_MAX);
    if (!isRead(page)) return body;
    const approval = page.approvals[0] ?? null;
    return {
      ...body,
      approval,
      approvals: page.approvals,
      ...(approval ? {
        next: approval.answerWith === "option"
          ? `Ask the person, then call sagax_approve with thread_id ${threadId}, approval_id ${approval.id} and option (one of approval.choices, by id or label); then call await_turn again with this handle.`
          : `Ask the person, then call sagax_approve with thread_id ${threadId}, approval_id ${approval.id} and decision allow or deny; then call await_turn again with this handle.`,
      } : {}),
    };
  };

  /** The catalogue entry only when this person owns the bot. A shared bot,
   * a published bot, and another person's bot (an admin's view included)
   * are 404 before any file is read. */
  const ownedBot = async (person: MemberPerson, botId: string): Promise<Answer | { id: string }> => {
    const catalogue = await deps.perform(person, { method: "GET", path: "/api/bot-catalog" });
    if (!okStatus(catalogue)) return passThrough(catalogue, "Your bots cannot be read.");
    const entries = ((objectOf(catalogue.body)?.entries as unknown[] | undefined) ?? []).map(objectOf);
    const entry = entries.find((candidate) => candidate?.id === botId);
    const ownerId = str(objectOf(entry?.owner)?.principalId);
    if (!entry || str(entry.source) !== "mine" || ownerId !== person.principalId) return fail(404, "not_found", "No such bot.");
    return { id: botId };
  };

  const ownRoutineRows = async (person: MemberPerson): Promise<Answer | { routines: Record<string, unknown>[]; runs: Record<string, unknown>[] }> => {
    const reply = await deps.perform(person, { method: "GET", path: "/api/routines" });
    if (!okStatus(reply)) return passThrough(reply, "Routines cannot be read.");
    const body = objectOf(reply.body) ?? {};
    const routines = ((body.routines as unknown[] | undefined) ?? []).map(objectOf).filter((row): row is Record<string, unknown> => {
      if (!row || row.redacted === true) return false;
      return str(objectOf(row.owner)?.id) === person.principalId;
    });
    const ownedIds = new Set(routines.map((row) => row.id).filter((id): id is string => typeof id === "string"));
    const runs = ((body.runs as unknown[] | undefined) ?? []).map(objectOf).filter((row): row is Record<string, unknown> => {
      if (!row || row.redacted === true) return false;
      const routineId = str(row.routineId);
      return routineId !== null && ownedIds.has(routineId);
    });
    return { routines, runs };
  };

  const routes: MemberRoute[] = [
    {
      method: "GET", path: "capabilities",
      async handle() {
        return answer({ api: ORG_MEMBER_API_VERSION, version: deps.version?.() ?? "unknown", routes: routes.map((route) => `${route.method} ${route.path}`).sort() });
      },
    },
    {
      method: "GET", path: "bots", permission: "clients.botsRead",
      async handle({ person }) {
        const [listed, catalogue] = await Promise.all([
          deps.perform(person, { method: "GET", path: "/api/bots", query: { messages: "0" } }),
          deps.perform(person, { method: "GET", path: "/api/bot-catalog" }),
        ]);
        if (!okStatus(listed)) return passThrough(listed, "Your bots cannot be read.");
        const usable = new Map<string, Record<string, unknown>>();
        for (const raw of (objectOf(listed.body)?.bots as unknown[] | undefined) ?? []) {
          const bot = objectOf(raw);
          if (bot && typeof bot.id === "string") usable.set(bot.id, bot);
        }
        const entries = okStatus(catalogue) ? ((objectOf(catalogue.body)?.entries as unknown[] | undefined) ?? []).map(objectOf).filter((e): e is Record<string, unknown> => Boolean(e) && typeof e!.id === "string") : [];
        const seen = new Set<string>();
        const bots = entries.map((entry) => {
          const id = entry.id as string;
          seen.add(id);
          const bot = usable.get(id);
          const owner = objectOf(entry.owner);
          const ownerId = str(owner?.principalId) ?? "";
          return {
            id,
            name: str(entry.name) ?? str(bot?.name) ?? "",
            title: str(entry.title) ?? "",
            description: str(entry.description) ?? "",
            source: str(entry.source) ?? "shared",
            owner: { principalId: ownerId, sub: ownerId === person.principalId ? person.sub : null, name: str(owner?.name) ?? "" },
            status: botStatus(bot, entry.archived === true),
            canMessage: Boolean(bot) && entry.archived !== true,
            threadId: str(bot?.threadId),
          };
        });
        // A bot the person reaches that the catalogue does not list (a solo
        // server's own bots, a section bot): shared with them.
        for (const [id, bot] of usable) {
          if (seen.has(id)) continue;
          bots.push({ id, name: str(bot.name) ?? "", title: str(bot.title) ?? "", description: str(bot.description) ?? "", source: "shared",
            owner: { principalId: "", sub: null, name: "" }, status: botStatus(bot, false), canMessage: true, threadId: str(bot.threadId) });
        }
        bots.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id.localeCompare(b.id));
        return answer({ bots });
      },
    },
    {
      method: "POST", path: "bots/{id}/messages", permission: "clients.botsMessage",
      async handle({ person, params, body }) {
        const input = objectOf(body);
        if (!input) return fail(400, "bad_request", "Send { \"text\": \"...\" }.");
        const extra = Object.keys(input).filter((key) => !["text", "threadId", "newThread", "wait", "sendId", "stream"].includes(key));
        if (extra.length) return fail(400, "bad_request", `Unknown field: ${extra[0]}.`);
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text || text.length > MEMBER_TEXT_MAX) return fail(400, "bad_request", `text is 1 to ${MEMBER_TEXT_MAX} characters.`);
        if (input.threadId !== undefined && (typeof input.threadId !== "string" || !THREAD_ID.test(input.threadId))) return fail(400, "bad_request", "threadId is a thread id.");
        if (input.newThread !== undefined && typeof input.newThread !== "boolean") return fail(400, "bad_request", "newThread is true or false.");
        if (input.newThread === true && input.threadId !== undefined) return fail(400, "bad_request", "Send threadId or newThread, not both.");
        const wait = input.wait === undefined ? 0 : input.wait;
        if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0 || wait > MEMBER_WAIT_MAX_SECONDS) return fail(400, "bad_request", `wait is 0 to ${MEMBER_WAIT_MAX_SECONDS} seconds.`);
        if (input.sendId !== undefined && (typeof input.sendId !== "string" || !SEND_ID.test(input.sendId))) return fail(400, "bad_request", "sendId is 8 to 80 letters, digits, _ or -.");
        if (input.stream !== undefined && typeof input.stream !== "boolean") return fail(400, "bad_request", "stream is true or false.");
        const botId = params.id!;
        let threadId = input.threadId as string | undefined;
        if (threadId && deps.confidential?.(threadId)) return fail(404, "not_found", "No such conversation.");
        // 2026-10-29: an AI client is another agent talking to the bot, not
        // the person typing: it works in its own conversation with the bot
        // (shared/agent-conversation.ts), drawn like a bot-to-bot one and
        // silent for the person. A named threadId is honored as given. The
        // Perspicax console is the person typing, so it keeps their chat.
        const hidden = person.actor !== "console";
        if (!threadId && hidden && deps.agentConversation) {
          threadId = deps.agentConversation(botId, person, input.newThread === true) ?? undefined;
          if (!threadId) return fail(502, "not_started", "A conversation with this bot could not be opened.");
        }
        if (!threadId && hidden && input.newThread !== true) threadId = deps.hiddenThreadOf?.(botId, person.principalId) ?? undefined;
        if ((input.newThread === true && !(hidden && deps.agentConversation)) || (hidden && !threadId)) {
          const created = await deps.perform(person, { method: "POST", path: `/api/bots/${encodeURIComponent(botId)}/tasks`, body: { confidential: false } });
          if (!okStatus(created)) return passThrough(created, "A new conversation could not be started.");
          threadId = str(objectOf(objectOf(created.body)?.task)?.threadId) ?? undefined;
          if (!threadId) return fail(502, "server_error", "The new conversation has no id.");
        }
        const sent = await deps.perform(person, {
          method: "POST",
          path: `/api/bots/${encodeURIComponent(botId)}/messages`,
          body: { text, ...(threadId ? { threadId } : {}), ...(input.sendId ? { sendId: input.sendId } : {}) },
        });
        if (!okStatus(sent)) return passThrough(sent, "The message could not be sent.");
        const receipt = objectOf(sent.body) ?? {};
        const finalThread = str(receipt.threadId) ?? threadId ?? null;
        const messageId = str(objectOf(receipt.message)?.id);
        if (hidden && finalThread && messageId) deps.markAiClientLine?.(finalThread, messageId);
        deps.record(person, { action: "client.message", target: { kind: "bot", id: botId }, after: { threadId: finalThread, waited: wait > 0, ...(input.newThread ? { newThread: true } : {}), ...(hidden && !input.threadId ? { hidden: true } : {}) } });
        if (!finalThread) return answer({ botId, threadId: null, messageId, status: "working", pending: true, reply: null, approvals: [], cursor: null, summary: null });
        if (input.stream === true) {
          return {
            stream: async (emit, closed) => {
              emit({ event: "started", botId, threadId: finalThread, messageId });
              return watchTurn({ person, botId, threadId: finalThread, anchor: messageId, wait, emit, closed });
            },
          };
        }
        return answer(await watchTurn({ person, botId, threadId: finalThread, anchor: messageId, wait }));
      },
    },
    {
      method: "GET", path: "threads/{id}/stream", permission: "clients.botsRead",
      async handle({ person, params, url }) {
        const anchor = url.searchParams.get("anchor") || null;
        if (anchor !== null && !THREAD_ID.test(anchor)) return fail(400, "bad_request", "anchor is a message id.");
        const rawWait = url.searchParams.get("wait");
        const wait = rawWait === null || rawWait === "" ? 30 : /^\d{1,3}$/.test(rawWait) ? Number(rawWait) : Number.NaN;
        if (!Number.isInteger(wait) || wait < 1 || wait > MEMBER_WAIT_MAX_SECONDS) return fail(400, "bad_request", `wait is 1 to ${MEMBER_WAIT_MAX_SECONDS} seconds.`);
        const threadId = params.id!;
        if (deps.confidential?.(threadId)) return fail(404, "not_found", "No such conversation.");
        // Read once before streaming: a thread the person cannot read is
        // refused with Sagax's own answer, as JSON.
        const first = await readThread(person, threadId, anchor, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(first)) return first;
        return {
          stream: async (emit, closed) => {
            emit({ event: "started", botId: deps.botOfThread?.(threadId) ?? null, threadId, messageId: anchor });
            return watchTurn({ person, botId: deps.botOfThread?.(threadId) ?? null, threadId, anchor, wait, emit, closed });
          },
        };
      },
    },
    {
      method: "GET", path: "threads/{id}", permission: "clients.botsRead",
      async handle({ person, params, url }) {
        const since = url.searchParams.get("since") || null;
        if (since !== null && !THREAD_ID.test(since)) return fail(400, "bad_request", "since is a message id.");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null || rawLimit === "" ? MEMBER_THREAD_LIMIT_DEFAULT : /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
        if (!Number.isInteger(limit) || limit < 1 || limit > MEMBER_THREAD_LIMIT_MAX) return fail(400, "bad_request", `limit is 1 to ${MEMBER_THREAD_LIMIT_MAX}.`);
        const threadId = params.id!;
        if (deps.confidential?.(threadId)) return fail(404, "not_found", "No such conversation.");
        // Read a full page so the cursor is found, then cut to the limit.
        const read = await readThread(person, threadId, since, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(read)) return read;
        const messages = read.messages.slice(-limit);
        return answer({
          threadId,
          status: deps.threadStatus(threadId) ?? "idle",
          messages,
          steps: read.steps,
          approvals: read.approvals,
          cursor: read.cursor,
          ...(read.gap ? { gap: true } : {}),
        });
      },
    },
    {
      method: "GET", path: "routines", permission: "clients.routinesRead",
      async handle({ person }) {
        const rows = await ownRoutineRows(person);
        if ("status" in rows) return rows;
        return answer({ routines: rows.routines.map((row) => projectRoutine(row, rows.runs, false)) });
      },
    },
    {
      method: "GET", path: "routines/{id}", permission: "clients.routinesRead",
      async handle({ person, params }) {
        const rows = await ownRoutineRows(person);
        if ("status" in rows) return rows;
        const found = rows.routines.find((row) => row.id === params.id);
        if (!found) return fail(404, "not_found", "No such routine.");
        return answer({ routine: projectRoutine(found, rows.runs, true) });
      },
    },
    {
      // 2026-11-01 (#1891): the person manages their own routine as themselves
      // (same as the Automations editor). Bot Ask/Auto still gates propose_*;
      // this path is the person's own write, never a bot proposal.
      method: "PATCH", path: "routines/{id}", permission: "clients.routinesWrite",
      async handle({ person, params, body }) {
        const input = objectOf(body);
        if (!input) return fail(400, "bad_request", "Send { \"enabled\", \"name\", \"instructions\" and/or \"schedule\" }.");
        const extra = Object.keys(input).filter((key) => !(MEMBER_ROUTINE_PATCH_FIELDS as readonly string[]).includes(key));
        if (extra.length) return fail(400, "bad_request", `Unknown field: ${extra[0]}.`);
        const patch: Record<string, unknown> = {};
        const fields: string[] = [];
        if (Object.hasOwn(input, "enabled")) {
          if (typeof input.enabled !== "boolean") return fail(400, "bad_request", "enabled is true or false.");
          patch.enabled = input.enabled;
          fields.push("enabled");
        }
        if (Object.hasOwn(input, "name")) {
          if (typeof input.name !== "string") return fail(400, "bad_request", "name is a string.");
          const name = input.name.trim();
          if (!name || name.length > MEMBER_ROUTINE_NAME_MAX) {
            return fail(400, "bad_request", `name is 1 to ${MEMBER_ROUTINE_NAME_MAX} characters.`);
          }
          patch.name = name;
          fields.push("name");
        }
        if (Object.hasOwn(input, "instructions")) {
          if (typeof input.instructions !== "string") return fail(400, "bad_request", "instructions is a string.");
          const instructions = input.instructions.trim();
          if (!instructions || instructions.length > MEMBER_ROUTINE_INSTRUCTIONS_MAX) {
            return fail(400, "bad_request", `instructions is 1 to ${MEMBER_ROUTINE_INSTRUCTIONS_MAX} characters.`);
          }
          // Sagax PATCH uses prompt; the member wire keeps instructions.
          patch.prompt = instructions;
          fields.push("instructions");
        }
        if (Object.hasOwn(input, "schedule")) {
          if (!input.schedule || typeof input.schedule !== "object" || Array.isArray(input.schedule)) {
            return fail(400, "bad_request", "schedule is an object (cron, daily/weekly, or interval, with a time zone when needed).");
          }
          const schedule = input.schedule as Record<string, unknown>;
          const type = str(schedule.type);
          if (type !== "cron" && type !== "daily" && type !== "interval" && type !== "once" && type !== "webhook" && type !== "event") {
            return fail(400, "bad_request", "schedule.type is cron, daily, interval, once, webhook or event.");
          }
          patch.schedule = schedule;
          fields.push("schedule");
        }
        if (!fields.length) return fail(400, "bad_request", "Send at least one of enabled, name, instructions, schedule.");

        const rows = await ownRoutineRows(person);
        if ("status" in rows) return rows;
        const owned = rows.routines.find((row) => row.id === params.id);
        if (!owned) return fail(404, "not_found", "No such routine.");

        const reply = await deps.perform(person, {
          method: "PATCH",
          path: `/api/routines/${encodeURIComponent(params.id!)}`,
          body: patch,
        });
        if (!okStatus(reply)) return passThrough(reply, "The routine could not be updated.");
        const updated = objectOf(objectOf(reply.body)?.routine) ?? objectOf(reply.body);
        deps.record(person, {
          action: "client.routine_update",
          target: { kind: "routine", id: params.id!, ...(typeof owned.name === "string" ? { name: scrubText(owned.name).slice(0, 80) } : {}) },
          after: { fields },
        });
        // Prefer the live Sagax row; fall back to the owned list row with the
        // patch applied so the answer still matches projectRoutine.
        const row = updated && typeof updated.id === "string"
          ? { ...owned, ...updated, ...(typeof updated.prompt === "string" ? { prompt: updated.prompt } : {}), ...(Object.hasOwn(patch, "prompt") ? { prompt: patch.prompt } : {}) }
          : { ...owned, ...patch, ...(Object.hasOwn(patch, "prompt") ? { prompt: patch.prompt } : {}) };
        return answer({ routine: projectRoutine(row, rows.runs, true) });
      },
    },
    {
      method: "POST", path: "routines/{id}/run", permission: "clients.routinesRun",
      async handle({ person, params }) {
        const reply = await deps.perform(person, { method: "POST", path: `/api/routines/${encodeURIComponent(params.id!)}/run`, body: {} });
        if (!okStatus(reply)) return passThrough(reply, "The routine could not be run.");
        const body = objectOf(reply.body);
        const run = wireRun(objectOf(body?.run), true);
        deps.record(person, { action: "client.routine_run", target: { kind: "routine", id: params.id! }, after: { runId: run?.id ?? null } });
        // 2026-11-01: the start's receipt (what started, where it stands in
        // its bot's queue and why, where to follow it), passed on as said.
        const standing = objectOf(body?.standing);
        const message = str(body?.message);
        return answer({ run, ...(standing ? { standing: scrubValue(standing) } : {}), ...(message ? { message: scrubText(message).slice(0, 1_000) } : {}) }, 201);
      },
    },
    {
      method: "GET", path: "routines/runs/{id}", permission: "clients.routinesRun",
      async handle({ person, params }) {
        const reply = await deps.perform(person, { method: "GET", path: "/api/routines" });
        if (!okStatus(reply)) return passThrough(reply, "Routines cannot be read.");
        const runs = (objectOf(reply.body)?.runs as unknown[] | undefined) ?? [];
        const found = runs.map(objectOf).find((run) => run?.id === params.id);
        if (!found) return fail(404, "not_found", "No such run.");
        return answer({ run: wireRun(found, true) });
      },
    },
    {
      method: "GET", path: "bots/{id}/rules", permission: "clients.botsRead",
      async handle({ person, params }) {
        const owned = await ownedBot(person, params.id!);
        if ("status" in owned) return owned;
        const id = encodeURIComponent(owned.id);
        const [file, listing] = await Promise.all([
          deps.perform(person, { method: "GET", path: `/api/bots/${id}/workspace/file`, query: { path: "RULES.md" } }),
          deps.perform(person, { method: "GET", path: `/api/bots/${id}/rules` }),
        ]);
        if (!okStatus(file) && file.status !== 404) return passThrough(file, "Rules cannot be read.");
        if (!okStatus(listing)) return passThrough(listing, "Rules cannot be read.");
        const sets = ((objectOf(listing.body)?.sets as unknown[] | undefined) ?? []).map(objectOf).flatMap((set) => {
          if (!set) return [];
          return [{
            id: str(set.id),
            name: scrubText(str(set.name) ?? ""),
            enabled: set.enabled === true,
            text: scrubText(typeof set.text === "string" ? set.text : ""),
          }];
        });
        return answer({ rules: okStatus(file) ? scrubText(str(objectOf(file.body)?.text) ?? "") : "", sets });
      },
    },
    {
      method: "GET", path: "bots/{id}/docs", permission: "clients.botsRead",
      async handle({ person, params, url }) {
        const asked = url.searchParams.get("path");
        const ref = asked === null ? null : docPath(asked);
        if (asked !== null && !ref) return fail(400, "bad_request", "path must be docs/<name>.md");
        const owned = await ownedBot(person, params.id!);
        if ("status" in owned) return owned;
        const id = encodeURIComponent(owned.id);
        if (ref) {
          const file = await deps.perform(person, { method: "GET", path: `/api/bots/${id}/workspace/file`, query: { path: ref } });
          if (!okStatus(file)) return passThrough(file, "That document cannot be read.");
          return answer({ path: ref, text: scrubText(str(objectOf(file.body)?.text) ?? "") });
        }
        const tree = await deps.perform(person, { method: "GET", path: `/api/bots/${id}/workspace` });
        if (!okStatus(tree)) return passThrough(tree, "Documents cannot be read.");
        const docs = ((objectOf(tree.body)?.entries as unknown[] | undefined) ?? []).map(objectOf).flatMap((entry) => {
          const path = str(entry?.path);
          return path && docPath(path) ? [path] : [];
        });
        return answer({ docs });
      },
    },
    {
      method: "GET", path: "bots/{id}/memory", permission: "clients.botsRead",
      async handle({ person, params }) {
        const owned = await ownedBot(person, params.id!);
        if ("status" in owned) return owned;
        const read = deps.readBotMemory?.(owned.id) ?? null;
        return answer({ text: scrubText(read?.text ?? "") });
      },
    },
    {
      method: "GET", path: "bots/{id}/connectors", permission: "clients.botsRead",
      async handle({ person, params }) {
        const owned = await ownedBot(person, params.id!);
        if ("status" in owned) return owned;
        const detail = await deps.perform(person, { method: "GET", path: `/api/bot-catalog/${encodeURIComponent(owned.id)}` });
        if (!okStatus(detail)) return passThrough(detail, "Connectors cannot be read.");
        const connectors = ((objectOf(detail.body)?.integrations as unknown[] | undefined) ?? []).map(objectOf).flatMap((row) => {
          if (!row) return [];
          return [{
            name: scrubText(str(row.name) ?? ""),
            kind: row.kind === "browser" ? "browser" : "mcp",
            enabled: row.enabled !== false,
            scope: "bot",
          }];
        });
        return answer({ connectors });
      },
    },
    {
      method: "GET", path: "approvals/{id}", permission: "clients.botsRead",
      async handle({ person, params, url }) {
        const threadId = url.searchParams.get("threadId") ?? "";
        if (!THREAD_ID.test(threadId)) return fail(400, "bad_request", "threadId is a thread id.");
        // The person must reach the thread: Sagax's own read decides.
        if (deps.confidential?.(threadId)) return fail(404, "not_found", "No such approval in this conversation.");
        const read = await readThread(person, threadId, null, 1);
        if (!isRead(read)) return read;
        const info = deps.approvalAnswerer?.(threadId, params.id!) ?? null;
        if (!info?.found) return fail(404, "not_found", "No such approval in this conversation.");
        const check = answerCheck(person, info);
        return answer({
          id: params.id!,
          threadId,
          open: info.open,
          canAnswer: check.canAnswer,
          ...(check.reason ? { reason: check.reason } : {}),
          ...(check.permission ? { permission: check.permission } : {}),
          whoCanApprove: check.whoCanApprove,
        });
      },
    },
    {
      method: "GET", path: "approvals", permission: "clients.botsRead",
      async handle({ person, url }) {
        const status = url.searchParams.get("status");
        if (status !== null && status !== "" && status !== "pending") return fail(400, "bad_request", "status is pending.");
        return pendingApprovals(person);
      },
    },
    {
      // No route-level permission: the bot's owner answers the cards of their
      // own bots by default; anyone else needs clients.approvalsAnswer
      // (decided per card below). An admin holds every key.
      //
      // 2026-10-17: { decision?, option?, text? }. A question takes one of its
      // options (by id or label) or words of the person's own; a bare allow
      // picks the only option or the yes of a yes/no pair, else 409
      // option_required with the options. `closed: true` only once the card
      // is really closed; a card already closed answers alreadyAnswered.
      method: "POST", path: "approvals/{id}",
      async handle({ person, params, body }) {
        const input = objectOf(body);
        const decision = input?.decision;
        const threadId = input?.threadId;
        const option = input?.option;
        const text = input?.text;
        const usage = "Send { \"threadId\": \"...\", \"decision\": \"allow\" or \"deny\" }, with \"option\" (an option id or label) for a question, or \"text\" (the person's own words).";
        if (!input || Object.keys(input).some((key) => !["decision", "threadId", "option", "text"].includes(key)) || typeof threadId !== "string" || !THREAD_ID.test(threadId)) return fail(400, "bad_request", usage);
        if (decision !== undefined && decision !== "allow" && decision !== "deny") return fail(400, "bad_request", usage);
        const optionOk = option === undefined || (typeof option === "string" && option.trim().length > 0 && option.length <= 200)
          || (Array.isArray(option) && option.length > 0 && option.length <= MAX_OPTIONS && option.every((o) => typeof o === "string" && o.trim().length > 0 && o.length <= 200));
        if (!optionOk) return fail(400, "bad_request", "option is an option id or label, or a list of them (one per question).");
        if (text !== undefined && (typeof text !== "string" || !text.trim() || text.length > MAX_CUSTOM_ANSWER)) return fail(400, "bad_request", `text is 1 to ${MAX_CUSTOM_ANSWER} characters.`);
        if (decision === undefined && option === undefined && text === undefined) return fail(400, "bad_request", usage);
        if (deps.confidential?.(threadId)) return fail(404, "not_found", "No such approval in this conversation.");
        const info = deps.approvalAnswerer?.(threadId, params.id!) ?? null;
        if (!holdsAnswerPermission(person, info)) {
          return fail(403, "forbidden_permission", `Your profile does not include ${permissionLabel("clients.approvalsAnswer", "en")}, and this bot is not yours. Ask an admin to add it in Perspicax.`, { permission: "clients.approvalsAnswer" });
        }
        if (!info?.found) return fail(404, "not_found", "No such approval in this conversation.");
        const key = `${threadId}/${params.id!}`;
        const running = answering.get(key);
        if (running) {
          const first = await running;
          return first.status === 200 ? answer({ ...(first.body as Record<string, unknown>), alreadyAnswered: true }) : first;
        }
        if (!info.open) {
          // Idempotent: the same answer twice, or one given in Sagax.
          const page = await rawPage(person, threadId);
          if (!("raw" in page)) return page;
          const card = cardIn(page.raw, params.id!)?.card ?? null;
          const state = approvalState(card);
          return answer({ answered: true, closed: true, alreadyAnswered: true, state, decision: state === "denied" ? "deny" : state === "allowed" || state === "answered" ? "allow" : null });
        }
        const work = answerCard(person, threadId, params.id!, {
          ...(decision ? { decision: decision as "allow" | "deny" } : {}),
          ...(option !== undefined ? { option: option as string | string[] } : {}),
          ...(text !== undefined ? { text: text as string } : {}),
        });
        answering.set(key, work);
        try {
          return await work;
        } finally {
          answering.delete(key);
        }
      },
    },
    {
      // The agent-to-agent API. No route-level key: each tool needs its own
      // scope (read: clients.botsRead, send_prompt: clients.botsMessage,
      // create_agent: clients.agentsCreate), checked and audited by the tool.
      method: "POST", path: "agents/{tool}",
      async handle({ person, params, body, signal }) {
        if (!deps.agentApi) return fail(404, "not_found", "This server does not offer the agent API.");
        const reply = await deps.agentApi(person, params.tool!, body ?? {}, signal);
        if (reply.status === 200 && (params.tool === "send_prompt" || params.tool === "await_turn")) return answer(await withApproval(person, reply.body));
        return answer(reply.body, reply.status);
      },
    },
    {
      method: "POST", path: "people/{id}/nudge", permission: "clients.peopleNudge",
      async handle({ person, params }) {
        const principalId = deps.resolvePerson(params.id!);
        if (!principalId) return fail(404, "not_found", "No such person.");
        const reply = await deps.perform(person, { method: "POST", path: "/api/nudges", body: { principalId } });
        if (!okStatus(reply)) return passThrough(reply, "This person cannot be nudged.");
        const result = objectOf(reply.body) ?? {};
        deps.record(person, { action: "client.nudge", target: { kind: "person", id: principalId } });
        return answer({ ok: true, id: str(result.id), at: typeof result.at === "number" ? result.at : null });
      },
    },
  ];
  return routes;
}

/** A run as an AI client reads it; `detail` adds the output and the error. */
function wireRun(run: Record<string, unknown> | null | undefined, detail = false) {
  if (!run || typeof run.id !== "string") return null;
  const cut = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : null);
  return {
    id: run.id,
    routineId: str(run.routineId),
    routineName: str(run.routineName),
    botId: str(run.botId),
    status: str(run.status),
    threadId: str(run.threadId) ?? str(run.resultsThreadId) ?? str(run.executionThreadId),
    startedAt: typeof run.startedAt === "number" ? run.startedAt : null,
    endedAt: typeof run.finishedAt === "number" ? run.finishedAt : null,
    // 2026-11-01: completed, but not all of it went right: never a plain success.
    ...(typeof run.problems === "string" && run.problems ? { problems: scrubText(run.problems).slice(0, 1_000) } : {}),
    ...(detail ? { attention: cut(run.attention, 500), error: cut(run.error, 500), output: cut(run.output, MEMBER_REPLY_MAX) } : {}),
  };
}

/** Write a streamed answer: NDJSON, one event per line, the last one
 * `final` (or `error` when the work failed after the stream began). Stops
 * early when the client goes away. */
async function streamAnswer(res: ServerResponse, answer: StreamAnswer): Promise<void> {
  let gone = false;
  const onClose = () => {
    gone = true;
  };
  // The response's close, not the request's: a request closes as soon as its
  // body was read.
  res.on("close", onClose);
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-sagax-member-api": "1",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  const emit = (event: StreamEvent) => {
    if (gone || res.writableEnded) return;
    res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const final = await answer.stream(emit, () => gone || res.writableEnded);
    emit({ event: "final", ...final });
  } catch (error) {
    console.error(`[org-member] stream: ${error instanceof Error ? error.message : String(error)}`);
    emit({ event: "error", code: "server_error", message: "The server could not finish this; its log has the details." });
  } finally {
    res.off("close", onClose);
    if (!res.writableEnded) res.end();
  }
}

/** The handler: true when the request was one of ours (answered). */
export function createOrgMemberRoutes(deps: OrgMemberRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const now = deps.now ?? Date.now;
  const compiled = compileRoutes(memberRoutes(deps).map((route) => ({ method: route.method, path: route.path, min: "employee" as const, handle: () => ({ status: 500, body: null }), member: route })));
  const answer = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (path !== "/api/org/member" && !path.startsWith(ORG_MEMBER_PREFIX)) return false;
    const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => {
      send(res, status, { code, message, reason: message, error: message, ...extra });
      return true;
    };
    const method = req.method ?? "GET";
    if (deps.identity !== "perspicax") return refuse(403, "identity_perspicax", "This server does not sign people in with Pulsatrix.");
    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
    if (!bearer) return refuse(401, "assertion_missing", "A Perspicax assertion is required.");
    const audience = deps.publicOrigin();
    if (!audience || bearer.length > MAX_TOKEN_CHARS) {
      return refuse(401, "assertion_invalid", audience ? "The assertion is too long." : "This server has no public address to check the assertion against.");
    }
    let assertion: ConsoleAssertion;
    try {
      assertion = await deps.verify(bearer, audience, deps.linkServerId());
    } catch (error) {
      return refuse(401, "assertion_invalid", (error instanceof Error ? error.message : "The assertion does not verify.").slice(0, 300));
    }
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) return refuse(401, "assertion_replayed", "This assertion was already used.");
    const found = deps.personFor(deps.issuer, assertion.sub);
    if (!found) return refuse(403, "unknown_person", "This person is not in this server's directory yet.");
    if (!found.active) return refuse(403, "person_disabled", "This person is turned off in Perspicax or on this server.");
    const person: MemberPerson = {
      principalId: found.principalId,
      sub: assertion.sub,
      name: found.name,
      // Both must say admin: the assertion is fresh, the principal is ours.
      admin: found.admin && assertion.role === "admin",
      actor: assertion.actor,
      ...(assertion.actor === "perspicax-mcp" && assertion.clientName ? { client: assertion.clientName } : {}),
    };
    const sub = path.startsWith(ORG_MEMBER_PREFIX) ? path.slice(ORG_MEMBER_PREFIX.length) : "";
    const hits = matchRoutes(compiled, sub);
    if (!hits.length) return refuse(404, "not_found", "No such member route.");
    const hit = hits.find((candidate) => candidate.route.method === method);
    if (!hit) {
      const allowed = [...new Set(hits.map((candidate) => candidate.route.method))].join(", ");
      res.setHeader("allow", allowed);
      return refuse(405, "method_not_allowed", `Use ${allowed} here.`);
    }
    const route = (hit.route as unknown as { member: MemberRoute }).member;
    if (route.permission && !can(person.admin ? { admin: true, permissions: [] } : deps.permissions(person.principalId), route.permission)) {
      return refuse(403, "forbidden_permission", `Your profile does not include ${permissionLabel(route.permission, typeof assertion.locale === "string" ? assertion.locale : "en")}. Ask an admin to add it in Perspicax.`, { permission: route.permission });
    }
    let body: unknown = null;
    if (method === "POST" || method === "PATCH") {
      const max = sub === "agents/send_prompt" ? AGENT_SEND_BODY_BYTES : MAX_BODY_BYTES;
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > max) return refuse(413, "too_large", `The body is larger than ${max} bytes.`);
      body = await readSmallJson(req, max);
      if (body === undefined) return refuse(400, "bad_request", `The body is not JSON, or larger than ${max} bytes.`);
    }
    try {
      const aborted = new AbortController();
      res.on("close", () => aborted.abort());
      const reply = await route.handle({ person, params: hit.params, url, body, signal: aborted.signal });
      if ("stream" in reply) {
        await streamAnswer(res, reply);
        return true;
      }
      send(res, reply.status, reply.body);
    } catch (error) {
      console.error(`[org-member] ${method} ${sub}: ${error instanceof Error ? error.message : String(error)}`);
      refuse(500, "server_error", "The server could not do this; its log has the details.");
    }
    return true;
  };
  // 2026-10-20: a throw before the route's own try (the directory, the
  // permissions, the body read) fell through to the server's generic 500,
  // without the member API marker and without a log line: Perspicax then
  // reports "does not offer the member API yet" with nothing to go on.
  // Every answer under the prefix stays marked, and the throw is logged.
  return async (req, res, url) => {
    try {
      return await answer(req, res, url);
    } catch (error) {
      const route = url.pathname.slice(ORG_MEMBER_PREFIX.length).split("/")[0] ?? "";
      console.error(`[org-member] ${req.method ?? "GET"} ${route}: unhandled before the route: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) send(res, 500, { code: "server_error", message: "The server could not do this; its log has the details.", reason: "The server could not do this; its log has the details.", error: "The server could not do this; its log has the details." });
      else if (!res.writableEnded) res.end();
      return true;
    }
  };
}
