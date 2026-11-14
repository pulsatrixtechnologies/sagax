/** #4250 (S6 `suggest-the-cheap-path`): a routine that runs several times a
 * day, ends quiet run after run, and starts every one of those runs by
 * reading the same tool is paying a model turn for a read the server could
 * make alone. The server notices it (no model) and the routine's bot
 * proposes ONCE, on a keyed card (the #4205 ask_choice card, key
 * `routine-cheap-path:<routineId>`), to turn that read into the routine's
 * pre-check (a tool watch, server/routines/routine-watch.ts: the turn starts
 * only when the result changes) or, on a server linked to Perspicax when the
 * read is a product's, into its product trigger (shared/routine-product-event.ts:
 * no run until the product says it changed).
 *
 * - Detection (`cheapPathFinding`): the routine is on, its own, on a clock
 *   that repeats within a day (routineRepeatsWithinDay) and has no pre-check;
 *   its last CHEAP_PATH_QUIET_RUNS settled runs, at least, all completed
 *   quiet (nothing for the person) and each first read a product or a
 *   server with the same read-only tool (routine-watch-tools.ts
 *   watchToolRefusal). The engine's housekeeping before it (ToolSearch,
 *   Skill, TodoWrite, the MCP resource listing), the app's own tools,
 *   sub-agent steps and setup rows are passed over. The read's arguments
 *   are kept when every run used the same.
 * - The card is the existing question card: it sits in the pinned zone and
 *   in Today and holds nothing. It is raised quiet (no notification): it is a
 *   saving to take or leave, nothing breaks while it waits.
 * - Once: the person's signal ledger keeps the key (kind
 *   `routine-cheap-path`) once the card was posted; a key it already holds,
 *   in any state, is never raised again, a restart included. A card that
 *   could not be posted is tried again at the next pass.
 * - The answer reaches the bot with the key verbatim (server/messages/replies.ts);
 *   the bot applies it with propose_routine_action (update with `watch`), or
 *   for the product trigger with propose_routine (trigger product) and
 *   propose_routine_action delete of this one, in its Ask or Auto mode.
 * - Retired by the server, silently, the moment the cause is gone: the
 *   routine got a pre-check or a trigger, stopped repeating within a day,
 *   or was deleted. */
import { canonicalJson } from "../../shared/canonical-json.ts";
import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { parseToolId } from "../../shared/approval-describe.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import { routineRepeatsWithinDay } from "../../shared/routine-repeat.ts";
import { CHEAP_PATH_KEY_PREFIX } from "../../shared/fix-card-keys.ts";
import type { SignalLedger } from "../proactive/signal-ledger.ts";
import { perspicaxReadTool } from "../artifacts/artifact-sources.ts";
import { watchToolRefusal } from "./routine-watch-tools.ts";

export { CHEAP_PATH_KEY_PREFIX };
/** The ledger kind of the proposal. */
export const CHEAP_PATH_KIND = "routine-cheap-path";
/** Quiet runs in a row, each opening with the same read, before the
 * proposal: enough that the read is the routine's habit, not a lull. */
export const CHEAP_PATH_QUIET_RUNS = 5;

/** The key of a routine's proposal. */
export function cheapPathKey(routineId: string): string {
  return `${CHEAP_PATH_KEY_PREFIX}${routineId}`;
}

/** The app's own tool servers: a read of the bot's own state is no
 * product read to watch. */
const OWN_SERVERS = new Set(["agents", "ogb", "sagax", "maus", "harness"]);

export interface CheapPathRoutine {
  id: string;
  name: string;
  botId?: string;
  enabled: boolean;
  target: string;
  schedule: { type: string };
  precheck?: unknown;
}

export interface CheapPathRun {
  id: string;
  status: string;
  quiet?: true;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  threadId?: string;
}

/** The first tool step of a run: its name, its arguments when they read as
 * a JSON object, and whether it is a product's (Perspicax). */
export interface CheapPathStep {
  tool: string;
  args?: Record<string, unknown>;
  product?: boolean;
}

export interface CheapPathFinding {
  tool: string;
  /** The arguments every one of the runs used, when they were the same. */
  args?: Record<string, unknown>;
  product: boolean;
  /** Quiet runs in a row that opened with this read. */
  count: number;
}

/** A transcript row as the first-step reader needs it. */
export interface CheapPathActivityRow {
  kind: string;
  at: number;
  tool?: { name?: string; setup?: boolean; terminal?: boolean; input?: string; productId?: string; parentItemId?: string };
}

const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function argsOf(input: string | undefined): Record<string, unknown> | undefined {
  if (!input?.trim()) return undefined;
  try {
    return objectOf(JSON.parse(input));
  } catch {
    return undefined;
  }
}

/** The engine's own housekeeping before the work: finding a deferred tool
 * (Claude's ToolSearch, on by default), loading a skill, a task list, the
 * MCP resource listing. None reads anything the person cares about. */
