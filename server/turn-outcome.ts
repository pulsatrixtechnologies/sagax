// What a requester learns when the turn it assigned ends without completing.
// The requester (a Chief of Staff, a lead) decides what happens next: send
// what is left, send it again, or tell the person. So it is told the cause in
// the runtime's own words — a stall, a provider reload, a quota, an error —
// what the turn did before it stopped, and the turn's last message whole. A
// bare "error" or "The coordinated turn was interrupted" left it guessing,
// and a guess re-sends the whole assignment. A step cap is not an end: the
// same turn continues in place from the handoff the driver wrote
// (docs/runtime-contract.md §10 PR 4), so TurnStops keeps that path for the
// continuation and no account asks anyone to assign what is left.
//
// The harness (index.ts) folds runtime events into TurnStops, notes there why
// it stops a turn itself, and reads it when a coordinated or delegated turn
// settles; the wording is a pure function.
import { errorTranscript } from "../shared/client-cancel.ts";
import { isOutboundTool } from "../shared/outbound.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { buildTurnDigest, digestTools } from "./digest.ts";
import type { TurnEvidence } from "./runtime/types.ts";
import type { Message } from "./store.ts";

/** The longest cause an outcome repeats: a provider's HTML body or a stack
 * trace is cut, a sentence a requester acts on is not. */
const REASON_CHARS = 600;

export interface TurnStop {
  turnId?: string;
  /** Why the harness stopped the turn itself (a Company change), noted
   * before it interrupts: the turn's own end may settle it first. */
  cause?: string;
  /** The runtime's last error for the turn, a client abort excepted: its
   * runtime.error, or a provider's own error sent as a reply (a usage limit,
   * an overload: RuntimeEventBase.synthetic). */
  error?: string;
  /** The step cap's handoff: every step the turn ran, in order. The same
   * turn continues from it in place (the runtime's `continue`). */
  handoffPath?: string;
}

/** Each thread's turn as its runtime last described a failure — its error
 * and the handoff a step cap wrote — and the harness's cause when it stopped
 * the turn. A new turn on the thread starts clean, and a read names the turn
 * it settles, so an earlier turn's words never stand in. */
export class TurnStops {
  readonly #byThread = new Map<string, TurnStop>();

  note(event: RuntimeEvent): void {
    if (event.type === "turn.started") {
      this.#byThread.delete(event.threadId);
      return;
    }
    const error = event.type === "runtime.error" ? event.message
      : event.type === "item.completed" && event.itemType === "assistant_text" && event.synthetic ? event.text : undefined;
    if (event.type !== "cap.exhausted" && (error === undefined || errorTranscript(error).kind !== "error")) return;
    const stop = this.#turn(event.threadId, event.turnId);
    if (event.type === "cap.exhausted") stop.handoffPath = event.handoffPath;
    else stop.error = error;
  }

  /** The harness is stopping this turn, for this cause: whichever settles it
   * first, its own end or the harness's teardown, reports the same words. */
  stopping(threadId: string, turnId: string | undefined, cause: string): void {
    this.#turn(threadId, turnId).cause = cause;
  }

  #turn(threadId: string, turnId: string | undefined): TurnStop {
    const held = this.#byThread.get(threadId);
    const stop: TurnStop = held && held.turnId === turnId ? held : { turnId };
    this.#byThread.set(threadId, stop);
    return stop;
  }

  read(threadId: string, turnId?: string): TurnStop | undefined {
    const stop = this.#byThread.get(threadId);
    return stop && (!turnId || !stop.turnId || stop.turnId === turnId) ? stop : undefined;
  }

  /** The thread is gone: nothing reads its last stop again. */
  forget(threadId: string): void {
    this.#byThread.delete(threadId);
  }
}

/** The requester's account of a turn that ended without completing. The
 * cause comes first, since a result chip shows only the start; then what the
 * turn did before it stopped, and its last message, unabridged:
 * a report written before a late failure is still the teammate's report. It
 * is quoted, as data: the account reaches prompts the harness speaks in (a
 * delegator's wake), where a teammate's words must never pass for its lines. */
