// The Mastery tier's measures (docs/achievements.md). Pure: the server feeds
// facts it saw (server/achievements-mastery.ts) and a nightly pass for
// the rules that span days; this file only keeps the bounded state and says
// how far each measure went. Every measure is the best value ever reached, so
// a good stretch that ended still counts, and nothing is ever taken back.
//
// A fact is something the server saw happen for one person (a routine run
// that ended, an approval denied, a turn completed on a provider). Replaying
// a fact with the same id is a no-op (the store's `seen` list).

export const MASTERY_METRICS = [
  "routine.clean-streak",
  "routine.recovered",
  "routine.continuity-runs",
  "routine.quiet-days",
  "routine.pack",
  "approval.denied-then-done",
  "turn.steered-then-done",
  "persona.revised",
  "turn.stopped-then-done",
  "approval.judgment",
  "delegation.conducted",
  "threads.tidy",
  "integrations.week",
  "subagents.turn",
  "bots.concurrent",
  "providers.thread",
  "auto.thrifty-weeks",
  "french.threads",
  "skills.learned-uses",
  "memory.recall-threads",
  "catalog.imports",
  "delegation.cross-model",
  "approvals.clean-days",
] as const;
export type MasteryMetric = (typeof MASTERY_METRICS)[number];

/** What the server saw, for one person. */
export type MasteryFact =
  /** A routine run of theirs ended: completed (ok) or failed / missed. */
  | { kind: "routine.outcome"; routineId: string; botId?: string; ok: boolean; continuity?: boolean }
  /** They changed one of their routines. */
  | { kind: "routine.edited"; routineId: string }
  /** A bot asked them for an approval. */
  | { kind: "approval.requested" }
  /** They answered an approval; `write` when the tool would change a system. */
  | { kind: "approval.answered"; threadId?: string; allow: boolean; write: boolean }
  /** They sent a message to a bot: its language, and whether it steered a running turn. */
  | { kind: "message.sent"; threadId: string; french: boolean; steered?: boolean }
  /** A bot's final answer in one of their threads (its language). */
  | { kind: "reply"; threadId: string; french: boolean }
  /** They stopped a bot's work. */
  | { kind: "bot.stopped"; botId: string }
  /** They saved a bot's standing instructions. */
  | { kind: "persona.saved"; botId: string }
  /** A turn of one of their threads started. */
  | { kind: "turn.started"; threadId: string; botId: string }
  /** A turn of one of their threads ended. `auto`: Auto picked the model, cheaper than the bot's own or not. */
  | { kind: "turn.done"; threadId: string; botId?: string; ok: boolean; provider?: string; auto?: { cheaper: boolean } }
  /** A tool line in one of their threads: a sub-agent, an integration (an MCP server), a skill loaded. */
  | { kind: "tool.used"; threadId: string; subagent?: string; integration?: string; skill?: string }
  /** A bot of theirs handed work to another bot from `threadId`, and it came back. */
  | { kind: "delegation.done"; threadId: string; toBotId: string; ok: boolean; crossModel: boolean }
  /** A bot of theirs wrote a skill from a conversation (/learn). */
  | { kind: "skill.learned"; skill: string }
  /** They wrote a bot's memory themselves. */
  | { kind: "memory.written"; botId: string }
  /** That bot recalled its memory in a thread. */
  | { kind: "memory.recalled"; botId: string; threadId: string }
  /** Someone imported a bot they published to the organization's catalogue. */
  | { kind: "catalog.imported"; botId: string; importer: string }
  /** The nightly look at their conversations. */
  | { kind: "threads.census"; open: number; folders: number; stale: number };

export interface MasteryRoutine {
  streak: number;
  completed: number;
  continuityRuns: number;
  botId?: string;
  /** Failed, then edited: counting completed runs since the fix. */
  recovering?: "failed" | "edited";
  sinceFix: number;
}

export interface MasteryDay {
  runs: number;
  fails: number;
  autoTurns: number;
  autoCheap: number;
  asked: number;
  answered: number;
  integrations: string[];
}

export interface MasteryThread {
  providers: string[];
  /** Every message and answer so far was French. */
  french: boolean;
  /** Completed turns. */
  turns: number;
  /** A write approval denied, waiting for the turn to complete another way. */
  deniedWrite?: boolean;
  /** A correction steered into the running turn, waiting for it to complete. */
  steered?: boolean;
  /** Sub-agents seen since the last turn ended. */
  subagents: string[];
  /** Bots that came back done from this thread's delegations since the last turn ended. */
  delegated: string[];
  at: number;
}

