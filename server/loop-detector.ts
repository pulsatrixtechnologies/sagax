// Stuck-loop detector for agent runs. A run that repeats the same tool call,
// gets the same result or the same error again and again, or cycles through
// a short sequence of calls whose results never change, is not making
// progress: today only spend and depth caps end it. This module is pure and
// engine-independent: it is fed one settled tool call at a time and answers
// whether the run is stuck, with a reason a person can read.
//
// RepeatDetector (server/repeat-detector.ts) only observes and shows a chip;
// this one decides that the run stops (makeLoopStopSubscriber).
//
// Waits, status polls and transient retries are real agent work. They use a
// higher repeat budget so a few unchanged checks do not stop the run, and an
// endless one still does. An error counts only when the input matches too.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { RuntimeEvent } from "../shared/runtime-events.ts";

export interface LoopThresholds {
  /** The same tool with the same input, this many times in a row, whatever
   * it returned (default 5). A wait or a status poll uses POLL_REPEAT_BUDGET
   * when that is higher. */
  identicalCall: number;
  /** The same tool with the same input returning the same result, this many
   * times in a row (default 3). A wait or a status poll uses
   * POLL_REPEAT_BUDGET when that is higher. */
  identicalResult: number;
  /** The same tool with the same input failing with the same error, this
   * many times in a row (default 3). A transient failure uses
   * TRANSIENT_RETRY_BUDGET when that is higher. */
  sameError: number;
  /** A sequence of 2 to maxPeriod calls repeating this many times with
   * unchanged results (default 6). A cycle made only of waits and polls
   * uses POLL_CYCLE_BUDGET when that is higher. */
  cycles: number;
  /** The longest repeating sequence looked for (default 4). */
  maxPeriod: number;
}

export const DEFAULT_LOOP_THRESHOLDS: Readonly<LoopThresholds> = Object.freeze({
  identicalCall: 5,
  identicalResult: 3,
  sameError: 3,
  cycles: 6,
  maxPeriod: 4,
});

/** How many times a wait or a status poll may repeat before it is stuck. */
export const POLL_REPEAT_BUDGET = 24;

/** How many times the same call may fail with a transient error before it
 * is stuck. */
export const TRANSIENT_RETRY_BUDGET = 8;

/** How many times a wait/poll cycle may repeat before it is stuck. */
export const POLL_CYCLE_BUDGET = 12;

/** `loopDetector` in config.json. Every field optional; absent means the
 * default, `enabled: false` turns the detector off. */
export const loopDetectorConfigSchema = z.object({
  enabled: z.boolean().optional(),
  identicalCall: z.number().int().min(2).max(1_000).optional(),
  identicalResult: z.number().int().min(2).max(1_000).optional(),
  sameError: z.number().int().min(2).max(1_000).optional(),
  cycles: z.number().int().min(2).max(100).optional(),
  maxPeriod: z.number().int().min(2).max(10).optional(),
}).strict();

export type LoopDetectorConfig = z.infer<typeof loopDetectorConfigSchema>;

/** The thresholds a config gives, or null when the detector is off. */
export function loopThresholds(config: LoopDetectorConfig | undefined): LoopThresholds | null {
  if (config?.enabled === false) return null;
  return {
    identicalCall: config?.identicalCall ?? DEFAULT_LOOP_THRESHOLDS.identicalCall,
    identicalResult: config?.identicalResult ?? DEFAULT_LOOP_THRESHOLDS.identicalResult,
    sameError: config?.sameError ?? DEFAULT_LOOP_THRESHOLDS.sameError,
    cycles: config?.cycles ?? DEFAULT_LOOP_THRESHOLDS.cycles,
    maxPeriod: config?.maxPeriod ?? DEFAULT_LOOP_THRESHOLDS.maxPeriod,
  };
}

export type LoopKind = "identical-call" | "identical-result" | "same-error" | "cycle";

export interface LoopVerdict {
  stuck: true;
  kind: LoopKind;
  reason: string;
  count: number;
}

