/** #4250 (S4): a product, or the person's phone line, that stopped working
 * for a person is told to that person as something to fix, once: one keyed
 * ask_choice card (#4205), raised by the server without a model, in the
 * person's conversation with their Primary Bot. Key `product:<api id>` or
 * `voice-line`, the organization server's own reason as its words, choices to
 * check it now or have it explained. It is the existing question card, like
 * the routine fix card (server/routines/routine-problem-card.ts): it sits in
 * the pinned zone and in Today, rings once as a question when raised, and
 * holds nothing.
 *
 * - A later failing event of the same key replaces its words in place (the
 *   key finds it, after a restart too); nothing rings again.
 * - The good state retires it, silently: there is nothing left to do.
 * - A good state with no card open does nothing.
 *
 * #4303: only what is still wrong is told, once.
 * - A failing state is told after PRODUCT_FIX_SETTLE_MS, and only when it is
 *   still the key's latest state then: a blip (a short restart of a server)
 *   whose recovery arrives meanwhile is never told. A card already open is
 *   replaced at once (it is already shown).
 * - Each key keeps its latest state (the event's own time and id), stored,
 *   so the same event delivered again, or an older one delivered late (a
 *   retry that arrives after the recovery), changes nothing, after a
 *   restart too. A failing state waiting to be told when the server stopped
 *   is told once it restarts, if it is still the latest.
 * - The card's words fit the pinned card whole: whole sentences, no cut.
 *
 * The told state is the signal ledger's (S1), under the card's own key in
 * the person's store, kind PRODUCT_FIX_KIND: raised is told, retired is
 * retired, so Today, the metrics and the reminders read it like the routine
 * fix card. */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { QUESTION_TITLE_MAX } from "../../shared/ask-question.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { SignalLedger } from "../proactive/signal-ledger.ts";
import type { ProductHealthChange } from "./perspicax-events.ts";

/** The signal ledger kind of a product or phone line fix card. */
export const PRODUCT_FIX_KIND = "product-fix";

/** How long a failing state waits before it is told: a recovery within it
 * (a server that restarted) leaves nothing to tell. */
export const PRODUCT_FIX_SETTLE_MS = 3 * 60_000;

/** Latest states kept (one per person and key); the oldest go first. */
export const PRODUCT_FIX_STATES_MAX = 5_000;

export interface ProductFixCardInput {
  tool: typeof ASK_CHOICE_TOOL;
  key: string;
  wait: false;
  decision: true;
  title: string;
  question: string;
  options: string[];
  details: string[];
}

export type ProductFixCardAsk = ProductFixCardInput | { tool: typeof ASK_CHOICE_TOOL; key: string; retire: true };

/** `lead`, then as many of `more`'s whole sentences as fit in `max`
 * characters: the pinned card shows a question of that length whole, as its
 * title, so nothing reads cut. The lead is kept whole even when longer. */
export function fitWholeSentences(lead: string, more: string, max = QUESTION_TITLE_MAX): string {
  let text = lead.trim();
  const sentences = more.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/u).filter(Boolean);
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > max) break;
    text = next;
  }
  return text;
}

/** The card's ask_choice input, in the person's words. */
export function productFixCardInput(change: ProductHealthChange, names: { product?: string }, words: ApprovalWords): ProductFixCardInput {
  const voice = change.kind === "voice_line";
  const product = (names.product?.trim() || change.api || "").slice(0, 80);
  // a line sent without its number reads without it
  const lead = (voice
    ? words.t(change.state === "out_of_credits" ? "product.fixCard.voiceCredits" : "product.fixCard.voiceFailing", { number: change.number ?? "" })
    : words.t("product.fixCard.failing", { product })).replace(/ {2,}/g, " ");
  const question = fitWholeSentences(lead, change.reason);
  const choices: Array<[string, string]> = [
    [words.t(voice ? "product.fixCard.checkLine" : "product.fixCard.check"), words.t(voice ? "product.fixCard.checkLineDetail" : "product.fixCard.checkDetail")],
    [words.t("product.fixCard.explain"), words.t("product.fixCard.explainDetail")],
  ];
  return {
    tool: ASK_CHOICE_TOOL,
    key: change.key,
    wait: false,
    decision: true,
    title: (voice ? words.t("product.fixCard.voiceTitle") : words.t("product.fixCard.title", { product })).slice(0, 120),
    question,
    options: choices.map(([label]) => label),
    details: choices.map(([, detail]) => detail),
  };
}

