// #4238: a bot turn the person did not start ends with a declared outcome
// for the person (shared/peer-outcome.ts).
//
// Here: a turn in a thread another bot opened (a teammate's request, a
// hand-off). Its exchange stays between the two bots (#3503); what it
// concluded for the person does not. A routine run and a wake report through
// their run card (syncRoutineRunToSource), an AI client reads its own
// conversation: neither is settled here.
//
// At the end of such a turn:
// - the items the bot raised during it (an ask_choice with a key, which the
//   server draws in the person's own conversation with the bot, and a tell)
//   are its outcome;
// - when it raised none, and its own words say something waits on the
//   person or was skipped for lack of them, the server asks it once, in
//   the same thread, to raise them; when the next turn still raises none,
//   the server raises them itself from those words through the one item
//   card path (server/turns/person-item-cards.ts, the peer scope): one keyed
//   card each, worded as a question to the person, Done / Not for me; the
//   same item later replaces its card, and an item the person already
//   answered is never raised again while the words keep naming it;
// - the outcome is written on the request's "Asked by" receipt (the line
//   opens what each request concluded) and on the bot's last row of the
//   exchange (the start-up back-fill reads it);
// - the items tagged for the person ([HUMAN]) that the person-attention
//   relay carried (keyed cards under the peer scope, and what no card could
//   carry on its attention card) are this outcome's items, recorded here
//   once, never raised a second time;
// - one synthesized line in the person's conversation names the teammate
//   and what needs them, never the bot-to-bot text. It rings nothing: each
//   card rings as a question does, once (an attention card already says its
//   items: no line then). A turn with nothing for the person writes nothing
//   and rings nothing. A person who set these cards to never gets none.

import { textLanguage } from "../../shared/looks-french.ts";
import { personAttentionText, ticketOf, type PersonAttentionCard, type PersonAttentionItem, PERSON_ATTENTION_MAX_ITEMS } from "../../shared/person-attention.ts";
import {
  peerItemQuestion,
  peerOutcomeKind,
  peerOutcomeLineText,
  peerOutcomeNudge,
  personWaitCues,
  saysNothingForPerson,
  type PeerOutcome,
  type PeerOutcomeItem,
  type PersonWaitCue,
} from "../../shared/peer-outcome.ts";
import { PEER_ITEM_SCOPE, personItemKey, type PersonItemCardsOutcome } from "./person-item-cards.ts";
import { ownTurnWords, RELAY_RECENT_ROWS, type AttentionBot, type AttentionRelayDeps, type AttentionTurn, type PeerCarried } from "./person-attention-relay.ts";

/** Items the bot raised during its turns in an exchange, until the turn's
 * end takes them. In memory: a turn lives in one process. */
export class PeerOutcomeLedger {
  private readonly byThread = new Map<string, PeerOutcomeItem[]>();

  record(threadId: string, item: PeerOutcomeItem): void {
    const items = (this.byThread.get(threadId) ?? []).filter((entry) => entry.key !== item.key);
    items.push(item);
    this.byThread.set(threadId, items);
  }

  take(threadId: string): PeerOutcomeItem[] {
    const items = this.byThread.get(threadId) ?? [];
    this.byThread.delete(threadId);
    return items;
  }
}

export interface PeerOutcomeDeps<B extends AttentionBot> extends Pick<AttentionRelayDeps<B>,
  "task" | "messages" | "append" | "patch" | "markUnread" | "conversation" | "agentConversation" | "routineRun" | "relayVia" | "recent" | "notify" | "feedback" | "now"> {
  /** What the bot raised during its turns in `threadId` (taken: cleared). */
  takeRecorded(threadId: string): PeerOutcomeItem[];
  /** The person's language in their conversation `target` with the bot. */
  language(bot: B, target: string): "fr" | "en";
  /** The item cards of the peer scope in the person's conversation `target`
   * (server/turns/person-item-cards.ts syncPersonItemCards, retire false:
   * an exchange is not a run that lists them all). `quiet`: the cards are
   * raised without ringing (the start-up back-fill rings its one line). */
  itemCards(bot: B, target: string, items: readonly PersonAttentionItem[], language: "fr" | "en", options?: { quiet?: boolean }): PersonItemCardsOutcome;
  /** The state of the peer item `key` in the bot's conversations with the
   * person of `target`: a card still pending, or one the person answered or
   * put away. Null: none. */
  itemState(bot: B, target: string, key: string): "pending" | "answered" | null;
  /** Start one control-plane turn of the bot in `threadId` with `prompt`. */
  nudge(bot: B, threadId: string, prompt: string): boolean;
  /** The exchanges the server asked once, with the words that made it ask. */
  nudges: Map<string, { words: string; at: number }>;
  log?(line: string): void;
}

