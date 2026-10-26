// The seam between the server and the coordinator that runs teammate work:
// the job runtime (server/runtime/, docs/runtime-contract.md), reached
// through RuntimeCoordinator. index.ts talks to this interface only; the
// room-handoff tree it replaced is gone, and its node shape survives here
// as the read model (HandoffView) the server's call sites were written
// against. The view goes once those sites read Assignment rows directly.
import { RuntimeCoordinator } from "./runtime-coordinator.ts";
import type { WorkOrigin } from "./peer-provenance.ts";
import type { LegacyThreadResolver } from "./runtime/import-legacy.ts";
import type { EnvelopeNames, Level, Limits, Mode, Origin, Outcome, Owner, Reply, Requester, StatusView, TurnEvidence } from "./runtime/types.ts";

export type { LegacyThreadResolver };

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
  /** work: do it; consult: answer, act on nothing; notify: one-way. */
  mode: Mode;
  /** resume: the requester is woken; poll: it reads its inbox; none: nothing comes back. */
  reply: Reply;
  outcome?: Outcome;
  outcomeDetail?: string;
  /** While parked: the exact question for the person. */
  question?: string;
  /** While parked on the person's cards (a root): the cards' message ids. */
  cards?: string[];
  /** While queued to continue in place (after a step cap, or a seat the
   * host holds it for): why, where the steps so far are, and how many
   * continuations so far including this one. */
  continuation?: { note: string; handoffPath?: string; count: number };
  /** A root that is one step of a room goal run: that run's id. */
  goalRunId?: string;
  /** The requester only passes it on: its reply goes to the person as is (Assignment.relay). */
  relay?: boolean;
}

/** A person's or a routine's own turn, as a root (one per request). */
export interface BeginTurnRequest {
  /** The turn's dispatch claim id: the root id, and what coordinate_bots keys its hand-offs on. */
  id: string;
  address: RoomAddress;
  /** The person's message or the routine's instructions. */
  brief: string;
  level: Level;
  opener?: HandoffOpener;
  origin?: WorkOrigin;
  /** A room goal run's step: the run's id (HandoffView.goalRunId). */
  goalRunId?: string;
  /** Who the tree acts for (a principal id, or the solo owner): harness-set,
   * never shown. Two trees join one request only for the same known person
   * (runtime Assignment.person). */
  person?: string;
}

/** How a host-run turn ended. `cap` continues the same node in place (a
 * step cap, a seat the turn could not get); `cards` parks it on the person. */
export interface HostTurnResult {
  ok: boolean;
  text: string;
  evidence?: TurnEvidence;
  cap?: { note: string; handoffPath?: string };
  cards?: { question: string; ids: string[] };
}

/** Who hands the work on, as the host knows it from the turn's capability:
 * a person's chat, a routine run, a webhook, an external runtime, a Cloud
 * guest. Written on a fresh root and copied down its tree. */
export interface HandoffOpener {
  requester: Requester;
  origin: Origin;
}

export interface HandoffOptions {
  /** "auto" (main 2026-10-19, consultation of the requester): a
   * consultation when the target is up the requester's own tree, else work.
   * A consultation may go back up its tree; work may not. */
  mode?: Mode | "auto";
  reply?: Reply;
  /** Where the host put the work: the teammate's standing thread, or a
   * (new) work thread, which is the default. The host picks the thread;
   * this is recorded as the row's destination kind. */
  thread?: "standing" | "new";
  /** A peer-review card allowed this before it was sent. */
  approvalGranted?: boolean;
  /** Run a finished teammate again with new work. */
  rework?: boolean;
  /** A room brief shown once per call. */
  requestBatchKey?: string;
  doneWhen?: string;
  /** The requester only passes it on: its reply goes to the person as is
   * (Assignment.relay). Only a direct thread relays: a room shows every reply. */
  relay?: boolean;
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
  /** Which execution of the node this is (runtime types.ts RunInput.turn). */
  turn: "first" | "resume" | "rerun" | "answered" | "continued";
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
   * engine settles. For a root (no parentId) this is the person's own
   * conversation continuing: person-visible, never internal. */
  run(node: HandoffView, resumed: boolean, signal: AbortSignal, composed: ComposedTurn): Promise<HostTurnResult>;
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
   * the work was asked for. `restored` is the restart's re-park, which shows
   * it again only if the first showing never happened (or no card for it is
   * still open). For a root parked on its own cards, the cards already show;
   * show nothing more. */
  park(node: HandoffView, question: string, restored?: boolean): void;
  /** Still parked (runtime inputRemindMs, then daily): the same question
   * again, in full, where the person reads. The work keeps waiting. */
  remind?(node: HandoffView, question: string, waitedMs: number): void;
  /** The permission level the target thread will actually run with, after
   * the host applied any delegated level, and its engine kind. Recorded on
   * the assignment so the envelope states the truth (invariant I6). For a
   * hand-off, `source` is the requesting node's address: a Chief's level
   * flows into a room with the hand-off (never onto the shared thread), so
   * the host resolves it from the source, as the room turn will. */
  levelOf(target: RoomAddress, source?: RoomAddress): { level: Level; driverKind?: string };
  /** The conversation is a Chief of Staff's. */
  chiefOf(address: RoomAddress): boolean;
  /** What the cut turn of this node already did outward (sent, posted,
   * pushed, paid), as short labels, read from the thread's activity since
   * the turn began. Asked once at startup for a running node a restart
   * cut, before any rerun: a turn that acted outward is not run again.
   * Optional; absent or empty means nothing known. */
  outward?(node: HandoffView): string[];
}

