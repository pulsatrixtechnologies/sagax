// Turn budget (#2737, QA 2026-11-07): a direct turn ran 22 minutes and 86
// steps without answering, frozen 6 minutes on one tool call. Rooms have a
// ceiling (rooms/room-turn-timeout.ts); a person's direct conversation had
// none. This guard gives every direct turn a settable ceiling of active
// minutes (time parked on an approval or question card is not counted) and
// of tool steps. At `wrapUpAt` of either one it steers one note asking for a
// partial answer now; at the ceiling it stops the turn and posts a partial
// render in the person's language: the turn's own working notes, the step
// count and how to continue. Never a silent failure.
//
// Continuation (#3023, 2026-11-08): a long
// task is not cut at the ceiling any more. Reaching it opens a new segment of
// the same turn (same session, same context, no question, no tool cut): the
// counters start again and one visible row says "Suite automatique n/N". Only
// the last segment carries the wrap-up note and the stop with a partial
// answer, so `maxContinuations` (default 10) is the anti-loop safety ceiling;
// the loop guard (#3013) still ends a turn that repeats itself well before.
//
// Settings, first set wins: SAGAX_TURN_BUDGET=0 (off), SAGAX_TURN_MAX_MINUTES
// and SAGAX_TURN_MAX_STEPS (0 = no ceiling), SAGAX_TURN_MAX_CONTINUATIONS,
// config.json `turnBudget.bots[id]`, `turnBudget`, then the defaults (20
// minutes and 80 steps per segment, 10 continuations, note at 75 %).
import { z } from "zod";

import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { reportBackgroundError } from "../background-error.ts";

export const DEFAULT_TURN_MAX_MINUTES = 20;
export const DEFAULT_TURN_MAX_STEPS = 80;
export const DEFAULT_TURN_WRAP_UP_AT = 0.75;
export const DEFAULT_TURN_MAX_CONTINUATIONS = 10;

const minutes = z.number().int().min(1).max(1_440);
const steps = z.number().int().min(5).max(10_000);
const continuations = z.number().int().min(0).max(100);

const limitsSchema = z.object({
  enabled: z.boolean().optional(),
  /** Active minutes before the turn is stopped; null: no time ceiling. */
  maxMinutes: minutes.nullable().optional(),
  /** Tool steps before the turn is stopped; null: no step ceiling. */
  maxSteps: steps.nullable().optional(),
  /** Segments a turn continues into, automatically, past the ceiling (0: stop at the first). */
  maxContinuations: continuations.optional(),
}).strict();

/** The `turnBudget` section of config.json. */
export const turnBudgetConfigSchema = limitsSchema.extend({
  /** Share of a ceiling at which the bot is asked for its partial answer. */
  wrapUpAt: z.number().min(0.5).max(0.95).optional(),
  /** Per-bot overrides, by bot id. */
  bots: z.record(z.string(), limitsSchema).optional(),
}).strict();
export type TurnBudgetConfig = z.output<typeof turnBudgetConfigSchema>;

export interface TurnBudgetSettings {
  enabled: boolean;
  maxMinutes?: number;
  maxSteps?: number;
  /** Automatic continuations past the ceiling; absent reads as none. */
  maxContinuations?: number;
  wrapUpAt: number;
}

function envLimit(value: string | undefined, schema: z.ZodNumber): number | null | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (raw === "0") return null;
  const parsed = schema.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

export function turnBudgetSettings(
  cfg: { turnBudget?: TurnBudgetConfig },
  env: NodeJS.ProcessEnv = process.env,
  botId?: string,
): TurnBudgetSettings {
  const section = cfg.turnBudget;
  const bot = botId ? section?.bots?.[botId] : undefined;
  const pick = (fromEnv: number | null | undefined, key: "maxMinutes" | "maxSteps", fallback: number): number | undefined => {
    if (fromEnv !== undefined) return fromEnv ?? undefined;
    if (bot && bot[key] !== undefined) return bot[key] ?? undefined;
    if (section && section[key] !== undefined) return section[key] ?? undefined;
    return fallback;
  };
  const maxMinutes = pick(envLimit(env.SAGAX_TURN_MAX_MINUTES, minutes), "maxMinutes", DEFAULT_TURN_MAX_MINUTES);
  const maxSteps = pick(envLimit(env.SAGAX_TURN_MAX_STEPS, steps), "maxSteps", DEFAULT_TURN_MAX_STEPS);
  const envContinuations = env.SAGAX_TURN_MAX_CONTINUATIONS?.trim();
  const parsedContinuations = envContinuations ? continuations.safeParse(Number(envContinuations)) : undefined;
  const maxContinuations = parsedContinuations?.success
    ? parsedContinuations.data
    : bot?.maxContinuations ?? section?.maxContinuations ?? DEFAULT_TURN_MAX_CONTINUATIONS;
  return {
    enabled: env.SAGAX_TURN_BUDGET !== "0" && section?.enabled !== false && bot?.enabled !== false,
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    maxContinuations,
    wrapUpAt: section?.wrapUpAt ?? DEFAULT_TURN_WRAP_UP_AT,
  };
}