export type PeerOutcomeResult =
  | { settled: "nudged" }
  | { settled: PeerOutcome["kind"]; outcome: PeerOutcome; line: boolean }
  | { settled: "none"; reason: "failed" | "no-task" | "confidential" | "agent" | "not-peer" | "run-reports" | "no-conversation" | "own-conversation" | "muted" };

/** The teammate that opened the exchange, when another bot did. */
function openerOf(task: { openedBy?: { botId?: string; name?: unknown } } | undefined, botId: string): PeerOutcome["from"] {
  const opener = task?.openedBy;
  return opener?.botId && opener.botId !== botId && typeof opener.name === "string" && opener.name.trim()
    ? { botId: opener.botId, name: opener.name.trim() } : undefined;
}

/** One item the server raises from a line of the bot's words: a question
 * to the person, the line as its context, keyed by its ticket or its words
 * (person-item-cards.ts, the peer scope). */
export interface PeerFallbackItem {
  item: PersonAttentionItem;
  cue: PersonWaitCue;
  key: string;
}

/** The items the server raises from the bot's words when the bot raised
 * none: one per line that says something waits on the person. */
export function fallbackItems(cues: readonly PersonWaitCue[], botName: string, personLanguage: "fr" | "en"): PeerFallbackItem[] {
  const out: PeerFallbackItem[] = [];
  const seen = new Set<string>();
  for (const cue of cues) {
    const language = textLanguage(cue.line) ?? personLanguage;
    const ticketId = ticketOf(cue.line);
    const item: PersonAttentionItem = { text: peerItemQuestion(cue, botName, language), ...(ticketId ? { ticketId } : {}) };
    const key = personItemKey(PEER_ITEM_SCOPE, item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ item, cue, key });
    if (out.length >= PERSON_ATTENTION_MAX_ITEMS) break;
  }
  return out;
}

/** Raise `fallback` through the item card path; the items no card could
 * carry go on one attention card (as for a routine's items). */
function raiseFallback<B extends AttentionBot>(
  bot: B,
  target: string,
  fallback: readonly PeerFallbackItem[],
  language: "fr" | "en",
  deps: Pick<PeerOutcomeDeps<B>, "itemCards" | "append" | "itemState">,
  source: { threadId: string; title?: string; from?: PeerOutcome["from"]; messageId: string },
  options: { quiet?: boolean } = {},
): PeerOutcomeItem[] {
  if (!fallback.length) return [];
  const result = deps.itemCards(bot, target, fallback.map((one) => one.item), language, options.quiet ? { quiet: true } : undefined);
  const kindOf = (key: string): PeerOutcomeItem["kind"] => fallback.find((one) => one.key === key)?.cue.kind === "access" ? "fix" : "ask";
  const textOf = (key: string) => fallback.filter((one) => one.key === key).map((one) => one.item.text).join("\n");
  const items: PeerOutcomeItem[] = [
    ...result.raised.map((key) => ({ key, kind: kindOf(key), text: textOf(key) })),
    ...result.replaced.map((key) => ({ key, kind: kindOf(key), text: textOf(key), replaced: true as const })),
    // already there: a card still pending, or one the person answered
    ...result.kept.map((key) => ({ key, kind: kindOf(key), text: textOf(key), replaced: true as const, ...(deps.itemState(bot, target, key) === "answered" ? { answered: true as const } : {}) })),
  ];
  if (result.left.length) {
    const card: PersonAttentionCard = {
      kind: "human", items: result.left, botId: bot.id, botName: bot.name, threadId: source.threadId,
      ...(source.title ? { threadTitle: source.title } : {}),
      sourceMessageId: `peer-outcome:${source.messageId}`,
      ...(source.from ? { openedBy: source.from } : {}),
    };
    const row = deps.append(target, {
      role: "bot", kind: "text", text: personAttentionText(card), attention: card,
      threadRef: { botId: bot.id, threadId: source.threadId, title: source.title ?? "" },
    });
    for (const left of result.left) {
      const key = personItemKey(PEER_ITEM_SCOPE, left);
      items.push({ key, kind: kindOf(key), text: left.text, ...(row && typeof row === "object" ? { messageId: row.id } : {}) });
    }
  }
  return items;
}

