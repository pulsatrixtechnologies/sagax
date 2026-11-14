/** #4250 (S1): the signal ledger, the one store per person of what was
 * noticed and told (docs/proactive.md, "Signal ledger").
 *
 * One entry per (bot, key): `{key, kind, level, bot, firstAt, lastAt,
 * count, toldAt, channels, state, answer}`. The key is the one already used
 * by the writer: a waker event key, `engine-sign-in:<engine>`,
 * `owner-notice:<cause>`, `routine-problem:<routineId>`, a reach-me card or
 * notice id. It replaces the in-memory and per-feature "told once" memories
 * (the waker's event keys, the engine reconnect and owner notices, the reach
 * reminders and sent notices, the streak's told state), so a restart neither
 * wakes twice, rings twice nor starts a reminder clock over.
 *
 * On disk: one file per person under the ledger's folder, named by a hash of
 * the person (never their id in a file name), written whole and atomically on
 * the next tick after a change and at shutdown (`flush`).
 *
 * `tellPerson` (createTellPerson) is the one way a proactive item reaches
 * `notify`: it records the item as told in the ledger, rings once per key and
 * step, and ends in one log line. */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SignalLevel } from "../../shared/signal-levels.ts";
import { writeFileAtomic } from "../atomic.ts";

export type SignalState = "open" | "told" | "answered" | "retired" | "expired";

export const SIGNAL_STATES: readonly SignalState[] = ["open", "told", "answered", "retired", "expired"];
const LEVELS: readonly SignalLevel[] = ["fyi", "card", "urgent"];

export interface SignalEntry {
  key: string;
  /** What the entry is, for the readers (Today, metrics, learning). */
  kind: string;
  level: SignalLevel;
  /** The bot it belongs to; "" for a signal of the person alone (an engine). */
  bot: string;
  firstAt: number;
  lastAt: number;
  /** Times it was noted (an event offered, a notice heard, a card raised). */
  count: number;
  /** When it was last told to the person. */
  toldAt?: number;
  /** The channels it was told by. */
  channels: string[];
  state: SignalState;
  answer?: string;
  /** S9: when the person answered it (the metrics' time to answer runs
   * from `firstAt`, the spell's start, to here). */
  answeredAt?: number;
  /** Reminder steps already told (the escalation ladder's clock). */
  reminded?: number;
  /** A short human label, never content (a card's title). */
  label?: string;
  /** Where the item lives (a card's conversation and request). */
  ref?: { threadId: string; requestId?: string };
}

export interface SignalNote {
  key: string;
  kind: string;
  level?: SignalLevel;
  bot?: string;
  label?: string;
  ref?: { threadId: string; requestId?: string };
}

export interface SignalLedgerStorage {
  /** Every person's entries, or null when nothing was stored. */
  load(): Map<string, SignalEntry[]> | null;
  save(person: string, entries: readonly SignalEntry[]): void;
}

export interface SignalLedgerOptions {
  storage?: SignalLedgerStorage;
  now?: () => number;
  /** Entries kept per person and kind; the oldest (by lastAt) go first. */
  maxPerKind?: number;
  /** Schedules the coalesced write (tests run it at once). */
  schedule?: (fn: () => void) => void;
}

export const SIGNAL_LEDGER_MAX_PER_KIND = 2_000;

const id = (bot: string, key: string) => `${bot}\u0000${key}`;

export class SignalLedger {
  private readonly people = new Map<string, Map<string, SignalEntry>>();
  private readonly dirty = new Set<string>();
  private readonly storage: SignalLedgerStorage | undefined;
  private readonly now: () => number;
  private readonly maxPerKind: number;
  private readonly schedule: (fn: () => void) => void;
  private scheduled = false;