export interface ToolCallObservation {
  tool: string;
  /** Raw input: an object, or a string (JSON text is parsed first). */
  input: unknown;
  /** The result text or value; hashed, never kept. */
  result?: unknown;
  error?: boolean;
}

/** JSON with object keys sorted at every depth, so key order never makes
 * two inputs differ. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return normalize(JSON.parse(text)); } catch { /* plain text */ }
    }
    return text.replace(/\s+/g, " ");
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  return value;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(normalize(value))).digest("hex").slice(0, 24);
}

type Pace = "work" | "wait" | "poll";

const WAIT_COMMAND = /^(?:sleep|wait)\b/i;
/** A status read: checks, or get/wait/describe of one resource. */
const STATUS_POLL = /^(?:pr\s+checks|pr\s+status|checks|run\s+(?:view|watch|list)|get\s+\S+|wait\s+\S+|describe\s+\S+)\b/i;
const HTTP_GET = /^(?:curl|wget)\b/i;
const HTTP_WRITE = /\s(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)\b|\s(?:-d|--data|--data-raw|--data-binary|-F|--form)\b/i;
/** Errno names, not a passing mention of a failure. */
const ERRNO_ERROR = /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNABORTED|EPIPE)\b/;
/** "timed out", a timeout that is the error itself, or "aborted due to
 * timeout". "expected timeout" is not. */
const TIMEOUT_ERROR = /\btime(?:d)?\s+out\b|\b(?:request|connection|connect|read|write|gateway|operation|network|socket|response|deadline)\s+timeout\b|\bdue to (?:a )?timeout\b|\btimeout(?:Error|Exception)\b|^(?:error|err)[:\s]+timeout$|^timeout$/i;
/** An HTTP status code, not a line or column number ("line 503") and not a
 * parenthesized number in passing ("see issue (503)"). A bare number counts
 * only as the whole message or with its reason phrase. A status or
 * status_code field, "returned 503", or a code in parentheses next to an
 * HTTP, status, error, or rate-limit word counts too. */
const HTTP_STATUS_ERROR = /\b(?:https?|status(?:[\s_]*code)?|error(?:[\s_]*code)?)["']?[:\s=]+["']?(?:429|502|503|504)\b|\b(?:429|502|503|504)\s+(?:too many requests|bad gateway|service unavailable|gateway time-?out)\b|^(?:429|502|503|504)$|\breturned\s+(?:429|502|503|504)\b|\b(?:https?|status(?:[\s_]*code)?|error(?:[\s_]*code)?|rate\s+limit)\b[^()\n]{0,40}\((?:429|502|503|504)\)/i;
const CONNECTION_RESET_ERROR = /\bconnection reset\b/i;
const SOCKET_HANGUP = /\bsocket hang up\b/i;
/** Proxy failures only: "upstream connect error", "disconnect/reset before
 * headers", and "upstream request timeout". "upstream branch was reset"
 * is a git note, not one of these. */
const UPSTREAM_RESET = /\bupstream connect error\b|\bdisconnect\/reset before headers\b|\bupstream request timeout\b/i;

function commandText(input: unknown): string {
  const value = normalize(input);
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["command", "cmd", "script"]) {
    const part = record[key];
    if (typeof part === "string" && part.trim()) return part;
    if (Array.isArray(part) && part.every((item) => typeof item === "string")) return part.join(" ");
  }
  return "";
}

/** Try the command as written, then without a leading program name, so a
 * status read matches with or without the program in front of it. */
function matchesShape(command: string, shape: RegExp, drops: number): boolean {
  let text = command.trim();
  for (let extra = 0; extra <= drops; extra++) {
    if (shape.test(text)) return true;
    const next = text.replace(/^\S+\s+/, "");
    if (next === text) return false;
    text = next;
  }
  return false;
}