/** The kind of an item tagged for the person: a refusal for a missing
 * permission or sign-in is one to fix. */
function taggedKind(text: string): PeerOutcomeItem["kind"] {
  return personWaitCues(text)[0]?.kind === "access" ? "fix" : "ask";
}

/** What the person-attention relay carried of this turn, as outcome items:
 * its keyed cards (a card already there is nothing new; one the person
 * answered says so) and the items left on its attention card. */
function carriedItems<B extends AttentionBot>(bot: B, target: string, carried: PeerCarried, deps: Pick<PeerOutcomeDeps<B>, "itemState">): PeerOutcomeItem[] {
  const items: PeerOutcomeItem[] = carried.keyed.map((one) => ({
    key: one.key, kind: taggedKind(one.text), text: one.text,
    ...(one.state === "raised" ? {} : { replaced: true as const }),
    ...(one.state === "kept" && deps.itemState(bot, target, one.key) === "answered" ? { answered: true as const } : {}),
  }));
  for (const item of carried.card?.items ?? []) {
    items.push({ key: personItemKey(PEER_ITEM_SCOPE, item), kind: taggedKind(item.text), text: item.text, onCard: true, ...(carried.card?.messageId ? { messageId: carried.card.messageId } : {}) });
  }
  return items;
}

/** Settle one finished turn. `carried`: what the person-attention relay
 * already carried of this turn to the person (its cards are this outcome's
 * items, recorded here once: no second card, no second record). `muted`:
 * the person set these cards to never: nothing is raised. */
