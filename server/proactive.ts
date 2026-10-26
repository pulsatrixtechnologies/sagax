// The server-side enforcement of a bot's proactive mode (shared/proactive-mode.ts).
//
// This is where the mechanism adapted from OpenMausBot's proactive routines
// (#3314) is bound to our approval model. Upstream let a workspace "Chief"
// watch the day through one default routine; we keep only the mechanism — a
// bot notices a read-only condition and then initiates a step — and gate every
// step here, per bot, with no Chief and no global watch.
//
// Two jobs:
//  1. Classify a step read vs write on the server, from the real tool or
//     command, never from a flag a caller sent. Anything not plainly read-only
//     is a write, so the unknown always cards.
//  2. Decide the step from the bot's STORED mode. A write never executes from
//     the proactive layer itself: read-auto always cards it (with a dry run),
//     follow-rules hands it to the bot's ordinary approval path (which cards it
//     unless a standing rule the person set already covers it), and propose
//     offers everything through a proposal card. Only a read ever runs on its
//     own (#875: a read opens no card).
//
// The loop is bounded by ProactiveBudget: a minimum interval between cycles and
// a cap on initiations per rolling window, per bot, so a bot cannot run away.

import { isOutboundTool } from "../shared/outbound.ts";
import {
  proactiveGate,
  proactiveMayObserve,
  proactiveModeFor,
  type ProactiveActionKind,
  type ProactiveDisposition,
} from "../shared/proactive-mode.ts";
import { isReadOnlyCommand } from "../shared/read-only-command.ts";

/** Tools that only ever read, beyond what the read-verb heuristic catches. */
const READ_TOOLS = new Set([
  "read_file",
  "list_files",
  "list_routines",
  "screenshot",
  "get_screen_size",
  "browse",
]);

/** Verbs that mean a tool reads. Mirrors shared/outbound.ts's READ_VERBS so
 * the two agree. */
const READ_VERBS = new Set([
  "GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "RETRIEVE", "LOOKUP", "DOWNLOAD", "VIEW", "CHECK", "COUNT",
]);

/** Verbs that mean a tool changes or sends something. A read-shaped name that
 * also carries one of these is treated as a write, to fail safe. */
const WRITE_VERBS = new Set([
  "CREATE", "CREATION", "ADD", "NEW", "UPDATE", "SET", "DELETE", "REMOVE", "WRITE", "EDIT", "PATCH", "PUT",
  "POST", "SEND", "MOVE", "RENAME", "UPLOAD", "ARCHIVE", "CLOSE", "APPROVE", "CANCEL", "ASSIGN", "RUN", "EXECUTE",
]);

function bareTool(tool: string): string {
  const parts = tool.split("__");
  return (parts[parts.length - 1] ?? "").trim();
}

/** The action tokens of a tool name, upper-cased. An MCP `mcp__srv__act`
 * keeps `act`; an engine slug `TOOLKIT_ACTION` drops its toolkit. */
function actionTokens(tool: string): string[] {
  let action = tool;
  if (tool.startsWith("mcp__")) {
    const [, , ...rest] = tool.split("__");
    action = rest.join("_");
  } else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(tool)) {
    action = tool.slice(tool.indexOf("_") + 1);
  }
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

export interface ProactiveActionInput {
  /** The tool or connector action the step would call. */
  tool?: string;
  /** A shell command line, when the tool is a shell runner. */
  command?: string;
}

/** Read vs write, decided from the tool and command only. Fail-safe: anything
 * not plainly read-only is a write. A caller cannot talk a send into a read. */