export type TurnBudgetLanguage = "fr" | "en";

export interface TurnBudgetDeps {
  /** Read at the turn's start and on every check, so a change reaches a running turn. */
  settings(threadId: string): TurnBudgetSettings;
  /** A person's direct conversation that is working now (rooms have their own ceiling). */
  live(threadId: string): boolean;
  canSteer(threadId: string): boolean;
  steer(threadId: string, note: string): Promise<SteerOutcome>;
  /** The person's Stop, for this cause. */
  interrupt(threadId: string, cause: string): Promise<unknown>;
  /** Posts the partial render as the bot's message. */
  post(threadId: string, text: string): void;
  /** Shows one row in the conversation: an automatic continuation started. */
  note?(threadId: string, text: string): void;
  language(threadId: string): TurnBudgetLanguage;
  now?(): number;
  setTimer?(fire: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
  log?(line: string): void;
}

export interface TurnBudget {
  onEvent(event: RuntimeEvent): void;
  settle(threadId: string): void;
  /** #2764: the next turn on this thread continues the same request (a
   * computer switch restarts it): it keeps the steps, minutes and notes
   * already spent instead of a fresh ceiling. */
  carryNext(threadId: string): void;
}

const NOTES_KEPT = 3;
const NOTE_MAX = 700;

interface TurnState {
  turnId?: string;
  steps: number;
  items: Set<string>;
  activeMs: number;
  resumedAt: number | null;
  openRequests: number;
  notes: string[];
  steered: boolean;
  stopped: boolean;
  timer: unknown;
  /** Continuations used, and the steps and active time spent before the current segment. */
  segment: number;
  segmentSteps: number;
  segmentMs: number;
}

function wholeMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function ceilingText(settings: TurnBudgetSettings, language: TurnBudgetLanguage): string {
  const parts: string[] = [];
  if (settings.maxMinutes !== undefined) parts.push(`${settings.maxMinutes} min`);
  if (settings.maxSteps !== undefined) parts.push(language === "fr" ? `${settings.maxSteps} étapes` : `${settings.maxSteps} steps`);
  return parts.join(language === "fr" ? " ou " : " or ");
}

/** Opened as `[Sagax: …]`, which model-written text cannot open. */
export function wrapUpNote(input: { language?: TurnBudgetLanguage; minutes: number; steps: number; ceiling: string }): string {
  if (input.language === "fr") {
    return `[Sagax : ce tour roule depuis ${input.minutes} min et ${input.steps} étapes ; il s'arrête à ${input.ceiling}. Arrête d'explorer et réponds tout de suite à la personne avec ce que tu as, en français : ce que tu as trouvé, ce qui reste et la prochaine étape. Ne lance aucun nouveau script ni aucune chaîne d'outils.]`;
  }
  return `[Sagax: this turn has run ${input.minutes} min and ${input.steps} steps; it is stopped at ${input.ceiling}. Stop exploring now and answer the person with what you have, in their language: what you found, what remains, and the one next step. Start no new script or tool chain.]`;
}

/** The visible row of an automatic continuation. */
export function continuationNote(input: { language?: TurnBudgetLanguage; segment: number; max: number; ceiling: string }): string {
  if (input.language === "fr") {
    return `Suite automatique ${input.segment}/${input.max} : la tâche dépasse ${input.ceiling}, je continue sans m'arrêter`;
  }
  return `Automatic continuation ${input.segment}/${input.max}: the task runs past ${input.ceiling}, carrying on`;
}

/** The partial render posted when the ceiling stops a turn. */
export function partialRender(input: { language: TurnBudgetLanguage; minutes: number; steps: number; ceiling: string; notes: readonly string[] }): string {
  const fr = input.language === "fr";
  const head = fr
    ? `Tour arrêté après ${input.minutes} min et ${input.steps} étapes : le plafond réglable du tour est de ${input.ceiling}.`
    : `Turn stopped after ${input.minutes} min and ${input.steps} steps: this turn's settable ceiling is ${input.ceiling}.`;
  const body = input.notes.length
    ? `${fr ? "Où j'en étais :" : "Where I was:"}\n\n${input.notes.map((note) => `> ${note.replace(/\n+/g, "\n> ")}`).join("\n\n")}`
    : fr ? "Aucune note de travail n'a été écrite avant l'arrêt." : "No working note was written before the stop.";
  const next = fr
    ? "Pour continuer, réponds « continue » : je repars de là. Le plafond se règle dans config.json (turnBudget) ou par SAGAX_TURN_MAX_MINUTES et SAGAX_TURN_MAX_STEPS."
    : "To go on, answer \"continue\" and I pick up from here. The ceiling is set in config.json (turnBudget) or with SAGAX_TURN_MAX_MINUTES and SAGAX_TURN_MAX_STEPS.";
  return `${head}\n\n${body}\n\n${next}`;
}

export function stopCause(input: { language?: TurnBudgetLanguage; minutes: number; steps: number; ceiling: string }): string {
  if (input.language === "fr") {
    return `le tour a atteint son plafond (${input.ceiling}) après ${input.minutes} min et ${input.steps} étapes ; il a été arrêté avec une réponse partielle`;
  }
  return `the turn reached its ceiling (${input.ceiling}) after ${input.minutes} min and ${input.steps} steps - it was stopped with a partial answer`;
}

export function createTurnBudget(deps: TurnBudgetDeps): TurnBudget {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fire: () => void, ms: number) => setTimeout(fire, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const turns = new Map<string, TurnState>();
  /** The last settled turn per thread, kept for a continuation (#2764). */
  const settled = new Map<string, TurnState>();
  const carried = new Set<string>();
  const log = (line: string) => (deps.log ?? console.info)(`[turn-budget] ${line}`);

  const elapsed = (turn: TurnState) => turn.activeMs + (turn.resumedAt === null ? 0 : now() - turn.resumedAt);

  const disarm = (turn: TurnState) => {
    if (turn.timer !== undefined) clearTimer(turn.timer);
    turn.timer = undefined;
  };

  const settle = (threadId: string) => {
    const turn = turns.get(threadId);
    if (turn) {
      disarm(turn);
      if (turn.resumedAt !== null) {
        turn.activeMs += now() - turn.resumedAt;
        turn.resumedAt = null;
      }
      settled.set(threadId, turn);
    }
    turns.delete(threadId);
  };

  const carryNext = (threadId: string) => {
    carried.add(threadId);
  };

  const stop = (threadId: string, turn: TurnState, settings: TurnBudgetSettings) => {
    turn.stopped = true;
    disarm(turn);
    const language = deps.language(threadId);
    const facts = { minutes: wholeMinutes(elapsed(turn)), steps: turn.steps };
    let stopping: Promise<unknown>;
    try {
      stopping = Promise.resolve(deps.interrupt(threadId, stopCause({ language, ...facts, ceiling: ceilingText(settings, language) })));
    } catch {
      return log(`stop not sent: thread=${threadId}`);
    }
    log(`stop sent: thread=${threadId} steps=${facts.steps} minutes=${facts.minutes}`);
    void stopping.then(
      () => deps.post(threadId, partialRender({ language, ...facts, ceiling: ceilingText(settings, language), notes: turn.notes })),
      () => log(`stop rejected: thread=${threadId}`),
    ).catch(reportBackgroundError);
  };

  const steer = (threadId: string, turn: TurnState, settings: TurnBudgetSettings) => {
    turn.steered = true;
    if (!deps.canSteer(threadId)) return;
    const language = deps.language(threadId);
    const note = wrapUpNote({ language, minutes: wholeMinutes(elapsed(turn)), steps: turn.steps, ceiling: ceilingText(settings, language) });
    try {
      void Promise.resolve(deps.steer(threadId, note)).then(
        (outcome) => log(`wrap-up ${outcome}: thread=${threadId}`),
        () => log(`wrap-up rejected: thread=${threadId}`),
      ).catch(reportBackgroundError);
    } catch {
      log(`wrap-up rejected: thread=${threadId}`);
    }
  };

  /** The ceiling was reached with a continuation left: a new segment of the same turn. */
  const continueTurn = (threadId: string, turn: TurnState, settings: TurnBudgetSettings, max: number) => {
    turn.segment += 1;
    turn.segmentSteps = turn.steps;
    turn.segmentMs = elapsed(turn);
    turn.steered = false;
    log(`continue ${turn.segment}/${max}: thread=${threadId} steps=${turn.steps}`);
    const language = deps.language(threadId);
    try {
      deps.note?.(threadId, continuationNote({ language, segment: turn.segment, max, ceiling: ceilingText(settings, language) }));
    } catch {
      log(`continuation row not shown: thread=${threadId}`);
    }
  };

  /** Acts on the ceiling or the wrap-up mark, then arms the timer for the next time mark. */
  const check = (threadId: string) => {
    const turn = turns.get(threadId);
    if (!turn || turn.stopped) return;
    disarm(turn);
    const settings = deps.settings(threadId);
    if (!settings.enabled || !deps.live(threadId)) return;
    const maxContinuations = settings.maxContinuations ?? 0;
    const maxMs = settings.maxMinutes === undefined ? undefined : settings.maxMinutes * 60_000;
    let spent = elapsed(turn) - turn.segmentMs;
    const overSteps = settings.maxSteps !== undefined && turn.steps - turn.segmentSteps >= settings.maxSteps;
    const overTime = maxMs !== undefined && spent >= maxMs;
    if (overSteps || overTime) {
      if (turn.segment >= maxContinuations) return stop(threadId, turn, settings);
      continueTurn(threadId, turn, settings, maxContinuations);
      spent = 0;
    }
    // Only the last segment asks for a partial answer: before it, the task goes on.
    const lastSegment = turn.segment >= maxContinuations;
    const wrapSteps = settings.maxSteps !== undefined && turn.steps - turn.segmentSteps >= Math.ceil(settings.maxSteps * settings.wrapUpAt);
    const wrapMs = maxMs === undefined ? undefined : maxMs * settings.wrapUpAt;
    if (lastSegment && !turn.steered && (wrapSteps || (wrapMs !== undefined && spent >= wrapMs))) steer(threadId, turn, settings);
    // Waiting on a person is not work: no timer while a card is open.
    if (maxMs === undefined || turn.resumedAt === null) return;
    const nextMark = lastSegment && !turn.steered && wrapMs !== undefined && spent < wrapMs ? wrapMs : maxMs;
    turn.timer = setTimer(() => {
      turn.timer = undefined;
      check(threadId);
    }, Math.max(1, nextMark - spent));
  };

  const onEvent = (event: RuntimeEvent) => {
    const { threadId } = event;
    if (event.type === "turn.completed" || event.type === "session.exited") return settle(threadId);
    if (event.type === "turn.started") {
      settle(threadId);
      const before = carried.delete(threadId) ? settled.get(threadId) : undefined;
      settled.delete(threadId);
      turns.set(threadId, {
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        steps: before?.steps ?? 0, items: new Set(), activeMs: before?.activeMs ?? 0, resumedAt: now(), openRequests: 0,
        notes: before ? [...before.notes] : [], steered: before?.steered ?? false, stopped: false, timer: undefined,
        segment: before?.segment ?? 0, segmentSteps: before?.segmentSteps ?? 0, segmentMs: before?.segmentMs ?? 0,
      });
      return check(threadId);
    }
    const turn = turns.get(threadId);
    if (!turn || turn.stopped) return;
    if ("turnId" in event && event.turnId !== undefined && turn.turnId !== undefined && event.turnId !== turn.turnId) return;
    if (event.type === "request.opened") {
      turn.openRequests += 1;
      if (turn.resumedAt !== null) {
        turn.activeMs += now() - turn.resumedAt;
        turn.resumedAt = null;
      }
      return disarm(turn);
    }
    if (event.type === "request.resolved") {
      if (turn.openRequests > 0) turn.openRequests -= 1;
      if (turn.openRequests === 0 && turn.resumedAt === null) turn.resumedAt = now();
      return check(threadId);
    }
    if (event.type === "item.completed" && event.itemType === "assistant_text") {
      const text = event.text.trim();
      if (text) {
        turn.notes.push(text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX)}…` : text);
        if (turn.notes.length > NOTES_KEPT) turn.notes.shift();
      }
      return;
    }
    if (event.type === "item.started" && event.itemType === "tool") {
      const key = event.itemId ?? `step-${turn.steps}`;
      if (turn.items.has(key)) return;
      turn.items.add(key);
      turn.steps += 1;
      check(threadId);
    }
  };

  return { onEvent, settle, carryNext };
}