  constructor(options: SignalLedgerOptions = {}) {
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.maxPerKind = options.maxPerKind ?? SIGNAL_LEDGER_MAX_PER_KIND;
    this.schedule = options.schedule ?? ((fn) => {
      const handle = setTimeout(fn, 0);
      (handle as { unref?: () => void }).unref?.();
    });
    let stored: Map<string, SignalEntry[]> | null = null;
    try {
      stored = this.storage?.load() ?? null;
    } catch {
      stored = null;
    }
    for (const [person, entries] of stored ?? []) {
      const book = this.book(person);
      for (const entry of entries) {
        const clean = readEntry(entry);
        if (clean) book.set(id(clean.bot, clean.key), clean);
      }
    }
  }

  get(person: string, bot: string, key: string): SignalEntry | undefined {
    return this.people.get(norm(person))?.get(id(bot, key));
  }

  /** The entry for (bot, key) in any person's store (a bot's own notice). */
  find(bot: string, key: string): { person: string; entry: SignalEntry } | undefined {
    for (const [person, book] of this.people) {
      const entry = book.get(id(bot, key));
      if (entry) return { person, entry };
    }
    return undefined;
  }

  /** Every entry, or one person's, optionally of one kind. */
  entries(filter: { person?: string; kind?: string; bot?: string } = {}): Array<{ person: string; entry: SignalEntry }> {
    const out: Array<{ person: string; entry: SignalEntry }> = [];
    const people = filter.person !== undefined ? [[norm(filter.person), this.people.get(norm(filter.person))] as const] : [...this.people];
    for (const [person, book] of people) {
      if (!book) continue;
      for (const entry of book.values()) {
        if (filter.kind !== undefined && entry.kind !== filter.kind) continue;
        if (filter.bot !== undefined && entry.bot !== filter.bot) continue;
        out.push({ person, entry });
      }
    }
    return out;
  }

  /** Something happened: a new entry opens, a known one counts once more.
   * `fresh` says it was not in the ledger. */
  note(person: string, note: SignalNote): { entry: SignalEntry; fresh: boolean } {
    const book = this.book(person);
    const bot = note.bot ?? "";
    const at = this.now();
    const known = book.get(id(bot, note.key));
    if (known) {
      known.lastAt = at;
      known.count += 1;
      if (note.label) known.label = note.label.slice(0, 160);
      if (note.ref) known.ref = note.ref;
      this.changed(person, known.kind);
      return { entry: known, fresh: false };
    }
    const entry: SignalEntry = {
      key: note.key, kind: note.kind, level: note.level ?? "card", bot,
      firstAt: at, lastAt: at, count: 1, channels: [], state: "open",
      ...(note.label ? { label: note.label.slice(0, 160) } : {}),
      ...(note.ref ? { ref: note.ref } : {}),
    };
    book.set(id(bot, note.key), entry);
    this.changed(person, entry.kind);
    return { entry, fresh: true };
  }

  /** It was told to the person (by these channels). A retired, answered or
   * expired entry opens a new spell: told again, its reminders start over. */
  told(person: string, note: SignalNote, channels: readonly string[] = [], toldAt?: number): SignalEntry {
    const known = this.get(person, note.bot ?? "", note.key);
    const reopened = known && known.state !== "open" && known.state !== "told";
    const { entry } = this.note(person, note);
    const at = toldAt ?? this.now();
    if (reopened) {
      entry.firstAt = at;
      delete entry.reminded;
      delete entry.answer;
      delete entry.answeredAt;
    }
    entry.state = "told";
    entry.toldAt = at;
    if (note.level) entry.level = note.level;
    for (const channel of channels) if (!entry.channels.includes(channel)) entry.channels.push(channel);
    this.changed(person, entry.kind);
    return entry;
  }

  /** Whether (bot, key) is told and not settled since. */
  isTold(person: string, bot: string, key: string): boolean {
    return this.get(person, bot, key)?.state === "told";
  }