export interface MasteryState {
  /** Best value each measure reached. */
  metrics: Partial<Record<MasteryMetric, number>>;
  /** Plain counters (approvals answered, denials...). */
  counts: Record<string, number>;
  routines: Record<string, MasteryRoutine>;
  days: Record<string, MasteryDay>;
  threads: Record<string, MasteryThread>;
  /** Bot id: its standing instructions saved that day, and completed turns since. */
  personas: Record<string, { day: string; turns: number }>;
  /** Days a revision was followed by enough completed turns. */
  personaDays: string[];
  /** Bots stopped by the person, waiting for a completed turn. */
  stopped: Record<string, number>;
  /** Thread id: the bot working on it now, and since when. */
  busy: Record<string, { botId: string; at: number }>;
  /** The current stretch of work at once: most bots, and whether one failed. */
  stretch: { peak: number; failed: boolean };
  /** Skills written from a conversation, and their uses. */
  skills: Record<string, number>;
  /** Bot id: threads where its memory, written by the person, was recalled. */
  memories: Record<string, string[]>;
  /** Published bot id: who imported it. */
  imports: Record<string, string[]>;
}

export function emptyMasteryState(): MasteryState {
  return {
    metrics: {}, counts: {}, routines: {}, days: {}, threads: {}, personas: {}, personaDays: [], stopped: {}, busy: {},
    stretch: { peak: 0, failed: false }, skills: {}, memories: {}, imports: {},
  };
}

export const MASTERY_LIMITS = { routines: 128, days: 120, threads: 300, bots: 64, skills: 128, keys: 64, busy: 64 } as const;

/** The numbers the rules share (docs/achievements.md). */
export const MASTERY_RULES = {
  /** A recovered routine: completed runs in a row after the fix. */
  recoveryRuns: 3,
  /** Completed turns after a revision of the standing instructions for it to count. */
  personaTurns: 5,
  /** A French thread: at least this many completed turns. */
  frenchTurns: 6,
  /** A thrifty week: at least this many Auto turns. */
  thriftyTurns: 20,
  /** Approval judgment: one denial counts per this many answers. */
  judgmentRatio: 5,
  /** A routine that counts toward Pack Leader. */
  packRuns: 20,
  /** Ten Hands: open threads, and folders they sit in. */
  tidyThreads: 10,
  tidyFolders: 5,
  /** A turn busy longer than this is stuck, not working alongside. */
  busyMs: 6 * 3_600_000,
} as const;

export function masteryMetricValue(state: MasteryState | undefined, metric: MasteryMetric): number {
  return state?.metrics[metric] ?? 0;
}

function best(state: MasteryState, metric: MasteryMetric, value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  if ((state.metrics[metric] ?? 0) < value) state.metrics[metric] = Math.min(Math.floor(value), 1e6);
}

function count(state: MasteryState, key: string, by = 1): number {
  state.counts[key] = (state.counts[key] ?? 0) + by;
  return state.counts[key];
}

/** Keep at most `max` entries, dropping the ones written first. */
function bound<T>(map: Record<string, T>, max: number): void {
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - max; i += 1) delete map[keys[i]!];
}

function pushUnique(list: string[], item: string, max: number = MASTERY_LIMITS.keys): boolean {
  if (list.includes(item)) return false;
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
  return true;
}

function dayOf(state: MasteryState, day: string): MasteryDay {
  let entry = state.days[day];
  if (!entry) {
    entry = { runs: 0, fails: 0, autoTurns: 0, autoCheap: 0, asked: 0, answered: 0, integrations: [] };
    state.days[day] = entry;
    // keys are dates: sorted is oldest first
    const days = Object.keys(state.days).sort();
    for (const old of days.slice(0, Math.max(0, days.length - MASTERY_LIMITS.days))) delete state.days[old];
  }
  return entry;
}

function threadOf(state: MasteryState, threadId: string, at: number): MasteryThread {
  let entry = state.threads[threadId];
  if (!entry) {
    entry = { providers: [], french: true, turns: 0, subagents: [], delegated: [], at };
    state.threads[threadId] = entry;
    bound(state.threads, MASTERY_LIMITS.threads);
  }
  entry.at = at;
  return entry;
}

export function previousDay(day: string, back = 1): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
}