const HOUSEKEEPING_TOOLS = new Set([
  "ToolSearch", "Skill", "TodoWrite", "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool", "RefreshMcpTools",
]);

/** Whether a transcript row is the run's reading of a product or a server:
 * a tool call of the run itself (not a sub-agent's, not a sign-in or setup
 * row, not a notice), naming a product or a connected server that is not
 * the app's own. Everything before it (housekeeping, the bot's own state)
 * is passed over. */
function productOrServerCall(row: CheapPathActivityRow): boolean {
  const tool = row.tool;
  const name = tool?.name?.trim();
  if (row.kind !== "activity" || !tool || !name || tool.setup || tool.terminal || tool.parentItemId) return false;
  if (HOUSEKEEPING_TOOLS.has(name)) return false;
  if (tool.productId || perspicaxReadTool(name)) return true;
  const server = parseToolId(name).server;
  return Boolean(server && !OWN_SERVERS.has(server));
}

/** The run's first read of a product or a server, read from its
 * conversation's rows between its start and its end (a routine with
 * continuity keeps one conversation). The engine's housekeeping and the
 * app's own tools before it are passed over. */
export function firstToolStep(run: CheapPathRun, rows: readonly CheapPathActivityRow[]): CheapPathStep | null {
  const from = run.startedAt ?? run.createdAt;
  const to = run.finishedAt ?? Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.at < from || row.at > to || !productOrServerCall(row)) continue;
    const name = row.tool!.name!.trim();
    const args = argsOf(row.tool?.input);
    return { tool: name, ...(args ? { args } : {}), ...(row.tool?.productId || perspicaxReadTool(name) ? { product: true } : {}) };
  }
  return null;
}

/** Whether a routine can carry the proposal at all: on, its own, on a clock
 * that repeats within a day, without a pre-check. */
export function cheapPathApplies(routine: CheapPathRoutine, now: number): boolean {
  return routine.enabled && routine.target === "bot" && !routine.precheck && routineRepeatsWithinDay(routine.schedule, now);
}

/** A read the server may make alone: a read-only tool of a connected
 * product or server, never the app's own. */
function watchableRead(step: CheapPathStep): boolean {
  const parsed = parseToolId(step.tool);
  if (!parsed.server && !step.product) return false;
  if (parsed.server && OWN_SERVERS.has(parsed.server)) return false;
  return watchToolRefusal(step.tool, step.args) === null;
}

/** The read the routine's last quiet runs all opened with, or null. */
export function cheapPathFinding(
  routine: CheapPathRoutine,
  runs: readonly CheapPathRun[],
  firstStep: (run: CheapPathRun) => CheapPathStep | null,
  now: number,
): CheapPathFinding | null {
  if (!cheapPathApplies(routine, now)) return null;
  const settled = runs
    .filter((run) => run.finishedAt !== undefined && run.status !== "queued" && run.status !== "running" && run.status !== "waiting")
    .sort((a, b) => b.finishedAt! - a.finishedAt!);
  let tool = "";
  let product = false;
  let args: string | null | undefined;
  let argsValue: Record<string, unknown> | undefined;
  let count = 0;
  for (const run of settled) {
    if (run.status !== "completed" || !run.quiet) break;
    const step = firstStep(run);
    if (!step || !watchableRead(step)) break;
    if (count && step.tool !== tool) break;
    if (!count) {
      tool = step.tool;
      product = Boolean(step.product);
      args = step.args ? canonicalJson(step.args) : null;
      argsValue = step.args;
    } else if (args !== undefined && (step.args ? canonicalJson(step.args) : null) !== args) {
      args = undefined;
      argsValue = undefined;
    }
    count += 1;
  }
  if (count < CHEAP_PATH_QUIET_RUNS) return null;
  return { tool, ...(args !== undefined && argsValue ? { args: argsValue } : {}), product, count };
}

/** Arguments past this are not repeated on the card (the bot reads its run). */
const READ_ARGS_MAX = 400;

/** The read as the run showed it: the tool, then its arguments as the
 * transcript's bounded, redacted preview kept them (never the raw call). */
function shownRead(finding: CheapPathFinding): string {
  const args = finding.args ? canonicalJson(finding.args) : "";
  return args && args.length <= READ_ARGS_MAX ? `${finding.tool} ${args}` : finding.tool;
}

export interface CheapPathCardInput {
  tool: typeof ASK_CHOICE_TOOL;
  key: string;
  wait: false;
  decision: true;
  title: string;
  question: string;
  options: string[];
  details: string[];
}

/** The card's ask_choice input, in the person's words. The product trigger
 * is offered only where it can work (a linked server, a product's read). */
