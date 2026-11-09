// Pulsatrix Flow watches (2026-11-09): every product task of Pulsatrix
// tied to a profile includes proactive work, and a bot that holds a
// Pulsatrix profile is proactive by default (shared/proactive-mode.ts: no
// stored mode reads as proactive, the old "follow-rules"; a chosen off is
// stored and kept).
//
// This is the observe loop ProactiveEngine was waiting for. For each bot
// whose mode is not off:
//   1. the products of the Pulsatrix profiles it holds: the APIs its owner's
//      account connection serves (api_list), matched to Flow's products;
//   2. the watches of those products from the Flow plugin's helper
//      (`px_flow.py proactive --product ...`), cached and reloaded hourly;
//   3. each watch on its cadence (`15m`, `1h`, `daily@HH:MM`,
//      `weekly:sun@HH:MM`, local time of the tenant);
//   4. `observe` runs as a READ on a short-lived connection with the owner's
//      routine credentials (as a routine of the bot): a tool Perspicax marks
//      read-only (or a plainly read-named one), `flow_run read recipe plan`,
//      or `flow_action` without `confirm` (Perspicax sends no write then).
//      An observe that is not a read never runs;
//   5. `when` (JMESPath) on the observed value; true and not already seen
//      (watch id + key of the result) goes through ProactiveEngine.consider
//      (stored mode, per-bot budget) and decideProactiveStep;
//   6. the step becomes a proactive wake (source "watch") of the bot: one
//      background turn whose report lands in the bot's one conversation
//      (unified chat, never a separate thread). A read runs; a write is
//      planned as a dry run and goes through the ordinary approval path
//      (the card in that same conversation). The proactive layer never runs
//      a write on its own.
//
// Dedup: a condition that stays true with the same key never wakes again;
// it can fire again once it turned false, or when its key changes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import jmespath from "jmespath";

import { writeFileAtomic } from "../atomic.ts";
import { classifyProactiveActionKind, type ProactiveEngine } from "./proactive.ts";
import type { ProactiveEvent, ProactiveOfferVerdict } from "./proactive-wake.ts";
import { proactiveMayObserve, proactiveModeFor } from "../../shared/proactive-mode.ts";
import { factsOfReference, factTopics, resolveWatchTokens, type WatchTokenContext } from "./watch-tokens.ts";

type Json = Record<string, unknown>;

export type WatchObserve =
  | { tool: string; args: Json }
  | { recipe: string }
  | { action: string; params: Json };

export type WatchPropose =
  | { skill: string }
  | { routine: string }
  | { action: string; params: Json };

/** One watch of the Flow contract (`px_flow.py proactive`). */
export interface FlowWatch {
  id: string;
  skill: string;
  products: string[];
  domain: string;
  summary: string;
  observe: WatchObserve;
  when: string;
  cadence: string;
  propose: WatchPropose;
  kind: "read" | "write";
  prompt: string;
}

export interface FlowWatchListing {
  watches: FlowWatch[];
  /** The tenant's time zone when the helper says it. */
  timeZone?: string;
  /** Rows dropped because they did not match the contract. */
  rejected: number;
}

const ID = /^[\w.:-]{1,120}$/;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function observeOf(value: unknown): WatchObserve | null {
  if (!isObject(value)) return null;
  const tool = text(value.tool, 160);
  if (tool) return { tool, args: isObject(value.args) ? value.args : {} };
  const recipe = text(value.recipe, 160);
  if (recipe) return { recipe };
  const action = text(value.action, 160);
  if (action) return { action, params: isObject(value.params) ? value.params : {} };
  return null;
}

function proposeOf(value: unknown): WatchPropose | null {
  if (!isObject(value)) return null;
  const skill = text(value.skill, 160);
  if (skill) return { skill };
  const routine = text(value.routine, 160);
  if (routine) return { routine };
  const action = text(value.action, 160);
  if (action) return { action, params: isObject(value.params) ? value.params : {} };
  return null;
}

