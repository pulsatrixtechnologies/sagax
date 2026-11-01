// The seam between the server and the coordinator that runs teammate work:
// the job runtime (server/runtime/, docs/runtime-contract.md), reached
// through RuntimeCoordinator. index.ts talks to this interface only; the
// room-handoff tree it replaced is gone, and its node shape survives here
// as the read model (HandoffView) the server's call sites were written
// against. The view goes once those sites read Assignment rows directly.
import { RuntimeCoordinator } from "./runtime-coordinator.ts";
import type { WorkOrigin } from "./peer-provenance.ts";
import type { EnvelopeNames, Level, Limits } from "./runtime/types.ts";

export type HandoffStatus = "source" | "queued" | "running" | "waiting" | "resume" | "completed" | "failed" | "cancelled";

/** A coordinated turn as the server reads it: who runs it where, what it
 * was asked, how far it got. Projected from an Assignment row. */
export interface HandoffView {
  id: string;
  rootId: string;
  parentId?: string;
  groupId?: string;
  threadId: string;
  botId: string;
  key: string;
  text: string;
  createdAt: number;
  requestBatchKey?: string;
  status: HandoffStatus;
  result: string;
  reported: boolean;
  executions: number;
  startedAt?: number;
  lastProgressAt?: number;
  approvalGranted: boolean;
  kind: "work" | "assignment";
  /** On a root: where the tree's work started (peer-provenance.ts); absent is outside. */
  origin?: WorkOrigin;
  /** Turns of this node a restart cut and ran again in place. */
  restarts: number;
  /** Its next turn, or the one running now, follows a restart (runtime types.ts). */
  restart?: "rerun" | "cut" | "teammates";
  /** The requester only passes it on: its reply goes to the person as is (Assignment.relay). */
  relay?: boolean;
  /** A one-way notice (send_to_bot, an aside): nothing returns to the
   * requester; its result, failure and questions stay in its own thread. */
  oneWay?: boolean;
  /** A consultation: answer, act on nothing. */
  consult?: boolean;
  /** Admitted ahead of other queued work (send_to_bot priority now). */
  priority?: "now";
}

/** coordinator.handedOutOutcome: what a conversation's handed-out work came to. */
export interface HandedOutOutcome {
  root: { status: string; outcome?: string; detail: string; result: string };
  failed: Array<{ botId: string; outcome: string; detail: string }>;
  /** A root of it is still live (waiting, resuming, running). */
  pending: boolean;
}

export type RoomAddress = Pick<HandoffView, "groupId" | "threadId" | "botId">;

/** The turn text the runtime composed (one envelope, one report), run by
 * the host as it is. `note` is the same without the brief, for a room
 * whose transcript already carries the words; `restartNote` is what a
 * restart did to this turn ("" when nothing), already at the front of `text`. */
export interface ComposedTurn {
  text: string;
  note: string;
  restartNote: string;
  /** A resume a teammate's question made due while other work is still
   * out: the bots whose questions it passes on. */
  asked?: string[];
}

export interface LiveHandoffEdge {
  sourceBotId: string;
  targetBotId: string;
  state: "queued" | "running";
  threadId: string;
  groupId?: string;
}

/** What the server gives the coordinator. Every method may throw; the
 * runtime logs and reads a throw as "not now". */