function isHttpPoll(tool: string, input: unknown): boolean {
  const command = commandText(input).trim();
  const candidates = [command, tool.trim()].filter(Boolean);
  for (const text of candidates) {
    if (!matchesShape(text, HTTP_GET, 2)) continue;
    // A write flag on the command keeps the call, even when the tool name
    // itself is the HTTP program.
    if (HTTP_WRITE.test(command || text)) return false;
    return true;
  }
  return false;
}

function paceOf(tool: string, input: unknown): Pace {
  const texts = [commandText(input), tool].map((text) => text.trim()).filter(Boolean);
  if (texts.some((text) => matchesShape(text, WAIT_COMMAND, 1))) return "wait";
  if (texts.some((text) => matchesShape(text, STATUS_POLL, 2))) return "poll";
  if (isHttpPoll(tool, input)) return "poll";
  return "work";
}

function resultText(result: unknown): string {
  const value = normalize(result);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return canonicalJson(value);
}

function transientError(result: unknown, error: boolean): boolean {
  if (!error) return false;
  const text = resultText(result);
  return ERRNO_ERROR.test(text) || TIMEOUT_ERROR.test(text) || HTTP_STATUS_ERROR.test(text)
    || CONNECTION_RESET_ERROR.test(text) || SOCKET_HANGUP.test(text) || UPSTREAM_RESET.test(text);
}