/** One validated watch, or null. A watch that cannot be read whole is
 * dropped, never half-run. */
export function watchOf(row: unknown): FlowWatch | null {
  if (!isObject(row)) return null;
  const id = text(row.id, 120);
  const when = text(row.when, 2_000);
  const cadence = text(row.cadence, 40);
  const prompt = text(row.prompt, 4_000);
  const observe = observeOf(row.observe);
  const propose = proposeOf(row.propose);
  if (!id || !ID.test(id) || !when || !cadence || !parseCadence(cadence) || !prompt || !observe || !propose) return null;
  try {
    // tokens are resolved before the run; checked here with a stand-in
    (jmespath as unknown as { compile(expression: string): unknown }).compile(when.replace(/\{\{[^{}]*\}\}/g, "x"));
  } catch {
    return null;
  }
  const products = Array.isArray(row.products) ? row.products.flatMap((item) => (text(item, 80) ? [text(item, 80)!.toLowerCase()] : [])) : [];
  return {
    id,
    skill: text(row.skill, 160) ?? "",
    products,
    domain: text(row.domain, 80) ?? "",
    summary: text(row.summary, 300) ?? id,
    observe,
    when,
    cadence,
    propose,
    // anything but an explicit read is a write: fail safe
    kind: row.kind === "read" ? "read" : "write",
    prompt,
  };
}

/** The helper's stdout, read whole. Bad JSON is no watch at all. */
export function parseWatchListing(stdout: string): FlowWatchListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { watches: [], rejected: 0 };
  }
  const rows = isObject(parsed) && Array.isArray(parsed.watches) ? parsed.watches : [];
  const watches: FlowWatch[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const row of rows) {
    const watch = watchOf(row);
    if (!watch || seen.has(watch.id)) {
      rejected += 1;
      continue;
    }
    seen.add(watch.id);
    watches.push(watch);
  }
  const zone = isObject(parsed) ? text(parsed.timezone ?? parsed.timeZone, 64) : undefined;
  return { watches, rejected, ...(zone && validTimeZone(zone) ? { timeZone: zone } : {}) };
}

// ── cadence ────────────────────────────────────────────────────────────────

export type Cadence =
  | { kind: "every"; ms: number }
  | { kind: "daily"; minutes: number }
  | { kind: "weekly"; day: number; minutes: number };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** `15m`, `1h`, `daily@HH:MM`, `weekly:sun@HH:MM`; null otherwise. */
export function parseCadence(value: string): Cadence | null {
  const raw = value.trim().toLowerCase();
  const every = /^(\d{1,4})(m|h)$/.exec(raw);
  if (every) {
    const ms = Number(every[1]) * (every[2] === "h" ? 3_600_000 : 60_000);
    return ms >= 60_000 ? { kind: "every", ms } : null;
  }
  const clock = (hh: string, mm: string): number | null => {
    const h = Number(hh);
    const m = Number(mm);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  };
  const daily = /^daily@(\d{1,2}):(\d{2})$/.exec(raw);
  if (daily) {
    const minutes = clock(daily[1]!, daily[2]!);
    return minutes === null ? null : { kind: "daily", minutes };
  }
  const weekly = /^weekly:([a-z]{3})@(\d{1,2}):(\d{2})$/.exec(raw);
  if (weekly) {
    const day = DAYS.indexOf(weekly[1]!);
    const minutes = clock(weekly[2]!, weekly[3]!);
    return day < 0 || minutes === null ? null : { kind: "weekly", day, minutes };
  }
  return null;
}

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock of an instant in a zone. */
function wall(at: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    y: Number(get("year")), mo: Number(get("month")) - 1, d: Number(get("day")),
    h: Number(get("hour")) % 24, mi: Number(get("minute")),
    dow: DAYS.indexOf(get("weekday").slice(0, 3).toLowerCase()),
  };
}