export function cheapPathCardInput(
  routine: { id: string; name: string },
  finding: CheapPathFinding,
  words: ApprovalWords,
  productTrigger: boolean,
): CheapPathCardInput {
  const name = routine.name.trim() || routine.id;
  const product = productTrigger && finding.product;
  const read = parseToolId(finding.tool).name;
  const question = [
    words.t("routine.cheapPath.question", { routine: name, count: finding.count, tool: read }),
    words.t("routine.cheapPath.precheckLine"),
    ...(product ? [words.t("routine.cheapPath.productLine")] : []),
    // the read as the run showed it (a redacted preview): the bot that gets
    // the answer re-reads its run for the exact call before it sets the
    // check (propose_routine_action update `watch`)
    words.t("routine.cheapPath.readLine", { read: shownRead(finding) }),
  ].join("\n\n");
  const choices: Array<[string, string]> = [
    [words.t("routine.cheapPath.precheck"), words.t("routine.cheapPath.precheckDetail")],
    ...(product ? [[words.t("routine.cheapPath.product"), words.t("routine.cheapPath.productDetail")] as [string, string]] : []),
    [words.t("routine.cheapPath.keep"), words.t("routine.cheapPath.keepDetail")],
  ];
  return {
    tool: ASK_CHOICE_TOOL,
    key: cheapPathKey(routine.id),
    wait: false,
    decision: true,
    title: words.t("routine.cheapPath.title", { routine: name }).slice(0, 120),
    question,
    options: choices.map(([label]) => label),
    details: choices.map(([, detail]) => detail),
  };
}

export interface RoutineCheapPathCardsDeps<R extends CheapPathRoutine> {
  /** The routine's runs as stored. */
  runs(routine: R): readonly CheapPathRun[];
  /** A settled run's first tool step (read once per run: a settled run does
   * not change). */
  firstStep(run: CheapPathRun): CheapPathStep | null;
  words(routine: R): ApprovalWords;
  /** Whether this server receives product events (linked to Perspicax). */
  productTrigger(routine: R): boolean;
  /** ask_choice as the routine's bot in its conversation with the person:
   * raises (quiet) or retires (`retire` true). Whether the card was
   * posted: a card that never went out is not marked told, so the next
   * pass tries again. */
  ask(routine: R, input: CheapPathCardInput | { tool: typeof ASK_CHOICE_TOOL; key: string; retire: true }): boolean;
  /** Whether the card raised with `key` is still pending. */
  pending(routine: R, key: string): boolean;
  now(): number;
  signals: SignalLedger;
  person(routine: R): string;
}

/** Bounded memory of first steps: settled runs never change. */
const STEP_CACHE_MAX = 4_000;

export class RoutineCheapPathCards<R extends CheapPathRoutine> {
  private readonly deps: RoutineCheapPathCardsDeps<R>;
  /** Routines whose card this process raised or found, for a delete. */
  private readonly raised = new Map<string, R>();
  private readonly steps = new Map<string, CheapPathStep | null>();

  constructor(deps: RoutineCheapPathCardsDeps<R>) {
    this.deps = deps;
  }

  /** Every routine, once per pass of the needs watch; a routine gone
   * retires its card. */
  syncAll(routines: readonly R[]): void {
    const seen = new Set<string>();
    for (const routine of routines) {
      seen.add(routine.id);
      this.sync(routine);
    }
    for (const [id, routine] of this.raised) {
      if (seen.has(id)) continue;
      this.raised.delete(id);
      this.retire(routine);
    }
  }

  sync(routine: R): void {
    const key = cheapPathKey(routine.id);
    const person = this.deps.person(routine);
    const bot = routine.botId ?? "";
    const entry = this.deps.signals.get(person, bot, key);
    const now = this.deps.now();
    if (entry) {
      // proposed once: only a card still open whose cause is gone is retired
      if ((entry.state === "told" || entry.state === "open") && !cheapPathApplies(routine, now)) this.retire(routine);
      else if (entry.state === "told" || entry.state === "open") this.raised.set(routine.id, routine);
      return;
    }
    if (!cheapPathApplies(routine, now)) return;
    const finding = cheapPathFinding(routine, this.deps.runs(routine), (run) => this.step(run), now);
    if (!finding) return;
    const input = cheapPathCardInput(routine, finding, this.deps.words(routine), this.deps.productTrigger(routine));
    if (!this.deps.ask(routine, input)) return;
    this.raised.set(routine.id, routine);
    this.deps.signals.told(person, { key, kind: CHEAP_PATH_KIND, level: "fyi", bot, label: input.title });
  }

  private step(run: CheapPathRun): CheapPathStep | null {
    if (this.steps.has(run.id)) return this.steps.get(run.id)!;
    const step = this.deps.firstStep(run);
    this.steps.set(run.id, step);
    if (this.steps.size > STEP_CACHE_MAX) this.steps.delete(this.steps.keys().next().value!);
    return step;
  }

  private retire(routine: R): void {
    const key = cheapPathKey(routine.id);
    this.raised.delete(routine.id);
    if (this.deps.pending(routine, key)) this.deps.ask(routine, { tool: ASK_CHOICE_TOOL, key, retire: true });
    this.deps.signals.settle(this.deps.person(routine), routine.botId ?? "", key, "retired");
  }
}
