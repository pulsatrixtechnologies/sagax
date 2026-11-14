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
 * The told state is the signal ledger's (S1), under the card's own key in
 * the person's store, kind PRODUCT_FIX_KIND: raised is told, retired is
 * retired, so Today, the metrics and the reminders read it like the routine
 * fix card. */
import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import type { SignalLedger } from "../proactive/signal-ledger.ts";
import type { ProductHealthChange } from "./perspicax-events.ts";

/** The signal ledger kind of a product or phone line fix card. */
export const PRODUCT_FIX_KIND = "product-fix";

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

/** The card's ask_choice input, in the person's words. */
export function productFixCardInput(change: ProductHealthChange, names: { product?: string }, words: ApprovalWords): ProductFixCardInput {
  const voice = change.kind === "voice_line";
  const product = (names.product?.trim() || change.api || "").slice(0, 80);
  // a line sent without its number reads without it
  const lead = (voice
    ? words.t(change.state === "out_of_credits" ? "product.fixCard.voiceCredits" : "product.fixCard.voiceFailing", { number: change.number ?? "" })
    : words.t("product.fixCard.failing", { product })).replace(/ {2,}/g, " ");
  const question = [lead, change.reason.trim()].filter(Boolean).join("\n\n");
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
}

export class ProductFixCards {
  private readonly deps: ProductFixCardsDeps;

  constructor(deps: ProductFixCardsDeps) {
    this.deps = deps;
  }

  /** One health change: raise or replace the card while it fails, retire it
   * once it works again. */
  apply(change: ProductHealthChange): "raised" | "retired" | "none" {
    if (!change.failing) {
      const place = this.deps.place(change.principalId, false);
      if (place) this.deps.signals?.settle(change.principalId, place.botId, change.key, "retired");
      if (!place || !this.deps.pending(place, change.key)) return "none";
      return this.deps.ask(place, change.principalId, { tool: ASK_CHOICE_TOOL, key: change.key, retire: true }) ? "retired" : "none";
    }
    const place = this.deps.place(change.principalId, true);
    if (!place) return "none";
    const product = change.api ? this.deps.productName(place, change.api) : undefined;
    const input = productFixCardInput(change, product ? { product } : {}, this.deps.words(change.principalId));
    const open = this.deps.pending(place, change.key);
    if (!this.deps.ask(place, change.principalId, input)) return "none";
    // replaced in place: noted, not told again
    const note = { key: change.key, kind: PRODUCT_FIX_KIND, level: change.level, bot: place.botId, label: input.title, ref: { threadId: place.threadId } };
    if (open) this.deps.signals?.note(change.principalId, note);
    else this.deps.signals?.told(change.principalId, note);
    return "raised";
  }
}
