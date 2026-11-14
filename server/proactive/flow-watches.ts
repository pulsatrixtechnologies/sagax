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
//   4. #4250 (S5 `one-probe-engine`): each such watch is a routine of the
//      carrying bot (FlowWatches.sync), on the watch's cadence (`15m`,
//      `1h`, `daily@HH:MM`, `weekly:sun@HH:MM`, local time of the tenant),
//      with the watch's consigne as its instructions and the code check
//      `flow_watch`; listed, paused, edited and deleted like any routine.
//      The person's choices stay the one store of what is on;
//   5. at each check, `observe` runs as a READ through the one probe engine
//      (server/routines/routine-watch.ts) with the person's routine
//      credentials: a tool Perspicax marks read-only (or a plainly
//      read-named one), `flow_run read recipe plan`, or `flow_action`
//      without `confirm` (Perspicax sends no write then);
//   6. `when` (JMESPath) on the observed value; true with a key not seen
//      before starts the routine's run, as the person, with what the watch
//      read as fenced data. A read runs; a write goes through the ordinary
//      approval path of a routine run.
//
// A chosen domain that cannot run pauses and says so once in the carrying
// bot's chat, with its cause; it resumes by itself.
//
// Dedup: a condition that stays true with the same key never wakes again;
// it can fire again once it turned false, or when its key changes (the
// probe engine keeps it per routine, on disk).
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import jmespath from "jmespath";

import { writeFileAtomic } from "../atomic.ts";
import type { RoutinePrecheckVerdict } from "../routines/routine-precheck.ts";
import type { BuiltWatchPrecheck } from "../routines/routine-watch.ts";
import type { Routine, RoutineInput } from "../routines/routines.ts";
import { classifyProactiveActionKind } from "./proactive.ts";
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

/** #4250 (S5): a watch's cadence as its routine's schedule: an interval
 * (5 minutes to a day, the routine bounds), else a daily or weekly time in
 * the tenant's zone. */
export function cadenceSchedule(cadence: Cadence, timeZone: string, now: number):
  | { type: "interval"; everyMinutes: number; anchorAt: number }
  | { type: "cron"; expression: string; timeZone: string } {
  if (cadence.kind === "every") return { type: "interval", everyMinutes: Math.min(1_440, Math.max(5, Math.round(cadence.ms / 60_000))), anchorAt: now };
  const minute = cadence.minutes % 60;
  const hour = Math.floor(cadence.minutes / 60);
  return { type: "cron", expression: `${minute} ${hour} * * ${cadence.kind === "weekly" ? cadence.day : "*"}`, timeZone };
}

// ── condition ──────────────────────────────────────────────────────────────

// #4250 (S5): `when` is read by the one probe engine (routine-watch.ts).
export { evaluateWhen, jmesTruthy } from "../routines/routine-watch.ts";

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

/** What a bot and its person's connection can run of the organization's
 * watches. */
export interface WatchReach {
  /** The Flow products the person's connection serves. */
  products: readonly string[];
  /** The bot's skills, read only when a watch names one. */
  skills: () => ReadonlySet<string>;
  /** The connection's tools and reads; absent when not read yet. */
  reads?: Pick<ObserveSession, "tools" | "readOnly">;
}

/** #3408: why a watch cannot run on this bot for its person, or undefined
 * when it can: every product it names is served (all, not one), the bot
 * holds its skill, and the connection runs its observe as a read. The one
 * rule for what is offered and what the loop observes. */
export function watchMissing(watch: FlowWatch, reach: WatchReach): { missing: "product" | "skill" | "read"; lacking: string[] } | undefined {
  const held = new Set(reach.products);
  const absent = watch.products.filter((product) => !held.has(product));
  if (absent.length) return { missing: "product", lacking: absent };
  if (watch.skill && !reach.skills().has(watch.skill)) return { missing: "skill", lacking: [watch.skill] };
  if (reach.reads && "refused" in observeCall(watch.observe, reach.reads)) return { missing: "read", lacking: [observeTool(watch.observe, reach.reads)] };
  return undefined;
}

/** #3408: the watches that may reach this bot: never one whose product,
 * skill or read it lacks. */
