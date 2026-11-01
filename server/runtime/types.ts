// The job runtime's public types: one record for every hand-off between
// bots (chat coordination, routines, webhooks, goal runs, external
// runtimes, one-way notices, consultations), one lifecycle, one wake lane.
// docs/runtime-contract.md is the contract these types implement; the
// scenario suite in server/runtime/*.test.ts proves it.
//
// Everything here is plain data or a port interface. The runtime itself
// (runtime.ts) never touches the store (store.ts) of another module and
// never reads model text to decide anything: lineage, level and outcomes
// come from the harness's own records.
import type { ApprovalMode } from "../../shared/approval-mode.ts";

// ── identity and lineage ───────────────────────────────────────────────

/** Where the work ultimately started. Immutable down the whole tree. */
export type OriginKind = "person" | "routine" | "outside";
/** The concrete source behind an outside origin, for framing and audit. */
export type OriginSource = "chat" | "routine" | "webhook" | "relay" | "external_runtime" | "guest" | "peer" | "api";

export interface Origin {
  kind: OriginKind;
  source: OriginSource;
  /** The thread, routine or webhook the work came from, when known. */
  ref?: string;
  /** The person's own request, harness-quoted (at most 400 characters), when
   * kind is "person". Never model text. */
  quote?: string;
  /** Who the work is for when a bot acts for a named person (Cloud guest,
   * external interface with an identity). */
  onBehalfOf?: string;
}

export type RequesterKind = "person" | "bot_turn" | "routine_run" | "external_runtime";

export interface Requester {
  kind: RequesterKind;
  /** The bot whose turn or run asked (absent for a person or an external runtime). */
  botId?: string;
  /** The conversation the result returns to (absent for an external runtime). */
  threadId?: string;
  /** The routine run or the external runtime's own reference. */
  runId?: string;
  /** The requester is a Chief of Staff conversation: its level may flow down. */
  chief?: boolean;
}

export type DestinationKind = "work_thread" | "standing_thread" | "room_thread";

export interface Assignee {
  botId: string;
  destination: { kind: DestinationKind; threadId: string; groupId?: string };
}

// ── the record ─────────────────────────────────────────────────────────

/** work: do it with your own tools. consult: answer from what you know, act
 * on nothing. notify: one-way, nothing comes back. */
export type Mode = "work" | "consult" | "notify";
/** resume: the requester is woken with the result. poll: the result waits
 * in the inbox for status(). none: no inbox entry (notify). */
export type Reply = "resume" | "poll" | "none";

export type Status =
  | "queued"          // accepted, not yet admitted
  | "running"         // a turn of the assignee is executing it
  | "needs_input"     // parked on the person (a card or a NEEDS INPUT line)
  | "waiting"         // its turn ended after handing out work; waits on children
  | "resume"          // every child settled, or one it waits on parked a new question; owes its own follow-up turn
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL: readonly Status[] = ["completed", "failed", "cancelled"];

/** Why it ended the way it did, typed so a requester can branch on it. */
export type Outcome =
  | "done"
  | "needs_input"      // ended with a question the person has not answered
  | "cap_continued"    // a step cap was hit and the work continued in place
  | "stalled"
  | "interrupted"      // a restart, reload or sleep cut it and it was not resumed again
  | "budget"
  | "provider_error"
  | "denied"           // a permission the level did not cover was refused
  | "expired"          // a wait on the person ran out: not run, not refused
  | "stopped"          // the person stopped it
  | "refused"          // validation refused it at dispatch
  | "duplicate"
  /** Peer turn ended without meeting doneWhen / without a work deliverable (#1818). */
  | "incomplete";

export type Level = ApprovalMode;
export type LevelSource = "own" | "chief" | "engine_cap";