/** Where a person's fix card goes. */
export interface ProductFixPlace {
  botId: string;
  threadId: string;
}

/** A key's latest state, as stored. */
export interface ProductFixState {
  /** The event's own time (ms), as the organization server stamped it. */
  at: number;
  eventId: string;
  /** When this server received it (ms): the settle clock. */
  receivedAt: number;
  /** Told to the person (a card raised for this state). */
  told: boolean;
  change: ProductHealthChange;
}

export interface ProductFixStateStorage {
  load(): ProductFixState[] | null;
  save(states: readonly ProductFixState[]): void;
}

/** One JSON file (mode 0600). */
export function productFixStateFile(path: string): ProductFixStateStorage {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { states?: unknown };
        return Array.isArray(parsed.states) ? (parsed.states as ProductFixState[]) : null;
      } catch {
        return null;
      }
    },
    save(states) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileAtomic(path, JSON.stringify({ version: 1, states }), { mode: 0o600, durable: false });
    },
  };
}

export interface ProductFixTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimer: ProductFixTimer = {
  set(fn, ms) {
    const handle = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface ProductFixCardsDeps {
  /** The person's conversation with their Primary Bot; `start` opens it
   * when there is none (a retire never starts one). */
  place(principalId: string, start: boolean): ProductFixPlace | null;
  /** Whether a card raised with `key` is still open there. */
  pending(place: ProductFixPlace, key: string): boolean;
  /** ask_choice as that bot, in that conversation: raises, replaces in
   * place (same key) or retires (`retire` true). False when not posted. */
  ask(place: ProductFixPlace, principalId: string, input: ProductFixCardAsk): boolean;
  words(principalId: string): ApprovalWords;
  /** The product's display name for the person, when known. */
  productName(place: ProductFixPlace, api: string): string | undefined;
  /** The signal ledger, keyed by the person's principal id. */
  signals?: SignalLedger;
  /** The keys' latest states, kept across restarts. */
  storage?: ProductFixStateStorage;
  /** How long a failing state waits before it is told (default
   * PRODUCT_FIX_SETTLE_MS; 0 tells it at once). */
  settleMs?: number;
  timer?: ProductFixTimer;
  now?(): number;
}

export type ProductFixOutcome = "raised" | "retired" | "held" | "none";

const stateId = (principalId: string, key: string) => `${principalId.trim().toLowerCase()}\u0000${key}`;

function readState(value: unknown): ProductFixState | null {
  const row = value as Partial<ProductFixState> | null;
  const change = row?.change as Partial<ProductHealthChange> | undefined;
  if (!row || typeof row.at !== "number" || typeof row.eventId !== "string" || typeof row.receivedAt !== "number" || !change) return null;
  if (typeof change.principalId !== "string" || typeof change.key !== "string" || typeof change.failing !== "boolean") return null;
  if (change.kind !== "product_health" && change.kind !== "voice_line") return null;
  return { at: row.at, eventId: row.eventId, receivedAt: row.receivedAt, told: row.told === true, change: change as ProductHealthChange };
}

export class ProductFixCards {
  private readonly deps: ProductFixCardsDeps;
  private readonly states = new Map<string, ProductFixState>();
  private readonly timers = new Map<string, unknown>();
  private readonly settleMs: number;
  private readonly timer: ProductFixTimer;
  private readonly now: () => number;

  constructor(deps: ProductFixCardsDeps) {
    this.deps = deps;
    this.settleMs = Math.max(0, deps.settleMs ?? PRODUCT_FIX_SETTLE_MS);
    this.timer = deps.timer ?? realTimer;
    this.now = deps.now ?? Date.now;
    let stored: ProductFixState[] | null = null;
    try {
      stored = deps.storage?.load() ?? null;
    } catch {
      stored = null;
    }
    for (const value of stored ?? []) {
      const state = readState(value);
      if (state) this.states.set(stateId(state.change.principalId, state.change.key), state);
    }
  }

  /** Tells the failing states that were waiting when the server stopped,
   * once their settle time is over and if they are still the latest. */
  resume(): void {
    for (const [id, state] of this.states) {
      if (!state.change.failing || state.told || this.timers.has(id)) continue;
      this.hold(id, Math.max(0, state.receivedAt + this.settleMs - this.now()));
    }
  }

  /** One health change: tell the card while it still fails, replace an
   * open one in place, retire it once it works again. */
  apply(change: ProductHealthChange): ProductFixOutcome {
    const id = stateId(change.principalId, change.key);
    const at = Date.parse(change.at);
    const eventAt = Number.isFinite(at) ? at : this.now();
    const known = this.states.get(id);
    // the same event again, or an older one delivered late: the key's
    // latest state stands
    if (known && (known.eventId === change.eventId || eventAt < known.at)) return "none";
    const state: ProductFixState = { at: eventAt, eventId: change.eventId, receivedAt: this.now(), told: false, change };
    this.states.set(id, state);

    if (!change.failing) {
      this.drop(id);
      this.save();
      const place = this.deps.place(change.principalId, false);
      if (place) this.deps.signals?.settle(change.principalId, place.botId, change.key, "retired");
      if (!place || !this.deps.pending(place, change.key)) return "none";
      return this.deps.ask(place, change.principalId, { tool: ASK_CHOICE_TOOL, key: change.key, retire: true }) ? "retired" : "none";
    }
    // a card already open is shown: its new words replace it at once
    const shown = this.deps.place(change.principalId, false);
    if (this.settleMs === 0 || (shown && this.deps.pending(shown, change.key))) {
      this.drop(id);
      return this.tell(id);
    }
    this.save();
    if (!this.timers.has(id)) this.hold(id, this.settleMs);
    return "held";
  }

  private hold(id: string, ms: number): void {
    this.timers.set(id, this.timer.set(() => {
      this.timers.delete(id);
      try {
        this.tell(id);
      } catch (error) {
        console.warn(`[perspicax-events] fix card not told (${error instanceof Error ? error.name : "error"})`);
      }
    }, ms));
  }

  private drop(id: string): void {
    const handle = this.timers.get(id);
    if (handle === undefined) return;
    this.timer.clear(handle);
    this.timers.delete(id);
  }

  /** Raises or replaces the card of the key's latest state, if it still
   * fails. */
  private tell(id: string): ProductFixOutcome {
    const state = this.states.get(id);
    if (!state || !state.change.failing) return "none";
    const change = state.change;
    const place = this.deps.place(change.principalId, true);
    if (!place) return "none";
    const product = change.api ? this.deps.productName(place, change.api) : undefined;
    const input = productFixCardInput(change, product ? { product } : {}, this.deps.words(change.principalId));
    const open = this.deps.pending(place, change.key);
    if (!this.deps.ask(place, change.principalId, input)) return "none";
    state.told = true;
    this.save();
    // replaced in place: noted, not told again
    const note = { key: change.key, kind: PRODUCT_FIX_KIND, level: change.level, bot: place.botId, label: input.title, ref: { threadId: place.threadId } };
    if (open) this.deps.signals?.note(change.principalId, note);
    else this.deps.signals?.told(change.principalId, note);
    return "raised";
  }

  private save(): void {
    if (!this.deps.storage) return;
    while (this.states.size > PRODUCT_FIX_STATES_MAX) {
      let oldest: string | undefined;
      let oldestAt = Infinity;
      for (const [id, state] of this.states) {
        if (state.receivedAt < oldestAt) {
          oldestAt = state.receivedAt;
          oldest = id;
        }
      }
      if (oldest === undefined) break;
      this.drop(oldest);
      this.states.delete(oldest);
    }
    try {
      this.deps.storage.save([...this.states.values()]);
    } catch (error) {
      console.warn(`[perspicax-events] fix card states not saved (${error instanceof Error ? error.name : "error"})`);
    }
  }
}
