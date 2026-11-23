// Learned routing on top of the quota planner (2026-11-22). A contextual
// Thompson sampler picks among the arms the planner already allows. The
// person's own switch turns it on. Off, or with too few recorded outcomes,
// the caller keeps the planner's pick. A turn's caller passes one model,
// the one the person chose: the sampler then picks an account only.
//
// Exploration never leaves the safe set. An arm the planner did not allow
// is out. A paid key is out unless the person confirmed it; the account the
// conversation is already on is not a new pick. A turn that acts as someone
// may use only the credentials that consent lists.
//
// Outcomes are latency to the first token, tokens per second, errors,
// rate limits, quota burned and a cost tier. Stats live in memory, and in
// usage/learned-routing.json when a data directory is given. The file holds
// counts only, never a prompt and never a key.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { readAtRestTextSync } from "../encryption/content-at-rest.ts";
/** Outcomes required before the sampler may leave the planner's pick. */
export const LEARNED_MIN_OUTCOMES = 12;
/** A context bucket needs this many of its own outcomes before it overrides the global pool. */
export const LEARNED_CONTEXT_MIN = 4;
/** Bonus on the conversation's current account, so a prompt cache is not dropped for a tiny gain. */
export const LEARNED_CACHE_BONUS = 0.05;
/** Bonus on the model the person asked for, until another model is clearly better. */
export const LEARNED_MODEL_BONUS = 0.04;

const PRIOR_MEAN = 0.35;
const PRIOR_SD = 0.22;
const PRIOR_STRENGTH = 2;
const MAX_STATS = 4_000;
const SAVE_EVERY_MS = 60_000;
const TTFT_SCALE_MS = 800;
const SPEED_SCALE = 40;
const QUOTA_SCALE = 20;

export interface RoutingContext {
  provider: string;
  /** The model the person asked for. Empty when the turn did not name one. */
  requestedModel: string;
  hourUtc: number;
  promptTokens: number;
  fresh: boolean;
}

export interface RoutingArm {
  instanceId: string;
  model: string;
  /** The credential bills each use. */
  paid: boolean;
  /** The person confirmed this paid credential may be selected. */
  paidConfirmed: boolean;
  /** The quota planner, or the simple rule it fell back to, allows this account. */
  plannerEligible: boolean;
  /** 1 is cheapest. Higher spends more. */
  costTier: number;
}

/** Set only when the turn acts as someone. Empty allows no credential. */
export interface ActAsConsent {
  consentedInstanceIds: readonly string[];
}

export interface RoutingOutcome {
  instanceId: string;
  model: string;
  context: RoutingContext;
  ttftMs: number;
  tokensPerSec: number;
  error: boolean;
  rateLimited: boolean;
  /** Percent points of the quota window this turn burned. */
  quotaBurn: number;
  costTier: number;
  at: number;
}

export type RoutingDecision =
  | { by: "planner"; reason: "off" | "thin" | "same" }
  | { by: "learned"; instanceId: string; model: string }
  | { by: "held"; reason: "paid" | "act-as" | "quota" };

interface ArmStat { n: number; mean: number; m2: number }
interface SavedFile { version: 1; total: number; stats: Record<string, ArmStat> }

export interface LearnedChooseInput {
  enabled: boolean;
  plannerInstanceId: string;
  plannerModel: string;
  currentInstanceId: string;
  context: RoutingContext;
  arms: readonly RoutingArm[];
  actAs: ActAsConsent | null;
  rng?: () => number;
}

export interface LearnedRouter {
  record(outcome: RoutingOutcome): void;
  choose(input: LearnedChooseInput): RoutingDecision;
  observations(): number;
  flush(): void;
}

/** Hour bucket, prompt size and whether the conversation is new. No prompt text. */
export function routingContextKey(context: RoutingContext): string {
  const hour = context.hourUtc < 8 ? "night" : context.hourUtc < 16 ? "day" : "evening";
  const prompt = context.promptTokens < 2_000 ? "s" : context.promptTokens < 16_000 ? "m" : "l";
  const provider = context.provider.replace(/[^\w.-]/g, "").slice(0, 40) || "provider";
  return `${provider}:${hour}:${prompt}:${context.fresh ? "new" : "open"}`;
}