interface Entry {
  tool: string;
  call: string;
  result: string;
  error: boolean;
  pace: Pace;
  transient: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export class LoopDetector {
  private readonly thresholds: LoopThresholds;
  private readonly history: Entry[] = [];
  private readonly keep: number;
  private verdict: LoopVerdict | null = null;

  constructor(thresholds: LoopThresholds) {
    this.thresholds = thresholds;
    const pollRepeats = Math.max(thresholds.identicalCall, thresholds.identicalResult, POLL_REPEAT_BUDGET);
    const transient = Math.max(thresholds.sameError, TRANSIENT_RETRY_BUDGET);
    const cycles = thresholds.maxPeriod * Math.max(thresholds.cycles, POLL_CYCLE_BUDGET);
    this.keep = Math.max(pollRepeats, transient, cycles) + 1;
  }

  /** The first stuck verdict, once reached (it stays). */
  get stuck(): LoopVerdict | null {
    return this.verdict;
  }

  /** Record one settled call. Returns a verdict the first time the run is
   * found stuck, null otherwise (and on every later call). */
  observe(observation: ToolCallObservation): LoopVerdict | null {
    if (this.verdict) return null;
    const tool = observation.tool.trim() || "tool";
    const call = `${tool}\u0000${digest(observation.input)}`;
    const error = observation.error === true;
    this.history.push({
      tool,
      call,
      result: digest(observation.result ?? ""),
      error,
      pace: paceOf(tool, observation.input),
      transient: transientError(observation.result, error),
    });
    if (this.history.length > this.keep) this.history.splice(0, this.history.length - this.keep);
    this.verdict = this.check();
    return this.verdict;
  }

  private tail(match: (entry: Entry, last: Entry) => boolean): number {
    const last = this.history.at(-1)!;
    let count = 0;
    for (let i = this.history.length - 1; i >= 0 && match(this.history[i]!, last); i--) count++;
    return count;
  }

  private check(): LoopVerdict | null {
    const t = this.thresholds;
    const last = this.history.at(-1)!;
    if (last.error) {
      const count = this.tail((e, l) => e.error && e.call === l.call && e.result === l.result);
      const limit = last.transient ? Math.max(t.sameError, TRANSIENT_RETRY_BUDGET) : t.sameError;
      if (count >= limit) {
        return {
          stuck: true, kind: "same-error", count,
          reason: `${last.tool} failed with the same error ${plural(count, "time")} in a row`,
        };
      }
      // A transient retry is not a stuck result. identical-result would
      // otherwise stop it at the ordinary threshold.
      if (last.transient) return this.cycle();
    }
    const relaxed = last.pace !== "work";
    const sameResult = this.tail((e, l) => e.call === l.call && e.result === l.result && e.error === l.error);
    const resultLimit = relaxed ? Math.max(t.identicalResult, POLL_REPEAT_BUDGET) : t.identicalResult;
    if (sameResult >= resultLimit) {
      return {
        stuck: true, kind: "identical-result", count: sameResult,
        reason: `${last.tool} returned the same result ${plural(sameResult, "time")} in a row for the same input`,
      };
    }
    const sameCall = this.tail((e, l) => e.call === l.call);
    const callLimit = relaxed ? Math.max(t.identicalCall, POLL_REPEAT_BUDGET) : t.identicalCall;
    if (sameCall >= callLimit) {
      return {
        stuck: true, kind: "identical-call", count: sameCall,
        reason: `the same ${last.tool} call with the same input ran ${plural(sameCall, "time")} in a row`,
      };
    }
    return this.cycle();
  }

  /** A sequence of `period` calls (not all the same call) repeated `times`
   * times, each call returning what it returned the previous round. */
  private repeated(period: number, times: number): LoopVerdict | null {
    const span = period * times;
    if (this.history.length < span) return null;
    const window = this.history.slice(this.history.length - span);
    const block = window.slice(0, period);
    if (block.every((e) => e.call === block[0]!.call)) return null;
    const repeats = window.every((e, i) => i < period
      || (e.call === window[i - period]!.call && e.result === window[i - period]!.result));
    if (!repeats) return null;
    const names = block.map((e) => e.tool).join(" → ");
    return {
      stuck: true, kind: "cycle", count: times,
      reason: `the calls ${names} repeated ${plural(times, "time")} with no change in their results`,
    };
  }

  private cycle(): LoopVerdict | null {
    const t = this.thresholds;
    for (let period = 2; period <= t.maxPeriod; period++) {
      const found = this.repeated(period, t.cycles);
      if (!found) continue;
      const span = period * t.cycles;
      const window = this.history.slice(this.history.length - span);
      if (window.every((entry) => entry.pace !== "work")) {
        const longer = this.repeated(period, Math.max(t.cycles, POLL_CYCLE_BUDGET));
        if (longer) return longer;
        continue;
      }
      return found;
    }
    return null;
  }
}

/** The text recorded when a run is stopped for a loop. */
export function stuckLoopStopReason(verdict: LoopVerdict): string {
  return `stuck-loop: ${verdict.reason}`;
}

/** Tool name plus the arguments that identify a call. The name is the
 * event's own tool field when it has one, otherwise the full title. The
 * first word of the title is not a name: "Read a.txt" and "Read b.txt"
 * are different calls. A bare name with no arguments is not countable. */
export function toolCallIdentity(source: {
  title?: string;
  tool?: string;
  input?: string;
  summary?: string;
}): { tool: string; input: unknown } | null {
  const named = typeof source.tool === "string" ? source.tool.trim() : "";
  const title = (source.title ?? "").trim();
  const tool = named || title || "tool";
  const explicit = source.input ?? source.summary;
  const input = explicit !== undefined ? explicit : /\s|\//.test(title) ? title : undefined;
  if (input === undefined) return null;
  return { tool, input };
}

export interface LoopStopOptions {
  /** Read on each turn, so a config change applies to the next turn. */
  config: () => LoopDetectorConfig | undefined;
  /** Stop the thread's run with this reason. Called once per turn. */
  stop: (threadId: string, reason: string, verdict: LoopVerdict) => void;
  /** Events to leave out (another turn's late events and the like). Only an
   * event that passes this filter may switch the current turn: a filtered
   * event from an older turn must not clear the turn that is running. A
   * turn completion is still applied, including when this returns true: a
   * stopped turn's completion can be quarantined, and the detector must
   * not stay latched. */
  ignore?: (event: RuntimeEvent) => boolean;
}

interface PendingCall { tool: string; input: unknown }

/** A bus subscriber: pairs each tool call's start (name, input) with its
 * completion (result, error), feeds one LoopDetector per running turn and
 * stops the turn on the first stuck verdict. A call whose input is unknown
 * (a bare tool name) is not counted: two bare "Bash" may differ. */
export function makeLoopStopSubscriber(options: LoopStopOptions): (event: RuntimeEvent) => void {
  const detectors = new Map<string, LoopDetector | null>();
  const pending = new Map<string, Map<string, PendingCall>>();
  const turnIds = new Map<string, string>();
  const forget = (threadId: string) => {
    detectors.delete(threadId);
    pending.delete(threadId);
    turnIds.delete(threadId);
  };
  return (event) => {
    const threadId = event.threadId;
    if (event.type === "turn.completed" || event.type === "session.exited") {
      const known = turnIds.get(threadId);
      // A late completion from an older turn must not wipe a newer one.
      if (event.turnId && known && event.turnId !== known) return;
      forget(threadId);
      return;
    }
    // A filtered event is not part of the running turn. Recording its turn
    // id first would clear that turn's history and then drop the event.
    if (options.ignore?.(event)) return;
    if (event.turnId) {
      const known = turnIds.get(threadId);
      if (known && known !== event.turnId) forget(threadId);
      turnIds.set(threadId, event.turnId);
    }
    if (event.type === "item.started" && event.itemType === "tool") {
      const named = (event as { tool?: unknown }).tool;
      const identity = toolCallIdentity({
        title: event.title,
        input: event.input,
        summary: event.summary,
        tool: typeof named === "string" ? named : undefined,
      });
      if (!identity) return;
      let calls = pending.get(threadId);
      if (!calls) pending.set(threadId, (calls = new Map()));
      if (calls.size >= 64) calls.delete(calls.keys().next().value!);
      calls.set(event.itemId ?? "", identity);
      return;
    }
    if (event.type !== "item.completed" || event.itemType !== "tool") return;
    const calls = pending.get(threadId);
    const key = event.itemId ?? "";
    const call = calls?.get(key);
    if (!call) return;
    calls!.delete(key);
    let detector = detectors.get(threadId);
    if (detector === undefined) {
      const thresholds = loopThresholds(options.config());
      detector = thresholds ? new LoopDetector(thresholds) : null;
      detectors.set(threadId, detector);
    }
    const verdict = detector?.observe({ tool: call.tool, input: call.input, result: event.output, error: !event.ok });
    if (verdict) options.stop(threadId, stuckLoopStopReason(verdict), verdict);
  };
}

export interface LoopStopOwners {
  botId?: string | null;
  groupId?: string | null;
}

export type LoopStopRoute =
  | { kind: "direct"; botId: string }
  | { kind: "room"; groupId: string }
  | { kind: "unowned" };

/** Where a stuck loop on this thread is stopped. A room thread, including
 * one several bots share, uses the room Stop path. A direct thread uses
 * the person's Stop path. A thread with neither is not stopped. */
export function loopStopRoute(owners: LoopStopOwners): LoopStopRoute {
  if (owners.groupId) return { kind: "room", groupId: owners.groupId };
  if (owners.botId) return { kind: "direct", botId: owners.botId };
  return { kind: "unowned" };
}

/** Send a stuck-loop stop to the direct or room path. An unowned thread is
 * reported once. */
export function dispatchLoopStop(
  threadId: string,
  owners: LoopStopOwners,
  actions: {
    stopDirect: (botId: string, threadId: string) => void;
    stopRoom: (groupId: string, threadId: string) => void;
    onUnowned: (threadId: string) => void;
  },
  seenUnowned: Set<string>,
): void {
  const route = loopStopRoute(owners);
  switch (route.kind) {
    case "direct":
      actions.stopDirect(route.botId, threadId);
      return;
    case "room":
      actions.stopRoom(route.groupId, threadId);
      return;
    case "unowned":
      if (seenUnowned.has(threadId)) return;
      seenUnowned.add(threadId);
      actions.onUnowned(threadId);
      return;
    default: {
      const unreachable: never = route;
      return unreachable;
    }
  }
}