export function settlePeerOutcome<B extends AttentionBot>(
  input: AttentionTurn<B> & { carried?: PeerCarried; muted?: boolean },
  deps: PeerOutcomeDeps<B>,
): PeerOutcomeResult {
  const { bot, threadId } = input;
  if (!input.ok || input.stopped || bot.hidden) {
    deps.takeRecorded(threadId);
    return { settled: "none", reason: "failed" };
  }
  const task = deps.task(bot.id, threadId);
  if (!task) return { settled: "none", reason: "no-task" };
  if (task.confidential === true) return { settled: "none", reason: "confidential" };
  if (deps.agentConversation(bot.id, threadId)) return { settled: "none", reason: "agent" };
  if (deps.relayVia?.(bot.id, threadId) !== "teammate") return { settled: "none", reason: "not-peer" };
  if (input.runTurn || deps.routineRun(threadId)) return { settled: "none", reason: "run-reports" };
  const target = deps.conversation(bot, threadId);
  if (!target) return { settled: "none", reason: "no-conversation" };
  if (target === threadId) return { settled: "none", reason: "own-conversation" };
  // #2694: the person set these cards to never: the server raises none,
  // asks the bot nothing, and writes no outcome it did not deliver
  if (input.muted || deps.feedback?.(bot.id, "attention") === "muted") {
    deps.takeRecorded(threadId);
    deps.nudges.delete(threadId);
    return { settled: "none", reason: "muted" };
  }
  const now = deps.now?.() ?? Date.now();
  const words = ownTurnWords(deps.messages(threadId), input.turnId);
  const items = deps.takeRecorded(threadId);
  if (input.carried) {
    const known = new Set(items.map((item) => item.key));
    items.push(...carriedItems(bot, target, input.carried, deps).filter((item) => !known.has(item.key)));
  }
  const asked = deps.nudges.get(threadId);
  deps.nudges.delete(threadId);
  const language = deps.language(bot, target);
  const from = openerOf(task as { openedBy?: { botId?: string; name?: unknown } }, bot.id);
  let fallback = false;
  if (!items.length && !input.carried) {
    const cues = personWaitCues(words.text);
    // the same items as an earlier sweep, each still pending or already
    // answered by the person: nothing new, the bot is not asked again
    const known = cues.length > 0 && !asked
      && fallbackItems(cues, bot.name, language).every((one) => deps.itemState(bot, target, one.key) !== null);
    if (cues.length && !asked && !known) {
      deps.nudges.set(threadId, { words: words.text, at: now });
      if (deps.nudge(bot, threadId, peerOutcomeNudge(cues))) {
        deps.log?.(`[peer-outcome] thread=${threadId.slice(0, 8)} bot=${bot.id.slice(0, 8)} asked once to raise ${cues.length} item(s)`);
        return { settled: "nudged" };
      }
      deps.nudges.delete(threadId);
    }
    // asked once and still nothing raised, without saying plainly that
    // nothing waits on the person: the server raises the items of the words
    // that made it ask (and of this turn's), itself
    const source = asked ? (saysNothingForPerson(words.text) ? "" : `${asked.words}\n${words.text}`) : cues.length ? words.text : "";
    const raised = raiseFallback(bot, target, fallbackItems(personWaitCues(source), bot.name, language), language, deps, {
      threadId, messageId: words.last?.id ?? threadId, ...(task.title ? { title: task.title } : {}), ...(from ? { from } : {}),
    });
    if (raised.length) fallback = true;
    items.push(...raised);
  }
  const outcome: PeerOutcome = {
    kind: peerOutcomeKind(items),
    items,
    threadId,
    ...(from ? { from } : {}),
    ...(fallback ? { fallback: true as const } : {}),
    at: now,
  };
  // the request's "Asked by" receipt in the person's conversation
  const recent = deps.recent?.(target, RELAY_RECENT_ROWS * 4) ?? deps.messages(target);
  const receipt = recent.findLast((message) => message.threadRef?.threadId === threadId && message.tool && !message.peerOutcome?.line);
  if (receipt) deps.patch(target, receipt.id, { peerOutcome: outcome });
  // the exchange's own last row: settled (the back-fill skips it)
  if (words.last) deps.patch(threadId, words.last.id, { peerOutcome: outcome });
  // the attention card already says its items and rings: no second line
  const fresh = items.filter((item) => !item.replaced);
  if (!fresh.length || input.carried?.card) {
    deps.log?.(`[peer-outcome] thread=${threadId.slice(0, 8)} bot=${bot.id.slice(0, 8)} outcome=${outcome.kind} items=${items.length} new=0`);
    return { settled: outcome.kind, outcome, line: false };
  }
  const line: PeerOutcome = { ...outcome, items: fresh, line: true };
  deps.append(target, {
    role: "bot", kind: "text", text: peerOutcomeLineText(line, bot.name, language), peerOutcome: line,
    threadRef: { botId: bot.id, threadId, title: task.title ?? "" },
  });
  // the conversation shows it unread when something needs the person; the
  // cards ring as questions do, so the line rings nothing more
  if (fresh.some((item) => item.kind !== "tell")) deps.markUnread(bot.id, target);
  deps.log?.(`[peer-outcome] thread=${threadId.slice(0, 8)} bot=${bot.id.slice(0, 8)} outcome=${outcome.kind} items=${items.length} new=${fresh.length}${fallback ? " raised-by-server" : ""}`);
  return { settled: outcome.kind, outcome, line: true };
}

/** One exchange the back-fill reads: a thread another bot opened. */
export interface BackfillThread<B extends AttentionBot> {
  bot: B;
  threadId: string;
}

/** #4238 back-fill: at start, the last days' exchanges that ended with
 * something waiting on the person and nothing for them (no outcome on their
 * last row, no card) are surfaced once. It runs without asking the bot, so
 * it reads the words strictly (a refusal for a missing permission, or a
 * line that names the person as the one something waits on: a bare
 * "skipped" or "to confirm" is not enough). Grouped per bot: the items go
 * through the one item card path (keyed, an answered one never again), and
 * one synthesized line per bot names them, never one per exchange; the
 * cards are raised quiet and that line alone rings, once per bot. Each
 * source row is then marked, so a second start adds nothing. */