/** The instant of a local wall time in a zone (DST: the first match). */
function instantOf(y: number, mo: number, d: number, minutes: number, timeZone: string): number {
  const target = Date.UTC(y, mo, d, Math.floor(minutes / 60), minutes % 60);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const seen = wall(guess, timeZone);
    const shown = Date.UTC(seen.y, seen.mo, seen.d, seen.h, seen.mi);
    guess += target - shown;
  }
  return guess;
}

/** The latest scheduled moment at or before `now` (daily and weekly). */
export function lastOccurrence(cadence: Exclude<Cadence, { kind: "every" }>, now: number, timeZone: string): number {
  const today = wall(now, timeZone);
  const back = cadence.kind === "weekly" ? (today.dow - cadence.day + 7) % 7 : 0;
  let at = instantOf(today.y, today.mo, today.d - back, cadence.minutes, timeZone);
  if (at > now) at = instantOf(today.y, today.mo, today.d - back - (cadence.kind === "weekly" ? 7 : 1), cadence.minutes, timeZone);
  return at;
}

/** Whether a watch is due now. A calendar cadence never catches up on a
 * first sight: `last` undefined waits for the next moment (the caller
 * records `now` as seen). An interval runs at once on first sight. */
export function cadenceDue(cadence: Cadence, last: number | undefined, now: number, timeZone: string): boolean {
  if (cadence.kind === "every") return last === undefined || now - last >= cadence.ms;
  if (last === undefined) return false;
  return lastOccurrence(cadence, now, timeZone) > last;
}

// ── condition ──────────────────────────────────────────────────────────────

/** JMESPath truth: false, null, "", [] and {} are false. */
export function jmesTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** Evaluate `when` on the observed value. The key of the condition is the
 * expression's own result when it says more than true (a list of tickets,
 * a count), else the observed value. A bad expression is false. */
export function evaluateWhen(expression: string, observed: unknown): { holds: boolean; key: string } {
  let result: unknown;
  try {
    result = jmespath.search(observed as never, expression);
  } catch {
    return { holds: false, key: "" };
  }
  const holds = jmesTruthy(result);
  const basis = result === true ? observed : result;
  return { holds, key: holds ? createHash("sha256").update(stable(basis)).digest("hex").slice(0, 16) : "" };
}

// ── profiles to products ───────────────────────────────────────────────────

const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The Flow products the served APIs reach. A product matches an API when
 * its whole name is in the API's id or name; an API no product matches
 * whole falls back to a distinctive part of the product name (4 letters or
 * more), e.g. `axcient-x360` for "X360Recover API". */
export function productsForApis(apis: ReadonlyArray<{ id: string; name: string }>, universe: readonly string[]): string[] {
  const out = new Set<string>();
  const products = [...new Set(universe.map((product) => product.toLowerCase()))];
  for (const api of apis) {
    const haystacks = [fold(api.id), fold(api.name)].filter(Boolean);
    const whole = products.filter((product) => fold(product) && haystacks.some((hay) => hay.includes(fold(product))));
    if (whole.length) {
      for (const product of whole) out.add(product);
      continue;
    }
    for (const product of products) {
      if (product.split(/[^a-z0-9]+/).some((part) => part.length >= 4 && haystacks.some((hay) => hay.includes(part)))) out.add(product);
    }
  }
  return [...out].sort();
}

/** Watches of a bot: those of its products, and those that name none. */
export function watchesForProducts(watches: readonly FlowWatch[], products: readonly string[]): FlowWatch[] {
  const held = new Set(products);
  return watches.filter((watch) => watch.products.length === 0 || watch.products.some((product) => held.has(product)));
}

// ── the observe step ───────────────────────────────────────────────────────

export interface ObserveSession {
  tools: ReadonlySet<string>;
  readOnly: ReadonlySet<string>;
  call(name: string, args: Json): Promise<{ ok: true; isError: boolean; value: unknown } | { ok: false; error: string }>;
}

