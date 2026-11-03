// The chip at 5, 10 and 20 repeats shows whatever the setting, and only this guard writes it (index.ts wrote it too
// until 2026-11-02, so every count showed twice). A call is its tool and its arguments: an MCP call counts by its
// start, with its arguments, when it fails (its ask is not counted), a shell ask by its command and folder, and a call
// an engine reports twice (a start titled with its command, then its ask) counts once. On by default: the guard acts
// on one shell command failing the same way back to back. It steers one note at steerAt, then stops the turn at
// stopAt (10 when unset).
// A turn waiting on a person or a computer is never acted on. Workspace `loopGuard.enabled: false`, per-bot
// `loopGuard: false`, or SAGAX_LOOP_GUARD=0 / OMB_LOOP_GUARD=0 turn it off.
import { z } from "zod";

import { failedTurnTool } from "../../shared/failed-turn.ts";
import { nameIsCommand } from "../../shared/tool-name.ts";
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { quoteInNote } from "../peers/peer-provenance.ts";
import { RepeatDetector, callKey, toolItemKey } from "../safety/repeat-detector.ts";
import { RepeatStreak, failureDigest } from "../safety/repeat-streak.ts";
import { COMMAND_SUMMARY_MAX, previewIsPartial } from "../tools/tool-summary.ts";

const COUNT_MIN = 2;
const COUNT_MAX = 1000;
const count = z.number().int().min(COUNT_MIN).max(COUNT_MAX);
const MAX_CORRECTIVE_ROUNDS = 5;

/** The `loopGuard` section of config.json. */
export const loopGuardConfigSchema = z.object({
  /** On unless false; SAGAX_LOOP_GUARD=0 (or OMB_LOOP_GUARD=0) forces it off. */
  enabled: z.boolean().optional(),
  /** Identical failures in a row before the note; 5 when unset. */
  steerAt: count.optional(),
  /** Identical failures in a row before the turn is stopped; 10 when unset. SAGAX_LOOP_GUARD_STOP_AT (or OMB_*) wins; null clears (never stops). */
  stopAt: count.nullable().optional(),
  /** For bots on API models: times a turn that answers after a failed tool call is sent back to re-run it; 1 when unset. */
  correctiveRounds: z.number().int().min(0).max(MAX_CORRECTIVE_ROUNDS).optional(),
}).strict();
export type LoopGuardConfig = z.output<typeof loopGuardConfigSchema>;

export interface LoopGuardSettings {
  enabled: boolean;
  steerAt: number;
  /** At or below `steerAt`, the turn is stopped without a note first. */
  stopAt?: number;
}

export const DEFAULT_STEER_AT = 5;
export const DEFAULT_STOP_AT = 10;
export const DEFAULT_CORRECTIVE_ROUNDS = 1;

export interface LoopGuardSettingsOpts {
  /** Per-bot override: false turns the guard off for that bot. Absent/true keeps the workspace setting. */
  botEnabled?: boolean;
}

function envStopAt(env: NodeJS.ProcessEnv): string | undefined {
  const sagax = env.SAGAX_LOOP_GUARD_STOP_AT?.trim();
  if (sagax) return sagax;
  return env.OMB_LOOP_GUARD_STOP_AT?.trim();
}

function envGuardOff(env: NodeJS.ProcessEnv): boolean {
  return env.SAGAX_LOOP_GUARD === "0" || env.OMB_LOOP_GUARD === "0";
}

/** On by default (steer, then stop). Workspace, per-bot, or env=0 can turn it off. */
export function loopGuardSettings(
  cfg: { loopGuard?: LoopGuardConfig },
  env: NodeJS.ProcessEnv = process.env,
  opts: LoopGuardSettingsOpts = {},
): LoopGuardSettings {
  const fromEnv = envStopAt(env);
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  const envStop = Number.isInteger(parsed) && parsed >= COUNT_MIN && parsed <= COUNT_MAX ? parsed : undefined;
  const fileStop = cfg.loopGuard?.stopAt;
  const stopAt = envStop ?? (fileStop === null ? undefined : fileStop ?? DEFAULT_STOP_AT);
  return {
    enabled: !envGuardOff(env) && cfg.loopGuard?.enabled !== false && opts.botEnabled !== false,
    steerAt: cfg.loopGuard?.steerAt ?? DEFAULT_STEER_AT,
    ...(stopAt === undefined ? {} : { stopAt }),
  };
}

