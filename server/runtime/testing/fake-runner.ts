// A scriptable TurnRunner for the scenario suite (docs/runtime-contract.md §8).
//
// It records every call the runtime makes (validate, canStart, run, park,
// report, changed, names) with its arguments, and answers run() from a
// script queued per assignee bot or per assignment id: complete, fail,
// needsInput, handOut (enqueue children from inside the turn, then settle),
// hang (a turn that stays running until release()), or custom. canStart and
// validate answer from settable maps. `running` and `parked` mirror what a
// real host would own (an engine process, a card on screen), so a scenario
// can hand them to checkInvariants() after every step.
//
// Nothing here imports the runtime: the handOut script reaches it through
// the small EnqueuePort attached by the test.
import type {
  Assignment,
  EnqueueRequest,
  EnqueueResult,
  EnvelopeNames,
  Outcome,
  RunInput,
  RunResult,
  TurnEvidence,
  TurnRunner,
} from "../types.ts";

export type FailOutcome = Exclude<Outcome, "done" | "needs_input">;

/** What the runner needs from the runtime to hand work out mid-turn. */
export interface EnqueuePort {
  enqueue(req: EnqueueRequest): EnqueueResult;
}

/** An EnqueueRequest with the lineage fields optional: the runner fills
 * parentId, origin, requester and levels from the running assignment. */
export type ChildSpec = Omit<EnqueueRequest, "parentId" | "origin" | "requester" | "levels"> &
  Partial<Pick<EnqueueRequest, "origin" | "requester" | "levels">>;

export interface TurnContext {
  a: Assignment;
  input: RunInput;
  signal: AbortSignal;
  /** Hand work out from this turn (parentId is this assignment). */
  handOut(child: ChildSpec): EnqueueResult;
}

export type Script =
  | { kind: "complete"; text: string; evidence?: TurnEvidence }
  | { kind: "fail"; outcome: FailOutcome; text: string; evidence?: TurnEvidence }
  | { kind: "needsInput"; question: string; cards?: string[] }
  /** The turn stopped short (a step cap) and the same node continues in place. */
  | { kind: "continue"; text: string; note: string; handoffPath?: string; evidence?: TurnEvidence }
  | { kind: "handOut"; children: ChildSpec[]; after: Script }
  | { kind: "hang" }
  | { kind: "custom"; fn: (ctx: TurnContext) => RunResult | Promise<RunResult> };

export const complete = (text: string, evidence?: TurnEvidence): Script => ({ kind: "complete", text, evidence });
export const fail = (outcome: FailOutcome, text: string, evidence?: TurnEvidence): Script => ({ kind: "fail", outcome, text, evidence });
export const needsInput = (question: string, cards?: string[]): Script => ({ kind: "needsInput", question, ...(cards ? { cards } : {}) });
export const continueTurn = (text: string, note: string, handoffPath?: string, evidence?: TurnEvidence): Script =>
  ({ kind: "continue", text, note, ...(handoffPath !== undefined ? { handoffPath } : {}), ...(evidence ? { evidence } : {}) });
export const handOut = (children: ChildSpec[], after: Script): Script => ({ kind: "handOut", children, after });
export const hang = (): Script => ({ kind: "hang" });
export const custom = (fn: (ctx: TurnContext) => RunResult | Promise<RunResult>): Script => ({ kind: "custom", fn });

export type RunnerMethod = "validate" | "canStart" | "run" | "park" | "report" | "changed" | "names" | "outward";

export interface RunnerCall {
  method: RunnerMethod;
  /** The assignment the call was about (absent for changed). */
  id?: string;
  /** Snapshot of the row as the runtime passed it. */
  a?: Assignment;
  parent?: Assignment;
  /** run: the input and the signal the turn got. */
  input?: RunInput;
  signal?: AbortSignal;
  /** run: the row as the store held it when run() was invoked (write-before-act). */
  storedStatus?: string;
  /** park: the question. */
  question?: string;
  /** changed: the rows. */
  rows?: Assignment[];
  /** What the runner answered (validate, canStart). */
  answer?: unknown;
  /** run: the turn ended because its signal was aborted. */
  aborted?: boolean;
  /** run: the signal was already aborted when the turn settled. */
  settledAborted?: boolean;
  /** run: the RunResult the turn resolved with. */
  result?: RunResult;
}

export interface RecordedEnqueue {
  /** The running assignment that handed the work out. */
  from: string;
  req: EnqueueRequest;
  result: EnqueueResult;
}

export interface BotInfo {
  name: string;
  /** The bot's standing conversation is a Chief of Staff conversation. */
  chief?: boolean;
}

interface Hung {
  resolve: (r: RunResult) => void;
  call: RunnerCall;
}

const clone = <T>(value: T): T => structuredClone(value);