/** The read call of an observe, or why it cannot run as a read. */
export function observeCall(observe: WatchObserve, session: Pick<ObserveSession, "tools" | "readOnly">): { name: string; args: Json } | { refused: string } {
  if ("tool" in observe) {
    if (!session.tools.has(observe.tool)) return { refused: `${observe.tool} is not served to this person` };
    const read = session.readOnly.has(observe.tool) || classifyProactiveActionKind({ tool: observe.tool }) === "read";
    return read ? { name: observe.tool, args: observe.args } : { refused: `${observe.tool} is not a read` };
  }
  if ("recipe" in observe) {
    const tool = session.tools.has("flow_run") ? "flow_run" : session.tools.has("flow") ? "flow" : undefined;
    if (!tool) return { refused: "flow_run is not served to this person" };
    // `read` serves read-only engine commands only (recipe plan)
    return { name: tool, args: { command: "read", args: ["recipe", "plan", observe.recipe] } };
  }
  if (!session.tools.has("flow_action")) return { refused: "flow_action is not served to this person" };
  // never `confirm`: Perspicax sends an action's writes only on a confirmed call
  return { name: "flow_action", args: { action: observe.action, params: observe.params } };
}

/** The tool name the proposed step is classified by. A declared read is a
 * `read_` step, still a write when its name carries a write verb (a
 * routine runs); a declared write is always a write. The server's own
 * classifier decides (classifyProactiveActionKind), fail safe. */
export function proposeTool(watch: FlowWatch): string {
  const propose = watch.propose;
  const step = "action" in propose ? `flow_action_${propose.action}` : "routine" in propose ? `run_routine_${propose.routine}` : `skill_${propose.skill}`;
  return `${watch.kind === "read" ? "read" : "write"}_${step}`;
}

export function proposeLabel(propose: WatchPropose): string {
  if ("action" in propose) return `Flow action ${propose.action}`;
  if ("routine" in propose) return `routine ${propose.routine}`;
  return `skill ${propose.skill}`;
}

const DETAIL_MAX = 3_500;

/** The proactive event of a watch that fired. */
export function watchEvent(input: { botId: string; runAs?: string; watch: FlowWatch; key: string; observed: unknown; disposition: "auto" | "defer" }): ProactiveEvent {
  const { watch } = input;
  let observed = JSON.stringify(input.observed ?? null) ?? "null";
  if (observed.length > DETAIL_MAX) observed = `${observed.slice(0, DETAIL_MAX)} [cut]`;
  return {
    botId: input.botId,
    source: "watch",
    key: `watch:${watch.id}:${input.key}`,
    label: `Pulsatrix watch: ${watch.summary.slice(0, 80)}`,
    summary: watch.summary,
    detail: `Watch ${watch.id} observed:\n${observed}`,
    hops: 0,
    ...(input.runAs ? { runAs: input.runAs } : {}),
    watch: {
      id: watch.id,
      summary: watch.summary,
      ...(watch.skill ? { skill: watch.skill } : {}),
      prompt: watch.prompt,
      propose: proposeLabel(watch.propose),
      disposition: input.disposition,
    },
  };
}

// ── memory ─────────────────────────────────────────────────────────────────

interface WatchState {
  /** Last time the watch was observed (or first seen, calendar cadences). */
  last?: number;
  /** The key of the condition that already fired and is still true. */
  fired?: string;
}

/** Per bot and watch: when it last ran and which true condition already
 * fired. Kept on disk so a restart neither re-fires nor catches up. */
