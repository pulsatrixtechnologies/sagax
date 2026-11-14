// A result that needs the person always reaches the person (2026-11-05).
//
// Production, 2026-11-05 08:47 ET: a dispatcher bot's hourly pass ended in
// a work thread another bot had opened ("@<requester> · work") with two
// items marked [HUMAIN] for the person. That turn was a peer hop: internal,
// so it marked nothing unread and rang nothing (index.ts turn.completed:
// `!internal`), and notify() drops a bot-to-bot thread's own news
// (notificationIsInterBotChatter). The requester's resume read it in its
// own hidden task. The person's conversation with the dispatcher showed
// nothing, and no card, push or follow-up came.
//
// The rule: when a bot's turn ends in a thread that is not the person's own
// conversation with that bot (a hand-off, a thread another bot opened, a
// routine run's task the routine no longer reports from, a notice the bot
// received), and its words carry a structured signal that needs the person
// (shared/person-attention.ts), one card goes into the person's own
// conversation with that bot, the conversation turns unread and the person
// is notified (desktop and phone: the notify frame feeds the push hub).
// A routine run still active reports through its own card
// (syncRoutineRunToSource), which carries the same items.
//
// Also: a routine run's task whose run already ended (a teammate's result
// resumed the bot after the run closed) is read by nobody. The bot's answer
// there is mirrored into its conversation, linked to the run's task.

import { personAttention, personAttentionText, type PersonAttention, type PersonAttentionCard, type PersonAttentionItem, type RunStatusNote } from "../../shared/person-attention.ts";
import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { withoutRoutineMarkers, withRunMarkers } from "../../shared/routine-result.ts";
import { routineRowLogLine } from "../routines/routine-report.ts";
import { openedByOwnBot } from "./bot-to-bot.ts";
import { PEER_ITEM_SCOPE, personItemKey, type PersonItemCardsOutcome } from "./person-item-cards.ts";

export interface AttentionBot {
  id: string;
  name: string;
  avatarUrl?: string;
  hidden?: boolean;
}

export interface AttentionRelayDeps<B extends AttentionBot> {
  task(botId: string, threadId: string): Pick<WireTask, "threadId" | "title" | "confidential" | "openedBy" | "routineRunId" | "archivedAt"> | undefined;
  messages(threadId: string): readonly WireMessage[];
  append(threadId: string, message: Omit<WireMessage, "id" | "at">): WireMessage | undefined | null | void;
  /** Patch a row in place (a routine run's card takes the items). */
  patch(threadId: string, messageId: string, patch: Partial<WireMessage>): void;
  markUnread(botId: string, threadId: string): void;
  /** The person's own conversation with the bot (started when they have none). */
  conversation(bot: B, threadId: string): string | undefined;
  /** An AI client's conversation over MCP: the client reads it. */
  agentConversation(botId: string, threadId: string): boolean;
  /** The routine run this thread is the task of, active or not. */
  routineRun(threadId: string): { id: string; routineName: string; status: string } | null;
  /** A deep link to a ConnectWise ticket, when the site is known. */
  ticketUrl?(threadId: string, ticketId: number): string | undefined;
  /** #4250: `source` is the bot's message the ring is about, in the
   * conversation it was said in: the ring is keyed on it, and the person is
   * the one of that conversation. */
  notify(bot: B, threadId: string, title: string, body: string, source: { threadId: string; messageId: string }): void;
  /** #2694: the person's feedback on this kind of card ("attention", or the
   * run card's wake kind): "muted" posts nothing, "quiet" posts the card
   * without ringing or marking unread. Absent: "normal". */
  feedback?(botId: string, topic: string): "muted" | "quiet" | "normal";
  /** #3581, #4051: the row of the routine run whose task is `runThreadId`,
   * as the routine's card write builds it (routineRunCard and its fallback
   * text) for the conversation `target`, with `said` (the answer as the bot
   * wrote it, its run markers included) as its report, through the one row
   * gate (routineRunMayWriteRow) reading the same facts as that card write
   * (server/index-leaves/syncRoutineRunToSource.ts createRoutineRunLateRow).
   * Undefined: nothing reaches the chat. `rings`: the conversation turns
   * unread and the person is notified. */
  runRow?(runThreadId: string, target: string, said: string): (Pick<WireMessage, "text" | "routineRun"> & { rings: boolean }) | undefined;
  /** #3990: one log line per run row written or updated. */
  rowLog?(line: string): void;
  /** #2901: why this thread is out of the person's sight (MCP send_prompt,
   * routine, proactive wake, teammate work); undefined for their own,
   * confidential or parallel threads. */
  relayVia?(botId: string, threadId: string): WireMessage["relayVia"];
  /** #2915: the thread's newest rows (at most `limit`), oldest first: the
   * mirror's dedupe and burst read only these, never the whole chat. */
  recent?(threadId: string, limit: number): readonly WireMessage[];
  /** #3503: whether two bots belong to the same person. What a bot says in
   * a thread another bot of the same person opened stays between them. */
  sameOwner?(botId: string, otherBotId: string): boolean;
  /** #4233: the items only the person can do of a routine run or a wake,
   * each as its keyed card in the bot's conversations with the person
   * (person-item-cards.ts syncPersonItemCards). The items no card could
   * carry, which stay for the attention card; undefined when this run raises
   * no card (a later run of its routine already listed its own). The relay
   * passes retire false: a late answer is not a later run, so the cards of
   * the run's items it does not mention stay open. */
  itemCards?(runThreadId: string, target: string, items: readonly PersonAttentionItem[], options: { retire: boolean }): PersonAttentionItem[] | undefined;
  /** #4238: the items only the person can do of a teammate's exchange, each
   * as its keyed card under the peer scope in the person's conversation
   * `target` (the same item card path, retire false: an exchange is not a
   * run that lists them all). */
  peerItemCards?(bot: B, target: string, items: readonly PersonAttentionItem[]): PersonItemCardsOutcome;
  now?(): number;
}