export class FakeRunner implements TurnRunner {
  readonly calls: RunnerCall[] = [];
  readonly enqueues: RecordedEnqueue[] = [];
  /** Turns whose run() promise has not settled (an engine process alive). */
  readonly running = new Set<string>();
  /** Assignments the host currently shows a question card for. */
  readonly parked = new Set<string>();
  /** Answers for canStart, keyed by assignment id (first) or bot id. */
  readonly canStartAnswers = new Map<string, true | false | string>();
  /** Reasons validate refuses with, keyed by assignment id or bot id. */
  readonly validateReasons = new Map<string, string>();
  /** What outward() says a cut turn already did, keyed by assignment id (first) or bot id. */
  readonly outwardAnswers = new Map<string, string[]>();
  readonly bots: Record<string, BotInfo>;
  personName = "Milind";
  /** Lets a scenario see the stored row at the moment run() is invoked. */
  lookup?: (id: string) => Assignment | undefined;
  /** The optional port (types.ts TurnRunner.outward); a host without it is
   * modelled by `new FakeRunner(bots, { outward: false })`. */
  outward?: (a: Assignment) => string[];

  #port?: EnqueuePort;
  #scripts = new Map<string, Script[]>();
  #hung = new Map<string, Hung>();
  #throwOnce = new Set<RunnerMethod>();
  #rejectRunOnce = false;

  constructor(bots: Record<string, BotInfo> = {}, options: { outward?: boolean } = {}) {
    this.bots = bots;
    if (options.outward !== false) this.outward = (a) => this.#outward(a);
  }

  // ── scripting ──────────────────────────────────────────────────────────

  /** The runtime the handOut script enqueues into. */
  attach(port: EnqueuePort): void {
    this.#port = port;
  }

  /** Queue scripts for a bot id or an assignment id; run() consumes one per
   * turn, assignment-id scripts first. Without a script a turn completes. */
  script(key: string, ...scripts: Script[]): void {
    const queue = this.#scripts.get(key) ?? [];
    queue.push(...scripts);
    this.#scripts.set(key, queue);
  }

  setCanStart(key: string, answer: true | false | string): void {
    this.canStartAnswers.set(key, answer);
  }

  /** What the host saw a node's cut turn do outward (read at open()). */
  setOutward(key: string, labels: string[]): void {
    this.outwardAnswers.set(key, labels);
  }

  /** The next call of this method throws (a host bug the runtime must absorb). */
  throwOnce(method: RunnerMethod): void {
    this.#throwOnce.add(method);
  }

  /** The next run() returns a rejected promise instead of a RunResult. */
  rejectRunOnce(): void {
    this.#rejectRunOnce = true;
  }