export function stoppedTurnOutcome(input: {
  reason: string;
  /** The thread's messages; only this turn's tool rows are read. */
  activities: readonly Message[];
  turnId?: string;
  said?: string;
}): string {
  const parts = [sentence(clip(input.reason, REASON_CHARS))];
  if (input.turnId) {
    const digest = buildTurnDigest({
      turnId: input.turnId, botId: "", threadId: "", at: 0, durationMs: 0,
      activities: input.activities, memory: [], reply: "", hookCoverage: "preview",
    });
    parts.push(digest.toolCalls
      ? `Before it stopped it made ${digest.toolCalls} tool call${digest.toolCalls === 1 ? "" : "s"}: ${digestTools(digest)}.`
      : "No tool calls were seen before it stopped.");
  }
  const said = input.said?.trim();
  return said ? `${parts.join(" ")}\nIts last message, quoted: ${JSON.stringify(said)}` : parts.join(" ");
}

/** A shell tool, by any engine's name for it: what it ran is in the row's
 * input (the command) or its summary (the command on one line). */
const SHELL_TOOL = /^(?:mcp__[\w-]+?__)?(?:bash|shell|exec|run_command|execute_command|run_shell_command|run_terminal_cmd|terminal|COMPOSIO_REMOTE_BASH_TOOL)$/i;
/** A shell command that leaves something outside the working tree: a
 * commit (history others pull) or a push. */
const GIT_OUTWARD = /\bgit\s+(commit|push)\b/g;
/** A shell command that moves money, by its words. */
const MONEY_OUTWARD = /\b(pay|payment|charge|refund|transfer)\b/gi;
/** The longest error text evidence keeps, and how many. */
const ERROR_CHARS = 200;
const ERRORS_KEPT = 3;

/** A tool activity row of a turn: a bot's activity row with a tool. */
const toolRows = (rows: readonly Message[]) =>
  rows.filter((row) => row.role === "bot" && row.kind === "activity" && row.tool !== undefined);

/** The outward actions a turn's activity rows show it completed — sends,
 * posts, publishes, invites, payments (shared/outbound.ts) and shell
 * commands that committed, pushed or paid — as short labels, each once, in
 * order. The one classifier: the restart policy reads it to decide that a
 * cut turn must not run again (docs/runtime-contract.md §5), and every
 * turn's evidence carries it. Only rows that did not fail count: a refused
 * send sent nothing. */
export function outwardActions(rows: readonly Message[]): string[] {
  const labels: string[] = [];
  const add = (label: string) => { if (!labels.includes(label)) labels.push(label); };
  for (const row of toolRows(rows)) {
    const tool = row.tool!;
    if (tool.ok === false) continue;
    if (isOutboundTool(tool.name)) { add(tool.name); continue; }
    if (!SHELL_TOOL.test(tool.name)) continue;
    const command = [tool.input, tool.summary].filter((text): text is string => typeof text === "string").join("\n");
    for (const git of command.matchAll(GIT_OUTWARD)) add(`git ${git[1]}`);
    for (const money of command.matchAll(MONEY_OUTWARD)) add(money[1]!.toLowerCase());
  }
  return labels;
}

/** What the harness observed of one execution, from its activity rows:
 * the tool calls that returned ok, the last few error texts, and the
 * outward actions it completed. The runtime reads the first two for its
 * continuation guard and the last for its restart policy. An error row is
 * the harness's own error row or a tool that failed; a failed
 * tool's row is named for the tool, so its output's first line is kept
 * beside the name, or three failed shell calls would read as one error
 * three times. */
export function turnEvidence(rows: readonly Message[]): TurnEvidence {
  const tools = toolRows(rows);
  const errors = tools.filter((row) => row.tool!.ok === false).map((row) => {
    const tool = row.tool!;
    const output = tool.itemId && typeof tool.output === "string" ? tool.output.split("\n").find((line) => line.trim()) : undefined;
    return clip(output ? `${tool.name}: ${output}` : tool.name, ERROR_CHARS);
  }).slice(-ERRORS_KEPT);
  const okToolCalls = tools.filter((row) => row.tool!.ok !== false && row.tool!.itemId !== undefined).length;
  const outward = outwardActions(rows);
  return { toolCalls: tools.filter((row) => row.tool!.itemId !== undefined).length, okToolCalls, errors, ...(outward.length ? { outward } : {}) };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?…"]$/.test(capital) ? capital : `${capital}.`;
}