/** #3503: a thread another bot of the same person opened (server/turns/bot-to-bot.ts). */
function betweenOwnBots<B extends AttentionBot>(deps: AttentionRelayDeps<B>, botId: string, threadId: string, task: Parameters<typeof openedByOwnBot>[0]): boolean {
  return deps.relayVia?.(botId, threadId) === "teammate" && openedByOwnBot(task, botId, deps.sameOwner);
}

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);

/** One finished turn. `runTurn`: the routine manager settled a run with
 * this very turn (its card reports it), so the run is not "ended" here. */
export interface AttentionTurn<B extends AttentionBot> {
  bot: B;
  threadId: string;
  turnId?: string;
  ok: boolean;
  stopped?: boolean;
  runTurn?: boolean;
}

/** The bot's words of one turn in this thread, and the last message of them. */
export function turnWords(messages: readonly WireMessage[], turnId: string | undefined): TurnWords {
  const own = messages.filter((message) => message.role === "bot" && message.kind === "text" && !message.from && !message.attention && typeof message.text === "string");
  const rows = turnId ? own.filter((message) => message.turnId === turnId) : own.slice(-1);
  const picked = rows.length ? rows : own.slice(-1);
  return wordsOf(picked);
}

/** A turn's words, its last row, the failed or partial status one of its
 * rows ended on (#3515: kept as data, the line is out of the text) and
 * whether its last row ended with the nothing-to-report line (#4051). */
export interface TurnWords { text: string; last?: WireMessage; runStatus?: RunStatusNote; runQuiet?: true }

function wordsOf(rows: readonly WireMessage[]): TurnWords {
  const runStatus = rows.findLast((message) => message.runStatus)?.runStatus;
  const last = rows.at(-1);
  return { text: rows.map((message) => message.text ?? "").join("\n\n"), last, ...(runStatus ? { runStatus } : {}), ...(last?.runQuiet ? { runQuiet: true as const } : {}) };
}

/** #2915: the bot's words of exactly this turn. Never an earlier turn's:
 * a turn that said nothing has no words (turnWords falls back to the last
 * line, which a mirror would copy a second time). Without a turn id, the
 * words after the last line written to the bot (what it was asked), never
 * an answer that came before that ask. */
export function ownTurnWords(messages: readonly WireMessage[], turnId: string | undefined): TurnWords {
  const own = (message: WireMessage) => message.role === "bot" && message.kind === "text" && !message.from && !message.attention && typeof message.text === "string";
  let rows: WireMessage[];
  if (turnId) rows = messages.filter((message) => own(message) && message.turnId === turnId);
  else {
    const asked = messages.findLastIndex((message) => message.role === "user" || (message.role === "bot" && Boolean(message.from)));
    rows = asked < 0 ? [] : messages.slice(asked + 1).filter(own);
  }
  return wordsOf(rows);
}

/** #2915: a card still waiting in this thread (a question the turn ended
 * on, an approval): the relay shows it in the bot's chat, so the turn did
 * not end "without a reply". */