export interface CoordinatorHost {
  /** Recheck addresses and route permission immediately before every dispatch. */
  validate(node: HandoffView, parent?: HandoffView): string | undefined;
  /** The assignee cannot take a turn now (slot-aware admission). */
  busy(node: HandoffView): boolean;
  /** Run one turn of the assignee with the composed text; resolves when the
   * engine settles. `stalled`: the host's stall watchdog stopped the turn
   * (a room turn too, during its setup), so it fails as `stalled`, not as a
   * provider error. */
  run(node: HandoffView, resumed: boolean, signal: AbortSignal, composed: ComposedTurn): Promise<{
    ok: boolean;
    text: string;
    stalled?: boolean;
    /** Harness-observed tools/commands for done_when checks (#1818). */
    evidence?: { toolCalls?: number; tools?: string[]; commands?: number; summary?: string };
  }>;
  /** A resume whose settled children all only relay (HandoffView.relay):
   * show their replies to the person as the answer, in the requester's
   * conversation, and return true; the requester then runs no turn. False
   * (or absent) runs the resume as usual. */
  relay?(node: HandoffView, replies: HandoffView[]): boolean;
  /** A settled child, to its requester; a root the runtime ended, alone. */
  report(child: HandoffView, parent?: HandoffView): void;
  changed(groupIds: ReadonlySet<string>, directThreadIds: ReadonlySet<string>): void;
  /** Display names for the envelope of a turn. */
  names(node: HandoffView, parent?: HandoffView): EnvelopeNames;
  /** A teammate ended its turn on a question for the person: show it where
   * the work was asked for. `restored` is the restart's re-park: it shows the
   * question again only if no card for it is still open. */
  park(node: HandoffView, question: string, restored?: boolean): void;
  /** Still parked (runtime inputRemindMs, then daily): the same question
   * again, in full, where the person reads. The work keeps waiting. */
  remind?(node: HandoffView, question: string, waitedMs: number): void;
  /** A parked turn has no place left to be answered (its conversation is
   * gone, or the card that asked was settled): the runtime closes it. */
  parkedGone?(node: HandoffView): boolean;
  /** The permission level the target thread will actually run with, after
   * the host applied any delegated level, and its engine kind. Recorded on
   * the assignment so the envelope states the truth (invariant I6). */
  levelOf(target: RoomAddress): { level: Level; driverKind?: string };
  /** The conversation is a Chief of Staff's. */
  chiefOf(address: RoomAddress): boolean;
}

