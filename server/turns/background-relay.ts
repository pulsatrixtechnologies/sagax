// #2901 / #2915 (2026-11-08, « rien d'invisible »): where a background
// thread's words and cards land in the bot's chat, and under which label.
//
// Pulled out of server/index.ts so the mapping is tested (#2915): an AI
// client's conversation over MCP is "mcp", a hand-off or a thread a bot
// opened is "teammate", a webhook or proactive run is "proactive", any other
// routine run is "routine". An archived thread keeps its label: an MCP
// client that continues a thread the sweep archived is still out of the
// person's sight, so its reply and its cards are still mirrored.
//
// A card's home is the chat of the person it concerns: who the card names,
// else the thread's own person (a member's MCP conversation on a shared bot
// is theirs, not the bot owner's), else who answers it. Nothing is started
// before the person is known to read the source, and never a conversation
// the relay would refuse (a confidential one, started for nothing on every
// patch of the card).

import { backgroundOrigin } from "../../shared/background-threads.ts";
import type { RelayVia, WireTask } from "../../shared/wire.ts";

export interface RelayBot {
  id: string;
  hidden?: boolean;
}

export type RelayTask = Pick<WireTask, "confidential" | "parallelOf" | "routineRunId" | "routineResults" | "hidden" | "openedBy" | "ownerPrincipalId"> & { askedAt?: unknown };

export interface BackgroundRelayDeps<B extends RelayBot> {
  /** A room's thread (never relayed from). */
  inRoom(threadId: string): boolean;
  task(botId: string, threadId: string): RelayTask | undefined;
  /** The routine run this thread is the task of, if any. */
  run(threadId: string): { proactive?: unknown; webhookId?: unknown } | null | undefined;
  privateThreads(): boolean;
  /** Organization setting: a conversation started now is confidential. */
  confidentialByDefault(): boolean;
  /** The thread's own person: its owner, the run's runAs, its opener. */
  threadPerson(bot: B, threadId: string): string | undefined;
  /** Who answers the card (cardAnswererId). */
  answerer(bot: B, threadId: string, card: { destinationAnswerer?: unknown } | null | undefined): string;
  readable(bot: B, threadId: string, person: string): boolean;
  /** The person's conversation with the bot, without starting one. */
  conversationFor(bot: B, person: string | undefined): string | undefined;
  /** The person's conversation, started when they have none. */
  conversationOrStart(bot: B, person: string | undefined): string | undefined;
}

/** Why a background thread is out of the person's sight. Undefined: one of
 * the person's own conversations, a confidential or parallel thread, or a
 * room. */
export function relayViaOf<B extends RelayBot>(deps: Pick<BackgroundRelayDeps<B>, "inRoom" | "task" | "run">, botId: string, threadId: string): RelayVia | undefined {
  if (deps.inRoom(threadId)) return undefined;
  const task = deps.task(botId, threadId);
  if (!task || task.confidential || task.parallelOf) return undefined;
  const origin = backgroundOrigin({ ...task, personWrote: task.askedAt !== undefined && task.openedBy?.kind !== "agent" ? true : undefined });
  if (!origin) return undefined;
  if (origin === "routine-run" || origin === "routine-results") {
    const run = deps.run(threadId);
    return run?.proactive || run?.webhookId ? "proactive" : "routine";
  }
  return origin === "ai-client" ? "mcp" : "teammate";
}

/** The people a background card may be shown to, most specific first: the
 * one it names, the thread's own person, then who answers it. Empty when
 * threads are not private (one chat for everyone). */
export function backgroundCardPeople<B extends RelayBot>(deps: BackgroundRelayDeps<B>, bot: B, threadId: string, card: { destinationAnswerer?: unknown } | null | undefined): string[] {
  if (!deps.privateThreads()) return [];
  const named = typeof card?.destinationAnswerer === "string" ? card.destinationAnswerer.trim().toLowerCase() : "";
  const people = [named, deps.threadPerson(bot, threadId)?.trim().toLowerCase() ?? "", deps.answerer(bot, threadId, card)?.trim().toLowerCase() ?? ""];
  return [...new Set(people.filter(Boolean))];
}