export interface Assignment {
  id: string;
  rootId: string;
  parentId?: string;
  /** Edges from the root: a root is 0. */
  depth: number;
  origin: Origin;
  requester: Requester;
  assignee: Assignee;
  mode: Mode;
  reply: Reply;
  /** The request, harness-stored (at most 12 000 characters). */
  brief: string;
  /** The requester's own completion criterion, if it gave one. */
  doneWhen?: string;
  status: Status;
  outcome?: Outcome;
  outcomeDetail?: string;
  level: Level;
  levelSource: LevelSource;
  /** Turns started for it, including resumes and reruns. */
  executions: number;
  /** Turns of it a restart cut and ran again in place. */
  restarts: number;
  /** Set while its next turn follows a restart: "rerun" its own cut turn runs
   * again; "cut" its turn was cut after handing out work; "teammates" only
   * work it waits on was cut. Cleared when that turn settles. */
  restart?: "rerun" | "cut" | "teammates";
  createdAt: number;
  startedAt?: number;
  /** Last durable progress: a dispatch, a settlement, a child's settlement. */
  lastActivityAt: number;
  finishedAt?: number;
  /** What the assignee last said or how it ended (at most 12 000 characters). */
  result: string;
  /** What the harness observed of the turn (commands, files, tool counts),
   * attached to the report as evidence. Never model text. */
  evidence?: TurnEvidence;
  /** The report reached the requester's conversation. */
  reportedAt?: number;
  /** The same brief to the same assignee under one parent is one request;
   * a repeat lands on it unless rework is set. */
  rework: boolean;
  /** Another tree's live request this one joined (same brief, same
   * assignee, same person, sent at the same time): it runs no turn of its
   * own and settles with that request's result. */
  joins?: string;
  /** Who the tree acts for (a principal id, or the solo owner), harness-set
   * and never shown: two trees join only when it is the same, known person. */
  person?: string;
  /** On a root only: the request it answers (the person's message id, or the
   * routine run), harness-set. One request has one root (invariant I11): a
   * turn that takes the same request again continues that root. */
  request?: string;
  /** send_to_bot priority now: admitted ahead of other queued work, and a
   * one-way notice starts without waiting for its sender's turn to end. */
  priority?: "now";
  /** While parked: the exact question for the person. */
  question?: string;
  /** The person's answer, harness-quoted, carried into the next turn. */
  answer?: string;
  /** While a turn runs: the awaited children whose open questions its input
   * carries. A restart that cuts that turn reruns it with them once more; no
   * other turn carries them again. */
  carrying?: string[];
  /** On a root only: the budget window since its last durable progress. */
  budgets?: { since: number; requests: number; executions: number; wakes: number };
  /** A peer-review card allowed this before it was sent. */
  approved?: boolean;
  /** A room brief shown once per call: every recipient of that call shares it. */
  batchKey?: string;
  /** The requester only passes this request on: its reply is the answer the
   * person sees, and a resume carrying only such replies runs no turn. */
  relay?: boolean;
  /** Schema version of the row. */
  version: 1;
}

export interface TurnEvidence {
  commands?: number;
  filesChanged?: string[];
  toolCalls?: number;
  /** Tool identities the harness observed this turn (for done_when tool:…). */
  tools?: string[];
  summary?: string;
}

export type EventKind =
  | "enqueued" | "refused" | "admitted" | "started" | "progress" | "parked" | "answered"
  | "waiting" | "resume_due" | "settled" | "reported" | "woken" | "cancelled"
  | "restart_reconciled" | "budget" | "stalled"
  /** The host runs the root's request again itself, as the same root (a
   * provider limit moved it to another engine): back to running, no new
   * "started" anchor, so the work it handed out before is still awaited. */
  | "continued"
  /** A root whose resume failed on the provider (its teammates had all
   * reported) is due to resume again with the same results, instead of the
   * host sending the request again: its earlier outcome is withdrawn. */
  | "reopened"
  /** The person's review card allowed queued work it held (the sender's
   * peer comms need review): it may now start. No status change. */
  | "approved";

export interface AssignmentEvent {
  id: number;
  assignmentId: string;
  at: number;
  kind: EventKind;
  detail?: string;
}

export type InboxKind = "settled" | "needs_input" | "stalled";