export class WatchMemory {
  private items: Record<string, Record<string, WatchState>> = {};

  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { bots?: unknown };
      if (isObject(parsed.bots)) {
        for (const [botId, rows] of Object.entries(parsed.bots)) {
          if (!isObject(rows)) continue;
          const kept: Record<string, WatchState> = {};
          for (const [watchId, row] of Object.entries(rows)) {
            if (!isObject(row)) continue;
            kept[watchId] = {
              ...(typeof row.last === "number" ? { last: row.last } : {}),
              ...(typeof row.fired === "string" ? { fired: row.fired } : {}),
            };
          }
          this.items[botId] = kept;
        }
      }
    } catch {
      // no memory yet
    }
  }

  get(botId: string, watchId: string): WatchState {
    return this.items[botId]?.[watchId] ?? {};
  }

  private set(botId: string, watchId: string, state: WatchState): void {
    (this.items[botId] ??= {})[watchId] = state;
  }

  noteRun(botId: string, watchId: string, at: number): void {
    this.set(botId, watchId, { ...this.get(botId, watchId), last: at });
  }

  /** The condition's verdict: "fire" the first time a key is true, then
   * "duplicate" while it stays true with that key; false clears it. */
  settle(botId: string, watchId: string, holds: boolean, key: string): "fire" | "duplicate" | "clear" {
    const state = this.get(botId, watchId);
    if (!holds) {
      if (state.fired !== undefined) this.set(botId, watchId, state.last !== undefined ? { last: state.last } : {});
      return "clear";
    }
    if (state.fired === key) return "duplicate";
    this.set(botId, watchId, { ...state, fired: key });
    return "fire";
  }

  /** A fired condition that could not start: let it fire again. */
  unfire(botId: string, watchId: string): void {
    const state = this.get(botId, watchId);
    this.set(botId, watchId, state.last !== undefined ? { last: state.last } : {});
  }

  forget(botId: string): void {
    delete this.items[botId];
  }

  save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify({ version: 1, bots: this.items }), { mode: 0o600 });
    } catch {
      // kept in memory
    }
  }
}

// ── the loop ───────────────────────────────────────────────────────────────

export const WATCH_TICK_MS = 60_000;
/** The watch list and a bot's products are reloaded this often. */
export const WATCH_RELOAD_MS = 60 * 60_000;
/** After a failed helper or connection, try again this soon. */
export const WATCH_RETRY_MS = 5 * 60_000;

export interface FlowHelper {
  /** Folder of the Flow plugin (cache key). */
  root: string;
  /** `px_flow.py proactive [--product p ...]`, its stdout. */
  proactive(products: readonly string[]): Promise<string>;
  /** `px_flow.py reference <topic>`, its stdout ({topic, path, body}). */
  reference(topic: string): Promise<string>;
}

/** The facts of a reference topic from the helper's stdout. */
export function factsOfReferenceOutput(stdout: string): Map<string, unknown> {
  try {
    const parsed = JSON.parse(stdout) as { body?: unknown };
    return typeof parsed.body === "string" ? factsOfReference(parsed.body) : new Map();
  } catch {
    return new Map();
  }
}

/** A watch with its tokens resolved, or the tokens that could not be. */
export function resolveWatch(watch: FlowWatch, ctx: WatchTokenContext): { watch: FlowWatch } | { unresolved: string[] } {
  const observe = resolveWatchTokens(watch.observe, ctx);
  const when = resolveWatchTokens(watch.when, ctx);
  const unresolved = [...(observe.ok ? [] : observe.unresolved), ...(when.ok ? [] : when.unresolved)];
  if (unresolved.length || !observe.ok || !when.ok) return { unresolved: [...new Set(unresolved)] };
  return { watch: { ...watch, observe: observe.value, when: when.value } };
}

