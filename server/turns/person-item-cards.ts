// #4233 (Q4): an item only the person can do ([HUMAIN] and its kin, read by
// shared/person-attention.ts) of a routine run or a wake is one keyed card,
// never a line of a list card that the next run writes again.
//
// Before this, the relay turned a run's tagged lines into one attention card
// of up to 12 items, deduplicated per source message and per run card: the
// same items written again by the next run made a new card, run after run.
// Keyed ask_choice cards (#4205) already had what items lacked: a key that
// spans the bot's conversations with the person, replace in place, retire.
// So each item is raised through that same ask_choice path (the server calls
// it as the bot would), with:
// - its key: the ticket it names, else a hash of its plain text, under the
//   routine's own prefix (so a later run of the same routine finds it);
// - wait false: it holds no turn and no run;
// - the choices "Done" and "Not for me" (in the item's language), free text
//   allowed as on every question card.
// The same item in the next run finds its pending card (left as it is when
// its words did not change, replaced in place otherwise); an item a later
// run of the same routine no longer lists is retired. An item the person
// already answered (Done, Not for me, their own words) or put away is never
// raised again while the runs keep listing it: the answer stands. Once a
// run of the routine no longer lists it, its answered card lets go of the
// key, so the item listed again later is a new card. An item the card
// cannot carry (its words end on a choice Done and Not for me cannot
// answer) stays for the attention card, so nothing is lost.
//
// The one conversion point for the two readers of personAttention:
// syncRoutineRunToSource (a run's own end, which retires) and
// relayPersonAttention (a run's late answer, which only raises or replaces:
// a late answer is not a later run). #4238: the items of a teammate's
// exchange take this same path under the peer scope, with retire false (an
// exchange is not a run that lists them all): the tagged items the relay
// reads there, and the ones the server raises from the bot's words
// (server/turns/peer-outcome-relay.ts, its fallback and its start-up
// back-fill).
import { createHash } from "node:crypto";

import { textLanguage } from "../../shared/looks-french.ts";
import { ASK_CHOICE_LIMITS, ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import type { PersonAttentionItem } from "../../shared/person-attention.ts";
import type { WireMessage } from "../../shared/wire.ts";

/** The choices of an item's card, by the item's language. */
export const PERSON_ITEM_CHOICES = {
  en: ["Done", "Not for me"],
  fr: ["Fait", "Pas pour moi"],
} as const;

const KEY_PREFIX = "item:";

/** #4238: the scope of the items raised from a teammate's exchange (no
 * routine id is this short word: routine ids are generated). */
export const PEER_ITEM_SCOPE = "peer";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The prefix every item key of one routine starts with. */
export function personItemKeyPrefix(routineId: string): string {
  const scope = routineId.length <= 80 ? routineId : sha(routineId).slice(0, 24);
  return `${KEY_PREFIX}${scope}:`;
}

/** An item's words without markdown, spaces tidied, case folded: the same
 * item written again with other emphasis is the same item. */
export function personItemPlainText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/** The card's key of one item of a routine: its ticket, else a hash of its
 * plain text. */
export function personItemKey(routineId: string, item: Pick<PersonAttentionItem, "text" | "ticketId">): string {
  const prefix = personItemKeyPrefix(routineId);
  return item.ticketId ? `${prefix}t${item.ticketId}` : `${prefix}h${sha(personItemPlainText(item.text)).slice(0, 16)}`;
}

/** The card's question: the items of one key (one ticket can carry several)
 * as the bot wrote them, one per line, and the ticket's link when the server
 * knows the site. */
export function personItemQuestion(items: PersonAttentionItem | readonly PersonAttentionItem[]): string {
  const list: readonly PersonAttentionItem[] = Array.isArray(items) ? items : [items as PersonAttentionItem];
  const withLink = list.find((item) => item.ticketId && item.ticketUrl);
  const link = withLink ? `\n\n[#${withLink.ticketId}](${withLink.ticketUrl})` : "";
  return `${list.map((item) => item.text).join("\n")}${link}`;
}

type ItemRow = Pick<WireMessage, "id" | "kind" | "card">;

/** The keys starting with `prefix` whose newest card in `messages` (one
 * conversation) the person answered or put away: a card closed by the
 * server (retired, expired) does not count. `accepts`: the card is the
 * asking bot's own. */
export function answeredItemKeys<M extends ItemRow>(messages: readonly M[], prefix: string, accepts: (message: M) => boolean = () => true): string[] {
  const newest = new Map<string, boolean>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const card = message.kind === "options" ? message.card : undefined;
    const key = card?.askKey;
    if (!card || !key || !key.startsWith(prefix) || newest.has(key) || !accepts(message)) continue;
    newest.set(key, Boolean(card.answered || card.dismissed) && !card.expired);
  }
  return [...newest].filter(([, answered]) => answered).map(([key]) => key);
}