/** The one wake lane: a requester learns about its work only through this. */
export interface InboxItem {
  id: string;
  ownerBotId?: string;
  ownerThreadId?: string;
  /** External runtimes poll by run id instead of a thread. */
  ownerRunId?: string;
  assignmentId: string;
  kind: InboxKind;
  createdAt: number;
  deliveredAt?: number;
}

// ── requests into the runtime ──────────────────────────────────────────

export interface EnqueueRequest {
  /** The requesting conversation's own assignment (a root or a child that is
   * running); absent when a person, a routine or an external runtime opens
   * a new root. */
  parentId?: string;
  origin: Origin;
  requester: Requester;
  assignee: Assignee;
  mode?: Mode;
  reply?: Reply;
  brief: string;
  doneWhen?: string;
  rework?: boolean;
  /** The requester's own level and, for a Chief lineage, the Chief
   * conversation's level, as the harness knows them. */
  levels: { own: Level; chief?: Level };
  /** The assignee's engine, for the level cap (shared/approval-mode.ts). */
  driverKind?: string;
  /** A peer-review card allowed this before it was sent. */
  approved?: boolean;
  /** A room brief shown once per call. */
  batchKey?: string;
  /** Assignment.relay. */
  relay?: boolean;
  /** Who a new root acts for (Assignment.person); a child inherits its root's. */
  person?: string;
  /** Assignment.priority. */
  priority?: "now";
  /** A bot carries its own stopped work on in another of its threads (a
   * step cap's `Continue:` thread, turn-continuation.ts): a one-way notice to
   * itself, so not work sent back up its tree. Only with mode notify. */
  continuation?: boolean;
}

export type EnqueueResult =
  | { ok: true; assignment: Assignment; duplicate: boolean }
  | { ok: false; reason: string; outcome: "refused" | "budget" | "duplicate" };

// ── ports the host implements ──────────────────────────────────────────

export interface RunInput {
  /** Which turn of the node this is: its first; a resume that returns its
   * settled children's results (and the open questions of children it still
   * waits on); its own turn run again after a restart cut
   * it; or the turn after the person answered its question. */
  turn: "first" | "resume" | "rerun" | "answered";
  /** Not the node's first turn (any `turn` but "first"). */
  resumed: boolean;
  /** What the restart did, for the first line of the turn ("" when nothing). */
  restartNote: string;
  /** The harness-written envelope (envelope.ts) that opens the turn. */
  envelope: string;
  /** The person's answer to the question this assignment was parked on. */
  answer?: string;
  /** The settled children whose results this (resume) turn returns. */
  settled?: Assignment[];
  /** The awaited children parked on a question this (resume) turn passes on:
   * a question not delivered yet, or, in the rerun of a turn a restart cut,
   * the questions that turn carried. */
  asked?: Assignment[];
  level: Level;
  mode: Mode;
}

export type RunResult =
  | { kind: "completed"; text: string; evidence?: TurnEvidence }
  | { kind: "failed"; outcome: Exclude<Outcome, "done" | "needs_input">; text: string; evidence?: TurnEvidence }
  | { kind: "needs_input"; question: string; evidence?: TurnEvidence };

export interface Owner {
  botId?: string;
  threadId?: string;
  runId?: string;
}

/** Display names the envelope needs. The host owns names; the runtime
 * owns ids. */
export interface EnvelopeNames {
  requester: string;
  assignee: string;
  /** The person the work is for, when the origin is a person. */
  person?: string;
  /** The requester conversation's title, when there is one. */
  thread?: string;
}

/** What the runtime needs from the server. Every method is synchronous and
 * cheap unless it returns a promise. None may throw into the runtime: a
 * throw is logged and treated as "not now". */