export interface Coordinator {
  node(id: string): HandoffView | undefined;
  has(id: string): boolean;
  all(): HandoffView[];
  /** all() without the ended nodes. Ended rows only grow, so a caller that
   * asks about live work (most do, on every broadcast) reads these. */
  active(): HandoffView[];
  children(id: string): HandoffView[];
  /** Direct-thread children of work whose parent assignee is this bot+thread
   * (no room groupId). Indexed store read for the activity panel; identical
   * membership to scanning all() for those parents. */
  directChildrenOf(botId: string, threadId: string): HandoffView[];
  /** Throws an Error whose message is the typed refusal the caller shows the model. */
  enqueue(source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, key: string, text: string,
    approvalGranted?: boolean, rework?: boolean, sourceText?: string, requestBatchKey?: string, origin?: WorkOrigin,
    mode?: "work" | "consult" | "notify" | "auto", person?: string, relay?: boolean, doneWhen?: string, request?: string,
    extra?: { priority?: "now" }): { node: HandoffView; duplicate: boolean; joined?: boolean };
  sharedRequest(node: HandoffView): { id: string; botIds: string[] };
  /** The host's own turn ended; `stalled` when its stall watchdog stopped it. */
  sourceSettled(generation: string, ok: boolean, stalled?: boolean): void;
  /** A host turn (`generation`) takes again the request a failed turn
   * (`previous`) answered, as the same root: "continued" (end it with
   * sourceSettled(generation)), "answered" (that root's own resume already
   * answers the request: start no other turn), "resumed" (that root's resume
   * failed on the provider after every teammate reported: the runtime runs
   * the resume again with the same results, start no other turn), or "none"
   * (no root: start as usual). docs/runtime-contract.md, one request one
   * root. A null generation only reads what would happen, and changes nothing. */
  continueRoot(previous: string, generation: string | null): "continued" | "answered" | "resumed" | "none";
  /** The root a direct conversation's request opened (Assignment.request),
   * read from the store: it outlives a restart, which the host's in-memory
   * request owner does not. */
  requestRoot(threadId: string, request: string): string | undefined;
  /** The conversation's own request still waits on work it handed out: its
   * root waits or resumes, or its running turn handed out work since it
   * began. A routine run on that thread waits instead of completing. */
  awaitsTeammates(threadId: string): boolean;
  /** What the work this direct conversation handed out since `since` came
   * to (a pure store read, safe before the runtime is ready): the latest
   * root's ending and the teammates whose work did not complete. Null when
   * it handed out nothing. A routine run settles honestly from it. */
  handedOutOutcome(threadId: string, since: number): HandedOutOutcome | null;
  /** An external runtime's delegate_bot: a poll root of its own with one
   * child, the root ended at once (its caller polls). Throws a refusal.
   * `key`: the call's idempotency key; a retried call with the same key
   * answers the same child (no second dispatch). At most EXTERNAL_QUEUE_CAP
   * of its requests wait queued on one conversation. */
  enqueueExternal(source: RoomAddress, target: RoomAddress, text: string, approvalGranted?: boolean, mode?: "work" | "consult" | "notify",
    key?: string, extra?: { priority?: "now" }): { node: HandoffView; duplicate: boolean };
  /** A step cap's `Continue:` thread (turn-continuation.ts): the bot's own
   * stopped work, carried on in a new thread of the same bot as a one-way
   * notice on a poll root of its own (nothing is resumed; its result,
   * failure and questions stay in that thread). The level is the target
   * thread's; `origin` is where the stopped work started. Throws a refusal. */
  enqueueContinuation(source: RoomAddress, target: RoomAddress, text: string, origin?: WorkOrigin): HandoffView;
  /** A room goal's worker assignment (group-goal-run): work in the same room
   * on a poll root of the goal run, so Stop/restart/admission are the
   * runtime's. The harness polls the child; nothing resumes the lead. */
  enqueueGoalAssignment(source: RoomAddress, target: RoomAddress, text: string, runId: string): HandoffView;
  /** The person's review card allowed queued work the sender's peer review
   * held: it may start now. False when the work is not queued any more. */
  approve(id: string): boolean;
  cancelRoom(groupId: string, threadId?: string, reason?: string, status?: "failed" | "cancelled"): void;
  cancelDirect(threadId: string, reason?: string): void;
  activeDirect(threadId: string): boolean;
  /** Every thread activeDirect is true for, read once: a bot's whole thread
   * list asks this instead of one store read per thread (port de OpenMausBot #3126). */
  activeDirectThreads(): Set<string>;
  assignerOf(threadId: string): HandoffView | undefined;
  outstandingDirect(threadId: string): HandoffView[];
  liveEdges(): LiveHandoffEdge[];
  stopAwaitingDirect(threadId: string, reason?: string): HandoffView[];
  continuesAfterRestart(threadId: string): boolean;
  /** The note a request arrived under (its envelope without the brief), for
   * a replay of that request line; undefined when the row is gone. */
  note(id: string): string | undefined;
  tick(): void;
  close(): void;
  /** The host saw activity on a coordinated turn in this thread (an engine event). */
  progress(threadId: string): void;
  /** The person wrote in a thread whose assignment is parked on a question:
   * true when the assignment took the text as its answer and the host must
   * not start an ordinary turn. */
  answer(threadId: string, text: string): boolean;
  /** Whether this thread's assignment is parked on a question for the person. */
  awaitingAnswer(threadId: string): boolean;
  /** A thread turned confidential or a confidential thread was deleted
   * (docs/confidential-threads.md): its teammate work keeps no words of it. */
  forgetThread(threadId: string): { removed: number; scrubbed: number };
}

export interface CoordinatorOptions {
  dataDir: string;
  host: CoordinatorHost;
  now?: () => number;
  runtimeLimits?: Partial<Limits>;
  log?: (line: string) => void;
  /** The confidential threads, read once when the runtime opens: their
   * teammate work is forgotten (docs/confidential-threads.md). */
  confidentialThreads?: () => Iterable<string>;
}

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  return new RuntimeCoordinator(options);
}