export function openCardIn(messages: readonly WireMessage[]): boolean {
  return messages.some((message) => {
    const card = message.card as { requestId?: unknown; answered?: unknown; dismissed?: unknown; expired?: unknown } | undefined;
    return Boolean(card && card.requestId && !card.answered && !card.dismissed && !card.expired);
  });
}

/** #2915: the longest row a burst of mirrored replies folds into (a single
 * reply is copied whole, however long: nothing of it stays hidden), and the
 * window in which a burst folds. */
export const RELAY_TEXT_MAX = 4000;
export const RELAY_ASK_MAX = 280;
export const RELAY_GROUP_MS = 60_000;
/** How many of the chat's newest rows the mirror reads (dedupe, burst). */
export const RELAY_RECENT_ROWS = 50;

/** QA 0.8.77: the bracketed notes the server puts before a request the bot
 * wrote itself (a thread it opened, a parallel task, a hand-off to another
 * engine, a message sent while it works, a read-only task). They are for the
 * model: the person reads the request alone. */
const OWN_REQUEST_NOTE = /^\[(?:Thread you opened yourself|Parallel task you started yourself|Part of your own work you handed to yourself|Sent while you work|Read-only task:)[\s\S]*?\]\s*/;

export function askedWords(text: string): string {
  let words = text;
  for (let next = words.replace(OWN_REQUEST_NOTE, ""); next !== words; next = words.replace(OWN_REQUEST_NOTE, "")) words = next;
  return words;
}

/** #2915: what was asked of the bot for this turn: the last line written to
 * it before the turn's first answer (an AI client's send_prompt, a
 * teammate's ask), and who asked. */
export function turnAsk(messages: readonly WireMessage[], turnId: string | undefined, opener?: { name?: string; botId?: string }): WireMessage["relayAsk"] {
  const first = turnId ? messages.findIndex((message) => message.turnId === turnId) : -1;
  for (let index = (first >= 0 ? first : messages.length) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    // an earlier turn's answer: what came before it was asked of that turn
    if (message.role === "bot" && message.kind === "text" && !message.from && message.turnId && message.turnId !== turnId) return undefined;
    const asked = message.role === "user" || (message.role === "bot" && Boolean(message.from));
    const text = asked && typeof message.text === "string" ? askedWords(message.text).replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const by = (message.from?.name || message.sender?.name || opener?.name || "").trim();
    // #4201: a bot that asked is written by its id, so a client never names
    // it twice (once by id, once by name): the row's own id, else the id of
    // the bot that opened this thread when the asker is that bot by name
    const openerBot = opener?.botId && !opener.botId.startsWith("agent:") ? opener.botId : undefined;
    const sameAsOpener = Boolean(by && opener?.name && by.toLocaleLowerCase() === opener.name.trim().toLocaleLowerCase());
    const botId = message.from?.botId || (message.from || message.sender ? (sameAsOpener ? openerBot : undefined) : opener?.botId);
    return { text: text.length > RELAY_ASK_MAX ? `${text.slice(0, RELAY_ASK_MAX - 1).trimEnd()}…` : text, ...(by ? { by } : {}), ...(botId ? { botId } : {}) };
  }
  return undefined;
}

/** #4238: what the relay carried to the person from a teammate's exchange,
 * for the turn's outcome (server/turns/peer-outcome-relay.ts settles it,
 * the one place that does): the items of the peer item cards by key and
 * what became of each card, and the items left on the attention card. */
export interface PeerCarried {
  keyed: Array<{ key: string; text: string; state: "raised" | "replaced" | "kept" }>;
  card?: { messageId?: string; items: PersonAttentionItem[] };
}

/** What happened (for tests and the log): the card's thread, or why not. */
export type AttentionRelayOutcome =
  | { posted: true; threadId: string; card: PersonAttentionCard; onRunCard?: true; keyed?: true; peer?: PeerCarried }
  | { posted: false; reason: "failed" | "no-task" | "confidential" | "agent" | "no-signal" | "run-reports" | "own-conversation" | "no-conversation" | "already" | "muted" | "for-opener" };