export function watchesForBot(watches: readonly FlowWatch[], reach: WatchReach): FlowWatch[] {
  return watches.filter((watch) => !watchMissing(watch, reach));
}

export function proposeLabel(propose: WatchPropose): string {
  if ("action" in propose) return `Flow action ${propose.action}`;
  if ("routine" in propose) return `routine ${propose.routine}`;
  return `skill ${propose.skill}`;
}

// ── memory ─────────────────────────────────────────────────────────────────

interface WatchState {
  /** Servers before #4250: the loop's own clock, fired key and replay
   * mark. Read and kept so a previous version still reads this file; no
   * longer written (the watch's routine and the probe engine keep them). */
  last?: number;
  fired?: string;
  due?: true;
  /** #3140: the cause of the skip already posted; the same cause stays
   * silent until it changes or an observe succeeds. */
  skip?: string;
  /** #3432: when the watch last woke the carrying bot for the person (its
   * last alert, shown in the person's Settings). */
  alertAt?: number;
  /** #4250 (S5): the routine that runs this watch for the person, on which
   * bot, for which domain, and the cadence its schedule was set from. */
  routine?: string;
  botId?: string;
  domain?: string;
  cadence?: string;
  /** The person's yes was applied to that routine (created or turned back
   * on). A routine the person then paused or deleted stays so; a later yes
   * after a no applies again. */
  applied?: true;
}

const STATE_KEYS = ["last", "fired", "skip", "alertAt", "routine", "botId", "domain", "cadence"] as const;