export interface FlowWatchLoopDeps {
  /** The bots to watch for (not hidden, not temporary), with their owner. */
  bots(): Array<{ id: string; owner: string }>;
  /** The stored bot (its proactiveMode), undefined if gone. */
  bot(botId: string): { proactiveMode?: unknown } | undefined;
  /** The organization's Flow plugin of this bot's owner, or null. */
  helper(botId: string, owner: string): FlowHelper | null;
  /** A routine connection as the owner (null: no Pulsatrix access). */
  session<T>(owner: string, botId: string, fn: (session: ObserveSession & { apis(): Promise<Array<{ id: string; name: string }>>; holdsProfile(): Promise<boolean> }) => Promise<T>): Promise<T | null>;
  /** The owner's time zone, when set. */
  timeZone(owner: string): string | undefined;
  engine: ProactiveEngine;
  offer(event: ProactiveEvent): ProactiveOfferVerdict | undefined;
  log(botId: string, line: string): void;
  memory: WatchMemory;
  now?: () => number;
  hostTimeZone?: () => string;
}

interface Cached<T> { at: number; value: T; ttl: number }

export class FlowWatchLoop {
  private readonly deps: FlowWatchLoopDeps;
  private readonly now: () => number;
  private readonly listings = new Map<string, Cached<FlowWatchListing>>();
  private readonly products = new Map<string, Cached<string[]>>();
  private readonly facts = new Map<string, Cached<Map<string, unknown>>>();
  private running = false;

  constructor(deps: FlowWatchLoopDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  private fresh<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
    const hit = cache.get(key);
    return hit && this.now() - hit.at < hit.ttl ? hit.value : undefined;
  }