  /** A reminder step was told. */
  reminded(person: string, bot: string, key: string, step: number, channels: readonly string[] = []): void {
    const entry = this.get(person, bot, key);
    if (!entry) return;
    entry.reminded = Math.max(entry.reminded ?? 0, step);
    entry.toldAt = this.now();
    entry.lastAt = entry.toldAt;
    for (const channel of channels) if (!entry.channels.includes(channel)) entry.channels.push(channel);
    this.changed(person, entry.kind);
  }

  /** The item ended: answered, retired (its cause is gone) or expired. */
  settle(person: string, bot: string, key: string, state: Exclude<SignalState, "open" | "told">, answer?: string): boolean {
    const entry = this.get(person, bot, key);
    if (!entry || entry.state === state) return false;
    entry.state = state;
    entry.lastAt = this.now();
    if (state === "answered") entry.answeredAt = entry.lastAt;
    if (answer !== undefined) entry.answer = answer.slice(0, 200);
    this.changed(person, entry.kind);
    return true;
  }

  /** Settles every entry that matches (all people when none is named). */
  settleWhere(filter: { person?: string; kind?: string; bot?: string; key?: string; keyPrefix?: string }, state: Exclude<SignalState, "open" | "told">): number {
    let settled = 0;
    for (const { person, entry } of this.entries(filter)) {
      if (filter.key !== undefined && entry.key !== filter.key) continue;
      if (filter.keyPrefix !== undefined && !entry.key.startsWith(filter.keyPrefix)) continue;
      if (entry.state !== "open" && entry.state !== "told") continue;
      if (this.settle(person, entry.bot, entry.key, state)) settled += 1;
    }
    return settled;
  }

  /** The entry is gone, as if never seen (a dropped watch is offered again). */
  forget(person: string, bot: string, key: string): boolean {
    const book = this.people.get(norm(person));
    const entry = book?.get(id(bot, key));
    if (!book || !entry) return false;
    book.delete(id(bot, key));
    this.changed(person, entry.kind);
    return true;
  }

  /** Writes every changed person's store now (shutdown, tests). */
  flush(): void {
    this.scheduled = false;
    if (!this.storage) {
      this.dirty.clear();
      return;
    }
    for (const person of this.dirty) {
      this.dirty.delete(person);
      try {
        this.storage.save(person, [...(this.people.get(person)?.values() ?? [])]);
      } catch (error) {
        console.warn(`signal ledger: a store could not be written (${error instanceof Error ? error.message : "error"})`);
      }
    }
  }

  private book(person: string): Map<string, SignalEntry> {
    const key = norm(person);
    let book = this.people.get(key);
    if (!book) {
      book = new Map();
      this.people.set(key, book);
    }
    return book;
  }

  private changed(person: string, kind: string): void {
    const key = norm(person);
    this.trim(key, kind);
    this.dirty.add(key);
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }

  /** Keeps at most maxPerKind entries of a kind per person: a flood of one
   * kind (mail events) never pushes out another (an owner notice). */
  private trim(person: string, kind: string): void {
    const book = this.people.get(person);
    if (!book) return;
    const ofKind = [...book.entries()].filter(([, entry]) => entry.kind === kind);
    if (ofKind.length <= this.maxPerKind) return;
    ofKind.sort((left, right) => left[1].lastAt - right[1].lastAt);
    for (const [key] of ofKind.slice(0, ofKind.length - this.maxPerKind)) book.delete(key);
  }
}

/** A person's id as the stores read it (trimmed, case kept: a principal id
 * is exact). */
function norm(person: string): string {
  return person.trim();
}