export function relayPersonAttention<B extends AttentionBot>(
  input: AttentionTurn<B>,
  deps: AttentionRelayDeps<B>,
): AttentionRelayOutcome {
  const { bot, threadId } = input;
  if (!input.ok || input.stopped || bot.hidden) return { posted: false, reason: "failed" };
  const task = deps.task(bot.id, threadId);
  // #2915: an archived thread the owner (or a client) continues still
  // reaches the person: its turn ran, its words need them
  if (!task) return { posted: false, reason: "no-task" };
  if (task.confidential === true) return { posted: false, reason: "confidential" };
  if (deps.agentConversation(bot.id, threadId)) return { posted: false, reason: "agent" };
  const { text, last, runStatus } = turnWords(deps.messages(threadId), input.turnId);
  // #3515: a failed or partial status line is read from the row's runStatus
  const found = last ? personAttention(text, runStatus) : undefined;
  if (!found || !last) return { posted: false, reason: "no-signal" };
  // #3503: a question in a thread another bot of the same person opened is
  // for that bot: the runtime parks the work and wakes it with the question
  if (found.kind === "question" && betweenOwnBots(deps, bot.id, threadId, task)) return { posted: false, reason: "for-opener" };
  const run = deps.routineRun(threadId);
  // the routine's own card reports it (with these items)
  if (input.runTurn || (run && ACTIVE_RUN.has(run.status))) return { posted: false, reason: "run-reports" };
  const target = deps.conversation(bot, threadId);
  if (!target) return { posted: false, reason: "no-conversation" };
  if (target === threadId) return { posted: false, reason: "own-conversation" };
  const rows = deps.messages(target);
  if (rows.some((message) => message.attention?.sourceMessageId === last.id)) return { posted: false, reason: "already" };
  let card = attentionCard(bot, threadId, task, last.id, found, run, deps);
  // 2026-11-05 (review: the same items twice): a run whose card is already
  // in the person's chat gets the items on that card, never a second card.
  // It rings once: only when the card had none yet.
  const runCard = run ? rows.findLast((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id) : undefined;
  // #2694: the thumbs-down, "less" and "never" given on these cards
  const level = deps.feedback?.(bot.id, runCard?.routineRun?.wakeTopic ?? "attention") ?? "normal";
  if (level === "muted") return { posted: false, reason: "muted" };
  const ring = level === "normal";
  // #4233: a run's or a wake's items are keyed cards (one per item, the same
  // item of the next run replaces its card); only what no card could carry
  // stays on the attention card. A late answer only raises or replaces: it
  // retires nothing, since only the run's own end (syncRoutineRunToSource)
  // speaks for the whole list. A person who asked for these less keeps the
  // quiet attention card.
  if (found.kind === "human" && run && ring && deps.itemCards) {
    const left = deps.itemCards(threadId, target, card.items, { retire: false });
    if (left && !left.length) return { posted: true, threadId: target, card, keyed: true };
    if (left) card = { ...card, items: left };
  }
  // #4238: a teammate's exchange (no run): its items take the same keyed
  // path under the peer scope, so the same sweep later replaces or keeps
  // its cards instead of adding a second one
  const peer = !run && deps.relayVia?.(bot.id, threadId) === "teammate";
  const keyed: PeerCarried["keyed"] = [];
  if (peer && found.kind === "human" && ring && deps.peerItemCards) {
    const items = card.items;
    const result = deps.peerItemCards(bot, target, items);
    const textOf = (key: string) => items.filter((item) => personItemKey(PEER_ITEM_SCOPE, item) === key).map((item) => item.text).join("\n");
    for (const [state, keys] of [["raised", result.raised], ["replaced", result.replaced], ["kept", result.kept]] as const) {
      for (const key of keys) keyed.push({ key, text: textOf(key), state });
    }
    if (!result.left.length) return { posted: true, threadId: target, card, keyed: true, peer: { keyed } };
    card = { ...card, items: result.left };
  }
  const carried = (row: unknown): { peer?: PeerCarried } => peer
    ? { peer: { keyed, card: { items: card.items, ...(row && typeof row === "object" && typeof (row as WireMessage).id === "string" ? { messageId: (row as WireMessage).id } : {}) } } }
    : {};
  if (runCard) {
    if (runCard.attention) return { posted: false, reason: "already" };
    deps.patch(target, runCard.id, { attention: card });
    deps.rowLog?.(routineRowLogLine("attention", "patch", runCard.routineRun, true));
    if (!ring) return { posted: true, threadId: target, card, onRunCard: true };
    deps.markUnread(bot.id, target);
    deps.notify(bot, target, card.kind === "question" ? `${bot.name} has a question for you` : `${bot.name} needs you`,
      card.items.map((entry) => entry.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ")).join("\n"), { threadId, messageId: last.id });
    return { posted: true, threadId: target, card, onRunCard: true };
  }
  const row = deps.append(target, {
    role: "bot", kind: "text", text: personAttentionText(card), attention: card,
    threadRef: { botId: bot.id, threadId, title: task.title },
  });
  if (!ring) return { posted: true, threadId: target, card, ...carried(row) };
  deps.markUnread(bot.id, target);
  deps.notify(bot, target, card.kind === "question" ? `${bot.name} has a question for you` : `${bot.name} needs you`,
    card.items.map((entry) => entry.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ")).join("\n"), { threadId, messageId: last.id });
  return { posted: true, threadId: target, card, ...carried(row) };
}

export function attentionCard<B extends AttentionBot>(
  bot: B,
  threadId: string,
  task: { title?: string; openedBy?: WireTask["openedBy"] } | undefined,
  sourceMessageId: string,
  found: PersonAttention,
  run: { id: string; routineName: string } | null,
  deps: Pick<AttentionRelayDeps<B>, "ticketUrl">,
): PersonAttentionCard {
  const items = found.items.map((entry) => {
    const url = entry.ticketId ? deps.ticketUrl?.(threadId, entry.ticketId) : undefined;
    return url ? { ...entry, ticketUrl: url } : { ...entry };
  });
  const opener = task?.openedBy && task.openedBy.botId && task.openedBy.botId !== bot.id && typeof task.openedBy.name === "string"
    ? { botId: task.openedBy.botId, name: task.openedBy.name } : undefined;
  return {
    kind: found.kind, items, botId: bot.id, botName: bot.name, threadId,
    ...(task?.title ? { threadTitle: task.title } : {}),
    sourceMessageId,
    ...(opener ? { openedBy: opener } : {}),
    ...(run ? { routineRunId: run.id, routineName: run.routineName } : {}),
  };
}

/** A routine run's task the run no longer reports from: the bot's answer
 * there (a teammate's result resumed it after the run closed) is the run's
 * last word. #3581: one result, one card. It goes onto the run's own card
 * in the conversation (the card's report becomes this answer, patched in
 * place, no new row). #3990: whether the row may be written or updated is
 * the one row gate (routineRunMayWriteRow, through `runRow`): a
 * result the routine posts, a run the person started. A wake on a
 * teammate's message whose late answer has nothing for the person (the
 * nothing-to-report line or plain words) writes nothing, updates nothing,
 * marks nothing unread and rings nothing; the answer stays in the run's
 * task, listed in the routine's runs. False when nothing was written. */
export function mirrorLateRunReply<B extends AttentionBot>(
  input: AttentionTurn<B>,
  deps: AttentionRelayDeps<B>,
): boolean {
  const { bot, threadId } = input;
  if (!input.ok || input.stopped || bot.hidden || input.runTurn) return false;
  const run = deps.routineRun(threadId);
  if (!run || ACTIVE_RUN.has(run.status)) return false;
  const task = deps.task(bot.id, threadId);
  if (!task || task.confidential === true) return false;
  const { text, last, runStatus, runQuiet } = turnWords(deps.messages(threadId), input.turnId);
  // #3515: run markers are read by the one shared strip, as routine output
  const words = withoutRoutineMarkers(text).trim();
  if (!last || !words) return false;
  const target = deps.conversation(bot, threadId);
  if (!target || target === threadId) return false;
  const rows = deps.messages(target);
  if (rows.some((message) => message.attention?.sourceMessageId === last.id || message.lateRunReplyOf === last.id)) return false;
  const existing = rows.findLast((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id);
  // #3990, #4051: the one row gate, whether the run's row is there or not,
  // on the answer as the bot wrote it (the store kept its markers as data)
  const found = deps.runRow?.(threadId, target, withRunMarkers(text, { runStatus, runQuiet }));
  if (!found?.routineRun) return false;
  const { rings, ...card } = found;
  const row = { ...card, lateRunReplyOf: last.id, ...(runStatus ? { runStatus } : {}) };
  deps.rowLog?.(routineRowLogLine("late", existing ? "patch" : "append", card.routineRun, false));
  if (existing) deps.patch(target, existing.id, row);
  else deps.append(target, { role: "bot", kind: "routine.run", ...row });
  if (!rings) return true;
  deps.markUnread(bot.id, target);
  deps.notify(bot, target, `${bot.name}: ${run.routineName}`, words.slice(0, 300), { threadId, messageId: last.id });
  return true;
}

/** #2901 (2026-11-08, « rien d'invisible »): what a bot says in an AI
 * client's conversation (send_prompt over MCP) leaves one row in the bot's
 * chat with a discreet provenance label. Quiet: no ring, no unread; nothing
 * a bot does for the person is invisible in its chat. Routine runs report
 * through their own card. Confidential and parallel threads never leave
 * their thread.
 *
 * #3581: the rule (shared/chat-relevance.ts) says a trace for an AI client's
 * turn and for a bot's thread. An AI client's trace is this row, in the
 * shape the released apps draw (the newer apps draw it as one names line,
 * its content behind the name). A bot's trace is the receipt that already
 * exists (the "Asked by" line of a hand-off, the "Messaged" row of a thread
 * a bot opened), so a thread a bot opened, on itself or on another bot,
 * leaves no copy here: its content stays in its thread.
 *
 * #2915: an archived thread an AI client continues is mirrored too (its
 * label comes from relayVia). The label carries what was asked. A turn that
 * failed, was stopped or said nothing leaves one trace line, never an
 * earlier turn's words. A burst of short replies to one asker folds into one
 * row; a reply is never cut. Only
 * the chat's newest rows are read. */
export function mirrorBackgroundReply<B extends AttentionBot>(
  input: AttentionTurn<B>,
  deps: AttentionRelayDeps<B>,
): boolean {
  const { bot, threadId } = input;
  if (bot.hidden || input.runTurn || deps.routineRun(threadId)) return false;
  const via = deps.relayVia?.(bot.id, threadId);
  // #3581: only an AI client's turn writes its own trace (a bot's is its receipt)
  if (via !== "mcp") return false;
  const task = deps.task(bot.id, threadId);
  if (!task || task.confidential === true) return false;
  const source = deps.messages(threadId);
  const { text, last, runStatus } = input.ok && !input.stopped ? ownTurnWords(source, input.turnId) : { text: "", last: undefined, runStatus: undefined };
  const words = withoutRoutineMarkers(text).trim();
  const ask = turnAsk(source, input.turnId, task.openedBy);
  // a turn that ended on a waiting card (a question, an approval) said
  // nothing, but the card itself is relayed into the chat: no trace
  if (input.ok && !input.stopped && !words && openCardIn(source)) return false;
  const trace: WireMessage["relayTrace"] = !input.ok ? "failed" : input.stopped ? "stopped" : !words ? "silent" : undefined;
  // the dedupe key: the reply's own row, else this turn
  const key = !trace && last ? last.id : `turn:${threadId}:${input.turnId ?? source.at(-1)?.id ?? "none"}`;
  const target = deps.conversation(bot, threadId);
  if (!target || target === threadId) return false;
  const recent = deps.recent?.(target, RELAY_RECENT_ROWS) ?? deps.messages(target).slice(-RELAY_RECENT_ROWS);
  if (recent.some((message) => message.relayOf === key || message.relayGroup?.includes(key) || message.attention?.sourceMessageId === key)) return false;
  if (trace) {
    deps.append(target, { role: "bot", kind: "text", text: RELAY_TRACE_TEXT[trace], relayVia: via, relayOf: key, relayTrace: trace, ...(ask ? { relayAsk: ask } : {}) });
    return true;
  }
  const now = deps.now?.() ?? Date.now();
  const tail = recent.at(-1);
  // a burst folds only replies to the same asker: the row's label names who
  // asked, and each folded reply quotes its own ask
  const chunk = ask ? `> ${ask.text}\n\n${words}` : words;
  if (tail && tail.role === "bot" && tail.kind === "text" && tail.relayVia === via && !tail.relayTrace && tail.relayOf
    && (tail.relayAsk?.by ?? "") === (ask?.by ?? "")
    && now - tail.at < RELAY_GROUP_MS && (tail.text ?? "").length + chunk.length + 2 <= RELAY_TEXT_MAX) {
    deps.patch(target, tail.id, { text: `${tail.text ?? ""}\n\n${chunk}`, relayGroup: [...(tail.relayGroup ?? []), key], ...(runStatus ? { runStatus } : {}) });
    return true;
  }
  // #3515: the copy keeps the failed or partial status its source ended on
  deps.append(target, { role: "bot", kind: "text", text: words, relayVia: via, relayOf: key, ...(ask ? { relayAsk: ask } : {}), ...(runStatus ? { runStatus } : {}) });
  return true;
}

/** #2915: the plain text of a trace line (the app shows it localized). */
export const RELAY_TRACE_TEXT: Record<NonNullable<WireMessage["relayTrace"]>, string> = {
  failed: "This request did not finish (error).",
  stopped: "This request was stopped before an answer.",
  silent: "This request finished without a reply.",
};