export function backfillPeerOutcomes<B extends AttentionBot>(
  threads: Iterable<BackfillThread<B>>,
  deps: Pick<PeerOutcomeDeps<B>, "task" | "messages" | "append" | "patch" | "markUnread" | "notify" | "feedback" | "conversation" | "agentConversation" | "routineRun" | "relayVia" | "now" | "language" | "itemCards" | "itemState">,
): number {
  const now = deps.now?.() ?? Date.now();
  const byBot = new Map<string, { bot: B; target: string; language: "fr" | "en"; items: PeerFallbackItem[]; sources: Array<{ threadId: string; messageId: string; title?: string; from?: PeerOutcome["from"] }> }>();
  for (const { bot, threadId } of threads) {
    if (bot.hidden || deps.feedback?.(bot.id, "attention") === "muted") continue;
    const task = deps.task(bot.id, threadId);
    if (!task || task.confidential === true || deps.agentConversation(bot.id, threadId)) continue;
    if (deps.relayVia?.(bot.id, threadId) !== "teammate" || deps.routineRun(threadId)) continue;
    const messages = deps.messages(threadId);
    const last = messages.findLast((message) => message.role === "bot" && message.kind === "text" && !message.from && typeof message.text === "string");
    if (!last || last.peerOutcome) continue;
    // a card still open in the exchange, or an attention card from it: told
    if (messages.some((message) => message.at > last.at && message.kind === "options")) continue;
    const words = ownTurnWords(messages, last.turnId);
    const cues = personWaitCues(words.text, { strict: true });
    if (!cues.length) continue;
    const target = deps.conversation(bot, threadId);
    if (!target || target === threadId) continue;
    if (deps.messages(target).some((message) => message.attention?.sourceMessageId === last.id || message.peerOutcome?.threadId === threadId)) continue;
    const group = byBot.get(bot.id) ?? { bot, target, language: deps.language(bot, target), items: [], sources: [] };
    for (const one of fallbackItems(cues, bot.name, group.language)) {
      if (group.items.length >= PERSON_ATTENTION_MAX_ITEMS) break;
      if (!group.items.some((known) => known.key === one.key)) group.items.push(one);
    }
    const from = openerOf(task as { openedBy?: { botId?: string; name?: unknown } }, bot.id);
    group.sources.push({ threadId, messageId: last.id, ...(task.title ? { title: task.title } : {}), ...(from ? { from } : {}) });
    byBot.set(bot.id, group);
  }
  let lines = 0;
  for (const group of byBot.values()) {
    const newest = group.sources.at(-1)!;
    // the cards are raised quiet: the one line per bot rings, once
    const items = raiseFallback(group.bot, group.target, group.items, group.language, deps, newest, { quiet: true });
    for (const source of group.sources) {
      const outcome: PeerOutcome = { kind: peerOutcomeKind(items), items, threadId: source.threadId, ...(source.from ? { from: source.from } : {}), backfill: true, fallback: true, at: now };
      deps.patch(source.threadId, source.messageId, { peerOutcome: outcome });
    }
    const fresh = items.filter((item) => !item.replaced);
    if (!fresh.length) continue;
    // one line per bot, and it alone rings (its cards were raised quiet)
    const line: PeerOutcome = { kind: "asked", items: fresh, threadId: newest.threadId, backfill: true, fallback: true, line: true, at: now };
    const text = peerOutcomeLineText(line, group.bot.name, group.language);
    deps.append(group.target, {
      role: "bot", kind: "text", text, peerOutcome: line,
      threadRef: { botId: group.bot.id, threadId: newest.threadId, title: newest.title ?? "" },
    });
    deps.markUnread(group.bot.id, group.target);
    if (fresh.some((item) => item.kind !== "tell")) deps.notify(group.bot, group.target, group.bot.name, text, { threadId: newest.threadId, messageId: newest.messageId });
    lines += 1;
  }
  return lines;
}