/** The longest run of calendar days in a row where `good` holds (a day with no entry breaks it). */
function longestRun(days: Record<string, MasteryDay>, good: (entry: MasteryDay) => boolean): number {
  let bestRun = 0;
  let run = 0;
  let last: string | null = null;
  for (const day of Object.keys(days).sort()) {
    run = good(days[day]!) ? (last !== null && run > 0 && previousDay(day) === last ? run + 1 : 1) : 0;
    bestRun = Math.max(bestRun, run);
    last = day;
  }
  return bestRun;
}

/**
 * The measures that read several days at once: after every fact and in the
 * nightly pass (server/achievements.ts), so a window that closes overnight
 * counts without a new fact. `today` is the person's day.
 */
export function reconcileMastery(state: MasteryState, today: string): void {
  // Quiet Nights: finished days in a row with routine runs and no failure
  // (today counts once it is over: a failure tonight would still break it).
  const finished = Object.fromEntries(Object.entries(state.days).filter(([day]) => day < today));
  best(state, "routine.quiet-days", longestRun(finished, (entry) => entry.runs > 0 && entry.fails === 0));
  // Clean Slate: finished days where every approval asked was answered that day and no routine failed.
  const clean = Object.entries(state.days).filter(([day, entry]) => day < today && entry.asked > 0 && entry.answered >= entry.asked && entry.fails === 0).length;
  best(state, "approvals.clean-days", clean);
  // Plugged In: integrations used in the last seven days.
  const week = new Set<string>();
  for (let back = 0; back < 7; back += 1) for (const name of state.days[previousDay(today, back)]?.integrations ?? []) week.add(name);
  best(state, "integrations.week", week.size);
  // Thrifty: a seven-day window with enough Auto turns, more than half on a cheaper model.
  for (const end of Object.keys(state.days)) {
    let turns = 0;
    let cheap = 0;
    for (let back = 0; back < 7; back += 1) {
      const entry = state.days[previousDay(end, back)];
      turns += entry?.autoTurns ?? 0;
      cheap += entry?.autoCheap ?? 0;
    }
    if (turns >= MASTERY_RULES.thriftyTurns && cheap * 2 > turns) best(state, "auto.thrifty-weeks", 1);
  }
}