export function classifyProactiveActionKind(action: ProactiveActionInput): ProactiveActionKind {
  const tool = typeof action.tool === "string" ? action.tool.trim() : "";
  if (!tool) return "write";
  // An outbound, money or contact action is always a write.
  if (isOutboundTool(tool)) return "write";
  const bare = bareTool(tool).toLowerCase();
  // A shell step is read-only only if its whole command line reads.
  if (bare === "run_command" || bare === "bash" || bare === "shell") {
    return isReadOnlyCommand(action.command) ? "read" : "write";
  }
  if (READ_TOOLS.has(bare)) return "read";
  // A plainly named writer is a write.
  if (["write_file", "edit_file", "apply_patch", "propose_routine"].includes(bare)) return "write";
  const tokens = actionTokens(tool);
  if (tokens.length === 0) return "write";
  // A write verb anywhere wins: fail safe.
  if (tokens.some((token) => WRITE_VERBS.has(token))) return "write";
  // Read only when the first or last token is a read verb (GMAIL_FETCH_EMAILS,
  // GOOGLECALENDAR_EVENTS_LIST). Otherwise the unknown cards.
  return READ_VERBS.has(tokens[0]!) || READ_VERBS.has(tokens[tokens.length - 1]!) ? "read" : "write";
}

export interface ProactiveDecisionInput {
  /** The stored bot; only its proactiveMode is read here. */
  bot: { proactiveMode?: unknown };
  action: ProactiveActionInput & {
    /** The full request the bot prepared, forwarded unchanged when a step
     * runs. Never narrowed or split — keeps #938's whole-request hold intact. */
    request?: unknown;
  };
  /** The bot's ordinary approval path: does a standing rule the person set
   * already cover this exact step? Only consulted for a deferred write. */
  coveredByRules: () => boolean;
}

export interface ProactiveDecision {
  /** May the bot sense the condition at all (read-only)? */
  mayObserve: boolean;
  disposition: ProactiveDisposition;
  kind: ProactiveActionKind;
  /** Run the step now with no card. True only for a read, or a deferred write
   * a standing rule already covers (same as a normal action). */
  execute: boolean;
  /** Open our approval card before executing. */
  card: boolean;
  /** Offer the step through a proposal card; execute nothing until a yes. */
  propose: boolean;
  /** A carded or proposed write is previewed as a dry run first. */
  dryRun: boolean;
  /** The request forwarded to the executor or the card, unchanged. */
  forwardedRequest: unknown;
}

/** Decide one proactive step. Server-enforced: the mode comes from the stored
 * bot (unknown fails closed to off) and the kind from the real action. */
export function decideProactiveStep(input: ProactiveDecisionInput): ProactiveDecision {
  const mode = proactiveModeFor(input.bot);
  const kind = classifyProactiveActionKind(input.action);
  const disposition = proactiveGate({ mode, kind });
  const base = {
    mayObserve: proactiveMayObserve(mode),
    disposition,
    kind,
    execute: false,
    card: false,
    propose: false,
    dryRun: false,
    forwardedRequest: input.action.request,
  } satisfies ProactiveDecision;

  switch (disposition) {
    case "blocked":
      return base;
    case "propose":
      // Everything is offered; nothing runs. A write is previewed as a dry run.
      return { ...base, propose: true, dryRun: kind === "write" };
    case "auto":
      // Reads only ever reach here.
      return { ...base, execute: true };
    case "card":
      return { ...base, card: true, dryRun: true };
    case "defer": {
      // A write handed to the ordinary approval path: it runs only if the
      // person's own standing rule covers it, otherwise it cards with a dry
      // run. The request is forwarded whole (never an emptied scope: #938).
      const covered = input.coveredByRules();
      return covered ? { ...base, execute: true } : { ...base, card: true, dryRun: true };
    }
  }
}

export interface ProactiveBudgetOptions {
  /** Least time between two proactive cycles of one bot. */
  minIntervalMs: number;
  /** Most proactive initiations one bot may start in a rolling window. */
  maxPerWindow: number;
  windowMs: number;
  now?: () => number;
}

/** A sane default: a bot wakes at most every 15 minutes and initiates at most
 * 12 times an hour, so a misbehaving prompt cannot loop. */
