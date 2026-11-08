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
// Settings, first set wins: SAGAX_TURN_BUDGET=0 (off), SAGAX_TURN_MAX_MINUTES
// and SAGAX_TURN_MAX_STEPS (0 = no ceiling), config.json `turnBudget.bots[id]`,
// `turnBudget`, then the defaults (20 minutes, 80 steps, note at 75 %).
import { z } from "zod";

import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { reportBackgroundError } from "../background-error.ts";

export const DEFAULT_TURN_MAX_MINUTES = 20;
export const DEFAULT_TURN_MAX_STEPS = 80;
export const DEFAULT_TURN_WRAP_UP_AT = 0.75;

const minutes = z.number().int().min(1).max(1_440);
const steps = z.number().int().min(5).max(10_000);

const limitsSchema = z.object({
  enabled: z.boolean().optional(),
  /** Active minutes before the turn is stopped; null: no time ceiling. */
  maxMinutes: minutes.nullable().optional(),
  /** Tool steps before the turn is stopped; null: no step ceiling. */
  maxSteps: steps.nullable().optional(),
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
  return {
    enabled: env.SAGAX_TURN_BUDGET !== "0" && section?.enabled !== false && bot?.enabled !== false,
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
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
  language(threadId: string): TurnBudgetLanguage;
  now?(): number;
  setTimer?(fire: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
  log?(line: string): void;
}

export interface TurnBudget {
  onEvent(event: RuntimeEvent): void;
  settle(threadId: string): void;
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
export function wrapUpNote(input: { minutes: number; steps: number; ceiling: string }): string {
  return `[Sagax: this turn has run ${input.minutes} min and ${input.steps} steps; it is stopped at ${input.ceiling}. Stop exploring now and answer the person with what you have, in their language: what you found, what remains, and the one next step. Start no new script or tool chain.]`;
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

export function stopCause(input: { minutes: number; steps: number; ceiling: string }): string {
  return `the turn reached its ceiling (${input.ceiling}) after ${input.minutes} min and ${input.steps} steps - it was stopped with a partial answer`;
}

export function createTurnBudget(deps: TurnBudgetDeps): TurnBudget {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fire: () => void, ms: number) => setTimeout(fire, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const turns = new Map<string, TurnState>();
  const log = (line: string) => (deps.log ?? console.info)(`[turn-budget] ${line}`);

  const elapsed = (turn: TurnState) => turn.activeMs + (turn.resumedAt === null ? 0 : now() - turn.resumedAt);

  const disarm = (turn: TurnState) => {
    if (turn.timer !== undefined) clearTimer(turn.timer);
    turn.timer = undefined;
  };

  const settle = (threadId: string) => {
    const turn = turns.get(threadId);
    if (turn) disarm(turn);
    turns.delete(threadId);
  };

  const stop = (threadId: string, turn: TurnState, settings: TurnBudgetSettings) => {
    turn.stopped = true;
    disarm(turn);
    const language = deps.language(threadId);
    const facts = { minutes: wholeMinutes(elapsed(turn)), steps: turn.steps };
    let stopping: Promise<unknown>;
    try {
      stopping = Promise.resolve(deps.interrupt(threadId, stopCause({ ...facts, ceiling: ceilingText(settings, "en") })));
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
    const note = wrapUpNote({ minutes: wholeMinutes(elapsed(turn)), steps: turn.steps, ceiling: ceilingText(settings, "en") });
    try {
      void Promise.resolve(deps.steer(threadId, note)).then(
        (outcome) => log(`wrap-up ${outcome}: thread=${threadId}`),
        () => log(`wrap-up rejected: thread=${threadId}`),
      ).catch(reportBackgroundError);
    } catch {
      log(`wrap-up rejected: thread=${threadId}`);
    }
  };

  /** Acts on the ceiling or the wrap-up mark, then arms the timer for the next time mark. */
  const check = (threadId: string) => {
    const turn = turns.get(threadId);
    if (!turn || turn.stopped) return;
    disarm(turn);
    const settings = deps.settings(threadId);
    if (!settings.enabled || !deps.live(threadId)) return;
    const spent = elapsed(turn);
    const maxMs = settings.maxMinutes === undefined ? undefined : settings.maxMinutes * 60_000;
    const overSteps = settings.maxSteps !== undefined && turn.steps >= settings.maxSteps;
    const overTime = maxMs !== undefined && spent >= maxMs;
    if (overSteps || overTime) return stop(threadId, turn, settings);
    const wrapSteps = settings.maxSteps !== undefined && turn.steps >= Math.ceil(settings.maxSteps * settings.wrapUpAt);
    const wrapMs = maxMs === undefined ? undefined : maxMs * settings.wrapUpAt;
    if (!turn.steered && (wrapSteps || (wrapMs !== undefined && spent >= wrapMs))) steer(threadId, turn, settings);
    // Waiting on a person is not work: no timer while a card is open.
    if (maxMs === undefined || turn.resumedAt === null) return;
    const nextMark = !turn.steered && wrapMs !== undefined && spent < wrapMs ? wrapMs : maxMs;
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
      turns.set(threadId, {
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        steps: 0, items: new Set(), activeMs: 0, resumedAt: now(), openRequests: 0, notes: [], steered: false, stopped: false, timer: undefined,
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

  return { onEvent, settle };
}