function readEntry(value: unknown): SignalEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.key !== "string" || !raw.key || raw.key.length > 600) return null;
  if (typeof raw.kind !== "string" || typeof raw.bot !== "string") return null;
  if (!Number.isFinite(raw.firstAt) || !Number.isFinite(raw.lastAt)) return null;
  const state = SIGNAL_STATES.includes(raw.state as SignalState) ? raw.state as SignalState : "open";
  const level = LEVELS.includes(raw.level as SignalLevel) ? raw.level as SignalLevel : "card";
  const ref = raw.ref && typeof raw.ref === "object" && typeof (raw.ref as { threadId?: unknown }).threadId === "string"
    ? { threadId: (raw.ref as { threadId: string }).threadId, ...(typeof (raw.ref as { requestId?: unknown }).requestId === "string" ? { requestId: (raw.ref as { requestId: string }).requestId } : {}) }
    : undefined;
  return {
    key: raw.key, kind: raw.kind, level, bot: raw.bot,
    firstAt: raw.firstAt as number, lastAt: raw.lastAt as number,
    count: Number.isFinite(raw.count) ? Math.max(1, raw.count as number) : 1,
    ...(Number.isFinite(raw.toldAt) ? { toldAt: raw.toldAt as number } : {}),
    channels: Array.isArray(raw.channels) ? raw.channels.filter((channel): channel is string => typeof channel === "string").slice(0, 10) : [],
    state,
    ...(typeof raw.answer === "string" ? { answer: raw.answer } : {}),
    ...(Number.isFinite(raw.answeredAt) ? { answeredAt: raw.answeredAt as number } : {}),
    ...(Number.isFinite(raw.reminded) ? { reminded: raw.reminded as number } : {}),
    ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    ...(ref ? { ref } : {}),
  };
}

/** The file name of a person's store: a hash, never their id. */
export function signalLedgerFileName(person: string): string {
  return `${createHash("sha256").update(norm(person)).digest("hex").slice(0, 32)}.json`;
}

/** One JSON file per person under `dir` (mode 0600). */
export function signalLedgerDirStorage(dir: string): SignalLedgerStorage {
  return {
    load() {
      let names: string[];
      try {
        names = readdirSync(dir).filter((name) => /^[0-9a-f]{32}\.json$/.test(name));
      } catch {
        return null;
      }
      const people = new Map<string, SignalEntry[]>();
      for (const name of names) {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as { person?: unknown; entries?: unknown };
          if (typeof parsed.person !== "string" || !Array.isArray(parsed.entries)) continue;
          people.set(parsed.person, parsed.entries as SignalEntry[]);
        } catch {
          // one unreadable store never hides the others
        }
      }
      return people;
    },
    save(person, entries) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(join(dir, signalLedgerFileName(person)), JSON.stringify({ version: 1, person, entries }), { mode: 0o600, durable: false });
    },
  };
}

/** A proactive item the person is told about. */
export interface TellItem<N> {
  key: string;
  kind: string;
  level?: SignalLevel;
  bot?: string;
  label?: string;
  ref?: { threadId: string; requestId?: string };
  /** 0 (or absent): the item itself; 1, 2...: its reminder steps. Each
   * step rings once. */
  step?: number;
  /** What `notify` gets. */
  notification: N;
}

export interface TellPersonDeps<N> {
  ledger: SignalLedger;
  /** The one notify of the server (and its access variant). */
  notify(notification: N, item: TellItem<N>): void;
  log?(line: string): void;
}

export type TellVerdict = "told" | "already_told";

/** #4250: the one way a proactive item reaches `notify`. Rings once per key
 * and step (a restart included: the ledger is on disk), records it as told,
 * and ends in one log line. */
export function createTellPerson<N>(deps: TellPersonDeps<N>): (person: string, item: TellItem<N>) => TellVerdict {
  const log = deps.log ?? ((line: string) => console.info(line));
  return (person, item) => {
    const bot = item.bot ?? "";
    const step = item.step ?? 0;
    const known = deps.ledger.get(person, bot, item.key);
    const already = known?.state === "told" && (step === 0 || (known.reminded ?? 0) >= step);
    const where = `kind=${item.kind} key=${item.key}${bot ? ` bot=${bot}` : ""} level=${item.level ?? known?.level ?? "card"}${step ? ` step=${step}` : ""}`;
    if (already) {
      log(`[signal] ${where} verdict=already_told`);
      return "already_told";
    }
    const note: SignalNote = { key: item.key, kind: item.kind, bot, ...(item.level ? { level: item.level } : {}), ...(item.label ? { label: item.label } : {}), ...(item.ref ? { ref: item.ref } : {}) };
    if (step === 0) deps.ledger.told(person, note, ["notify"]);
    else {
      if (!known) deps.ledger.told(person, note, ["notify"]);
      deps.ledger.reminded(person, bot, item.key, step, ["notify"]);
    }
    try {
      deps.notify(item.notification, item);
    } finally {
      log(`[signal] ${where} verdict=told`);
    }
    return "told";
  };
}