export const DEFAULT_PROACTIVE_BUDGET: ProactiveBudgetOptions = {
  minIntervalMs: 15 * 60_000,
  maxPerWindow: 12,
  windowMs: 60 * 60_000,
};

/** Bounds the proactive loop per bot. Pure in-memory bookkeeping; the caller
 * checks mayCycle before observing and mayInitiate before starting a step. */
export class ProactiveBudget {
  private readonly opts: Required<ProactiveBudgetOptions>;
  private readonly lastCycle = new Map<string, number>();
  private readonly starts = new Map<string, number[]>();

  constructor(options: ProactiveBudgetOptions = DEFAULT_PROACTIVE_BUDGET) {
    this.opts = { now: () => Date.now(), ...options };
  }

  mayCycle(botId: string): boolean {
    const last = this.lastCycle.get(botId);
    return last === undefined || this.opts.now() - last >= this.opts.minIntervalMs;
  }

  noteCycle(botId: string): void {
    this.lastCycle.set(botId, this.opts.now());
  }

  private recent(botId: string): number[] {
    const now = this.opts.now();
    const kept = (this.starts.get(botId) ?? []).filter((at) => now - at < this.opts.windowMs);
    this.starts.set(botId, kept);
    return kept;
  }

  mayInitiate(botId: string): boolean {
    return this.recent(botId).length < this.opts.maxPerWindow;
  }

  noteInitiate(botId: string): void {
    const kept = this.recent(botId);
    kept.push(this.opts.now());
    this.starts.set(botId, kept);
  }

  /** Drop a bot's bookkeeping, e.g. when it is deleted. */
  forget(botId: string): void {
    this.lastCycle.delete(botId);
    this.starts.delete(botId);
  }
}

export interface ProactiveEngineDeps {
  /** The stored bot, by id; undefined if gone. */
  bot(botId: string): { proactiveMode?: unknown } | undefined;
  /** The bot's ordinary approval path (see decideProactiveStep). */
  coveredByRules(botId: string, action: ProactiveActionInput): boolean;
  budget?: ProactiveBudget;
}

export type ProactiveSkip = "off" | "gone" | "cadence" | "budget";

export interface ProactiveConsideration {
  /** The bot may start this step now. */
  acted: boolean;
  /** Why it did not, when acted is false. */
  reason?: ProactiveSkip;
  decision: ProactiveDecision;
}

/** The drop-in a future observe loop or a trigger handler calls for one bot
 * and one candidate step. It gates the step through the per-bot mode and keeps
 * the loop bounded, so nothing here can run away or weaken the approval model.
 * It is deliberately NOT a Chief: it holds no roster and watches no workspace,
 * it only answers, per bot, "may this one step start, and how". */
export class ProactiveEngine {
  private readonly deps: ProactiveEngineDeps;
  private readonly budget: ProactiveBudget;

  constructor(deps: ProactiveEngineDeps) {
    this.deps = deps;
    this.budget = deps.budget ?? new ProactiveBudget();
  }

  consider(botId: string, action: ProactiveDecisionInput["action"]): ProactiveConsideration {
    const bot = this.deps.bot(botId);
    const blocked = (reason: ProactiveSkip): ProactiveConsideration => ({
      acted: false,
      reason,
      decision: decideProactiveStep({ bot: bot ?? {}, action, coveredByRules: () => false }),
    });
    if (!bot) return blocked("gone");
    const decision = decideProactiveStep({ bot, action, coveredByRules: () => this.deps.coveredByRules(botId, action) });
    // Off costs nothing: it never touches the budget.
    if (decision.disposition === "blocked") return { acted: false, reason: "off", decision };
    if (!this.budget.mayCycle(botId)) return { acted: false, reason: "cadence", decision };
    if (!this.budget.mayInitiate(botId)) return { acted: false, reason: "budget", decision };
    this.budget.noteCycle(botId);
    this.budget.noteInitiate(botId);
    return { acted: true, decision };
  }

  forget(botId: string): void {
    this.budget.forget(botId);
  }
}