/** Only with the guard on, like the note and the stop. Defaults to one corrective round. */
export function correctiveRounds(
  cfg: { loopGuard?: LoopGuardConfig },
  env: NodeJS.ProcessEnv = process.env,
  opts: LoopGuardSettingsOpts = {},
): number {
  return loopGuardSettings(cfg, env, opts).enabled
    ? cfg.loopGuard?.correctiveRounds ?? DEFAULT_CORRECTIVE_ROUNDS
    : 0;
}

type ActivityTool = { name: string; ok: false; output?: string };

export interface LoopGuardDeps {
  /** Read on every tool start and completion, so a change reaches a running turn. Pass the thread so a per-bot off is honoured. */
  settings(threadId: string): LoopGuardSettings;
  append(threadId: string, tool: ActivityTool): void;
  /** Necessary for any action: the guard must never speak into or stop a conversation that is not working. */
  live(threadId: string): boolean;
  waiting(threadId: string): boolean;
  /** The decision a person's own message gets in the running turn. */
  canSteer(threadId: string): boolean;
  steer(threadId: string, note: string): Promise<SteerOutcome>;
  /** The person's Stop, for this cause; it writes its transcript rows before it returns. */
  interrupt(threadId: string, cause: string): Promise<unknown>;
  /** Never given the command: its text may hold a credential. */
  log?(line: string): void;
}

export interface LoopGuard {
  onEvent(event: RuntimeEvent): void;
  /** For a turn that ended without an event the guard sees (the stall watchdog), or a deleted thread. */
  settle(threadId: string): void;
}

const NOTICE_AT = [5, 10, 20] as const;
const MAX_CALLS_PER_TURN = 256;
/** Counted starts (or asks) kept per thread for the other to match: an ask follows its start within a few events. */
const MAX_UNMATCHED = 64;
const CALL_QUOTE_MAX = 160;

interface CountedCall {
  key: string;
  tool: string;
  args: string;
  /** An MCP call counts when it fails, not when it starts: a scroll or a
   * poll repeats for good reasons, the same failing call does not. */
  onFailure?: true;
}

/** A call the chip counts, with the texts that name it (a title, a command, its arguments): a tool start and a
 * permission ask that share one are the same call. */
