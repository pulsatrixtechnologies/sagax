// Pulsatrix Flow watches (2026-11-09; walked from the person's choices
// since #3423, lot 2 of #3408). A watch is the organization's: it is ambient
// (the server goes looking on the person's behalf), so it never runs until
// the person said yes to its domain, for one of their bots
// (server/proactive/proactive-choices.ts). A bot's stored proactiveMode is
// never read as that yes: createBot and the startup both write "proactive".
//
// For each person with a chosen domain (no choice: no session, no helper
// call, no read, no offer):
//   1. the carrying bot must be eligible: the person's own, visible, not
//      temporary, its turns mounting the person's account connection;
//   2. the products the person's connection serves (api_list), read once a
//      day per person, matched to Flow's products;
//   3. the watches of the chosen domains from the Flow plugin's helper
//      (`px_flow.py proactive --product ...`), cached and reloaded hourly;
//      a watch runs only when the connection serves every product it names
//      and the bot holds its skill, and not when the person switched it off;
//   4. each watch on its cadence (`15m`, `1h`, `daily@HH:MM`,
//      `weekly:sun@HH:MM`, local time of the tenant);
//   5. `observe` runs as a READ on a short-lived connection with the
//      person's routine credentials: a tool Perspicax marks read-only (or a
//      plainly read-named one), `flow_run read recipe plan`, or
//      `flow_action` without `confirm` (Perspicax sends no write then);
//   6. `when` (JMESPath) on the observed value; true and not already seen
//      (watch id + key of the result, per person) wakes the carrying bot
//      with a proactive wake (source "watch"). The person's choice passes
//      the bot's switch, as a direct trigger does. A read runs; a write is
//      planned as a dry run and goes through the ordinary approval path.
//
// A chosen domain that cannot run pauses and says so once in the carrying
// bot's chat, with its cause; it resumes by itself.
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
import type { WatchPauseCause } from "./proactive-choices.ts";
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
  /** The tools its skill declares (Flow lot `flow-domains`); empty: the
   * observe tool stands for them. */
  tools: string[];
}

/** A watch domain as Flow describes it (Flow lot `flow-domains`); absent:
 * the label falls back to the slug. */
export interface FlowDomain {
  label?: { fr?: string; en?: string };
  audience?: { fr?: string; en?: string };
}

export interface FlowWatchListing {
  watches: FlowWatch[];
  /** The domains Flow describes, by slug. */
  domains?: Record<string, FlowDomain>;
  /** The tenant's time zone when the helper says it. */
  timeZone?: string;
  /** Rows dropped because they did not match the contract. */
  rejected: number;
  /** The helper could not be read (tried again soon). */
  failed?: true;
}

/** One watch of a domain the person may choose, as a bot shows it. */
export interface OfferedWatch {
  id: string;
  summary: string;
  cadence: string;
  products: string[];
  /** It would run for this person on this bot; else what is missing. */
  runs: boolean;
  missing?: "product" | "skill" | "read";
  /** #3513: what is missing, by name: the products the person's connection
   * does not serve, the skill the bot does not hold, or (#3408) the observe
   * tool the connection does not serve as a read. */
  lacking?: string[];
  /** #3431: the tools it declares (else its observe tool), for the card's
   * details; only those the connection marks read-only pass without a card. */
  tools?: string[];
}

/** One domain of the organization's Flow, as the person may choose it. */
export interface OfferedDomain {
  domain: string;
  label: { fr?: string; en?: string };
  audience?: { fr?: string; en?: string };
  watches: OfferedWatch[];
  /** At least one of its watches runs for this person on this bot. */
  eligible: boolean;
}

/** The domains a person may choose on one of their bots, or why none can
 * be listed now. */
export type OfferedListing =
  | { ok: true; botId: string; domains: OfferedDomain[] }
  | { ok: false; botId: string; cause: "bot-gone" | "bot-not-eligible" | "no-flow" | "flow-failed" | "no-access" };

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
    tools: Array.isArray(row.tools) ? [...new Set(row.tools.flatMap((item) => (text(item, 160) ? [text(item, 160)!] : [])))].slice(0, 40) : [],
  };
}