  /** Settle a hung turn. Default: completed. */
  release(id: string, script: Script = complete("released")): void {
    const hung = this.#hung.get(id);
    if (!hung) throw new Error(`fake runner: ${id} is not hung`);
    this.#hung.delete(id);
    hung.resolve(this.#settle(script));
  }

  hungIds(): string[] {
    return [...this.#hung.keys()];
  }

  /** The host process died: engines, cards and hung promises are gone. The
   * call log survives so a scenario can count across boots. */
  reboot(): void {
    this.running.clear();
    this.parked.clear();
    this.#hung.clear();
    this.#throwOnce.clear();
    this.#rejectRunOnce = false;
  }

  /** What checkInvariants() needs to know about live ownership. */
  live(): { running: Set<string>; parked: Set<string> } {
    return { running: this.running, parked: this.parked };
  }

  // ── reading the log ────────────────────────────────────────────────────

  callsOf(method: RunnerMethod, id?: string): RunnerCall[] {
    return this.calls.filter((c) => c.method === method && (id === undefined || c.id === id));
  }

  runs(id?: string): RunnerCall[] {
    return this.callsOf("run", id);
  }

  reports(id?: string): RunnerCall[] {
    return this.callsOf("report", id);
  }

  parks(id?: string): RunnerCall[] {
    return this.callsOf("park", id);
  }

  // ── TurnRunner ─────────────────────────────────────────────────────────

  validate(a: Assignment, parent?: Assignment): string | undefined {
    this.#maybeThrow("validate");
    const answer = this.validateReasons.get(a.id) ?? this.validateReasons.get(a.assignee.botId);
    this.calls.push({ method: "validate", id: a.id, a: clone(a), parent: parent && clone(parent), answer });
    return answer;
  }

  canStart(a: Assignment): true | false | string {
    this.#maybeThrow("canStart");
    const answer = this.canStartAnswers.get(a.id) ?? this.canStartAnswers.get(a.assignee.botId) ?? true;
    this.calls.push({ method: "canStart", id: a.id, a: clone(a), answer });
    return answer;
  }

  run(a: Assignment, input: RunInput, signal: AbortSignal): Promise<RunResult> {
    this.#maybeThrow("run");
    const call: RunnerCall = {
      method: "run",
      id: a.id,
      a: clone(a),
      input: { ...input, settled: input.settled?.map(clone) },
      signal,
      storedStatus: this.lookup?.(a.id)?.status,
    };
    this.calls.push(call);
    if (this.#rejectRunOnce) {
      this.#rejectRunOnce = false;
      return Promise.reject(new Error("fake runner: run rejected"));
    }
    this.parked.delete(a.id);
    this.running.add(a.id);
    const script = this.#nextScript(a);
    return this.#execute(a, input, signal, script, call).then(
      (result) => {
        this.running.delete(a.id);
        call.result = result;
        call.settledAborted = signal.aborted;
        return result;
      },
      (err: unknown) => {
        this.running.delete(a.id);
        call.settledAborted = signal.aborted;
        throw err;
      },
    );
  }

  park(a: Assignment, question: string): void {
    this.#maybeThrow("park");
    this.calls.push({ method: "park", id: a.id, a: clone(a), question });
    this.parked.add(a.id);
  }

  report(a: Assignment, parent?: Assignment): void {
    this.#maybeThrow("report");
    this.calls.push({ method: "report", id: a.id, a: clone(a), parent: parent && clone(parent) });
    this.parked.delete(a.id);
  }

  changed(assignments: readonly Assignment[]): void {
    this.#maybeThrow("changed");
    const rows = assignments.map(clone);
    this.calls.push({ method: "changed", rows });
    for (const row of rows) if (row.status !== "needs_input") this.parked.delete(row.id);
  }

  names(a: Assignment, parent?: Assignment): EnvelopeNames {
    this.#maybeThrow("names");
    this.calls.push({ method: "names", id: a.id, a: clone(a), parent: parent && clone(parent) });
    const requester = a.requester.botId
      ? this.bots[a.requester.botId]?.name ?? a.requester.botId
      : a.requester.kind === "person" ? this.personName : a.requester.kind;
    return {
      requester,
      assignee: this.bots[a.assignee.botId]?.name ?? a.assignee.botId,
      person: a.origin.kind === "person" ? this.personName : undefined,
      thread: a.requester.threadId,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  #outward(a: Assignment): string[] {
    this.#maybeThrow("outward");
    const answer = this.outwardAnswers.get(a.id) ?? this.outwardAnswers.get(a.assignee.botId) ?? [];
    this.calls.push({ method: "outward", id: a.id, a: clone(a), answer });
    return answer;
  }

  #maybeThrow(method: RunnerMethod): void {
    if (!this.#throwOnce.has(method)) return;
    this.#throwOnce.delete(method);
    throw new Error(`fake runner: ${method} threw once`);
  }

  #nextScript(a: Assignment): Script {
    for (const key of [a.id, a.assignee.botId]) {
      const queue = this.#scripts.get(key);
      if (queue && queue.length > 0) return queue.shift() as Script;
    }
    return complete("done");
  }

  #settle(script: Script): RunResult {
    switch (script.kind) {
      case "complete":
        return { kind: "completed", text: script.text, evidence: script.evidence };
      case "fail":
        return { kind: "failed", outcome: script.outcome, text: script.text, evidence: script.evidence };
      case "needsInput":
        return { kind: "needs_input", question: script.question, ...(script.cards ? { cards: script.cards } : {}) };
      case "continue":
        return { kind: "continue", text: script.text, note: script.note, ...(script.handoffPath !== undefined ? { handoffPath: script.handoffPath } : {}),
          ...(script.evidence ? { evidence: script.evidence } : {}) };
      default:
        throw new Error(`fake runner: ${script.kind} cannot settle a released turn`);
    }
  }

  /** The full EnqueueRequest for work handed out by a running assignment. */
  childRequest(a: Assignment, spec: ChildSpec): EnqueueRequest {
    const { origin, requester, levels, ...rest } = spec;
    return {
      parentId: a.id,
      origin: origin ?? clone(a.origin),
      requester: requester ?? {
        kind: "bot_turn",
        botId: a.assignee.botId,
        threadId: a.assignee.destination.threadId,
        chief: this.bots[a.assignee.botId]?.chief === true,
      },
      levels: levels ?? { own: "ask" },
      ...rest,
    };
  }

  async #execute(a: Assignment, input: RunInput, signal: AbortSignal, script: Script, call: RunnerCall): Promise<RunResult> {
    // An engine answers asynchronously; nothing settles inside the caller's
    // own stack frame.
    await Promise.resolve();
    const ctx: TurnContext = {
      a,
      input,
      signal,
      handOut: (child) => {
        if (!this.#port) throw new Error("fake runner: attach(runtime) before a handOut script runs");
        const req = this.childRequest(a, child);
        const result = this.#port.enqueue(req);
        this.enqueues.push({ from: a.id, req, result });
        return result;
      },
    };
    switch (script.kind) {
      case "complete":
      case "fail":
      case "needsInput":
      case "continue":
        return this.#settle(script);
      case "handOut":
        for (const child of script.children) ctx.handOut(child);
        return this.#execute(a, input, signal, script.after, call);
      case "custom":
        return script.fn(ctx);
      case "hang":
        return new Promise<RunResult>((resolve) => {
          this.#hung.set(a.id, { resolve, call });
          signal.addEventListener("abort", () => {
            if (!this.#hung.has(a.id)) return;
            this.#hung.delete(a.id);
            call.aborted = true;
            resolve({ kind: "failed", outcome: "stopped", text: "aborted" });
          }, { once: true });
        });
    }
  }
}