  private async listing(helper: FlowHelper, products: readonly string[], botId: string): Promise<FlowWatchListing> {
    const key = `${helper.root}\u0000${[...products].sort().join(",")}`;
    const hit = this.fresh(this.listings, key);
    if (hit) return hit;
    let value: FlowWatchListing;
    let ttl = WATCH_RELOAD_MS;
    try {
      value = parseWatchListing(await helper.proactive(products));
      if (value.rejected) this.deps.log(botId, `Pulsatrix watches: ${value.rejected} watch(es) of the Flow plugin do not match the contract and were left out.`);
    } catch (error) {
      value = { watches: [], rejected: 0 };
      ttl = WATCH_RETRY_MS;
      this.deps.log(botId, `Pulsatrix watches could not load: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
    }
    this.listings.set(key, { at: this.now(), value, ttl });
    while (this.listings.size > 200) this.listings.delete(this.listings.keys().next().value!);
    return value;
  }

  private async factsOf(helper: FlowHelper, topic: string): Promise<Map<string, unknown>> {
    const key = `${helper.root}\u0000${topic}`;
    const hit = this.fresh(this.facts, key);
    if (hit) return hit;
    let value: Map<string, unknown>;
    let ttl = WATCH_RELOAD_MS;
    try {
      value = factsOfReferenceOutput(await helper.reference(topic));
    } catch {
      value = new Map();
      ttl = WATCH_RETRY_MS;
    }
    this.facts.set(key, { at: this.now(), value, ttl });
    while (this.facts.size > 200) this.facts.delete(this.facts.keys().next().value!);
    return value;
  }

  /** One pass over every bot. Never throws; never two at once. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const { id, owner } of this.deps.bots()) {
        try {
          await this.tickBot(id, owner);
        } catch (error) {
          this.deps.log(id, `Pulsatrix watches failed: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
        }
      }
      this.deps.memory.save();
    } finally {
      this.running = false;
    }
  }

  async tickBot(botId: string, owner: string): Promise<void> {
    const bot = this.deps.bot(botId);
    if (!bot || !proactiveMayObserve(proactiveModeFor(bot))) return;
    const helper = this.deps.helper(botId, owner);
    if (!helper) return;
    // the products of the profiles the bot holds (needs a connection, hourly)
    let products = this.fresh(this.products, botId);
    if (!products) {
      const universe = (await this.listing(helper, [], botId)).watches.flatMap((watch) => watch.products);
      const found = await this.deps.session(owner, botId, async (session) => {
        if (!(await session.holdsProfile())) return [];
        return productsForApis(await session.apis(), universe);
      }).catch(() => null);
      products = found ?? [];
      this.products.set(botId, { at: this.now(), value: products, ttl: found === null ? WATCH_RETRY_MS : WATCH_RELOAD_MS });
    }
    if (!products.length) return;
    const listing = await this.listing(helper, products, botId);
    const zone = listing.timeZone ?? this.deps.timeZone(owner) ?? this.deps.hostTimeZone?.() ?? "UTC";
    const now = this.now();
    const due: FlowWatch[] = [];
    for (const watch of watchesForProducts(listing.watches, products)) {
      const cadence = parseCadence(watch.cadence)!;
      const last = this.deps.memory.get(botId, watch.id).last;
      if (cadenceDue(cadence, last, now, zone)) due.push(watch);
      else if (last === undefined) this.deps.memory.noteRun(botId, watch.id, now);
    }
    if (!due.length) return;
    const topics = factTopics(due.map((watch) => [watch.observe, watch.when]));
    const facts = new Map<string, Map<string, unknown>>();
    for (const topic of topics) facts.set(topic, await this.factsOf(helper, topic));
    const ctx: WatchTokenContext = { now, timeZone: zone, fact: (topic, key) => facts.get(topic)?.get(key) };
    const ready: FlowWatch[] = [];
    for (const watch of due) {
      const resolved = resolveWatch(watch, ctx);
      if ("watch" in resolved) {
        ready.push(resolved.watch);
        continue;
      }
      // never a call with a raw template: skipped until the tenant sets it
      this.deps.memory.noteRun(botId, watch.id, now);
      this.deps.log(botId, `Pulsatrix watch ${watch.id} skipped: ${resolved.unresolved.join(", ").slice(0, 200)} not set for this organization.`);
    }
    if (!ready.length) return;
    await this.deps.session(owner, botId, async (session) => {
      for (const watch of ready) {
        this.deps.memory.noteRun(botId, watch.id, now);
        const call = observeCall(watch.observe, session);
        if ("refused" in call) {
          this.deps.log(botId, `Pulsatrix watch ${watch.id} skipped: ${call.refused}.`);
          continue;
        }
        const answer = await session.call(call.name, call.args);
        if (!answer.ok || answer.isError) {
          this.deps.log(botId, `Pulsatrix watch ${watch.id} could not observe${answer.ok ? "" : `: ${answer.error.slice(0, 120)}`}.`);
          continue;
        }
        this.consider(botId, owner, watch, answer.value);
      }
    });
  }

  /** A watch observed: its condition, then the gate, then the wake. */
  consider(botId: string, owner: string, watch: FlowWatch, observed: unknown): "fired" | "false" | "duplicate" | "off" | "budget" | "refused" {
    const { holds, key } = evaluateWhen(watch.when, observed);
    const verdict = this.deps.memory.settle(botId, watch.id, holds, key);
    if (verdict === "clear") return "false";
    if (verdict === "duplicate") return "duplicate";
    const considered = this.deps.engine.consider(botId, { tool: proposeTool(watch), request: watch.propose });
    if (!considered.acted || considered.decision.disposition === "blocked") {
      this.deps.memory.unfire(botId, watch.id);
      if (considered.reason === "budget" || considered.reason === "cadence") {
        this.deps.log(botId, `Pulsatrix watch ${watch.id} waits: the hour's limit of proactive steps is reached.`);
        return "budget";
      }
      return "off";
    }
    const disposition = considered.decision.disposition;
    const offered = this.deps.offer(watchEvent({ botId, runAs: owner || undefined, watch, key, observed, disposition }));
    if (offered !== "gathered" && offered !== "duplicate") {
      this.deps.memory.unfire(botId, watch.id);
      this.deps.log(botId, `Pulsatrix watch ${watch.id} did not wake the bot (${offered ?? "error"}).`);
      return "refused";
    }
    return "fired";
  }

  /** A deleted bot. */
  forget(botId: string): void {
    this.products.delete(botId);
    this.deps.memory.forget(botId);
  }
}