/** The bot's chat a background card is shown and answered in: the
 * conversation of the first person who reads the source. Undefined: not a
 * background thread, nobody may read it, or no conversation the relay
 * would accept. */
export function backgroundCardHome<B extends RelayBot>(deps: BackgroundRelayDeps<B>, bot: B | undefined, threadId: string, card: { destinationAnswerer?: unknown } | null | undefined): string | undefined {
  if (!bot || bot.hidden || !relayViaOf(deps, bot.id, threadId)) return undefined;
  if (!deps.privateThreads()) {
    const home = deps.conversationOrStart(bot, undefined);
    return home && home !== threadId ? home : undefined;
  }
  const person = backgroundCardPeople(deps, bot, threadId, card).find((candidate) => deps.readable(bot, threadId, candidate));
  if (!person) return undefined;
  const found = deps.conversationFor(bot, person);
  // a started conversation would be confidential: the relay refuses it, and
  // the next patch of the card would start yet another one
  const home = found ?? (deps.confidentialByDefault() ? undefined : deps.conversationOrStart(bot, person));
  return home && home !== threadId ? home : undefined;
}

/** 2026-11-09 (#3159: "Waiting for you…" with nothing to answer): a card left
 * open in one of the person's own older threads (an earlier topic of the one
 * conversation, an archived thread) is shown in their conversation, where the
 * chat opens, rather than only up the stream where nobody scrolls. Undefined:
 * a room, a background thread (backgroundCardHome), a confidential, parallel
 * or hidden thread, or a card already in the conversation. */
export function earlierThreadCardHome<B extends RelayBot>(deps: BackgroundRelayDeps<B>, bot: B | undefined, threadId: string, card: { destinationAnswerer?: unknown } | null | undefined): string | undefined {
  if (!bot || bot.hidden || deps.inRoom(threadId)) return undefined;
  const task = deps.task(bot.id, threadId);
  if (!task || task.confidential || task.parallelOf || task.hidden || relayViaOf(deps, bot.id, threadId)) return undefined;
  let person: string | undefined;
  if (deps.privateThreads()) {
    person = backgroundCardPeople(deps, bot, threadId, card).find((candidate) => deps.readable(bot, threadId, candidate));
    if (!person) return undefined;
  }
  const home = deps.conversationFor(bot, person);
  return home && home !== threadId ? home : undefined;
}

/** #2915: who answers a card raised in a person's own MCP conversation
 * (an AI client's send_prompt, private threads): that person. Their turn
 * runs as them, and the card is shown in their chat, so it is theirs to
 * answer (from the app or from their client's sagax_approve). Undefined
 * for any other thread: the bot owner answers as before. */
export function mcpThreadAnswerer<B extends RelayBot>(deps: Pick<BackgroundRelayDeps<B>, "inRoom" | "task" | "run" | "privateThreads">, botId: string, threadId: string | undefined): string | undefined {
  if (!threadId || !deps.privateThreads()) return undefined;
  const owner = deps.task(botId, threadId)?.ownerPrincipalId?.trim().toLowerCase();
  if (!owner || relayViaOf(deps, botId, threadId) !== "mcp") return undefined;
  return owner;
}

/** #2915: whether a background card may be copied into a destination: one
 * same person must both read the source and own the destination (never one
 * person for each). Who answers it is tried first (the common case, no
 * extra lookup); then, for a background thread, the other people of
 * backgroundCardPeople. A room's card stays with its answerer. */
export function backgroundRelayAllowed<B extends RelayBot>(
  deps: BackgroundRelayDeps<B>,
  bot: B,
  source: string,
  card: { destinationAnswerer?: unknown } | null | undefined,
  check: { readsSource(person: string): boolean; ownsDestination(person: string): boolean },
): boolean {
  const allowed = (person: string) => Boolean(person) && check.readsSource(person) && check.ownsDestination(person);
  const answerer = deps.answerer(bot, source, card)?.trim().toLowerCase() ?? "";
  if (allowed(answerer)) return true;
  if (deps.inRoom(source) || !relayViaOf(deps, bot.id, source)) return false;
  return backgroundCardPeople(deps, bot, source, card).some((person) => person !== answerer && allowed(person));
}
