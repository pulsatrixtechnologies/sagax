// The job runtime (docs/runtime-contract.md): one record, one lifecycle and
// one wake lane for every piece of work one bot hands to another. The store
// is the only state; this class holds nothing a restart would need, just the
// handles of the turns it started in this process and the monotonic anchors
// of their activity windows. The host drives it: tick() is the only place
// anything is admitted or dispatched, and no timer lives here.
//
// Every state change is written before the runtime acts on it, and the
// runtime never throws into a turn: a host method that throws is logged and
// read as "not now"; a request that cannot be honoured gets a typed refusal.
import { randomUUID } from "node:crypto";

import { requiresDecisionCard, unmetCompletion } from "./done-when.ts";
import { composeEnvelope } from "./envelope.ts";
import { assignmentLevel } from "./level.ts";
import type { RuntimeStore } from "./store.ts";
import { asking, awaited, childrenSince, clip, CUT_TWICE, duration, isTerminal, ownsConversation, path, restartNote, wakeOwner } from "./tree.ts";
import { DEFAULT_LIMITS, INPUT_REMIND_REPEAT_MS, type Assignment, type Assignee, type Clock, type EnqueueRequest, type EnqueueResult, type EnvelopeNames,
  type EventKind, type InboxItem, type InboxKind, type Level, type Limits, type LiveEdge, type Origin, type Outcome, type Owner,
  type Reply, type Requester, type RunInput, type RunResult, type StatusView, type TurnEvidence, type TurnRunner } from "./types.ts";

export interface RuntimeOptions {
  /** Default: Date.now and performance.now. */
  clock?: Clock;
  /** Merged over DEFAULT_LIMITS. */
  limits?: Partial<Limits>;
  /** Default: ./level.ts. */
  level?: typeof assignmentLevel;
  /** Default: console.error("runtime:", line). */
  log?: (line: string) => void;
}

export interface BeginRequest {
  /** The root's id, when the host already names the requesting turn (its
   * generation); default a fresh uuid. */
  id?: string;
  origin: Origin;
  /** person | routine_run | external_runtime */
  requester: Requester;
  /** The requesting conversation's own bot and thread. */
  assignee: Assignee;
  /** The person's message or the routine's instructions (at most 12 000 characters). */
  brief: string;
  /** The conversation's own level. */
  level: Level;
  /** Default "resume"; external runtimes use "poll". */
  reply?: Reply;
  /** Who the tree acts for (Assignment.person). */
  person?: string;
  /** The request the root answers (Assignment.request). */
  request?: string;
}

const BRIEF_MAX = 12_000;
/** Two trees that send the same brief to the same teammate within this
 * window send one request: the later one joins the live one. */
const JOIN_WINDOW_MS = 15 * 60_000;
/** A joined request waits this long at most, then runs on its own: no wait
 * between trees can last (or loop) forever. */
const JOIN_WAIT_MS = 30 * 60_000;
const RESULT_MAX = 12_000;
const DETAIL_MAX = 400;

const defaultClock: Clock = { now: () => Date.now(), monotonic: () => performance.now() };

/** A turn this process started: its abort handle and the monotonic moment
 * of its last visible activity (dispatch, or the host's progress()).
 * `interruption`: a resume for a teammate's question while other work is
 * still out; the node's restart note waits for its real resume. `carried`:
 * the settled children whose results the node has seen by the end of this
 * turn; one outside it settled where no turn of the node read it, so the
 * node owes another resume. */
interface LiveTurn { controller: AbortController; rootId: string; activeAt: number; interruption: boolean; carried: ReadonlySet<string> }

type TerminalStatus = "completed" | "failed" | "cancelled";

/** How many times one requester may rework the same brief for the same
 * teammate in the same place, after its first run. */
export const MAX_REWORKS = 3;

/** How many pieces of work one requesting turn may hand out over its whole
 * life (2026-11-01). The window budgets renew on every settlement, so a
 * requester that re-plans after each report with a new brief never ran out
 * of them: this is the bound that does not renew. */
export const MAX_REQUESTS_PER_REQUESTER = 64;

export class Runtime {
  readonly limits: Limits;
  private readonly store: RuntimeStore;
  private readonly runner: TurnRunner;
  private readonly clock: Clock;
  private readonly level: typeof assignmentLevel;
  private readonly log: (line: string) => void;
  /** Clocks do not run while the server is down: every window of a tree
   * that outlived a restart starts again here. Counts carry on. */
  private readonly bootAt: number;
  private opened = false;
  private closing = false;
  private ticking = false;
  private readonly turns = new Map<string, LiveTurn>();
  /** Reminders already sent per parked assignment (in memory: a restart
   * starts the wait window over anyway, see since()). */
  private readonly reminded = new Map<string, number>();
  /** Wall-clock activity per root seen through progress(): a turn that keeps
   * reporting tool calls keeps its tree out of the stall window without a
   * row write per call. */
  private readonly rootActivity = new Map<string, number>();
  /** Nodes whose canStart reason was recorded once; cleared on dispatch. */
  private readonly admissionNoted = new Set<string>();
  /** Terminal rows whose report() threw or was cut by a crash; retried each tick. */
  private readonly reportDue = new Set<string>();
  /** Tick-local change notices: one changed() at the end, not one per row. */
  private batch: Map<string, Assignment> | null = null;
  /** Whether the last safe() call threw (its result is then undefined). */
  private lastThrew = false;

  constructor(store: RuntimeStore, runner: TurnRunner, options: RuntimeOptions = {}) {
    this.store = store;
    this.runner = runner;
    this.clock = options.clock ?? defaultClock;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.level = options.level ?? assignmentLevel;
    this.log = options.log ?? (line => console.error("runtime:", line));
    this.bootAt = this.clock.now();
  }

  // ── host entry points ────────────────────────────────────────────────