function wordsOf(value: unknown): { fr?: string; en?: string } | undefined {
  if (typeof value === "string") return text(value, 200) ? { en: text(value, 200)! } : undefined;
  if (!isObject(value)) return undefined;
  const fr = text(value.fr, 200);
  const en = text(value.en, 200);
  return fr || en ? { ...(fr ? { fr } : {}), ...(en ? { en } : {}) } : undefined;
}

/** The domains of the helper's output, known fields only. */
function domainsOf(value: unknown): Record<string, FlowDomain> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, FlowDomain> = {};
  for (const [slug, row] of Object.entries(value)) {
    if (!ID.test(slug) || !isObject(row)) continue;
    const label = wordsOf(row.label);
    const audience = wordsOf(row.for ?? row.audience);
    out[slug] = { ...(label ? { label } : {}), ...(audience ? { audience } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** #3513: a readable name from a slug (`backup-health` reads "Backup
 * health"), for a domain, a skill or a product without a label: the person
 * never reads a raw slug. */
export function readableName(slug: string): string {
  const words = slug.replace(/[-_.:]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

/** A domain's label for the person, else a readable name from its slug. */
export function domainLabel(listing: Pick<FlowWatchListing, "domains"> | undefined, slug: string, language: "fr" | "en"): string {
  const label = listing?.domains?.[slug]?.label;
  return (language === "fr" ? label?.fr ?? label?.en : label?.en ?? label?.fr) ?? readableName(slug);
}

/** The read tools a chosen domain's alerts may run without a card
 * (decision 3): those its watches declare, kept only when the connection
 * marks them read-only; without Flow's list, the observe tools. */
export function watchReadTools(watches: readonly FlowWatch[], readOnly: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const watch of watches) {
    for (const tool of declaredTools(watch)) if (readOnly.has(tool)) out.add(tool);
  }
  return [...out].sort();
}

/** The tools a watch declares; without Flow's list, its observe tool. */
export function declaredTools(watch: Pick<FlowWatch, "tools" | "observe">): string[] {
  return watch.tools.length ? [...watch.tools] : "tool" in watch.observe ? [watch.observe.tool] : [];
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
  const domains = isObject(parsed) ? domainsOf(parsed.domains) : undefined;
  return { watches, rejected, ...(domains ? { domains } : {}), ...(zone && validTimeZone(zone) ? { timeZone: zone } : {}) };
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

/** Watches a person's connection can run: every product a watch names is
 * served (all, not one), or it names none. */
export function watchesForProducts(watches: readonly FlowWatch[], products: readonly string[]): FlowWatch[] {
  const held = new Set(products);
  return watches.filter((watch) => watch.products.every((product) => held.has(product)));
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

/** #3408: the tool an observe reads with on this connection, by name. */
function observeTool(observe: WatchObserve, session: Pick<ObserveSession, "tools">): string {
  if ("tool" in observe) return observe.tool;
  if ("recipe" in observe) return session.tools.has("flow") ? "flow" : "flow_run";
  return "flow_action";
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
export function watchEvent(input: { botId: string; runAs?: string; watch: FlowWatch; key: string; observed: unknown; disposition: "auto" | "defer"; reads?: readonly string[] }): ProactiveEvent {
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
    // #3140: ids only; a restart before the wake observes the watch again
    replay: { kind: "watch", watchId: watch.id },
    watch: {
      id: watch.id,
      summary: watch.summary,
      ...(watch.skill ? { skill: watch.skill } : {}),
      prompt: watch.prompt,
      propose: proposeLabel(watch.propose),
      disposition: input.disposition,
      domain: watch.domain,
      // #3423: only a domain the person turned on fires: it passes the switch
      chosen: true,
      // #3431 (decision 3): the read-only tools the yes covers in this wake
      ...(input.reads?.length ? { reads: [...input.reads] } : {}),
    },
  };
}

// ── memory ─────────────────────────────────────────────────────────────────

interface WatchState {
  /** Last time the watch was observed (or first seen, calendar cadences). */
  last?: number;
  /** The key of the condition that already fired and is still true. */
  fired?: string;
  /** #3140: the cause of the skip already posted; the same cause stays
   * silent until it changes or an observe succeeds. */
  skip?: string;
  /** #3140: observe at the next tick, whatever the cadence (a pending wake
   * replayed after a restart). */
  due?: true;
  /** #3432: when the watch last woke the carrying bot for the person (its
   * last alert, shown in the person's Settings). */
  alertAt?: number;
}

/** Per person and watch (#3423: a watch is the person's, not a bot's):
 * when it last ran and which true condition already fired, and the pause
 * already told per chosen domain. Kept on disk so a restart neither
 * re-fires nor catches up. The per-bot memory of before is not read: it
 * restarts per person. */
export class WatchMemory {
  private items: Record<string, Record<string, WatchState>> = {};

  private pauses: Record<string, Record<string, string>> = {};

  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; people?: unknown; pauses?: unknown };
      if (parsed.version === 2 && isObject(parsed.people)) {
        for (const [person, rows] of Object.entries(parsed.people)) {
          if (!isObject(rows)) continue;
          const kept: Record<string, WatchState> = {};
          for (const [watchId, row] of Object.entries(rows)) {
            if (!isObject(row)) continue;
            kept[watchId] = {
              ...(typeof row.last === "number" ? { last: row.last } : {}),
              ...(typeof row.fired === "string" ? { fired: row.fired } : {}),
              ...(typeof row.skip === "string" ? { skip: row.skip } : {}),
              ...(row.due === true ? { due: true as const } : {}),
              ...(typeof row.alertAt === "number" ? { alertAt: row.alertAt } : {}),
            };
          }
          this.items[person] = kept;
        }
      }
      if (parsed.version === 2 && isObject(parsed.pauses)) {
        for (const [person, rows] of Object.entries(parsed.pauses)) {
          if (!isObject(rows)) continue;
          this.pauses[person] = Object.fromEntries(Object.entries(rows).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        }
      }
    } catch {
      // no memory yet
    }
  }

  get(person: string, watchId: string): WatchState {
    return this.items[person]?.[watchId] ?? {};
  }

  private set(person: string, watchId: string, state: WatchState): void {
    (this.items[person] ??= {})[watchId] = state;
  }

  noteRun(person: string, watchId: string, at: number): void {
    const { due: _due, ...state } = this.get(person, watchId);
    this.set(person, watchId, { ...state, last: at });
  }

  /** #3140: true the first time a cause is seen (post its line), false
   * while the same cause repeats. */
  skipped(person: string, watchId: string, cause: string): boolean {
    const state = this.get(person, watchId);
    if (state.skip === cause) return false;
    this.set(person, watchId, { ...state, skip: cause });
    return true;
  }

  /** An observe went through: the next skip posts again. */
  observed(person: string, watchId: string): void {
    const { skip: _skip, ...state } = this.get(person, watchId);
    this.set(person, watchId, state);
  }

  /** #3140: a fired condition whose wake never started (a restart): it
   * is observed again at the next tick and may fire again. */
  replay(person: string, watchId: string): void {
    const { fired: _fired, ...state } = this.get(person, watchId);
    this.set(person, watchId, { ...state, due: true });
  }

  /** The condition's verdict: "fire" the first time a key is true, then
   * "duplicate" while it stays true with that key; false clears it. */
  settle(person: string, watchId: string, holds: boolean, key: string): "fire" | "duplicate" | "clear" {
    const state = this.get(person, watchId);
    if (!holds) {
      if (state.fired !== undefined) {
        const { fired: _fired, ...rest } = state;
        this.set(person, watchId, rest);
      }
      return "clear";
    }
    if (state.fired === key) return "duplicate";
    this.set(person, watchId, { ...state, fired: key });
    return "fire";
  }

  /** #3432: the watch woke the carrying bot for the person (an alert). */
  alerted(person: string, watchId: string, at: number): void {
    this.set(person, watchId, { ...this.get(person, watchId), alertAt: at });
  }

  /** A fired condition that could not start: let it fire again. */
  unfire(person: string, watchId: string): void {
    const { fired: _fired, ...state } = this.get(person, watchId);
    this.set(person, watchId, state);
  }

  /** A chosen domain paused for `cause`: true the first time (say it once). */
  paused(person: string, domain: string, cause: string): boolean {
    const rows = (this.pauses[person] ??= {});
    if (rows[domain] === cause) return false;
    rows[domain] = cause;
    return true;
  }

  /** A chosen domain runs again: a later pause is told again. */
  resumed(person: string, domain: string): void {
    if (this.pauses[person]?.[domain] !== undefined) delete this.pauses[person]![domain];
  }

  forget(person: string): void {
    delete this.items[person];
    delete this.pauses[person];
  }

  save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify({ version: 2, people: this.items, pauses: this.pauses }), { mode: 0o600 });
    } catch {
      // kept in memory
    }
  }
}

// ── the loop ───────────────────────────────────────────────────────────────

export const WATCH_TICK_MS = 60_000;
/** The watch list is reloaded this often. */
export const WATCH_RELOAD_MS = 60 * 60_000;
/** A person's products are read once a day (3.4 of the design). */
export const WATCH_PRODUCTS_MS = 24 * 60 * 60_000;
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

/** One domain a person turned on, the bot that carries it, and the watches
 * they switched off inside it (shared/proactive-choices.ts chosenDomains). */
export interface ChosenDomain {
  domain: string;
  botId: string;
  watchesOff: readonly string[];
}

export type ObserveConnection = ObserveSession & { apis(): Promise<Array<{ id: string; name: string }>>; holdsProfile(): Promise<boolean> };

export interface FlowWatchLoopDeps {
  /** Every person with a chosen domain (none: the loop does nothing). */
  choices(): ReadonlyArray<{ person: string; domains: readonly ChosenDomain[] }>;
  /** Whether this bot can carry the person's watches: the person's own,
   * visible, not temporary, its turns mounting the person's account
   * connection. */
  carrier(botId: string, person: string): { ok: true } | { ok: false; cause: "bot-gone" | "bot-not-eligible" };
  /** #3470: the names of the bot's enabled skills (the resolution of a
   * turn's Skills index): one inventory, read once per bot of a walk,
   * never once per watch. */
  skills(botId: string, person: string): ReadonlySet<string>;
  /** The bot's person, for a replay or a release keyed by bot. */
  owner(botId: string): string | undefined;
  /** The organization's Flow plugin for this bot and person, or null. */
  helper(botId: string, person: string): FlowHelper | null;
  /** A routine connection as the person (null: no Pulsatrix access). */
  session<T>(person: string, botId: string, fn: (session: ObserveConnection) => Promise<T>): Promise<T | null>;
  /** The person's time zone, when set. */
  timeZone(person: string): string | undefined;
  engine: ProactiveEngine;
  offer(event: ProactiveEvent): ProactiveOfferVerdict | undefined;
  /** A line in the bot's Events lens. */
  log(botId: string, line: string): void;
  /** A chosen domain paused: one line in the carrying bot's chat (the
   * person's main bot, or another of theirs, when that bot is gone). */
  pause(botId: string, person: string, domain: string, cause: WatchPauseCause, listing: FlowWatchListing | undefined): void;
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
  /** #3408: the tools the person's connection serves, read with the
   * products (same session, same day), so a watch whose read cannot run is
   * never offered. */
  private readonly reads = new Map<string, Pick<ObserveSession, "tools" | "readOnly">>();
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

  /** #3470: the bot's skills, read at most once (on the first watch that
   * names one), whatever the number of watches. */
  private skillsOnce(botId: string, person: string): () => ReadonlySet<string> {
    let read: ReadonlySet<string> | undefined;
    return () => {
      if (!read) {
        try {
          read = this.deps.skills(botId, person);
        } catch {
          read = new Set();
        }
      }
      return read;
    };
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
      value = { watches: [], rejected: 0, failed: true };
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

  /** One pass over the people who chose a domain. Never throws; never two
   * at once. No choice: no session, no helper call, no read, no offer.
   *
   * #3394: a watch is the organization's; a domain is carried by the one
   * bot the person named, so one event wakes one bot, once. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const { person, domains } of this.deps.choices()) {
        if (!person || !domains.length) continue;
        try {
          await this.tickPerson(person, domains);
        } catch (error) {
          for (const botId of new Set(domains.map((row) => row.botId))) {
            this.deps.log(botId, `Pulsatrix watches failed: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
          }
        }
      }
      this.deps.memory.save();
    } finally {
      this.running = false;
    }
  }

  private pause(person: string, chosen: ChosenDomain, cause: WatchPauseCause, listing?: FlowWatchListing): void {
    if (this.deps.memory.paused(person, chosen.domain, cause)) this.deps.pause(chosen.botId, person, chosen.domain, cause, listing);
  }

  /** The person's products, read once a day (null: no access now). */
  private async productsOf(person: string, botId: string, helper: FlowHelper): Promise<string[] | null> {
    const hit = this.fresh(this.products, person);
    if (hit) return hit;
    const universe = (await this.listing(helper, [], botId)).watches.flatMap((watch) => watch.products);
    const found = await this.deps.session(person, botId, async (session) => {
      this.reads.set(person, { tools: new Set(session.tools), readOnly: new Set(session.readOnly) });
      if (!(await session.holdsProfile())) return [];
      return productsForApis(await session.apis(), universe);
    }).catch(() => null);
    if (found === null) this.reads.delete(person);
    // the reads and the products of a person are read and dropped together
    while (this.reads.size > 200) {
      const oldest = this.reads.keys().next().value!;
      this.reads.delete(oldest);
      this.products.delete(oldest);
    }
    this.products.set(person, { at: this.now(), value: found ?? [], ttl: found === null ? WATCH_RETRY_MS : WATCH_PRODUCTS_MS });
    return found;
  }

  /** The domains the person may choose on this bot of theirs: each with
   * its label and watches, and whether it would run here (the person's
   * products, read once a day, and the bot's skills). Called when the
   * person asks (GET and PUT /api/me/proactive), never by the loop. */
  async offered(person: string, botId: string): Promise<OfferedListing> {
    const verdict = this.deps.carrier(botId, person);
    if (!verdict.ok) return { ok: false, botId, cause: verdict.cause };
    const helper = this.deps.helper(botId, person);
    if (!helper) return { ok: false, botId, cause: "no-flow" };
    const universe = await this.listing(helper, [], botId);
    if (universe.failed) return { ok: false, botId, cause: "flow-failed" };
    const products = await this.productsOf(person, botId, helper);
    if (products === null) return { ok: false, botId, cause: "no-access" };
    const held = new Set(products);
    const skills = this.skillsOnce(botId, person);
    const reads = this.reads.get(person);
    const byDomain = new Map<string, OfferedWatch[]>();
    for (const watch of universe.watches) {
      const absent = watch.products.filter((product) => !held.has(product));
      const unread = !absent.length && reads && "refused" in observeCall(watch.observe, reads) ? observeTool(watch.observe, reads) : undefined;
      const missing = absent.length ? "product" as const
        : watch.skill && !skills().has(watch.skill) ? "skill" as const
        : unread ? "read" as const : undefined;
      const lacking = missing === "product" ? absent : missing === "skill" ? [watch.skill] : missing === "read" ? [unread!] : [];
      const row: OfferedWatch = { id: watch.id, summary: watch.summary, cadence: watch.cadence, products: watch.products, runs: !missing, ...(missing ? { missing, lacking } : {}), tools: declaredTools(watch) };
      byDomain.set(watch.domain, [...(byDomain.get(watch.domain) ?? []), row]);
    }
    const domains = [...byDomain].sort(([a], [b]) => a.localeCompare(b)).map(([domain, watches]): OfferedDomain => {
      const described = universe.domains?.[domain];
      return {
        domain,
        label: described?.label ?? { en: readableName(domain) },
        ...(described?.audience ? { audience: described.audience } : {}),
        watches,
        eligible: watches.some((watch) => watch.runs),
      };
    });
    return { ok: true, botId, domains };
  }

  /** #3432: when this watch last alerted the person, if ever. */
  lastAlert(person: string, watchId: string): number | undefined {
    return this.deps.memory.get(person.trim().toLowerCase(), watchId).alertAt;
  }

  /** A domain's label from the listings read so far, else a readable name
   * from its slug. */
  label(domain: string, language: "fr" | "en"): string {
    for (const { value } of this.listings.values()) {
      if (value.domains?.[domain]) return domainLabel(value, domain, language);
    }
    return readableName(domain);
  }

  /** One person's chosen domains, each on its own bot. */
  async tickPerson(person: string, chosen: readonly ChosenDomain[]): Promise<void> {
    const byBot = new Map<string, ChosenDomain[]>();
    for (const row of chosen) {
      const verdict = this.deps.carrier(row.botId, person);
      if (!verdict.ok) {
        this.pause(person, row, verdict.cause);
        continue;
      }
      byBot.set(row.botId, [...(byBot.get(row.botId) ?? []), row]);
    }
    for (const [botId, rows] of byBot) await this.tickBot(person, botId, rows);
  }

  /** The chosen domains one bot carries for its person. */
  private async tickBot(person: string, botId: string, rows: readonly ChosenDomain[]): Promise<void> {
    const helper = this.deps.helper(botId, person);
    if (!helper) {
      for (const row of rows) this.pause(person, row, "no-flow");
      return;
    }
    const products = await this.productsOf(person, botId, helper);
    if (products === null) {
      for (const row of rows) this.pause(person, row, "no-access");
      return;
    }
    const listing = products.length ? await this.listing(helper, products, botId) : { watches: [], rejected: 0 };
    const served = watchesForProducts(listing.watches, products);
    const skills = this.skillsOnce(botId, person);
    const mine: FlowWatch[] = [];
    for (const row of rows) {
      const off = new Set(row.watchesOff);
      const runnable = served.filter((watch) => watch.domain === row.domain && !off.has(watch.id)
        && (!watch.skill || skills().has(watch.skill)));
      if (!runnable.length) {
        // against every watch of the organization, not only the served ones:
        // a domain Flow does not have is said, never skipped in silence
        const universe = await this.listing(helper, [], botId);
        const inDomain = universe.watches.filter((watch) => watch.domain === row.domain);
        if (universe.failed) this.pause(person, row, "flow-failed", universe);
        else if (!inDomain.length) this.pause(person, row, "unknown-domain", universe);
        // nothing left on purpose (every watch switched off) is no pause
        else if (inDomain.some((watch) => !off.has(watch.id))) this.pause(person, row, "no-watch", universe);
        continue;
      }
      this.deps.memory.resumed(person, row.domain);
      mine.push(...runnable);
    }
    if (!mine.length) return;
    const zone = listing.timeZone ?? this.deps.timeZone(person) ?? this.deps.hostTimeZone?.() ?? "UTC";
    const now = this.now();
    const due: FlowWatch[] = [];
    for (const watch of mine) {
      const cadence = parseCadence(watch.cadence)!;
      const { last, due: replayed } = this.deps.memory.get(person, watch.id);
      if (replayed || cadenceDue(cadence, last, now, zone)) due.push(watch);
      else if (last === undefined) this.deps.memory.noteRun(person, watch.id, now);
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
      this.deps.memory.noteRun(person, watch.id, now);
      const tokens = resolved.unresolved.join(", ").slice(0, 200);
      this.skip(person, botId, watch.id, `unresolved:${tokens}`, `Pulsatrix watch ${watch.id} skipped: ${tokens} not set for this organization.`);
    }
    if (!ready.length) return;
    // #3140: marked before the connection, so a missing access waits for
    // the next cadence instead of retrying on every tick
    for (const watch of ready) this.deps.memory.noteRun(person, watch.id, now);
    let failure: string | undefined;
    const reached = await this.deps.session(person, botId, async (session) => {
      for (const watch of ready) {
        const call = observeCall(watch.observe, session);
        if ("refused" in call) {
          this.skip(person, botId, watch.id, `refused:${call.refused}`, `Pulsatrix watch ${watch.id} skipped: ${call.refused}.`);
          continue;
        }
        const answer = await session.call(call.name, call.args);
        if (!answer.ok || answer.isError) {
          const error = answer.ok ? "" : answer.error.slice(0, 120);
          this.skip(person, botId, watch.id, `observe:${error}`, `Pulsatrix watch ${watch.id} could not observe${error ? `: ${error}` : ""}.`);
          continue;
        }
        this.deps.memory.observed(person, watch.id);
        this.consider(botId, person, watch, answer.value, session.readOnly);
      }
      return true;
    }).catch((error: unknown) => {
      failure = error instanceof Error ? error.message.slice(0, 160) : "error";
      return null;
    });
    if (reached) return;
    for (const watch of ready) {
      if (failure === undefined) this.skip(person, botId, watch.id, "access", `Pulsatrix watch ${watch.id} skipped: no Pulsatrix access for this person.`);
      else this.skip(person, botId, watch.id, `failed:${failure}`, `Pulsatrix watch ${watch.id} could not run: ${failure}`);
    }
  }

  /** #3140: a skip posts its line once per cause; the same cause stays
   * silent until it changes or an observe succeeds. */
  private skip(person: string, botId: string, watchId: string, cause: string, line: string): void {
    if (this.deps.memory.skipped(person, watchId, cause)) this.deps.log(botId, line);
  }

  /** #3140: a pending wake of this watch was lost to a restart: observe it
   * again at the next tick, so the condition fires again if it still holds. */
  replay(botId: string, watchId: string): void {
    const person = this.deps.owner(botId);
    if (!person) return;
    this.deps.memory.replay(person, watchId);
    this.deps.memory.save();
  }

  /** #3140: a gathered watch event no wake will run for (dropped): the
   * condition is no longer marked as sent and fires again at its cadence. */
  released(botId: string, watchId: string): void {
    const person = this.deps.owner(botId);
    if (!person) return;
    this.deps.memory.unfire(person, watchId);
    this.deps.memory.save();
  }

  /** A watch observed: its condition, then the budget, then the wake of the
   * carrying bot. The person's choice passes the bot's switch. */
  consider(botId: string, person: string, watch: FlowWatch, observed: unknown, readOnly?: ReadonlySet<string>): "fired" | "false" | "duplicate" | "off" | "budget" | "refused" {
    const { holds, key } = evaluateWhen(watch.when, observed);
    const verdict = this.deps.memory.settle(person, watch.id, holds, key);
    if (verdict === "clear") return "false";
    if (verdict === "duplicate") return "duplicate";
    const considered = this.deps.engine.consider(botId, { tool: proposeTool(watch), request: watch.propose });
    if (!considered.acted || considered.decision.disposition === "blocked") {
      this.deps.memory.unfire(person, watch.id);
      if (considered.reason === "budget" || considered.reason === "cadence") {
        this.deps.log(botId, `Pulsatrix watch ${watch.id} waits: the hour's limit of proactive steps is reached.`);
        return "budget";
      }
      return "off";
    }
    const disposition = considered.decision.disposition;
    const reads = readOnly ? watchReadTools([watch], readOnly) : [];
    const offered = this.deps.offer(watchEvent({ botId, runAs: person || undefined, watch, key, observed, disposition, reads }));
    if (offered !== "gathered" && offered !== "duplicate") {
      this.deps.memory.unfire(person, watch.id);
      this.deps.log(botId, `Pulsatrix watch ${watch.id} did not wake the bot (${offered ?? "error"}).`);
      return "refused";
    }
    if (offered === "gathered") this.deps.memory.alerted(person, watch.id, this.now());
    return "fired";
  }
}