export interface TurnRunner {
  /** Recheck addresses and routes right before every dispatch. A string
   * refuses the assignment with that reason. */
  validate(a: Assignment, parent?: Assignment): string | undefined;
  /** Whether the assignee can take a turn now. A string says why not, once,
   * where the work was sent; false waits silently. */
  canStart(a: Assignment): true | false | string;
  /** Run one turn of the assignee. Resolves when the engine settles. The
   * signal aborts the turn (a cancel or a stop). */
  run(a: Assignment, input: RunInput, signal: AbortSignal): Promise<RunResult>;
  /** The assignment is parked on the person; show what it needs.
   * `restored` is the restart's re-park: show it again only if it never got
   * shown (or its card is gone). */
  park(a: Assignment, question: string, restored?: boolean): void;
  /** Still parked after inputRemindMs (then daily): remind the person, the
   * same question in full. Optional: a host without it reminds nobody. */
  remind?(a: Assignment, question: string, waitedMs: number): void;
  /** Whether a parked assignment has no place left to be answered: its
   * conversation is gone, or the card that asked was settled without the
   * answer reaching the runtime. Such a park is closed as expired, at the
   * restart and on every tick. Optional: absent, nothing is closed early. */
  parkedGone?(a: Assignment): boolean;
  /** A settled child, into its requester's conversation (a chip, a line), or
   * a root that ended alone, into its own. Called once per settlement. */
  report(a: Assignment, parent?: Assignment): void;
  /** Rows changed: refresh what shows them. */
  changed(assignments: readonly Assignment[]): void;
  /** Display names for the envelope of a turn (ids are the fallback). */
  names(a: Assignment, parent?: Assignment): EnvelopeNames;
}

export interface Clock {
  /** Wall-clock milliseconds, for timestamps. */
  now(): number;
  /** Monotonic milliseconds that do not advance while the host sleeps, for
   * stall windows. */
  monotonic(): number;
}

export interface Limits {
  /** Edges from the root a child may sit at. */
  depth: number;
  /** Per root, counted since the root's last progress. */
  requests: number;
  executions: number;
  wakes: number;
  /** A queued assignment that never started within this is expired. */
  queueMs: number;
  /** No durable progress on a root for this long fails the tree. */
  stallMs: number;
  /** A turn with no activity for this long is stalled (the host says what
   * counts as activity by touching progress()). */
  turnStallMs: number;
  /** How long a parked assignment waits on the person before it expires:
   * not run, not refused. 2026-10-19 (bot quality, cause B): a week. A
   * question is never cancelled because the person was away for an hour. */
  inputWaitMs: number;
  /** A delegation (a child outside a room) parked on the person this long,
   * on the wall clock (a restart does not start it over), is closed as
   * expired: 2026-10-29, a bot handed work to teammates that each waited on
   * a GO in their own conversation for hours, and every one stayed listed
   * as waiting on the person under each new turn of the requester. A root's
   * own question and a room's keep inputWaitMs. */
  delegationInputWaitMs: number;
  /** A parked question is shown again (runner.remind) after this long, then
   * every day, until it is answered or expires. */
  inputRemindMs: number;
  /** A queued assignment whose doneWhen requires a person decision card
   * (ask_choice / native equivalents) expires after this, so a busy hub
   * cannot silently hold a GO forever (#1818). Default 15 minutes. */
  decisionCardQueueMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  depth: 4,
  requests: 24,
  executions: 48,
  wakes: 48,
  queueMs: 24 * 60 * 60_000,
  stallMs: 4 * 60 * 60_000,
  turnStallMs: 20 * 60_000,
  inputWaitMs: 7 * 24 * 60 * 60_000,
  delegationInputWaitMs: 4 * 60 * 60_000,
  inputRemindMs: 30 * 60_000,
  decisionCardQueueMs: 15 * 60_000,
};

/** After the first reminder, one a day. */
export const INPUT_REMIND_REPEAT_MS = 24 * 60 * 60_000;

// ── read models ────────────────────────────────────────────────────────

export interface LiveEdge {
  sourceBotId: string;
  targetBotId: string;
  state: "queued" | "running" | "needs_input" | "waiting";
  threadId: string;
  groupId?: string;
}

export interface StatusView {
  assignment: Assignment;
  children: Assignment[];
  inbox: InboxItem[];
}

export const terminal = (status: Status): boolean => TERMINAL.includes(status);