  /** Restart reconciliation (contract §5) and re-park of needs_input,
   * using stored data only. Idempotent; runs before the first tick. */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    const now = this.clock.now();
    // Deepest first: a child's fate marks its parent ("teammates") before
    // the parent's own turn is judged, and the parent is read fresh then.
    const live = this.store.all({ nonTerminal: true }).sort((a, b) => b.depth - a.depth);
    this.withBatch(() => {
      for (const snapshot of live) {
        const n = this.store.get(snapshot.id);
        if (!n || isTerminal(n)) continue;
        if (n.status === "needs_input") {
          // A stale delegation is closed, not parked again (its card would
          // come back after every restart).
          const stale = this.parkedStale(n, now);
          if (stale) {
            this.store.update(n, { kind: "restart_reconciled", at: now, detail: `needs_input: closed (${stale})` });
            this.cancelTree(n, stale, "failed", "expired");
            continue;
          }
          this.store.update(n, { kind: "restart_reconciled", at: now, detail: "needs_input: parked again" });
          this.touch(n);
          this.safe("park", () => this.runner.park(n, n.question ?? "", true));
          continue;
        }
        if (n.status !== "running") continue;
        if (childrenSince(this.store, n).length > 0) {
          // It handed out work: nothing of it runs again; its resume says so.
          n.status = "waiting"; n.restart = "cut"; n.lastActivityAt = now;
          this.store.update(n, { kind: "restart_reconciled", at: now, detail: "waiting: cut after handing out work" });
          this.touch(n);
        } else if (n.restart === "rerun") {
          this.store.update(n, { kind: "restart_reconciled", at: now, detail: "failed: cut twice" });
          this.settle(n, "failed", "interrupted", CUT_TWICE);
        } else {
          n.restart = "rerun"; n.restarts += 1; n.lastActivityAt = now;
          n.status = this.store.children(n.id).length ? "resume" : "queued";
          this.store.update(n, { kind: "restart_reconciled", at: now, detail: `${n.status}: rerun ${n.restarts}` });
          this.touch(n);
        }
        const parent = n.parentId ? this.store.get(n.parentId) : undefined;
        if (parent && !isTerminal(parent) && !parent.restart) {
          parent.restart = "teammates";
          this.store.update(parent, { kind: "restart_reconciled", at: now, detail: `${parent.status}: teammates cut` });
          this.touch(parent);
        }
      }
      // A crash between a settlement and its report leaves the report owed.
      for (const n of this.store.all()) if (isTerminal(n) && n.reportedAt === undefined) this.reportDue.add(n.id);
    });
  }

  /** A requesting turn starts: the root, already running (the host runs
   * that turn itself and ends it with end()). */
  begin(req: BeginRequest): Assignment {
    const now = this.clock.now();
    const id = req.id ?? randomUUID();
    const root: Assignment = {
      id, rootId: id, depth: 0, origin: req.origin, requester: req.requester, assignee: req.assignee,
      mode: "work", reply: req.reply ?? "resume", brief: clip(req.brief, BRIEF_MAX), status: "running",
      level: req.level, levelSource: "own", executions: 1, restarts: 0, createdAt: now, startedAt: now, lastActivityAt: now,
      result: "", rework: false, budgets: { since: now, requests: 0, executions: 1, wakes: 0 }, version: 1,
      ...(req.person ? { person: req.person } : {}), ...(req.request ? { request: req.request } : {}),
    };
    this.store.transaction(() => {
      this.store.insert(root, { kind: "enqueued", at: now, detail: "queued: root" });
      this.store.update(root, { kind: "started", at: now, detail: `running: turn 1 (host), level ${root.level}` });
    });
    this.touch(root);
    return root;
  }

  /** The host takes a root's request again in a turn of its own: the turn
   * that began it failed (a provider limit) and the same request continues,
   * on another engine, as this same root, never as a second root. The work
   * it handed out stays awaited: no "started" anchor moves, so a child that
   * settled meanwhile is still owed to its resume. "continued": the root runs
   * again and the host ends it with end(); "answered": its own resume already
   * ran or runs, so the request needs no other turn; "none": no root to
   * continue (it handed out nothing), the host starts its turn as usual;
   * "resumed": the root's own resume failed (the same limit again) after
   * every teammate had reported, so the runtime runs that resume again with
   * the same results, and the host sends nothing (sending the request again
   * would dispatch its work a second time). */
  continueHost(rootId: string, detail = "the host continues the request", peek = false): "continued" | "answered" | "resumed" | "none" {
    const n = this.store.get(rootId);
    if (!n || n.parentId) return "none";
    // Its own resume runs, or answered: the request has its answer.
    if (this.turns.has(n.id) || (n.status === "completed" && n.executions > 1)) return "answered";
    // A resume that failed on the provider answered nothing, yet its
    // teammates' results are in: the resume runs again (a dispatched resume
    // shows every settled result of the node, not only the unread ones).
    if (n.status === "failed" && (n.outcome === "provider_error" || n.outcome === "stalled") && n.executions > 1 &&
        n.reply === "resume" && this.resumeReason(n) === "settled") {
      if (this.closing) return "none";
      if (peek) return "resumed";
      const now = this.clock.now();
      n.status = "resume"; n.lastActivityAt = now;
      delete n.outcome; delete n.outcomeDetail; delete n.finishedAt; delete n.reportedAt;
      this.withBatch(() => {
        this.store.update(n, { kind: "reopened", at: now, detail: clip(`resume: ${detail}, its resume failed`, DETAIL_MAX) });
        this.touch(n);
      });
      return "resumed";
    }
    if (n.status === "running" || isTerminal(n)) return "none";
    if (n.status !== "waiting" && n.status !== "resume") return "none";
    if (this.closing) return "none";
    if (peek) return "continued";
    const now = this.clock.now();
    n.status = "running"; n.lastActivityAt = now;
    // The same request's turn again, by the host: not a runtime execution
    // (executions counts those), but it counts against the tree's budget.
    if (n.budgets) n.budgets.executions += 1;
    this.withBatch(() => {
      this.store.update(n, { kind: "continued", at: now, detail: clip(`running: ${detail}`, DETAIL_MAX) });
      this.touch(n);
    });
    return "continued";
  }

  /** That requesting turn ended. */
  end(rootId: string, result: { ok: boolean; text: string; evidence?: TurnEvidence; stalled?: boolean }): void {
    const n = this.store.get(rootId);
    if (!n || n.status !== "running") { this.log(`end(${rootId}): not a running root`); return; }
    // A turn the teardown fails is left for the next open() to find cut.
    if (!result.ok && this.closing) return;
    const outcome: RunResult = result.ok
      ? { kind: "completed", text: result.text, ...(result.evidence ? { evidence: result.evidence } : {}) }
      // The host's stall watchdog stopped it: its requester is woken as stalled.
      : { kind: "failed", outcome: result.stalled ? "stalled" : "provider_error", text: result.text, ...(result.evidence ? { evidence: result.evidence } : {}) };
    this.withBatch(() => this.finishTurn(n, outcome));
  }

  /** Hand work to a teammate from a running node. Never throws. */
  enqueue(req: EnqueueRequest): EnqueueResult {
    try {
      return this.withBatch(() => this.admit(req));
    } catch (error) {
      this.log(`enqueue failed: ${String(error)}`);
      return { ok: false, reason: `The request could not be recorded: ${String(error)}`, outcome: "refused" };
    }
  }

  private admit(req: EnqueueRequest): EnqueueResult {
    const refuse = (reason: string, outcome: "refused" | "budget" = "refused"): EnqueueResult => ({ ok: false, reason, outcome });
    const now = this.clock.now();
    const parent = req.parentId ? this.store.get(req.parentId) : undefined;
    if (req.parentId && !parent) return refuse("The requesting turn no longer exists");
    if (parent && parent.status !== "running") return refuse("The requesting turn is not running");
    const brief = clip(req.brief, BRIEF_MAX);
    const lineage = parent ? path(this.store, parent) : [];
    const root = lineage[0];
    const target = req.assignee;
    const mode = req.mode ?? "work";
    // Work cannot go back up its own tree: results return by themselves. A
    // consultation can: the teammate asks the bot that sent it the work a
    // question and gets the answer, nothing is handed back.
    // A bot's own continuation is a notice to itself, never work handed back.
    const ownContinuation = req.continuation === true && mode === "notify";
    if (mode !== "consult" && !ownContinuation && lineage.some(a => a.assignee.botId === target.botId &&
      (!a.assignee.destination.groupId || !target.destination.groupId || a.assignee.destination.groupId === target.destination.groupId))) {
      return refuse("Cannot assign work back to an ancestor; results return automatically");
    }
    if (parent) {
      // The same brief to the same teammate in the same place under one
      // parent is one request; only rework runs a finished one again.
      const same = this.store.children(parent.id).filter(c => c.brief === brief && c.assignee.botId === target.botId &&
        c.assignee.destination.threadId === target.destination.threadId && c.assignee.destination.groupId === target.destination.groupId);
      const existing = same.at(-1);
      if (existing && !(req.rework && isTerminal(existing))) return { ok: true, assignment: existing, duplicate: true };
      // Every settlement renews the budgets, so only this bounds a requester
      // that reworks the same brief after each report (2026-11-01).
      if (same.length > MAX_REWORKS) {
        return refuse(`Rework limit reached: this brief already ran ${same.length} times for this teammate. Change the brief, or report what is still missing to the person`, "budget");
      }
      // Nor do they bound one that re-plans with a new brief after each
      // report: count everything this requester ever handed out.
      const handedOut = this.store.children(parent.id).length;
      if (handedOut >= MAX_REQUESTS_PER_REQUESTER) {
        this.store.update(parent, { kind: "budget", at: now, detail: `requests: ${handedOut} handed out by this turn` });
        return refuse(`Work limit reached: this request already handed out ${handedOut} pieces of work without finishing. Stop handing out more: report to the person what is done, what is still missing and why`, "budget");
      }
      if (parent.depth + 1 > this.limits.depth) return refuse(`Assignment depth limit reached (${this.limits.depth})`);
      if (root?.budgets && root.budgets.requests + 1 > this.limits.requests) {
        this.store.update(root, { kind: "budget", at: now, detail: `requests: ${root.budgets.requests} since last progress` });
        return refuse(`Request budget exhausted: ${this.limits.requests} requests without progress`, "budget");
      }
    }
    const chiefLineage = Boolean(req.requester.chief) || lineage.some(a => a.requester.chief === true);
    const { level, source } = this.level({ own: req.levels.own, chief: req.levels.chief, origin: (root ?? req).origin.kind, chiefLineage,
      driverKind: req.driverKind });
    const node: Assignment = {
      id: randomUUID(), rootId: parent ? parent.rootId : "", ...(parent ? { parentId: parent.id } : {}), depth: parent ? parent.depth + 1 : 0,
      // The origin is written once at the root and copied down.
      origin: root ? root.origin : req.origin, requester: req.requester, assignee: target, mode,
      reply: req.reply ?? (mode === "notify" ? "none" : "resume"), brief, ...(req.doneWhen ? { doneWhen: req.doneWhen } : {}),
      status: "queued", level, levelSource: source, executions: 0, restarts: 0, createdAt: now, lastActivityAt: now, result: "",
      rework: Boolean(req.rework), ...(req.approved !== undefined ? { approved: req.approved } : {}),
      ...(req.batchKey !== undefined ? { batchKey: req.batchKey } : {}), ...(req.relay ? { relay: true } : {}),
      ...(req.priority ? { priority: req.priority } : {}), version: 1,
    };
    const person = root ? root.person : req.person;
    if (person) node.person = person;
    if (!parent) { node.rootId = node.id; node.budgets = { since: now, requests: 0, executions: 0, wakes: 0 }; }
    const problem = this.safe("validate", () => this.runner.validate(node, parent));
    if (this.lastThrew) return refuse("The host could not validate the request now");
    if (problem) return refuse(problem);
    const leader = parent && !req.rework ? this.joinable(node, parent) : undefined;
    if (leader) node.joins = leader.id;
    this.store.transaction(() => {
      this.store.insert(node, { kind: "enqueued", at: now, detail: leader ? `queued: joined ${leader.id}` : "queued" });
      if (root?.budgets) { root.budgets.requests += 1; this.store.update(root); }
    });
    this.touch(node, ...root ? [root] : []);
    return { ok: true, assignment: node, duplicate: false };
  }

  /** The live request of another tree this one can join: same mode, brief,
   * teammate and room, for the same person, at the same level, sent within
   * JOIN_WINDOW_MS, itself running its own turn. Never one in this tree. */
  private joinable(node: Assignment, parent: Assignment): Assignment | undefined {
    const now = this.clock.now();
    if (!node.person) return undefined;
    return this.store.all({ nonTerminal: true }).find(c =>
      c.id !== node.id && c.joins === undefined && c.parentId !== undefined && c.rootId !== parent.rootId &&
      c.mode === node.mode && c.brief === node.brief && c.assignee.botId === node.assignee.botId &&
      c.assignee.destination.groupId === node.assignee.destination.groupId && c.level === node.level &&
      c.person === node.person && now - c.createdAt <= JOIN_WINDOW_MS);
  }

  /** A joined request settles with its leader's answer once that one
   * completed. A leader that is gone, ended any other way (stopped, failed,
   * expired: its own tree's fate), or still out after JOIN_WAIT_MS leaves it
   * to run on its own. True while it still waits or once it settled. */
  private followLeader(n: Assignment): boolean {
    if (n.joins === undefined) return false;
    const leader = this.store.get(n.joins);
    if (leader && !isTerminal(leader) && this.clock.now() - n.createdAt <= JOIN_WAIT_MS) return true;
    if (leader?.status === "completed") {
      n.result = leader.result;
      if (leader.evidence) n.evidence = leader.evidence; else delete n.evidence;
      this.settle(n, "completed", leader.outcome ?? "done", leader.outcomeDetail);
      return true;
    }
    delete n.joins;
    this.store.update(n, { kind: "admitted", at: this.clock.now(), detail: "the joined request did not answer: runs on its own" });
    this.touch(n);
    return false;
  }

  /** Whether a joined request still waits on a live leader (its windows are the leader's). */
  private waitsOnLeader(n: Assignment): boolean {
    if (n.joins === undefined || isTerminal(n)) return false;
    const leader = this.store.get(n.joins);
    return Boolean(leader && !isTerminal(leader) && this.clock.now() - n.createdAt <= JOIN_WAIT_MS);
  }

  /** Expiry and stall checks, reports, waiting→resume, admission and
   * dispatch, inbox writes. Never overlaps itself; nothing after close(). */
  tick(): void {
    if (!this.opened) this.open();
    if (this.closing || this.ticking) return;
    this.ticking = true;
    try {
      this.withBatch(() => this.tickBody());
    } finally {
      this.ticking = false;
    }
  }

  private tickBody(): void {
    const now = this.clock.now();
    const mono = this.clock.monotonic();
    const live = this.store.all({ nonTerminal: true });
    // Expire deepest first so each node fails with its own reason; an
    // ancestor's cancellation then only sweeps what is left.
    for (const snapshot of [...live].sort((a, b) => b.depth - a.depth)) {
      const n = this.store.get(snapshot.id);
      if (!n || isTerminal(n)) continue;
      if (n.status === "queued" && this.waitsOnLeader(n)) {
        // A joined request waits on its leader, whose own windows apply.
      } else if (n.status === "queued") {
        // Decision-card work (#1818): a busy hub must fail or escalate within
        // decisionCardQueueMs, not sit for the full day-long queueMs.
        const queueBound = requiresDecisionCard(n.doneWhen) ? this.limits.decisionCardQueueMs : this.limits.queueMs;
        if (now - this.since(n.lastActivityAt) > queueBound) {
          const why = requiresDecisionCard(n.doneWhen)
            ? (n.executions > 0 ? "decision card not resumed while hub was busy" : "decision card never started while hub was busy")
            : (n.executions > 0 ? "not resumed" : "never started");
          this.cancelTree(n, why, "failed", "expired");
        }
      } else if (n.status === "needs_input" && now - this.since(n.lastActivityAt) > this.limits.inputWaitMs) {
        this.reminded.delete(n.id);
        this.cancelTree(n, "the person did not answer", "failed", "expired");
      } else if (n.status === "needs_input") {
        const stale = this.parkedStale(n, now);
        if (stale) {
          this.reminded.delete(n.id);
          this.cancelTree(n, stale, "failed", "expired");
        } else this.remindIfDue(n, now);
      } else if (n.status === "running") {
        const turn = this.turns.get(n.id);
        if (turn && mono - turn.activeAt > this.limits.turnStallMs) {
          this.cancelTree(n, `no activity for ${duration(this.limits.turnStallMs)}`, "failed", "stalled");
        }
      }
    }
    // Access is rechecked on every tick for every live row, not only at
    // dispatch: a route or membership that changes while a teammate works
    // ends that work with the reason, so no result crosses a boundary that
    // closed under it (deepest first, so each row fails with its own cause).
    for (const snapshot of [...live].sort((a, b) => b.depth - a.depth)) {
      const n = this.store.get(snapshot.id);
      if (!n || isTerminal(n)) continue;
      const parent = n.parentId ? this.store.get(n.parentId) : undefined;
      const problem = this.safe("validate", () => this.runner.validate(n, parent));
      if (this.lastThrew || !problem) continue;
      this.cancelTree(n, problem, "failed", "refused");
    }
    // A tree with no durable or visible progress stalls as a whole, unless
    // it is parked on the person: that time is charged to no window.
    for (const rootId of new Set(live.map(n => n.rootId))) {
      const root = this.store.get(rootId);
      if (!root || isTerminal(root)) continue;
      const anchor = Math.max(this.since(root.lastActivityAt), this.rootActivity.get(rootId) ?? 0);
      if (now - anchor <= this.limits.stallMs) continue;
      const tree = this.store.all({ rootId });
      if (tree.some(n => n.status === "needs_input")) continue;
      if (tree.some(n => this.waitsOnLeader(n))) continue;
      this.store.update(root, { kind: "stalled", at: now, detail: `no progress for ${duration(now - anchor)}` });
      this.cancelTree(root, `no progress for ${duration(this.limits.stallMs)}`, "failed", "stalled");
    }
    for (const id of Array.from(this.reportDue)) {
      const n = this.store.get(id);
      if (!n || !isTerminal(n)) { this.reportDue.delete(id); continue; }
      this.report(n, false);
    }
    for (const snapshot of live) {
      if (snapshot.status !== "waiting") continue;
      const n = this.store.get(snapshot.id);
      if (!n || n.status !== "waiting") continue;
      const due = this.resumeReason(n);
      if (!due) continue;
      if (due === "settled" && !n.parentId && n.reply === "poll") {
        // No turn returns these results: the poller reads the lane itself.
        this.settle(n, "completed", "done");
      } else {
        n.status = "resume";
        this.store.update(n, { kind: "resume_due", at: now, detail: due === "settled" ? "resume" : "resume: a teammate asks" });
        this.touch(n);
      }
    }
    this.dispatchDue();
  }

  private dispatchDue(): void {
    // Priority-now work is admitted first (send_to_bot priority now: the
    // front of the queue); otherwise the store's order.
    const live = this.store.all({ nonTerminal: true }).sort((a, b) => Number(b.priority === "now") - Number(a.priority === "now"));
    const busyThreads = new Set(live.filter(n => n.status === "running").map(n => n.assignee.destination.threadId));
    for (const snapshot of live) {
      if (snapshot.status !== "queued" && snapshot.status !== "resume") continue;
      const n = this.store.get(snapshot.id);
      if (!n || (n.status !== "queued" && n.status !== "resume")) continue;
      if (n.status === "queued" && this.followLeader(n)) continue;
      // The question that made it due was answered, or its teammate ended,
      // before it could start: it waits again rather than run with nothing new.
      if (n.status === "resume" && n.restart !== "rerun" && !this.resumeReason(n)) {
        n.status = "waiting";
        this.store.update(n, { kind: "waiting", at: this.clock.now(), detail: "waiting: nothing left to resume for" });
        this.touch(n);
        continue;
      }
      const thread = n.assignee.destination.threadId;
      // Same-conversation turns never overlap; same-room speakers take turns.
      if (busyThreads.has(thread)) continue;
      const parent = n.parentId ? this.store.get(n.parentId) : undefined;
      const group = n.assignee.destination.groupId;
      if (parent?.status === "running" && group !== undefined && parent.assignee.destination.groupId === group) continue;
      const resumed = n.status === "resume";
      if (!resumed) {
        const root = n.parentId ? this.store.get(n.rootId) : n;
        if (root?.budgets && root.budgets.executions + 1 > this.limits.executions) {
          this.cancelTree(n, `${this.limits.executions} turns without progress`, "failed", "budget");
          continue;
        }
      }
      const problem = this.safe("validate", () => this.runner.validate(n, parent));
      if (this.lastThrew) continue;
      if (problem) { this.cancelTree(n, problem, "failed", "refused"); continue; }
      const can = this.safe("canStart", () => this.runner.canStart(n));
      if (can !== true) {
        if (typeof can === "string" && !this.admissionNoted.has(n.id)) {
          this.admissionNoted.add(n.id);
          this.store.update(n, { kind: "admitted", at: this.clock.now(), detail: `waiting: ${can}` });
          this.touch(n);
        }
        continue;
      }
      if (this.dispatch(n, parent, resumed)) busyThreads.add(thread);
    }
  }

  /** The row says running and the events are stored before the host runs
   * anything. A failed write leaves the row as it was and starts nothing. */
  private dispatch(n: Assignment, parent: Assignment | undefined, resumed: boolean): boolean {
    const now = this.clock.now();
    const root = n.parentId ? this.store.get(n.rootId) : n;
    if (!root) { this.log(`dispatch(${n.id}): root ${n.rootId} is missing`); return false; }
    let input: RunInput;
    let delivered: string[];
    let carrying: string[];
    let carried: Set<string>;
    let interruption: boolean;
    try {
      const children = this.store.children(n.id);
      // A resume returns every settled result of the node, not only what
      // settled since its last turn: the requester reviews the whole of what
      // it handed out, and the host keeps those reports out of the transcript
      // it replays, so a session that lost them still hears them here.
      const settled = awaited(children).filter(isTerminal);
      const ids = new Set(children.map(c => c.id));
      const lane = this.store.inbox({ threadId: n.assignee.destination.threadId }).filter(i => ids.has(i.assignmentId));
      const pending = lane.filter(i => i.deliveredAt === undefined);
      // A question rides one turn: the resume it made due, or the rerun of
      // that resume after a restart cut it.
      const fresh = new Set(pending.filter(i => i.kind === "needs_input").map(i => i.assignmentId));
      const again = new Set(n.restart === "rerun" ? n.carrying : undefined);
      const asked = resumed ? awaited(children).filter(c => asking(c) && (fresh.has(c.id) || again.has(c.id))) : [];
      interruption = resumed && n.restart !== "rerun" && asked.length > 0;
      const names = this.names(n, parent);
      const turn: RunInput["turn"] = resumed ? "resume" : n.restart === "rerun" ? "rerun" : n.answer !== undefined ? "answered" : "first";
      input = {
        turn,
        resumed: turn !== "first",
        restartNote: interruption ? "" : restartNote(n, children, child => this.names(child, n).assignee),
        envelope: composeEnvelope(n, names, parent),
        ...(n.answer !== undefined ? { answer: n.answer } : {}),
        ...(resumed && settled.length ? { settled } : {}),
        ...(asked.length ? { asked } : {}),
        level: n.level, mode: n.mode,
      };
      // Only a resume shows its children's results and questions, so only a
      // resume takes their items off the lane: a result that settled while
      // the node waited on the person, or ran its own turn, is still owed.
      delivered = resumed ? pending.map(i => i.id) : [];
      carrying = asked.map(c => c.id);
      const seen = new Set(lane.filter(i => i.deliveredAt !== undefined && i.kind !== "needs_input").map(i => i.assignmentId));
      carried = new Set(resumed ? settled.map(c => c.id) : settled.filter(c => seen.has(c.id)).map(c => c.id));
    } catch (error) {
      this.log(`dispatch(${n.id}) could not compose the turn: ${String(error)}`);
      return false;
    }
    n.status = "running"; n.startedAt = now; n.executions += 1; n.lastActivityAt = now;
    if (carrying.length) n.carrying = carrying; else delete n.carrying;
    if (root.id !== n.id) root.lastActivityAt = now;
    if (root.budgets) root.budgets.executions += 1;
    try {
      this.store.transaction(() => {
        this.store.update(n, { kind: "admitted", at: now, detail: "admitted" });
        this.store.update(n, { kind: "started", at: now, detail: `running: turn ${n.executions}${resumed ? " (resume)" : ""}, level ${n.level}` });
        if (root.id !== n.id) this.store.update(root);
        this.store.markDelivered(delivered, now);
      });
    } catch (error) {
      this.log(`dispatch(${n.id}) not written, nothing started: ${String(error)}`);
      return false;
    }
    this.admissionNoted.delete(n.id);
    this.touch(n, root);
    const controller = new AbortController();
    const live: LiveTurn = { controller, rootId: root.id, activeAt: this.clock.monotonic(), interruption, carried };
    this.turns.set(n.id, live);
    this.rootActivity.set(root.id, now);
    let turn: Promise<RunResult>;
    try {
      turn = Promise.resolve(this.runner.run(n, input, controller.signal));
    } catch (error) {
      turn = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void turn.then(
      result => this.turnEnded(n.id, result, live),
      error => {
        this.log(`run(${n.id}) threw: ${String(error)}`);
        this.turnEnded(n.id, { kind: "failed", outcome: "provider_error", text: clip(String(error), 1000) }, live);
      },
    ).finally(() => this.turns.delete(n.id));
    return true;
  }

  private turnEnded(id: string, result: RunResult, live: LiveTurn): void {
    try {
      const n = this.store.get(id);
      if (!n || n.status !== "running") return;
      // A turn the shutdown fails is left for the next open() to find cut;
      // one that still finishes keeps its result.
      if (this.closing && result.kind === "failed") return;
      this.withBatch(() => this.finishTurn(n, result, live));
    } catch (error) {
      this.log(`settling ${id} failed: ${String(error)}`);
    }
  }

  /** One turn of the node ended: parked, waiting on the work it handed out,
   * or settled. Shared by host-run root turns (end) and runtime turns.
   * `live`: the handle of the dispatched turn ending; a host turn begun with
   * begin() has none. */
  private finishTurn(n: Assignment, result: RunResult, live?: LiveTurn): void {
    const now = this.clock.now();
    if (!live?.interruption) delete n.restart;
    delete n.answer; delete n.carrying;
    // Access is rechecked as the turn ends, not only each tick: a reply that
    // lands after the route closed is never retained, however fast it came.
    const parentRow = n.parentId ? this.store.get(n.parentId) : undefined;
    const problem = this.safe("validate", () => this.runner.validate(n, parentRow));
    if (!this.lastThrew && problem) { this.settle(n, "failed", "refused", problem); return; }
    if (result.evidence) n.evidence = result.evidence;
    const root = n.parentId ? this.store.get(n.rootId) : n;
    if (result.kind === "needs_input") {
      n.status = "needs_input"; n.question = clip(result.question, BRIEF_MAX); n.lastActivityAt = now;
      this.store.update(n, { kind: "parked", at: now, detail: `needs_input: ${clip(result.question, DETAIL_MAX)}` });
      this.touch(n);
      this.safe("park", () => this.runner.park(n, n.question ?? ""));
      if (n.parentId && this.wake(n, "needs_input") && root && !isTerminal(root)) {
        this.cancelTree(root, `${this.limits.wakes} wakes without progress`, "failed", "budget");
      }
      return;
    }
    n.result = clip(result.text, RESULT_MAX);
    const kids = awaited(this.store.children(n.id));
    // A child that settled while this turn ran (or while the node waited on
    // the person) is a result no turn of the node has read: it resumes once more.
    const unseen = live !== undefined && kids.some(c => isTerminal(c) && !live.carried.has(c.id));
    const outstanding = unseen || kids.some(c => !isTerminal(c)) || awaited(childrenSince(this.store, n)).length > 0;
    if (outstanding) {
      // The turn ended: the tree made progress, and the node waits on what
      // it handed out (root may be n itself; renew then touches n).
      n.status = "waiting"; n.lastActivityAt = now;
      if (root) this.renew(root, now);
      this.store.transaction(() => {
        this.store.update(n, { kind: "waiting", at: now, detail: result.kind === "failed" ? `waiting: turn ${result.outcome}` : "waiting" });
        if (root && root.id !== n.id) this.store.update(root);
      });
      this.touch(n, ...root && root.id !== n.id ? [root] : []);
      return;
    }
    const ownTurn = !n.parentId;
    if (result.kind === "completed") {
      // #1818: a peer ack or a missed done_when must not settle as completed.
      // Roots (the requester's own turn) are excluded: they often end with an
      // empty host text after handing work out.
      const unmet = n.parentId
        ? unmetCompletion({ mode: n.mode, doneWhen: n.doneWhen, text: result.text, evidence: result.evidence ?? n.evidence })
        : undefined;
      if (unmet) this.settle(n, "failed", "incomplete", unmet, ownTurn);
      else this.settle(n, "completed", "done", undefined, ownTurn);
    } else this.settle(n, "failed", result.outcome, undefined, ownTurn);
  }

  /** The host saw activity on this running turn: its stall window restarts.
   * A root's own turn (begin) has no turn handle here; its activity still
   * keeps the tree out of the stall window. */
  progress(id: string): void {
    const turn = this.turns.get(id);
    if (turn) {
      turn.activeAt = this.clock.monotonic();
      this.rootActivity.set(turn.rootId, this.clock.now());
      return;
    }
    const n = this.store.get(id);
    if (n?.status === "running") this.rootActivity.set(n.rootId, this.clock.now());
  }

  /** The person answered a parked question; the next turn carries it. */
  answer(id: string, text: string): boolean {
    const n = this.store.get(id);
    if (!n || n.status !== "needs_input") return false;
    const now = this.clock.now();
    this.reminded.delete(id);
    n.answer = clip(text, BRIEF_MAX); delete n.question; n.lastActivityAt = now;
    // Teammates it waited on settled while it waited on the person: the
    // answer and their results ride one resume, not an answer turn first.
    n.status = this.resultsOwed(n) ? "resume" : "queued";
    // Time parked was charged to no window: the tree's stall window
    // restarts with the answer, not with the question.
    const root = n.parentId ? this.store.get(n.rootId) : undefined;
    this.store.transaction(() => {
      this.store.update(n, { kind: "answered", at: now, detail: `${n.status}: answered` });
      if (root && !isTerminal(root)) { root.lastActivityAt = now; this.store.update(root); }
    });
    this.touch(n, ...root ? [root] : []);
    return true;
  }

  /** The person's review card allowed this queued work (event "approved"):
   * the host's validate no longer holds it. False when it is not queued. */
  approve(id: string): boolean {
    const n = this.store.get(id);
    if (!n || n.status !== "queued") return false;
    if (n.approved) return true;
    n.approved = true;
    this.withBatch(() => {
      this.store.update(n, { kind: "approved", at: this.clock.now(), detail: "queued: the person allowed it" });
      this.touch(n);
    });
    return true;
  }

  /** Cancel this node and everything under it; abort running turns. */
  cancel(id: string, reason = "Stopped by user", outcome: "stopped" | "failed" = "stopped"): void {
    const n = this.store.get(id);
    if (!n) return;
    // A harness stop (a provider reload) fails the work with its own cause,
    // so a requester never reads it as the person's Stop.
    this.withBatch(() => outcome === "failed" ? this.cancelTree(n, reason, "failed", "interrupted") : this.cancelTree(n, reason, "cancelled", "stopped"));
  }

  /** The person stopped the requester's conversation (contract §2): work
   * that never started is dropped, a teammate mid-turn keeps its process
   * and still reports, and nothing resumes the stopped conversation. */
  stopRequester(owner: Owner, reason = "Stopped by user"): Assignment[] {
    const left: Assignment[] = [];
    this.withBatch(() => {
      for (const snapshot of this.store.all({ nonTerminal: true })) {
        if (!ownsConversation(snapshot, owner)) continue;
        const n = this.store.get(snapshot.id);
        if (!n || isTerminal(n)) continue;
        for (const child of this.store.children(n.id)) {
          if (isTerminal(child)) continue;
          if (child.status === "queued" && (child.executions === 0 || child.restart === "rerun")) {
            this.cancelTree(child, child.restart === "rerun" ? "Stopped before it resumed" : "Stopped before it started", "cancelled", "stopped");
          } else left.push(child);
        }
        this.settle(n, "cancelled", "stopped", reason);
      }
    });
    return left;
  }

  status(id: string): StatusView | undefined {
    const assignment = this.store.get(id);
    if (!assignment) return undefined;
    const children = this.store.children(id);
    const about = new Set([id, ...children.map(c => c.id)]);
    const lanes = new Map([assignment, ...children].map(a => [JSON.stringify(wakeOwner(a)), wakeOwner(a)]));
    const inbox = new Map<string, InboxItem>();
    for (const lane of lanes.values()) {
      for (const item of this.store.inbox(lane)) if (about.has(item.assignmentId)) inbox.set(item.id, item);
    }
    return { assignment, children, inbox: [...inbox.values()].sort((a, b) => a.createdAt - b.createdAt) };
  }

  /** Non-terminal work this owner's nodes are waiting on. */
  outstanding(owner: Owner): Assignment[] {
    const live = this.store.all({ nonTerminal: true });
    if (owner.threadId === undefined && owner.runId !== undefined) return live.filter(n => ownsConversation(n, owner));
    const mine = new Set(live.filter(n => ownsConversation(n, owner)).map(n => n.id));
    return live.filter(n => n.parentId !== undefined && mine.has(n.parentId) && n.reply !== "none");
  }

  liveEdges(): LiveEdge[] {
    const edges: LiveEdge[] = [];
    for (const n of this.store.all({ nonTerminal: true })) {
      if (!n.parentId) continue;
      const parent = this.store.get(n.parentId);
      if (!parent || parent.assignee.botId === n.assignee.botId) continue;
      const state: LiveEdge["state"] = n.status === "resume" ? "waiting" : n.status as LiveEdge["state"];
      edges.push({ sourceBotId: parent.assignee.botId, targetBotId: n.assignee.botId, state, threadId: n.assignee.destination.threadId,
        ...(n.assignee.destination.groupId ? { groupId: n.assignee.destination.groupId } : {}) });
    }
    return edges;
  }

  /** Undelivered inbox items for this owner, marked delivered now. */
  poll(owner: Owner): { items: InboxItem[]; assignments: Assignment[] } {
    const now = this.clock.now();
    const items = this.store.inbox(owner, true);
    this.store.markDelivered(items.map(i => i.id), now);
    for (const item of items) item.deliveredAt = now;
    const assignments = items.flatMap(i => { const a = this.store.get(i.assignmentId); return a ? [a] : []; });
    return { items, assignments };
  }

  /** Shutdown began: dispatch nothing more; running turns are left for the
   * next open() to find cut. */
  close(): void {
    this.closing = true;
  }

  // ── settlement and the wake lane ─────────────────────────────────────

  /** Cancel or fail the subtree, deepest first, then the node. */
  private cancelTree(n: Assignment, reason: string, status: "failed" | "cancelled", outcome: Outcome): void {
    for (const child of this.store.children(n.id)) {
      if (isTerminal(child)) continue;
      const fresh = this.store.get(child.id);
      if (fresh && !isTerminal(fresh)) this.cancelTree(fresh, reason, status, outcome);
    }
    const fresh = this.store.get(n.id);
    if (fresh && !isTerminal(fresh)) this.settle(fresh, status, outcome, reason);
  }

  /** The terminal outcome, written once, then reported once, then (for a
   * requester that is resumed or polls) one inbox item. `ownTurn`: a root
   * whose own turn produced the outcome needs no report into itself. */
  private settle(n: Assignment, status: TerminalStatus, outcome: Outcome, detail?: string, ownTurn = false): void {
    if (isTerminal(n)) return;
    const now = this.clock.now();
    n.status = status; n.outcome = outcome; n.finishedAt = now; n.lastActivityAt = now;
    if (detail !== undefined) n.outcomeDetail = clip(detail, DETAIL_MAX); else delete n.outcomeDetail;
    if (status !== "completed" && detail !== undefined && n.result === "") n.result = clip(detail, RESULT_MAX);
    // A refusal replaces whatever the turn had said: the reader it would
    // have reached is exactly the one the refusal is about.
    if (outcome === "refused" && detail !== undefined) { n.result = clip(detail, RESULT_MAX); delete n.evidence; }
    delete n.question; delete n.answer; delete n.carrying;
    const kind: EventKind = status === "cancelled" ? "cancelled" : outcome === "refused" ? "refused" : "settled";
    const root = n.parentId ? this.store.get(n.rootId) : n;
    this.store.transaction(() => {
      this.store.update(n, { kind, at: now, detail: `${status}: ${outcome}${detail ? ` — ${clip(detail, DETAIL_MAX)}` : ""}` });
      // A settlement is the tree's progress: its budgets start over.
      if (root && root.id !== n.id && !isTerminal(root)) { this.renew(root, now); this.store.update(root); }
    });
    this.turns.get(n.id)?.controller.abort();
    this.turns.delete(n.id);
    this.admissionNoted.delete(n.id);
    if (root?.id === n.id) this.rootActivity.delete(n.id);
    this.touch(n, ...root && root.id !== n.id ? [root] : []);
    this.report(n, ownTurn);
  }

  private report(n: Assignment, ownTurn: boolean): void {
    if (n.reportedAt !== undefined) return;
    const now = this.clock.now();
    const parent = n.parentId ? this.store.get(n.parentId) : undefined;
    if (!ownTurn) {
      this.safe("report", () => this.runner.report(n, parent));
      if (this.lastThrew) { this.reportDue.add(n.id); return; }
    }
    n.reportedAt = now;
    this.store.update(n, { kind: "reported", at: now, detail: ownTurn ? "own turn" : "reported" });
    this.reportDue.delete(n.id);
    this.touch(n);
    // A root has no requester node to wake: its conversation saw the end.
    if (n.parentId) this.wake(n, n.outcome === "stalled" ? "stalled" : "settled");
  }

  /** One inbox item for the requester, counted against the root's wake
   * budget. Returns true when that budget is now exceeded. */
  private wake(n: Assignment, kind: InboxKind): boolean {
    if (n.reply === "none") return false;
    const now = this.clock.now();
    const owner = wakeOwner(n);
    const item: InboxItem = { id: randomUUID(), assignmentId: n.id, kind, createdAt: now };
    if (owner.botId !== undefined) item.ownerBotId = owner.botId;
    if (owner.threadId !== undefined) item.ownerThreadId = owner.threadId;
    if (owner.runId !== undefined) item.ownerRunId = owner.runId;
    const root = n.parentId ? this.store.get(n.rootId) : n;
    let over = false;
    this.store.transaction(() => {
      this.store.addInbox(item);
      if (root?.budgets) {
        root.budgets.wakes += 1;
        over = root.budgets.wakes > this.limits.wakes;
        if (root.id !== n.id) this.store.update(root, over ? { kind: "budget", at: now, detail: `wakes: ${root.budgets.wakes}` } : undefined);
      }
      this.store.update(n, { kind: "woken", at: now, detail: kind });
      if (over && root?.id === n.id) this.store.update(n, { kind: "budget", at: now, detail: `wakes: ${n.budgets?.wakes ?? 0}` });
    });
    this.touch(n, ...root && root.id !== n.id ? [root] : []);
    return over;
  }

  // ── small helpers ────────────────────────────────────────────────────

  /** Durable progress on the root: every budget window starts over. */
  private renew(root: Assignment, now: number): void {
    root.lastActivityAt = now;
    if (root.budgets) root.budgets = { since: now, requests: 0, executions: 0, wakes: 0 };
  }

  /** Why a parked assignment is closed before inputWaitMs, if it is: a
   * delegation (a child outside a room) parked longer than
   * delegationInputWaitMs on the wall clock, or a park with no place left
   * to answer it (runner.parkedGone). */
  private parkedStale(n: Assignment, now: number): string | undefined {
    if (n.status !== "needs_input") return undefined;
    const delegation = n.parentId !== undefined && n.assignee.destination.groupId === undefined;
    if (delegation && now - n.lastActivityAt > this.limits.delegationInputWaitMs) {
      return `the person did not answer within ${duration(this.limits.delegationInputWaitMs)}`;
    }
    if (this.runner.parkedGone && this.safe("parkedGone", () => this.runner.parkedGone!(n)) === true) {
      return "its question can no longer be answered";
    }
    return undefined;
  }

  /** A parked question still unanswered: remind the person after
   * inputRemindMs, then once a day. The work keeps waiting. */
  private remindIfDue(n: Assignment, now: number): void {
    const waited = now - this.since(n.lastActivityAt);
    const sent = this.reminded.get(n.id) ?? 0;
    if (waited <= this.limits.inputRemindMs + sent * INPUT_REMIND_REPEAT_MS) return;
    this.reminded.set(n.id, sent + 1);
    if (this.reminded.size > 5_000) this.reminded.delete(this.reminded.keys().next().value!);
    if (this.runner.remind) this.safe("remind", () => this.runner.remind!(n, n.question ?? "", waited));
  }

  /** Why a waiting node owes a turn now: every child it waits on settled and
   * was reported, or one of them parked on a question not passed on yet.
   * Each needs_input item resumes its requester at most once: dispatch marks
   * it delivered in the transaction that starts the turn, and a delivered
   * item never counts again, across restarts too. A poll root reads its own
   * lane and is never resumed for a question. */
  private resumeReason(n: Assignment): "settled" | "asked" | undefined {
    const kids = awaited(this.store.children(n.id));
    if (kids.length === 0) return undefined;
    if (kids.every(c => isTerminal(c) && c.reportedAt !== undefined)) return "settled";
    if (!n.parentId && n.reply === "poll") return undefined;
    const parked = new Set(kids.filter(asking).map(c => c.id));
    if (parked.size === 0) return undefined;
    const items = this.store.inbox({ threadId: n.assignee.destination.threadId }, true);
    return items.some(i => i.kind === "needs_input" && parked.has(i.assignmentId)) ? "asked" : undefined;
  }

  /** Every child it waits on settled and was reported, and at least one
   * result is still on the lane (no resume of the node has read it). */
  private resultsOwed(n: Assignment): boolean {
    if (!n.parentId && n.reply === "poll") return false;
    if (this.resumeReason(n) !== "settled") return false;
    const ids = new Set(this.store.children(n.id).map(c => c.id));
    return this.store.inbox({ threadId: n.assignee.destination.threadId }, true)
      .some(i => ids.has(i.assignmentId) && i.kind !== "needs_input");
  }

  /** A clock anchor, never before this boot: downtime is nobody's budget. */
  private since(at: number): number {
    return Math.max(at, this.bootAt);
  }

  private names(n: Assignment, parent: Assignment | undefined): EnvelopeNames {
    const names = this.safe("names", () => this.runner.names(n, parent));
    return names ?? { requester: n.requester.botId ?? n.requester.kind, assignee: n.assignee.botId };
  }

  /** A host method that throws is logged and read as "not now". */
  private safe<T>(what: string, fn: () => T): T | undefined {
    this.lastThrew = false;
    try {
      return fn();
    } catch (error) {
      this.lastThrew = true;
      this.log(`${what} threw: ${String(error)}`);
      return undefined;
    }
  }

  /** Change notices coalesce per outer call; the host hears each row once. */
  private withBatch<T>(fn: () => T): T {
    if (this.batch) return fn();
    this.batch = new Map();
    try {
      return fn();
    } finally {
      const rows = [...this.batch.values()];
      this.batch = null;
      if (rows.length) this.safe("changed", () => this.runner.changed(rows));
    }
  }

  private touch(...rows: Assignment[]): void {
    if (this.batch) { for (const row of rows) this.batch.set(row.id, row); return; }
    this.safe("changed", () => this.runner.changed(rows));
  }
}