/** #4250 (S2): the item's level on the notification it rings with, so the
 * one attention policy reads the writer's level, not one derived from the
 * kind. A frame the bot marked FYI stays FYI. */
export function withItemLevel<T extends { level?: unknown } | null | undefined>(note: T, level: SignalLevel | undefined): T {
  if (!note || !level || note.level === "fyi") return note;
  return { ...note, level };
}

/** #4250: the keys the server tells its proactive items under. Each names
 * the one occurrence the person is told about, so the next occurrence (a new
 * away period, a new message, another conversation) rings again. */
export const signalKeys = {
  /** A run's failure or block: once per run and status. */
  runProblem: (runId: string, status: string) => `run-problem:${runId}:${status}`,
  /** Runs skipped while the person was away: once per away period (its
   * first skipped occurrence). */
  awaySkips: (routineId: string, skips: { firstAt: number }) => `away-skips:${routineId}:${skips.firstAt}`,
  /** A run's own attention card ("needs you" on its row): once per run and
   * card. */
  runNeedsYou: (runId: string, cardId: string) => `needs-you:run:${runId}:${cardId}`,
  /** A routine paused (its person signed out, or no longer allowed): once
   * per pause, the next pause rings again. */
  routineSuspended: (routineId: string, suspension: { reason: string; at: number }) => `routine-suspended:${routineId}:${suspension.reason}:${suspension.at}`,
  /** A daily suggestion card: once per proposal. */
  proposal: (proposalId: string) => `proposal:${proposalId}`,
  /** A question or a "needs you" card: once per bot message it is about. */
  needsYou: (source: { threadId: string; messageId: string }) => `needs-you:${source.threadId}:${source.messageId}`,
  /** A keyed card told in one of several conversations under one person
   * (the administrators' homes of a server engine): once per conversation. */
  inHome: (key: string, threadId: string) => `${key}@${threadId}`,
} as const;

/** #4250: settles a keyed card's entries, the one told under the key itself
 * and those told per conversation (signalKeys.inHome). */
export function settleKeyed(ledger: SignalLedger, filter: { kind: string; key: string }, state: Exclude<SignalState, "open" | "told">): number {
  return ledger.settleWhere(filter, state) + ledger.settleWhere({ kind: filter.kind, keyPrefix: `${filter.key}@` }, state);
}

/** #4250 (S9): how a card or an attention row ended, for the signal
 * ledger. `answered` only for the person's own act: a choice, a skip, a
 * "handled". `expired`: it waited past its delay unanswered. `retired`: the
 * server or the bot closed it without the person (a stalled turn, an
 * interrupt, a restart, a newer proposal, an automatic apply, a card put
 * away), which is neither answered nor ignored. */
export type CardSignalState = "answered" | "expired" | "retired";

export interface CardSignalEnding {
  state: CardSignalState;
  requestId?: string;
  bot?: string;
  /** A keyed card's key (signalKeys keys of keyed and fix cards). */
  askKey?: string;
  /** An attention row: the bot message it was read from. */
  source?: { threadId: string; messageId: string };
}

/** #4250 (S9): how a message's card or attention ended; null while it
 * waits (or for a message with neither). */