interface SeenCall extends CountedCall {
  texts: string[];
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

type ToolStart = Extract<RuntimeEvent, { type: "item.started" }>;
type Ask = Extract<RuntimeEvent, { type: "request.opened" }>;

/** An MCP tool id as engines title a call (`server__tool`, `mcp__server__tool`). */
const MCP_TOOL_ID = /^(?:mcp__)?[a-z][\w-]{0,63}__[a-z][\w-]{0,127}$/i;
/** Codex asks 'Allow the <server> MCP server to run tool "<tool>"?' (server/drivers/codex/tools.ts): the tool again. */
const CODEX_MCP_ASK = /^Allow the .+ MCP server to run tool ".*"\?$/;
/** Previews are cut (an ask's summary at 200 characters, an ACP title at 80): texts that agree this far name the same
 * call. */
const SAME_TEXT_CHARS = 120;

/** An ask for an MCP tool: the engine named the tool (`mcpTool`), titled the ask with its id (Claude's
 * `mcp__server__tool`), or summed it up with that id alone or with Codex's sentence about it. */
function asksForMcpTool(event: Ask, summary: string): boolean {
  return Boolean(event.mcpTool) || MCP_TOOL_ID.test(event.tool) || MCP_TOOL_ID.test(summary) || CODEX_MCP_ASK.test(summary);
}

/** A permission ask, by its tool and its arguments, whitespace aside. A shell ask is its whole command and the folder
 * it runs in, never the summary or the description Claude writes anew for each call; any other ask is its summary and
 * its arguments. An MCP ask is never counted (2026-11-02): an ACP agent's (kind "other") or Grok's names the tool
 * alone, so different calls of one tool read as one (prod: « other: sagax-environment__run_command », cw_psa_query
 * with 8 distinct arguments), and Claude's would count beside its own start. Every MCP call is counted by its start,
 * with its arguments, when it fails. */
function askedCall(event: Ask): SeenCall | null {
  const summary = oneLine(event.summary ?? "");
  if (asksForMcpTool(event, summary)) return null;
  const input = oneLine(event.input ?? "");
  const command = event.command ? oneLine(event.command.command) : "";
  const key = command
    ? callKey(event.tool, JSON.stringify([command, oneLine(event.command!.cwd)]))
    : callKey(event.tool, input && input !== summary ? JSON.stringify([summary, input]) : summary);
  if (!key) return null;
  const named = summary === event.tool ? "" : summary;
  return { key, tool: event.tool, args: named || command || input, texts: [named, command, input].filter(Boolean) };
}

function countedCall(event: RuntimeEvent): SeenCall | null {
  if (event.type === "request.opened" && event.requestType === "permission") return askedCall(event);
  if (event.type !== "item.started" || event.itemType !== "tool") return null;
  const title = oneLine(event.title ?? "");
  const texts = [title, oneLine(event.summary ?? ""), oneLine(event.input ?? "")].filter(Boolean);
  // An MCP call is the tool with its arguments; with none, it names no call.
  if (MCP_TOOL_ID.test(title)) {
    const input = oneLine(event.input ?? "");
    return input ? { key: `tool:${JSON.stringify([title, input])}`, tool: "tool", args: title, onFailure: true, texts } : null;
  }
  const key = toolItemKey(event.title, event.input);
  // The chip quotes the title only, never the input the key counts on.
  return key ? { key, tool: "tool", args: title, texts } : null;
}

function sameCall(a: readonly string[], b: readonly string[]): boolean {
  return a.some((text) => b.some((other) => text.slice(0, SAME_TEXT_CHARS) === other.slice(0, SAME_TEXT_CHARS)));
}

const CHIP_ERROR_MAX = 300;

/** What the repeat chip says it found: the latest error of that very call, or
 * that none of the earlier ones failed. Never empty, so the step never reads
 * "failed and returned no error message". */
function chipOutput(lastError: string | undefined): string {
  return lastError
    ? `The same call with the same arguments ran again. Its latest error:\n${lastError}`
    : "The same call with the same arguments ran again; the earlier ones did not fail.";
}

/** Undefined for a start with no `summary` (it runs no shell command; ACP titles a read or a wait in words). Null when
 * the input or summary may be cut or masked: it still ran, so it ends the streak. Claude Code, pi and Muse title a
 * shell call "Bash", which the chip never counts; this key is what lets the guard act on them. */
function shellCall(event: ToolStart): CountedCall | null | undefined {
  const { summary, input } = event;
  const command = summary === undefined ? "" : oneLine(summary);
  if (summary === undefined || !command) return undefined;
  const cut = input !== undefined ? previewIsPartial(input) : summary.length >= COMMAND_SUMMARY_MAX || previewIsPartial(summary);
  if (cut) return null;
  const title = oneLine(event.title ?? "");
  const key = callKey("tool", [title, command, input ?? ""].filter(Boolean).join(" "));
  // Codex and ACP title a shell call with the command itself.
  return key ? { key, tool: !title || nameIsCommand(title) ? "tool" : title, args: command } : null;
}

/** Secrets masked before the cut, and no bracket or quote that could close the harness's note early. */
function quoted(call: CountedCall): string {
  return `“${quoteInNote(`${call.tool}: ${call.args}`, CALL_QUOTE_MAX).replace(/[“”]/g, '"')}”`;
}

/** Opened as `[Sagax: …]`, which model-written text cannot open, and never carrying what the command printed. */
function loopNote(call: string, streak: number): string {
  return `[Sagax: this exact call has failed the same way ${streak} times in a row: ${call}. Change approach, or stop and report what is blocking.]`;
}

function loopCause(call: string, streak: number): string {
  return `the same call failed the same way ${streak} times in a row: ${call} - the turn was stopped`;
}

export function createLoopGuard(deps: LoopGuardDeps): LoopGuard {
  const repeats = new RepeatDetector({ thresholds: NOTICE_AT, maxKeysPerThread: MAX_CALLS_PER_TURN });
  const streaks = new RepeatStreak<CountedCall>({ maxPending: MAX_CALLS_PER_TURN });
  const acted = new Map<string, { stopped: boolean; steered: Set<string> }>();
  const turnOf = new Map<string, string>();
  /** Per thread: the counted call each running item is, and each call's latest error. */
  const callOfItem = new Map<string, Map<string, CountedCall>>();
  const lastError = new Map<string, Map<string, string>>();
  const log = (what: string, threadId: string, streak: number) =>
    (deps.log ?? console.info)(`[loop-guard] ${what}: thread=${threadId} failures-in-a-row=${streak}`);

  // An engine that titles a call with its command and also asks for it (ACP, Codex) reports one call twice: the
  // counted starts and asks the other has not matched yet, per thread, so each call counts once whichever comes first.
  const unmatched = new Map<string, { starts: SeenCall[]; asks: SeenCall[] }>();
  /** The start or ask this call was already counted as, else undefined: it is the call's first sighting. */
  const countedAs = (threadId: string, call: SeenCall, start: boolean): SeenCall | undefined => {
    let seen = unmatched.get(threadId);
    if (!seen) unmatched.set(threadId, (seen = { starts: [], asks: [] }));
    const other = start ? seen.asks : seen.starts;
    const match = other.findIndex((earlier) => sameCall(earlier.texts, call.texts));
    if (match >= 0) return other.splice(match, 1)[0];
    const mine = start ? seen.starts : seen.asks;
    mine.push(call);
    if (mine.length > MAX_UNMATCHED) mine.shift();
    return undefined;
  };

  const startOver = (threadId: string) => {
    streaks.settle(threadId);
    acted.delete(threadId);
  };

  const settle = (threadId: string) => {
    repeats.settle(threadId);
    unmatched.delete(threadId);
    startOver(threadId);
    turnOf.delete(threadId);
    callOfItem.delete(threadId);
    lastError.delete(threadId);
  };

  const steer = (threadId: string, note: string, streak: number) => {
    // One attempt: an indeterminate or failed steer may have been delivered, and a second could land twice.
    try {
      void Promise.resolve(deps.steer(threadId, note)).then(
        (outcome) => log(outcome === "steered" ? "steer sent" : `steer ${outcome}`, threadId, streak),
        () => log("steer rejected", threadId, streak),
      );
    } catch {
      log("steer rejected", threadId, streak);
    }
  };

  const stop = (threadId: string, cause: string, streak: number) => {
    let stopping: Promise<unknown>;
    try {
      stopping = Promise.resolve(deps.interrupt(threadId, cause));
    } catch {
      return log("stop not sent", threadId, streak);
    }
    log("stop sent", threadId, streak);
    // Last row, so Retry belongs to it, and written before the engine answers.
    deps.append(threadId, failedTurnTool(cause));
    // One stop per turn; an engine that ignores it runs on, as after the person's Stop.
    void stopping.catch(() => log("stop rejected", threadId, streak));
  };

  const act = (threadId: string, call: CountedCall, streak: number, settings: LoopGuardSettings) => {
    const { stopAt } = settings;
    if (streak < Math.min(settings.steerAt, stopAt ?? settings.steerAt)) return;
    let turn = acted.get(threadId);
    if (turn?.stopped || !deps.live(threadId) || deps.waiting(threadId)) return;
    if (!turn) acted.set(threadId, (turn = { stopped: false, steered: new Set() }));
    // At or past: a streak that passed the mark while the turn was waiting is acted on after the wait.
    if (stopAt !== undefined && streak >= stopAt) {
      turn.stopped = true;
      stop(threadId, loopCause(quoted(call), streak), streak);
      return;
    }
    if (turn.steered.has(call.key) || turn.steered.size >= MAX_CALLS_PER_TURN || !deps.canSteer(threadId)) return;
    turn.steered.add(call.key);
    steer(threadId, loopNote(quoted(call), streak), streak);
  };

  const onEvent = (event: RuntimeEvent) => {
    const { threadId } = event;
    if (event.type === "turn.completed" || event.type === "session.exited") return settle(threadId);
    // A turn's end does not always reach this fold, so a turn's start is a fence too.
    if (event.type === "turn.started") {
      unmatched.delete(threadId);
      startOver(threadId);
      if (event.turnId === undefined) turnOf.delete(threadId);
      else turnOf.set(threadId, event.turnId);
      return;
    }

    const chip = (call: CountedCall) => {
      const { threshold } = repeats.record(threadId, call.key);
      if (!threshold) return;
      const { tool, args } = call;
      deps.append(threadId, {
        name: `Same call repeated ${threshold}× - ${tool}: ${args.slice(0, 80)}${args.length > 80 ? "…" : ""} - it may be stuck`,
        ok: false,
        output: chipOutput(lastError.get(threadId)?.get(call.key)),
      });
    };
    const counted = countedCall(event);
    if (counted) {
      // A call charged where it is reported counts once, under the key it was first counted by (its start, or its
      // ask); an MCP call counts when it fails, by its start alone.
      const earlier = counted.onFailure ? undefined : countedAs(threadId, counted, event.type === "item.started");
      if (event.type === "item.started" && event.itemId) {
        let items = callOfItem.get(threadId);
        if (!items) callOfItem.set(threadId, (items = new Map()));
        if (items.size >= MAX_CALLS_PER_TURN) items.delete(items.keys().next().value!);
        // its errors go to the key it counts under
        items.set(event.itemId, earlier ?? counted);
      }
      if (!earlier && !counted.onFailure) chip(counted);
    }
    if (event.type === "item.completed" && event.itemType === "tool" && event.itemId) {
      const call = callOfItem.get(threadId)?.get(event.itemId);
      if (call) {
        callOfItem.get(threadId)!.delete(event.itemId);
        let errors = lastError.get(threadId);
        if (!event.ok && typeof event.output === "string" && event.output.trim()) {
          if (!errors) lastError.set(threadId, (errors = new Map()));
          if (errors.size >= MAX_CALLS_PER_TURN) errors.delete(errors.keys().next().value!);
          errors.set(call.key, event.output.trim().slice(0, CHIP_ERROR_MAX));
        } else if (event.ok) errors?.delete(call.key);
        if (!event.ok && call.onFailure) chip(call);
      }
    }

    if ((event.type !== "item.started" && event.type !== "item.completed") || event.itemType !== "tool") return;
    const settings = deps.settings(threadId);
    // Nothing is tracked while off, so a streak never spans commands the guard did not see.
    if (!settings.enabled) return streaks.settle(threadId);
    if (event.turnId !== undefined && turnOf.get(threadId) !== event.turnId) {
      startOver(threadId);
      turnOf.set(threadId, event.turnId);
    }
    if (event.type === "item.started") {
      const call = shellCall(event);
      if (call !== undefined) streaks.started(threadId, event.itemId, call);
      return;
    }
    const run = streaks.completed(threadId, event.itemId, failureDigest(event.ok, event.output));
    if (run) act(threadId, run.call, run.streak, settings);
  };

  return { onEvent, settle };
}