/** The rows of `messages` whose answered or put away card still holds
 * `key`, each with its card without the key (the item it named is gone
 * from the routine's list: listed again, it is a new card). */
export function releasedItemCards<M extends ItemRow>(messages: readonly M[], key: string, accepts: (message: M) => boolean = () => true): Array<{ messageId: string; card: NonNullable<M["card"]> }> {
  const out: Array<{ messageId: string; card: NonNullable<M["card"]> }> = [];
  for (const message of messages) {
    const card = message.kind === "options" ? message.card : undefined;
    if (!card || card.askKey !== key || !(card.answered || card.dismissed) || !accepts(message)) continue;
    const { askKey: _released, ...rest } = card;
    out.push({ messageId: message.id, card: rest as NonNullable<M["card"]> });
  }
  return out;
}

export interface PersonItemCardDeps {
  /** The pending card raised with `key` in the bot's conversations with the
   * person (the ask_choice key index), or null. */
  pending(key: string): { question: string; options: readonly string[] } | null;
  /** The keys of the pending cards starting with `prefix`, in the same
   * conversations. */
  pendingKeys(prefix: string): readonly string[];
  /** The keys starting with `prefix` whose card the person answered or put
   * away (answeredItemKeys over the conversation the cards are raised in). */
  answeredKeys(prefix: string): readonly string[];
  /** The answered card of `key` lets go of it (releasedItemCards). */
  release(key: string): void;
  /** ask_choice as the bot calls it (server/widgets/chat-widgets.ts
   * createAgentCard, raised as a question card): whether it took. */
  ask(input: Record<string, unknown>): boolean;
}

export interface PersonItemCardsOutcome {
  /** Items no card could carry: they stay for the attention card. */
  left: PersonAttentionItem[];
  raised: string[];
  replaced: string[];
  kept: string[];
  retired: string[];
  /** Answered items whose card let go of its key (a run no longer lists
   * them). */
  released: string[];
}

/** Bring one routine's item cards to `items`, the list of its latest run
 * (empty: that run listed none). `language`: the person's, for items whose
 * own words do not say. Items that share a key (two items on one ticket) are
 * one card that carries them all. `retire: false` (a run's late answer, which
 * is not a later run): raise or replace only, never retire a card the run's
 * own list still holds, never release an answered one. An item the person
 * answered or put away is kept as it is while the list holds it. */
export function syncPersonItemCards(
  run: { routineId: string; routineName?: string },
  items: readonly PersonAttentionItem[],
  deps: PersonItemCardDeps,
  language?: "fr" | "en",
  options: { retire?: boolean } = {},
): PersonItemCardsOutcome {
  const out: PersonItemCardsOutcome = { left: [], raised: [], replaced: [], kept: [], retired: [], released: [] };
  const answered = new Set(deps.answeredKeys(personItemKeyPrefix(run.routineId)));
  const byKey = new Map<string, PersonAttentionItem[]>();
  for (const item of items) {
    const key = personItemKey(run.routineId, item);
    const same = byKey.get(key);
    if (!same) byKey.set(key, [item]);
    else if (!same.some((one) => personItemPlainText(one.text) === personItemPlainText(item.text))) same.push(item);
  }
  const listed = new Set<string>();
  const title = (run.routineName ?? "").trim().slice(0, ASK_CHOICE_LIMITS.title).trim();
  for (const [key, group] of byKey) {
    listed.add(key);
    // the same items in another order are the same card
    group.sort((a, b) => personItemPlainText(a.text).localeCompare(personItemPlainText(b.text)));
    const question = personItemQuestion(group);
    const choices = [...PERSON_ITEM_CHOICES[textLanguage(group.map((item) => item.text).join("\n")) ?? language ?? "en"]];
    const pending = deps.pending(key);
    // the person answered it: the answer stands while the runs list it
    if (!pending && answered.has(key)) {
      out.kept.push(key);
      continue;
    }
    if (pending && pending.question === question && pending.options.join("\n") === choices.join("\n")) {
      out.kept.push(key);
      continue;
    }
    const took = deps.ask({ tool: ASK_CHOICE_TOOL, key, wait: false, ...(title ? { title } : {}), question, options: choices });
    if (!took) {
      listed.delete(key);
      out.left.push(...group);
      continue;
    }
    (pending ? out.replaced : out.raised).push(key);
  }
  if (options.retire === false) return out;
  for (const key of deps.pendingKeys(personItemKeyPrefix(run.routineId))) {
    if (listed.has(key)) continue;
    if (deps.ask({ tool: ASK_CHOICE_TOOL, key, retire: true })) out.retired.push(key);
  }
  for (const key of answered) {
    if (listed.has(key)) continue;
    deps.release(key);
    out.released.push(key);
  }
  return out;
}