export function cardSignalEnding(message: unknown): CardSignalEnding | null {
  if (!message || typeof message !== "object") return null;
  const row = message as {
    from?: { botId?: unknown };
    card?: { requestId?: unknown; askKey?: unknown; answered?: unknown; dismissed?: unknown; expired?: unknown; skipped?: unknown; autoApplied?: unknown };
    attention?: { botId?: unknown; threadId?: unknown; sourceMessageId?: unknown; handledAt?: unknown; closed?: unknown };
  };
  const bot = typeof row.from?.botId === "string" && row.from.botId ? row.from.botId : undefined;
  const card = row.card;
  if (card) {
    const answered = typeof card.answered === "string" ? card.answered : card.answered === true ? "yes" : "";
    // the person skipped it (#3471): their own act
    const state: CardSignalState | null = card.skipped === true ? "answered"
      : answered === "unavailable" || card.autoApplied === true ? "retired"
      // a verdict on a card closed as stale (a restart, a newer proposal) is the server's
      : answered ? (card.expired === true ? "retired" : "answered")
      : card.expired === true ? "expired"
      // closed with no choice: put away (an automatic apply, a passive card)
      : card.dismissed === true ? "retired"
      : null;
    if (!state) return null;
    return {
      state,
      ...(typeof card.requestId === "string" && card.requestId ? { requestId: card.requestId } : {}),
      ...(bot ? { bot } : {}),
      ...(typeof card.askKey === "string" && card.askKey ? { askKey: card.askKey } : {}),
    };
  }
  const attention = row.attention;
  if (!attention || !Number.isFinite(attention.handledAt)) return null;
  const state: CardSignalState = attention.closed === "expired" ? "expired" : "answered";
  const attentionBot = typeof attention.botId === "string" && attention.botId ? attention.botId : bot;
  return {
    state,
    ...(attentionBot ? { bot: attentionBot } : {}),
    ...(typeof attention.threadId === "string" && typeof attention.sourceMessageId === "string" ? { source: { threadId: attention.threadId, messageId: attention.sourceMessageId } } : {}),
  };
}

/** #4250 (S9): a card ended (the message `messageId` of `threadId`, its
 * request `requestId` for an approval): the person answered it, it expired
 * unanswered, or it was closed without them (retired). The items told
 * about it end the same way, and an answer ends their time to answer. An
 * item is about the card when it points at it (its `ref`), when it is the
 * card's own "needs you" signal (signalKeys.needsYou of the message or of
 * the attention row's source, signalKeys.runNeedsYou for a run's card), or
 * when it is the keyed card's own entry (its `askKey`, or that key told per
 * conversation, signalKeys.inHome). Only the card's bot's entries are
 * read. Returns how many were settled. */
export function settleCardSignals(
  ledger: SignalLedger,
  card: { person?: string; bot?: string; threadId: string; messageId: string; requestId?: string; askKey?: string; source?: { threadId: string; messageId: string } },
  state: CardSignalState,
  answer?: string,
): number {
  const own = new Set([signalKeys.needsYou(card), ...(card.source ? [signalKeys.needsYou(card.source)] : [])]);
  if (card.askKey) {
    own.add(card.askKey);
    own.add(signalKeys.inHome(card.askKey, card.threadId));
  }
  const runCard = `:${card.messageId}`;
  let settled = 0;
  for (const { person, entry } of ledger.entries({ ...(card.person !== undefined ? { person: card.person } : {}), ...(card.bot !== undefined ? { bot: card.bot } : {}) })) {
    if (entry.state !== "open" && entry.state !== "told") continue;
    const ref = entry.ref;
    const points = ref?.threadId === card.threadId && ref.requestId !== undefined && (ref.requestId === card.messageId || ref.requestId === card.requestId);
    const isOwn = own.has(entry.key) || (entry.key.startsWith("needs-you:run:") && entry.key.endsWith(runCard));
    if (!points && !isOwn) continue;
    if (ledger.settle(person, entry.bot, entry.key, state, state === "answered" ? answer : undefined)) settled += 1;
  }
  return settled;
}