/** 0 to 1. An error or a rate limit scores 0. Higher is a better arm. */
export function routingReward(outcome: Pick<RoutingOutcome, "ttftMs" | "tokensPerSec" | "error" | "rateLimited" | "quotaBurn" | "costTier">): number {
  if (outcome.error || outcome.rateLimited) return 0;
  const ttft = 1 / (1 + Math.max(0, outcome.ttftMs) / TTFT_SCALE_MS);
  const speed = Math.max(0, outcome.tokensPerSec) / (Math.max(0, outcome.tokensPerSec) + SPEED_SCALE);
  const quota = 1 - Math.min(1, Math.max(0, outcome.quotaBurn) / QUOTA_SCALE);
  const tier = Math.min(1, Math.max(0, outcome.costTier - 1) / 4);
  const score = 0.45 * ttft + 0.25 * speed + 0.15 * quota + 0.15 * (1 - tier);
  return Math.max(0, Math.min(1, score));
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u <= 0) u = rng();
  while (v <= 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleScore(stat: ArmStat | undefined, rng: () => number): number {
  const n = stat?.n ?? 0;
  const mean = n === 0 || !stat ? PRIOR_MEAN : (PRIOR_STRENGTH * PRIOR_MEAN + n * stat.mean) / (PRIOR_STRENGTH + n);
  const observedVar = n > 1 && stat ? Math.max(0, stat.m2 / (n - 1)) : PRIOR_SD * PRIOR_SD;
  const sd = Math.sqrt(observedVar / (PRIOR_STRENGTH + n));
  return mean + sd * gaussian(rng);
}

function addStat(stat: ArmStat, value: number): void {
  stat.n += 1;
  const delta = value - stat.mean;
  stat.mean += delta / stat.n;
  stat.m2 += delta * (value - stat.mean);
}

function cleanOutcome(outcome: RoutingOutcome): RoutingOutcome | null {
  if (!outcome.instanceId.trim()) return null;
  if (!Number.isFinite(outcome.ttftMs) || outcome.ttftMs < 0) return null;
  if (!Number.isFinite(outcome.tokensPerSec) || outcome.tokensPerSec < 0) return null;
  if (!Number.isFinite(outcome.quotaBurn) || !Number.isFinite(outcome.costTier)) return null;
  return {
    ...outcome,
    instanceId: outcome.instanceId.slice(0, 200),
    model: outcome.model.slice(0, 200),
    quotaBurn: Math.max(0, Math.min(100, outcome.quotaBurn)),
    costTier: Math.max(1, Math.min(5, outcome.costTier)),
    error: outcome.error === true,
    rateLimited: outcome.rateLimited === true,
  };
}

function validStat(value: unknown): ArmStat | null {
  if (!value || typeof value !== "object") return null;
  const stat = value as ArmStat;
  if (!Number.isInteger(stat.n) || stat.n < 0 || stat.n > 1_000_000) return null;
  if (!Number.isFinite(stat.mean) || !Number.isFinite(stat.m2) || stat.m2 < 0) return null;
  return { n: stat.n, mean: stat.mean, m2: stat.m2 };
}

function armOf(instanceId: string, model: string): string {
  return `${instanceId}\u0000${model}`;
}

function isSafe(arm: RoutingArm, input: LearnedChooseInput): boolean {
  if (!arm.plannerEligible || !arm.instanceId.trim()) return false;
  if (input.actAs && !input.actAs.consentedInstanceIds.includes(arm.instanceId)) return false;
  if (arm.paid && !arm.paidConfirmed && arm.instanceId !== input.currentInstanceId) return false;
  return true;
}

function heldReason(planner: RoutingArm | undefined, actAs: ActAsConsent | null): "paid" | "act-as" | "quota" {
  if (planner && actAs && !actAs.consentedInstanceIds.includes(planner.instanceId)) return "act-as";
  if (planner?.paid && !planner.paidConfirmed && planner.instanceId) return "paid";
  return "quota";
}

export function createLearnedRouter(options: { dataDir?: string; now?: () => number; rng?: () => number } = {}): LearnedRouter {
  const now = options.now ?? (() => Date.now());
  const file = options.dataDir ? join(options.dataDir, "usage", "learned-routing.json") : null;
  const stats = new Map<string, ArmStat>();
  let total = 0;
  let dirty = false;
  let savedAt = 0;
  if (file) {
    try {
      const raw = JSON.parse(readAtRestTextSync(file)) as SavedFile;
      if (raw?.version === 1 && raw.stats && typeof raw.stats === "object") {
        for (const [key, value] of Object.entries(raw.stats)) {
          const stat = validStat(value);
          if (stat && key.length <= 400) stats.set(key, stat);
        }
        total = Number.isFinite(raw.total) && raw.total > 0 ? Math.floor(raw.total) : 0;
      }
    } catch {
      // no store yet, or a store this process cannot read
    }
  }
  const save = (force = false) => {
    if (!file || (!force && (!dirty || now() - savedAt < SAVE_EVERY_MS))) return;
    try {
      const saved: SavedFile = { version: 1, total, stats: Object.fromEntries(stats) };
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, `${JSON.stringify(saved)}\n`, { mode: 0o600, durable: false });
      savedAt = now();
      dirty = false;
    } catch {
      // a full disk keeps the counts in memory; the planner still answers
    }
  };
  const touch = (key: string, value: number) => {
    const stat = stats.get(key) ?? { n: 0, mean: 0, m2: 0 };
    addStat(stat, value);
    stats.delete(key);
    stats.set(key, stat);
  };

  return {
    record(outcome) {
      const clean = cleanOutcome(outcome);
      if (!clean) return;
      const reward = routingReward(clean);
      const arm = armOf(clean.instanceId, clean.model);
      touch(`${routingContextKey(clean.context)}\u0000${arm}`, reward);
      touch(`*\u0000${arm}`, reward);
      total += 1;
      while (stats.size > MAX_STATS) {
        const oldest = stats.keys().next().value;
        if (oldest === undefined) break;
        stats.delete(oldest);
      }
      dirty = true;
      save(false);
    },
    observations: () => total,
    flush: () => save(true),
    choose(input) {
      if (!input.enabled) return { by: "planner", reason: "off" };
      const seen = new Set<string>();
      const arms = input.arms.filter((arm) => {
        const key = armOf(arm.instanceId, arm.model);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const planner = arms.find((arm) => arm.instanceId === input.plannerInstanceId && arm.model === input.plannerModel)
        ?? arms.find((arm) => arm.instanceId === input.plannerInstanceId);
      const safe = arms.filter((arm) => isSafe(arm, input));
      if (!safe.length) return { by: "held", reason: heldReason(planner, input.actAs) };
      const plannerSafe = planner ? safe.some((arm) => arm.instanceId === planner.instanceId && arm.model === planner.model) : false;
      if (!plannerSafe) {
        const rng = input.rng ?? options.rng ?? Math.random;
        const pick = total < LEARNED_MIN_OUTCOMES
          ? safe.find((arm) => arm.instanceId === input.currentInstanceId) ?? safe[0]!
          : bestArm(safe, input, stats, rng);
        return { by: "learned", instanceId: pick.instanceId, model: pick.model };
      }
      if (total < LEARNED_MIN_OUTCOMES) return { by: "planner", reason: "thin" };
      const rng = input.rng ?? options.rng ?? Math.random;
      const pick = bestArm(safe, input, stats, rng);
      if (planner && pick.instanceId === planner.instanceId && pick.model === planner.model) return { by: "planner", reason: "same" };
      return { by: "learned", instanceId: pick.instanceId, model: pick.model };
    },
  };
}

function bestArm(arms: readonly RoutingArm[], input: LearnedChooseInput, stats: Map<string, ArmStat>, rng: () => number): RoutingArm {
  const context = routingContextKey(input.context);
  let best = arms[0]!;
  let bestScore = -Infinity;
  for (const arm of arms) {
    const id = armOf(arm.instanceId, arm.model);
    const local = stats.get(`${context}\u0000${id}`);
    const global = stats.get(`*\u0000${id}`);
    const stat = local && local.n >= LEARNED_CONTEXT_MIN ? local : global ?? local;
    let score = sampleScore(stat, rng);
    if (!input.context.fresh && arm.instanceId === input.currentInstanceId) score += LEARNED_CACHE_BONUS;
    if (input.context.requestedModel && arm.model === input.context.requestedModel) score += LEARNED_MODEL_BONUS;
    const tie = Math.abs(score - bestScore) <= 1e-9;
    const prefer = tie && arm.instanceId === input.plannerInstanceId && arm.model === input.plannerModel;
    if (score > bestScore + 1e-9 || prefer) {
      best = arm;
      bestScore = score;
    }
  }
  return best;
}

/** What a settled turn can tell the sampler. `model` is the person's choice. */
export interface SettledLearnedTurn {
  instanceId: string;
  model: string;
  provider: string;
  promptTokens: number;
  fresh: boolean;
  ttftMs: number;
  durationMs: number;
  outputTokens: number;
  ok: boolean;
  /** The person stopped the turn. A stop is not an outcome. */
  stopped: boolean;
  limited: "quota" | "rate_limited" | null;
  quotaBurn: number;
  costTier: number;
  at: number;
}

/** The row `record` stores. Null when the person stopped the turn, or the turn names no account or model. */
export function outcomeOfSettledTurn(turn: SettledLearnedTurn): RoutingOutcome | null {
  if (turn.stopped || !turn.instanceId.trim() || !turn.model.trim()) return null;
  const durationMs = Number.isFinite(turn.durationMs) && turn.durationMs > 0 ? turn.durationMs : 0;
  const output = Number.isFinite(turn.outputTokens) && turn.outputTokens > 0 ? turn.outputTokens : 0;
  const at = Number.isFinite(turn.at) ? turn.at : 0;
  return {
    instanceId: turn.instanceId,
    model: turn.model,
    context: {
      provider: turn.provider.trim() || "provider",
      requestedModel: turn.model,
      hourUtc: new Date(at).getUTCHours(),
      promptTokens: Number.isFinite(turn.promptTokens) && turn.promptTokens > 0 ? Math.floor(turn.promptTokens) : 0,
      fresh: turn.fresh === true,
    },
    ttftMs: Number.isFinite(turn.ttftMs) && turn.ttftMs > 0 ? turn.ttftMs : 0,
    tokensPerSec: output / (Math.max(durationMs, 1) / 1000),
    error: turn.ok !== true,
    rateLimited: turn.limited === "rate_limited",
    quotaBurn: Number.isFinite(turn.quotaBurn) ? turn.quotaBurn : 0,
    costTier: Number.isFinite(turn.costTier) ? turn.costTier : 1,
    at,
  };
}