/** Per person and watch (#3423: a watch is the person's, not a bot's): the
 * routine that runs it, its last alert, the skip already told, and the
 * pause already told per chosen domain. Kept on disk (version 2, the shape
 * servers before #4250 read: they keep the fields they know). */
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
            const state: WatchState = {};
            for (const key of STATE_KEYS) {
              const value = row[key];
              if (typeof value === (key === "last" || key === "alertAt" ? "number" : "string")) (state as Record<string, unknown>)[key] = value;
            }
            if (row.due === true) state.due = true;
            if (row.applied === true) state.applied = true;
            kept[watchId] = state;
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

  /** The people with a watch row. */
  people(): string[] {
    return Object.keys(this.items);
  }

  /** One person's watch rows. */
  rows(person: string): Array<[string, WatchState]> {
    return Object.entries(this.items[person] ?? {});
  }

  /** The person and watch a routine runs, if it runs one. */
  byRoutine(routineId: string): { person: string; watchId: string; state: WatchState } | undefined {
    for (const [person, rows] of Object.entries(this.items)) {
      for (const [watchId, state] of Object.entries(rows)) if (state.routine === routineId) return { person, watchId, state };
    }
    return undefined;
  }

  /** #4250: the watch runs as this routine, the person's yes applied. */
  link(person: string, watchId: string, row: { routine: string; botId: string; domain: string; cadence: string }): void {
    this.set(person, watchId, { ...this.get(person, watchId), ...row, applied: true });
  }

  /** The watch is no longer chosen: its routine was paused; a later yes
   * turns it on again. */
  unapply(person: string, watchId: string): void {
    const { applied: _applied, fired: _fired, ...state } = this.get(person, watchId);
    this.set(person, watchId, state);
  }

  /** The key told before #4250 no longer holds back the next check (a
   * wake lost to a restart fires again). */
  unfire(person: string, watchId: string): void {
    const { fired: _fired, ...state } = this.get(person, watchId);
    this.set(person, watchId, state);
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

  /** #3432: the watch woke the carrying bot for the person (an alert). */
  alerted(person: string, watchId: string, at: number): void {
    this.set(person, watchId, { ...this.get(person, watchId), alertAt: at });
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

// ── the watches as routines ────────────────────────────────────────────────

/** The watch list is reloaded this often (a new watch the organization
 * adds to a chosen domain becomes a routine at the next sync). */
export const WATCH_RELOAD_MS = 60 * 60_000;
/** A person's products are read once a day (3.4 of the design). */
export const WATCH_PRODUCTS_MS = 24 * 60 * 60_000;
/** After a failed helper or connection, try again this soon. */
export const WATCH_RETRY_MS = 5 * 60_000;
/** #4250: the routines' code check that runs a Flow watch. */
export const FLOW_WATCH_CHECK = "flow_watch" as const;

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

/** What the watches need of the routine manager (as the brief's). */
export interface FlowWatchRoutineManager {
  list(): readonly Routine[];
  create(input: RoutineInput, runAs?: string): Routine;
  update(id: string, patch: Partial<RoutineInput>): Routine | null;
}

export interface FlowWatchesDeps {
  /** Every person with a chosen domain. */
  choices(): ReadonlyArray<{ person: string; domains: readonly ChosenDomain[] }>;
  /** Whether this bot can carry the person's watches: the person's own,
   * visible, not temporary, its turns mounting the person's account
   * connection. */
  carrier(botId: string, person: string): { ok: true } | { ok: false; cause: "bot-gone" | "bot-not-eligible" };
  /** #3470: the names of the bot's enabled skills, read once per bot of a
   * pass, never once per watch. */
  skills(botId: string, person: string): ReadonlySet<string>;
  /** The bot's person, for a replay keyed by bot. */
  owner(botId: string): string | undefined;
  /** The organization's Flow plugin for this bot and person, or null. */
  helper(botId: string, person: string): FlowHelper | null;
  /** A routine connection as the person (null: no Pulsatrix access). */
  session<T>(person: string, botId: string, fn: (session: ObserveConnection) => Promise<T>): Promise<T | null>;
  /** The person's time zone, when set. */
  timeZone(person: string): string | undefined;
  hostTimeZone?: () => string;
  /** The routine manager (null: none on this server). */
  routines(): FlowWatchRoutineManager | null;
  /** The one probe engine (server/routines/routine-watch.ts): one read of
   * a built tool pre-check for this routine, its state kept per routine. */
  evaluate(routine: Routine, precheck: BuiltWatchPrecheck): Promise<RoutinePrecheckVerdict>;
  /** Forget what the engine kept for a routine: its next check reads the
   * condition as new. */
  forgetState?(routineId: string): void;
  /** A line in the bot's Events lens. */
  log(botId: string, line: string): void;
  /** A chosen domain paused: one line in the carrying bot's chat (the
   * person's main bot, or another of theirs, when that bot is gone). */
  pause(botId: string, person: string, domain: string, cause: WatchPauseCause, listing: FlowWatchListing | undefined): void;
  memory: WatchMemory;
  now?: () => number;
}

interface Cached<T> { at: number; value: T; ttl: number }

/** The routine's instructions: the watch's consigne, its skill and the step
 * it proposes. What the watch read reaches the run as fenced data. */
export function watchRoutinePrompt(watch: FlowWatch): string {
  const lines = [watch.prompt.trim(), ""];
  if (watch.skill) lines.push(`Skill: ${watch.skill}.`);
  lines.push(`Proposed step: ${proposeLabel(watch.propose)}.`);
  return lines.join("\n");
}

/** The routine a watch runs as, for the carrying bot. */
export function watchRoutineInput(botId: string, watch: FlowWatch, timeZone: string, now: number): RoutineInput {
  return {
    name: watch.summary.slice(0, 120),
    prompt: watchRoutinePrompt(watch),
    botId,
    enabled: true,
    schedule: cadenceSchedule(parseCadence(watch.cadence)!, timeZone, now),
    precheck: { kind: "code", check: FLOW_WATCH_CHECK },
    overlap: "skip",
  };
}

/** #4250 (S5 `one-probe-engine`): the Pulsatrix Flow watches a person
 * turned on are routines of the carrying bot, listed, paused, edited and
 * deleted like any routine. The person's choices stay the one store of
 * what is on (server/proactive/proactive-choices.ts); `sync` makes the
 * routines follow them. Each routine's code check (`flow_watch`) resolves
 * the watch's tokens and reads it through the one probe engine: no model
 * turn until `when` holds with a new key. There is no watch loop, no timer
 * of its own: the routine scheduler runs the checks. */
export class FlowWatches {
  private readonly deps: FlowWatchesDeps;
  private readonly now: () => number;
  private readonly listings = new Map<string, Cached<FlowWatchListing>>();
  private readonly products = new Map<string, Cached<string[]>>();
  /** #3408: the tools the person's connection serves, read with the
   * products (same session, same day), so a watch whose read cannot run is
   * never offered. */
  private readonly reads = new Map<string, Pick<ObserveSession, "tools" | "readOnly">>();
  private readonly facts = new Map<string, Cached<Map<string, unknown>>>();
  /** When each person's routines were last synced; one sync at a time. */
  private readonly synced = new Map<string, number>();
  private readonly syncing = new Map<string, Promise<void>>();

  constructor(deps: FlowWatchesDeps) {
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

  private pause(person: string, chosen: Pick<ChosenDomain, "domain" | "botId">, cause: WatchPauseCause, listing?: FlowWatchListing): void {
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
   * person asks (GET and PUT /api/me/proactive). */
  async offered(person: string, botId: string): Promise<OfferedListing> {
    const verdict = this.deps.carrier(botId, person);
    if (!verdict.ok) return { ok: false, botId, cause: verdict.cause };
    const helper = this.deps.helper(botId, person);
    if (!helper) return { ok: false, botId, cause: "no-flow" };
    const universe = await this.listing(helper, [], botId);
    if (universe.failed) return { ok: false, botId, cause: "flow-failed" };
    const products = await this.productsOf(person, botId, helper);
    if (products === null) return { ok: false, botId, cause: "no-access" };
    const reach: WatchReach = { products, skills: this.skillsOnce(botId, person), reads: this.reads.get(person) };
    const byDomain = new Map<string, OfferedWatch[]>();
    for (const watch of universe.watches) {
      const missing = watchMissing(watch, reach);
      const row: OfferedWatch = { id: watch.id, summary: watch.summary, cadence: watch.cadence, products: watch.products, runs: !missing, ...missing, tools: declaredTools(watch) };
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

  /** The watches one bot can run for the person among `rows` (its chosen
   * domains), the domains it could not read now (left as they are), and the
   * time zone of the tenant. Pauses are told once, with their cause. */
  private async runnable(person: string, botId: string, rows: readonly ChosenDomain[]): Promise<{ watches: FlowWatch[]; undecided: string[]; zone: string; helper?: FlowHelper }> {
    const zoneOf = (listing?: FlowWatchListing) => listing?.timeZone ?? this.deps.timeZone(person) ?? this.deps.hostTimeZone?.() ?? "UTC";
    const undecided = rows.map((row) => row.domain);
    const carried = this.deps.carrier(botId, person);
    if (!carried.ok) {
      for (const row of rows) this.pause(person, row, carried.cause);
      return { watches: [], undecided, zone: zoneOf() };
    }
    const helper = this.deps.helper(botId, person);
    if (!helper) {
      for (const row of rows) this.pause(person, row, "no-flow");
      return { watches: [], undecided, zone: zoneOf() };
    }
    const products = await this.productsOf(person, botId, helper);
    if (products === null) {
      for (const row of rows) this.pause(person, row, "no-access");
      return { watches: [], undecided, zone: zoneOf(), helper };
    }
    const listing = products.length ? await this.listing(helper, products, botId) : { watches: [], rejected: 0 };
    if (listing.failed) {
      for (const row of rows) this.pause(person, row, "flow-failed", listing);
      return { watches: [], undecided, zone: zoneOf(), helper };
    }
    // #3408: the one filter (products, skill, read) of what may reach the bot
    const served = watchesForBot(listing.watches, { products, skills: this.skillsOnce(botId, person), reads: this.reads.get(person) });
    const mine: FlowWatch[] = [];
    const unknown: string[] = [];
    for (const row of rows) {
      const off = new Set(row.watchesOff);
      const runnable = served.filter((watch) => watch.domain === row.domain && !off.has(watch.id));
      if (!runnable.length) {
        // against every watch of the organization, not only the served ones:
        // a domain Flow does not have is said, never skipped in silence
        const universe = await this.listing(helper, [], botId);
        const inDomain = universe.watches.filter((watch) => watch.domain === row.domain);
        if (universe.failed) {
          this.pause(person, row, "flow-failed", universe);
          unknown.push(row.domain);
        } else if (!inDomain.length) this.pause(person, row, "unknown-domain", universe);
        // nothing left on purpose (every watch switched off) is no pause
        else if (inDomain.some((watch) => !off.has(watch.id))) this.pause(person, row, "no-watch", universe);
        continue;
      }
      this.deps.memory.resumed(person, row.domain);
      mine.push(...runnable);
    }
    return { watches: mine, undecided: unknown, zone: zoneOf(listing), helper };
  }

  /** Make the person's routines follow their choices: each watch they turned
   * on, that runs for them, is a routine of the carrying bot (created, or
   * turned back on after a no); a watch no longer chosen pauses its routine.
   * A domain that cannot be read now keeps its routines as they are (their
   * check says why). A routine the person paused or deleted after their yes
   * stays so. One sync per person at a time. */
  sync(person: string): Promise<void> {
    const key = person.trim().toLowerCase();
    const running = this.syncing.get(key);
    if (running) return running.then(() => this.sync(key));
    const run = this.syncPerson(key).finally(() => this.syncing.delete(key));
    this.syncing.set(key, run);
    return run;
  }

  /** Every person with a choice or a watch routine (start, upgrade). */
  async syncAll(): Promise<void> {
    this.synced.clear();
    await this.syncStale();
  }

  /** The people not synced for an hour (a new watch of a chosen domain, a
   * watch the organization removed, a domain that can run again). Called
   * from a pass the server already makes, never from a timer of its own. */
  async syncStale(): Promise<void> {
    const people = new Set([...this.deps.choices().map((row) => row.person.trim().toLowerCase()), ...this.deps.memory.people()]);
    for (const person of people) {
      if (!person || this.now() - (this.synced.get(person) ?? 0) < WATCH_RELOAD_MS) continue;
      try {
        await this.sync(person);
      } catch {
        // the next pass tries again
      }
    }
  }

  private async syncPerson(person: string): Promise<void> {
    const manager = this.deps.routines();
    if (!manager) return;
    this.synced.set(person, this.now());
    const chosen = this.deps.choices().find((row) => row.person.trim().toLowerCase() === person)?.domains ?? [];
    const byBot = new Map<string, ChosenDomain[]>();
    for (const row of chosen) byBot.set(row.botId, [...(byBot.get(row.botId) ?? []), row]);
    const wanted = new Map<string, { botId: string; watch: FlowWatch; zone: string }>();
    const undecided = new Set<string>();
    for (const [botId, rows] of byBot) {
      const found = await this.runnable(person, botId, rows);
      for (const domain of found.undecided) undecided.add(domain);
      for (const watch of found.watches) wanted.set(watch.id, { botId, watch, zone: found.zone });
    }
    const memory = this.deps.memory;
    const routines = new Map(manager.list().map((routine) => [routine.id, routine]));
    for (const [watchId, want] of wanted) {
      const state = memory.get(person, watchId);
      let routine = state.routine ? routines.get(state.routine) : undefined;
      const row = { botId: want.botId, domain: want.watch.domain, cadence: want.watch.cadence };
      if (routine && routine.botId !== want.botId) {
        // the domain moved to another bot: the old routine pauses
        if (routine.enabled) manager.update(routine.id, { enabled: false });
        routine = undefined;
        memory.unapply(person, watchId);
      }
      if (!routine) {
        // deleted by the person after their yes: stays deleted until a new yes
        if (state.routine && state.applied && state.botId === want.botId) continue;
        const created = manager.create(watchRoutineInput(want.botId, want.watch, want.zone, this.now()), person);
        memory.link(person, watchId, { routine: created.id, ...row });
        continue;
      }
      const patch: Partial<RoutineInput> = {};
      if (!state.applied && !routine.enabled) patch.enabled = true;
      if (state.cadence !== want.watch.cadence) patch.schedule = cadenceSchedule(parseCadence(want.watch.cadence)!, want.zone, this.now());
      if (Object.keys(patch).length) manager.update(routine.id, patch);
      memory.link(person, watchId, { routine: routine.id, ...row });
    }
    for (const [watchId, state] of memory.rows(person)) {
      if (wanted.has(watchId) || !state.applied) continue;
      if (state.domain && undecided.has(state.domain)) continue;
      const routine = state.routine ? routines.get(state.routine) : undefined;
      if (routine?.enabled) manager.update(routine.id, { enabled: false });
      memory.unapply(person, watchId);
    }
    memory.save();
  }

  /** #4250: the routine's code check. The watch, read as the person through
   * the one probe engine; a turn only when `when` holds with a new key. A
   * watch that cannot run now says why and stays quiet; a read that fails
   * fails the check, as any routine's. */
  async check(routine: Routine): Promise<RoutinePrecheckVerdict> {
    const link = this.deps.memory.byRoutine(routine.id);
    if (!link) return { wake: false, reason: "This routine no longer runs a Pulsatrix watch" };
    const { person, watchId, state } = link;
    const chosen = this.deps.choices().find((row) => row.person.trim().toLowerCase() === person)?.domains
      .find((row) => row.domain === state.domain && row.botId === routine.botId);
    if (!chosen || chosen.watchesOff.includes(watchId)) return { wake: false, reason: "This watch is switched off in your choices" };
    const found = await this.runnable(person, routine.botId, [chosen]);
    const watch = found.watches.find((row) => row.id === watchId);
    if (!watch || !found.helper) return { wake: false, reason: "This watch cannot run for you now" };
    const now = this.now();
    const topics = factTopics([watch.observe, watch.when]);
    const facts = new Map<string, Map<string, unknown>>();
    for (const topic of topics) facts.set(topic, await this.factsOf(found.helper, topic));
    const resolved = resolveWatch(watch, { now, timeZone: found.zone, fact: (topic, key) => facts.get(topic)?.get(key) });
    if ("unresolved" in resolved) {
      // never a call with a raw template: skipped until the tenant sets it
      const tokens = resolved.unresolved.join(", ").slice(0, 200);
      this.skip(person, routine.botId, watch.id, `unresolved:${tokens}`, `Pulsatrix watch ${watch.id} skipped: ${tokens} not set for this organization.`);
      this.deps.memory.save();
      return { wake: false, reason: `${tokens} not set for this organization` };
    }
    const reads = this.reads.get(person);
    const call = reads ? observeCall(resolved.watch.observe, reads) : { refused: "no Pulsatrix access for this person" };
    if ("refused" in call) {
      this.skip(person, routine.botId, watch.id, `refused:${call.refused}`, `Pulsatrix watch ${watch.id} skipped: ${call.refused}.`);
      this.deps.memory.save();
      return { wake: false, reason: call.refused };
    }
    const precheck: BuiltWatchPrecheck = {
      kind: "watch",
      source: { type: "tool", tool: call.name, args: call.args },
      when: resolved.watch.when,
      // the template, not its resolved dates: one condition from day to day
      stateKey: `flow-watch:${watch.id}:${JSON.stringify([watch.observe, watch.when])}`,
      firstRun: "wake",
      // the key the loop of a server before #4250 already told: the first
      // check after the upgrade compares with it, so a roll repeats nothing
      ...(state.fired !== undefined ? { seed: { key: state.fired, at: state.last ?? state.alertAt ?? 0 } } : {}),
    };
    const verdict = await this.deps.evaluate(routine, precheck);
    this.deps.memory.observed(person, watch.id);
    if (verdict.wake) this.deps.memory.alerted(person, watch.id, this.now());
    this.deps.memory.save();
    return verdict;
  }

  /** #3140: a skip posts its line once per cause; the same cause stays
   * silent until it changes or an observe succeeds. */
  private skip(person: string, botId: string, watchId: string, cause: string, line: string): void {
    if (this.deps.memory.skipped(person, watchId, cause)) this.deps.log(botId, line);
  }

  /** #3140: a pending watch wake of a server before #4250, lost to a
   * restart: the watch's routine reads its condition as new at its next
   * check, so it fires again if it still holds. */
  replay(botId: string, watchId: string): void {
    const person = this.deps.owner(botId);
    const routine = person ? this.deps.memory.get(person, watchId).routine : undefined;
    if (!person || !routine) return;
    this.deps.memory.unfire(person, watchId);
    this.deps.memory.save();
    this.deps.forgetState?.(routine);
  }
}