/** Count one fact for a person on `day` (their own). Returns false when it changed nothing. */
export function applyMasteryFact(state: MasteryState, fact: MasteryFact, at: number, day: string): boolean {
  switch (fact.kind) {
    case "routine.outcome": {
      const routine = (state.routines[fact.routineId] ??= { streak: 0, completed: 0, continuityRuns: 0, sinceFix: 0 });
      bound(state.routines, MASTERY_LIMITS.routines);
      if (fact.botId) routine.botId = fact.botId;
      const today = dayOf(state, day);
      if (fact.ok) {
        today.runs += 1;
        routine.streak += 1;
        routine.completed += 1;
        if (fact.continuity) routine.continuityRuns += 1;
        if (routine.recovering === "edited") {
          routine.sinceFix += 1;
          if (routine.sinceFix >= MASTERY_RULES.recoveryRuns) {
            routine.recovering = undefined;
            best(state, "routine.recovered", count(state, "routine.recovered"));
          }
        }
        best(state, "routine.clean-streak", routine.streak);
        best(state, "routine.continuity-runs", routine.continuityRuns);
        const bots = new Set(Object.values(state.routines).filter((item) => item.completed >= MASTERY_RULES.packRuns && item.botId).map((item) => item.botId));
        best(state, "routine.pack", bots.size);
      } else {
        today.fails += 1;
        routine.streak = 0;
        routine.recovering = "failed";
        routine.sinceFix = 0;
      }
      reconcileMastery(state, day);
      return true;
    }
    case "routine.edited": {
      const routine = state.routines[fact.routineId];
      if (routine?.recovering !== "failed") return false;
      routine.recovering = "edited";
      routine.sinceFix = 0;
      return true;
    }
    case "approval.requested":
      dayOf(state, day).asked += 1;
      return true;
    case "approval.answered": {
      dayOf(state, day).answered += 1;
      const answered = count(state, "approval.answered");
      const denied = fact.allow ? state.counts["approval.denied"] ?? 0 : count(state, "approval.denied");
      best(state, "approval.judgment", Math.min(denied, Math.floor(answered / MASTERY_RULES.judgmentRatio)));
      if (!fact.allow && fact.write && fact.threadId) threadOf(state, fact.threadId, at).deniedWrite = true;
      return true;
    }
    case "message.sent": {
      const thread = threadOf(state, fact.threadId, at);
      if (!fact.french) thread.french = false;
      if (fact.steered) thread.steered = true;
      return true;
    }
    case "reply": {
      if (!fact.french) threadOf(state, fact.threadId, at).french = false;
      return !fact.french;
    }
    case "bot.stopped":
      state.stopped[fact.botId] = at;
      bound(state.stopped, MASTERY_LIMITS.bots);
      return true;
    case "persona.saved":
      state.personas[fact.botId] = { day, turns: 0 };
      bound(state.personas, MASTERY_LIMITS.bots);
      return true;
    case "turn.started": {
      for (const [thread, entry] of Object.entries(state.busy)) if (at - entry.at > MASTERY_RULES.busyMs) delete state.busy[thread];
      if (Object.keys(state.busy).length === 0) state.stretch = { peak: 0, failed: false };
      state.busy[fact.threadId] = { botId: fact.botId, at };
      bound(state.busy, MASTERY_LIMITS.busy);
      state.stretch.peak = Math.max(state.stretch.peak, new Set(Object.values(state.busy).map((entry) => entry.botId)).size);
      return true;
    }
    case "turn.done": {
      const thread = threadOf(state, fact.threadId, at);
      if (fact.provider) pushUnique(thread.providers, fact.provider.toLowerCase(), 16);
      best(state, "providers.thread", thread.providers.length);
      const today = dayOf(state, day);
      if (fact.auto) {
        today.autoTurns += 1;
        if (fact.auto.cheaper) today.autoCheap += 1;
      }
      // Full House: the stretch counts when its last bot finishes and none failed.
      if (state.busy[fact.threadId]) {
        delete state.busy[fact.threadId];
        if (!fact.ok) state.stretch.failed = true;
        if (Object.keys(state.busy).length === 0) {
          if (!state.stretch.failed) best(state, "bots.concurrent", state.stretch.peak);
          state.stretch = { peak: 0, failed: false };
        }
      }
      if (fact.ok) {
        thread.turns += 1;
        if (thread.deniedWrite) best(state, "approval.denied-then-done", count(state, "approval.denied-then-done"));
        if (thread.steered) best(state, "turn.steered-then-done", count(state, "turn.steered-then-done"));
        best(state, "subagents.turn", thread.subagents.length);
        if (thread.delegated.length >= 2) best(state, "delegation.conducted", count(state, "delegation.conducted"));
        if (thread.french && thread.turns === MASTERY_RULES.frenchTurns) best(state, "french.threads", count(state, "french.threads"));
        if (fact.botId && state.stopped[fact.botId]) {
          delete state.stopped[fact.botId];
          best(state, "turn.stopped-then-done", count(state, "turn.stopped-then-done"));
        }
        const persona = fact.botId ? state.personas[fact.botId] : undefined;
        if (persona) {
          persona.turns += 1;
          if (persona.turns === MASTERY_RULES.personaTurns) {
            pushUnique(state.personaDays, persona.day, 64);
            best(state, "persona.revised", state.personaDays.length);
            delete state.personas[fact.botId!];
          }
        }
      }
      thread.deniedWrite = undefined;
      thread.steered = undefined;
      thread.subagents = [];
      thread.delegated = [];
      reconcileMastery(state, day);
      return true;
    }
    case "tool.used": {
      let changed = false;
      if (fact.subagent) changed = pushUnique(threadOf(state, fact.threadId, at).subagents, fact.subagent, 32) || changed;
      if (fact.integration) changed = pushUnique(dayOf(state, day).integrations, fact.integration.toLowerCase(), 32) || changed;
      if (fact.integration) reconcileMastery(state, day);
      const skill = fact.skill?.toLowerCase();
      if (skill && state.skills[skill] !== undefined) {
        state.skills[skill] += 1;
        best(state, "skills.learned-uses", state.skills[skill]!);
        changed = true;
      }
      return changed;
    }
    case "delegation.done": {
      if (!fact.ok) return false;
      pushUnique(threadOf(state, fact.threadId, at).delegated, fact.toBotId, 16);
      if (fact.crossModel) best(state, "delegation.cross-model", count(state, "delegation.cross-model"));
      return true;
    }
    case "skill.learned":
      state.skills[fact.skill.toLowerCase()] ??= 0;
      bound(state.skills, MASTERY_LIMITS.skills);
      return true;
    case "memory.written":
      state.memories[fact.botId] ??= [];
      bound(state.memories, MASTERY_LIMITS.bots);
      return true;
    case "memory.recalled": {
      const threads = state.memories[fact.botId];
      if (!threads || !pushUnique(threads, fact.threadId, 32)) return false;
      best(state, "memory.recall-threads", threads.length);
      return true;
    }
    case "catalog.imported": {
      const people = (state.imports[fact.botId] ??= []);
      bound(state.imports, MASTERY_LIMITS.bots);
      if (!pushUnique(people, fact.importer, 64)) return false;
      best(state, "catalog.imports", people.length);
      return true;
    }
    case "threads.census": {
      // Ten Hands: enough open threads in enough folders, none left to go stale.
      const tidy = fact.stale === 0 && fact.folders >= MASTERY_RULES.tidyFolders;
      best(state, "threads.tidy", tidy ? fact.open : Math.min(fact.open, MASTERY_RULES.tidyThreads - 1));
      return true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Stored state: read back defensively, bounded                        */
/* ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 160).slice(-max) : [];
}

export function cleanMasteryState(input: unknown): MasteryState {
  const value = record(input);
  const state = emptyMasteryState();
  const entries = (raw: unknown, max: number) => Object.entries(record(raw)).slice(-max).map(([id, item]) => [id.slice(0, 160), item] as const);
  for (const metric of MASTERY_METRICS) {
    const n = num(record(value.metrics)[metric]);
    if (n > 0) state.metrics[metric] = n;
  }
  for (const [key, n] of entries(value.counts, 64)) if (num(n) > 0) state.counts[key] = num(n);
  for (const [id, raw] of entries(value.routines, MASTERY_LIMITS.routines)) {
    const r = record(raw);
    state.routines[id] = {
      streak: num(r.streak),
      completed: num(r.completed),
      continuityRuns: num(r.continuityRuns),
      sinceFix: num(r.sinceFix),
      ...(typeof r.botId === "string" ? { botId: r.botId.slice(0, 160) } : {}),
      ...(r.recovering === "failed" || r.recovering === "edited" ? { recovering: r.recovering } : {}),
    };
  }
  for (const [day, raw] of Object.entries(record(value.days)).filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort().slice(-MASTERY_LIMITS.days)) {
    const d = record(raw);
    state.days[day] = { runs: num(d.runs), fails: num(d.fails), autoTurns: num(d.autoTurns), autoCheap: num(d.autoCheap), asked: num(d.asked), answered: num(d.answered), integrations: strings(d.integrations, 32) };
  }
  for (const [id, raw] of entries(value.threads, MASTERY_LIMITS.threads)) {
    const t = record(raw);
    state.threads[id] = {
      providers: strings(t.providers, 16),
      french: t.french !== false,
      turns: num(t.turns),
      subagents: strings(t.subagents, 32),
      delegated: strings(t.delegated, 16),
      at: num(t.at),
      ...(t.deniedWrite === true ? { deniedWrite: true } : {}),
      ...(t.steered === true ? { steered: true } : {}),
    };
  }
  for (const [id, raw] of entries(value.personas, MASTERY_LIMITS.bots)) {
    const p = record(raw);
    if (typeof p.day === "string") state.personas[id] = { day: p.day.slice(0, 10), turns: num(p.turns) };
  }
  state.personaDays = strings(value.personaDays, 64);
  for (const [id, at] of entries(value.stopped, MASTERY_LIMITS.bots)) if (num(at) > 0) state.stopped[id] = num(at);
  for (const [id, raw] of entries(value.busy, MASTERY_LIMITS.busy)) {
    const b = record(raw);
    if (typeof b.botId === "string" && num(b.at) > 0) state.busy[id] = { botId: b.botId.slice(0, 160), at: num(b.at) };
  }
  const stretch = record(value.stretch);
  state.stretch = { peak: num(stretch.peak), failed: stretch.failed === true };
  for (const [name, n] of entries(value.skills, MASTERY_LIMITS.skills)) state.skills[name] = num(n);
  for (const [id, threads] of entries(value.memories, MASTERY_LIMITS.bots)) state.memories[id] = strings(threads, 32);
  for (const [id, people] of entries(value.imports, MASTERY_LIMITS.bots)) state.imports[id] = strings(people, 64);
  return state;
}

/* ------------------------------------------------------------------ */
/* French, cheaply (shared/looks-french.ts)                             */
/* ------------------------------------------------------------------ */

export { looksFrench } from "./looks-french.ts";
