// The chip at 5, 10 and 20 repeats shows whatever the setting. On by default: the guard acts on one shell command
// failing the same way back to back. It steers one note at steerAt, then stops the turn at stopAt (10 when unset).
// A turn waiting on a person or a computer is never acted on. Workspace `loopGuard.enabled: false`, per-bot
// `loopGuard: false`, or SAGAX_LOOP_GUARD=0 / OMB_LOOP_GUARD=0 turn it off.
import { z } from "zod";

import { failedTurnTool } from "../../shared/failed-turn.ts";
import { nameIsCommand } from "../../shared/tool-name.ts";
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { quoteInNote } from "../peer-provenance.ts";
import { RepeatDetector, callKey, toolItemKey } from "../repeat-detector.ts";
import { RepeatStreak, failureDigest } from "../repeat-streak.ts";
import { COMMAND_SUMMARY_MAX, previewIsPartial } from "../tool-summary.ts";

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
const CALL_QUOTE_MAX = 160;

interface CountedCall {
  key: string;
  tool: string;
  args: string;
  /** An MCP call counts when it fails, not when it starts: a scroll or a
   * poll repeats for good reasons, the same failing call does not. */
  onFailure?: true;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function shown(key: string | null): CountedCall | null {
  if (!key) return null;
  const [tool, ...rest] = key.split(":");
  return { key, tool: tool!, args: rest.join(":") };
}

type ToolStart = Extract<RuntimeEvent, { type: "item.started" }>;

/** An MCP tool id as engines title a call (`server__tool`, `mcp__server__tool`). */
const MCP_TOOL_ID = /^(?:mcp__)?[a-z][\w-]{0,63}__[a-z][\w-]{0,127}$/i;

function countedCall(event: RuntimeEvent): CountedCall | null {
  if (event.type === "request.opened" && event.requestType === "permission") {
    // 2026-11-02: an MCP ask (Grok's use_tool, kind "other") is titled with the
    // bare tool id and carries no arguments: five different calls of one tool
    // read as "the same call" (prod: cw_psa_query, 8 distinct calls, one 404).
    // The call's own start counts it, with its arguments.
    const summary = event.summary?.trim() ?? "";
    if (event.mcpTool || MCP_TOOL_ID.test(summary)) return null;
    return shown(callKey(event.tool, event.summary));
  }
  if (event.type !== "item.started" || event.itemType !== "tool") return null;
  const title = (event.title ?? "").trim();
  // An MCP call is the tool with its arguments; with none, it names no call.
  if (MCP_TOOL_ID.test(title)) {
    return event.input?.trim() ? { key: `tool:${JSON.stringify([title, event.input.trim()])}`, tool: "tool", args: title, onFailure: true } : null;
  }
  const key = toolItemKey(event.title, event.input);
  // The chip quotes the title only, never the input the key counts on.
  return key ? { key, tool: "tool", args: title } : null;
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

  const startOver = (threadId: string) => {
    streaks.settle(threadId);
    acted.delete(threadId);
  };

  const settle = (threadId: string) => {
    repeats.settle(threadId);
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
      if (event.type === "item.started" && event.itemId) {
        let items = callOfItem.get(threadId);
        if (!items) callOfItem.set(threadId, (items = new Map()));
        if (items.size >= MAX_CALLS_PER_TURN) items.delete(items.keys().next().value!);
        items.set(event.itemId, counted);
      }
      if (!counted.onFailure) chip(counted);
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