export interface Coordinator {
  node(id: string): HandoffView | undefined;
  has(id: string): boolean;
  all(): HandoffView[];
  /** all() without the ended nodes. Ended rows only grow, so a caller that
   * asks about live work (most do, on every broadcast) reads these. */
  active(): HandoffView[];
  children(id: string): HandoffView[];
  /** Hand work on from a running node: the requester's own root (its turn's
   * generation, begun by beginTurn) or a teammate's node (`parentId`). Every
   * turn has a root since PR 4 (direct) and PR 5 (rooms): a generation with
   * none is refused. `joined`: the request joined another tree's identical
   * live request for the same person (runtime Assignment.joins). Throws an Error whose message is the typed refusal the
   * caller shows the model. */
  enqueue(source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, text: string,
    options?: HandoffOptions): { node: HandoffView; duplicate: boolean; joined?: boolean };
  /** One assignment with its children and inbox (assignment_status). */
  status(id: string): StatusView | undefined;
  /** Undelivered inbox items for a polling requester, marked delivered. */
  poll(owner: Owner): { items: StatusView["inbox"]; assignments: HandoffView[] };
  /** Non-terminal work the conversation in this thread is waiting on, rooms included. */
  outstandingFor(threadId: string): HandoffView[];
  /** A person's or routine's own turn begins: its root, running. */
  beginTurn(req: BeginTurnRequest): HandoffView;
  /** That turn ended (completed, failed, parked on cards, or continuing in place). */
  endTurn(id: string, result: HostTurnResult): void;
  /** The person acted on a parked node's cards (a root or a child): the
   * node runs its next execution with the harness text. False when the
   * node is not parked. */
  answerNode(id: string, text: string): boolean;
  /** The same as answerNode; kept one release for the card paths that
   * were written against it. */
  answerRoot(id: string, text: string): boolean;
  /** The root parked on the person's cards in this thread, if any. */
  parkedDirect(threadId: string): HandoffView | undefined;
  /** Remove terminal trees that finished before `before`. */
  prune(before: number): number;
  sharedRequest(node: HandoffView): { id: string; botIds: string[] };
  cancelRoom(groupId: string, threadId?: string, reason?: string, status?: "failed" | "cancelled"): void;
  cancelDirect(threadId: string, reason?: string): void;
  activeDirect(threadId: string): boolean;
  /** Every thread activeDirect is true for, read once: a bot's whole thread
   * list asks this instead of one store read per thread (port de OpenMausBot #3126). */
  activeDirectThreads(): Set<string>;
  assignerOf(threadId: string): HandoffView | undefined;
  outstandingDirect(threadId: string): HandoffView[];
  liveEdges(): LiveHandoffEdge[];
  /** The person stopped this conversation (a bot's thread or a room thread):
   * its nodes stop being awaited (contract §2 "Stop awaiting"); returns the
   * teammates left mid-turn. Thread-keyed, so a room thread is the same call. */
  stopAwaitingDirect(threadId: string, reason?: string): HandoffView[];
  /** The turn running in this thread (a bot's or a room's) is one the next
   * start goes on with, so a shutdown's "cut" line would be false. */
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
  /** Names the threads the one-time delegation-ledger import cannot (a
   * target's standing thread, a source thread's bot); without it those
   * rows carry an empty thread id the host's validate refuses. */
  legacyThreads?: LegacyThreadResolver;
}

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  return new RuntimeCoordinator(options);
}
