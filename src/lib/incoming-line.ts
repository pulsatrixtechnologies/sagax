// #3581: every trace of work another bot or an AI client asked of this bot
// is ONE quiet names line, the same row as "Asked [faces]" in the other
// direction (BotNamesLine): "Asked by [face] Bot B", "Message from [face]
// Bot B", "Answer from [face] Bot B". Never the quoted request: the name
// opens the exchange (the request, then the answer). A run of them folds
// into one line, one name per party in the order they first asked, and a
// count when there are more requests than names ("5 requests").
//
// What it reads, rows stored before and after the change alike:
// - a hand-off this bot received (its "Sent to" receipt in this chat);
// - an answer whose receipt is not in the transcript (above the page);
// - a notice another bot's thread surfaced here ("Message from <bot>: #...");
// - a stored copy of a background reply (relayVia teammate or mcp): an AI
//   client's request, or a teammate's from before the copies stopped. A
//   failed, stopped or silent turn is said on the line's tail.
import type { Message } from "@/state/store";
import { AGENT_OPENER_PREFIX } from "../../shared/agent-conversation";
import { handoffReceiptIn, handoffResultId, handoffResultIn, handoffRequestId, isHandoff } from "./handoff-row";

export type IncomingVerb = "askedBy" | "messageFrom" | "answerFrom";
export type IncomingTrace = "failed" | "stopped" | "silent";

export interface IncomingEntry {
  verb: IncomingVerb;
  /** The party: a bot id, else `agent:<name>` for an AI client, else the name. */
  key: string;
  botId?: string;
  /** The stored name; an AI client without one is `undefined` (the app says "AI client"). */
  name?: string;
  color?: string;
  /** An AI client asked, not a bot. */
  agent?: boolean;
  /** The exchange's own thread, when it has one (a hand-off, a notice). */
  threadId?: string;
  /** What was asked, as stored. */
  request?: string;
  /** What this bot answered, as stored on a copy. */
  reply?: string;
  /** Why the request left no answer. */
  trace?: IncomingTrace;
  /** The row this entry reads. */
  message: Message;
}

export interface IncomingLineItem {
  kind: "incomingLine";
  id: string;
  verb: IncomingVerb;
  /** One per request, in the order they came. */
  entries: IncomingEntry[];
  /** Every stored row the line covers, hidden ones included (unread divider, dates, search). */
  messages: Message[];
}

const NOTICE = /^Message from /;
const TRACES = new Set<string>(["failed", "stopped", "silent"]);

/** The incoming trace a row stands for, or null for any other row. */
export function incomingEntry(message: Message, selfBotId: string, lookup: readonly Message[]): IncomingEntry | null {
  if (isHandoff(message)) {
    const ref = message.threadRef!;
    const tool = message.tool!;
    const answers = handoffResultId(message);
    if (answers) {
      // drawn in its receipt's "Asked" line when the receipt is here
      if (handoffReceiptIn(lookup, answers)) return null;
      return {
        verb: "answerFrom",
        key: ref.botId,
        botId: ref.botId,
        name: ref.title || undefined,
        threadId: ref.threadId,
        ...(tool.ok === false ? { trace: "stopped" as const } : tool.output?.trim() ? { reply: tool.output.trim() } : {}),
        message,
      };
    }
    // a hand-off this bot sent is the "Asked" line (lib/ask-line)
    if (ref.botId !== selfBotId) return null;
    const from = message.from;
    const result = handoffResultIn(lookup, handoffRequestId(message));
    return {
      verb: "askedBy",
      key: from?.botId ?? from?.name ?? ref.threadId,
      ...(from?.botId ? { botId: from.botId } : {}),
      ...(from?.name ? { name: from.name } : {}),
      ...(from?.color ? { color: from.color } : {}),
      threadId: ref.threadId,
      ...(tool.input?.trim() ? { request: tool.input.trim() } : {}),
      ...(result?.tool?.ok === false ? { trace: "stopped" as const } : {}),
      message,
    };
  }
  if (message.kind === "activity" && message.threadRef && message.from && NOTICE.test(message.tool?.name ?? "")) {
    const from = message.from;
    return {
      verb: "messageFrom",
      key: from.botId ?? from.name,
      ...(from.botId ? { botId: from.botId } : {}),
      name: from.name,
      ...(from.color ? { color: from.color } : {}),
      threadId: message.threadRef.threadId,
      ...(message.threadRef.title ? { request: message.threadRef.title } : {}),
      // the notice of a thread that did not complete keeps saying so on the tail
      ...(message.tool?.ok === false ? { trace: message.tool.name.endsWith(" (failed)") ? "failed" as const : "stopped" as const } : {}),
      message,
    };
  }
  if (message.role === "bot" && message.kind === "text") {
    const asked = relayAskEntry(message);
    if (!asked) return null;
    const trace = message.relayTrace && TRACES.has(message.relayTrace) ? message.relayTrace : undefined;
    return { ...asked, ...(trace ? { trace } : message.text?.trim() ? { reply: message.text.trim() } : {}) };
  }
  return null;
}

/** The request a row relayed from a teammate or an AI client stands for
 * (who asked, what), whatever the row is: a stored copy of the reply, or a
 * waiting card that came from such a request. Null for any other row. */
export function relayAskEntry(message: Message): IncomingEntry | null {
  if (message.relayVia !== "teammate" && message.relayVia !== "mcp") return null;
  const ask = message.relayAsk;
  const agent = message.relayVia === "mcp";
  const name = ask?.by?.trim() || undefined;
  return {
    verb: "askedBy",
    key: agent ? `${AGENT_OPENER_PREFIX}${name ?? ""}` : ask?.botId ?? name ?? "",
    ...(!agent && ask?.botId ? { botId: ask.botId } : {}),
    ...(name ? { name } : {}),
    ...(agent ? { agent: true } : {}),
    ...(ask?.text?.trim() ? { request: ask.text.trim() } : {}),
    message,
  };
}

/** A teammate's copy right under the receipt of the very request it answers
 * is that request's answer, not a second request. */
function answersReceipt(entry: IncomingEntry, previous: IncomingEntry | undefined): boolean {
  return Boolean(previous && previous.threadId && previous.reply === undefined && !previous.trace
    && previous.verb === "askedBy" && entry.verb === "askedBy" && !entry.agent && !entry.threadId
    && previous.key === entry.key);
}

type AnyItem = { kind: string; message?: Message; messages?: readonly Message[] };

function rowsOf(item: AnyItem): Message[] {
  if (item.message) return [item.message];
  return item.messages ? [...item.messages] : [];
}

/** Fold every run of consecutive incoming traces of one verb into one line.
 * `silent` rows (hidden tool steps) sit inside a run without breaking it. */
export function collapseIncomingLines<T extends AnyItem>(
  items: readonly T[],
  options: {
    selfBotId: string;
    lookup: readonly Message[];
    silent: (item: T) => boolean;
    /** Threads on: only stored copies fold; a hand-off and a notice keep their thread links. */
    copiesOnly?: boolean;
  },
): Array<T | IncomingLineItem> {
  const { selfBotId, lookup, silent, copiesOnly = false } = options;
  const entryOf = (item: T) => {
    if (item.kind !== "message" || !item.message) return null;
    const entry = incomingEntry(item.message, selfBotId, lookup);
    return entry && copiesOnly && entry.threadId ? null : entry;
  };
  // an answer drawn in its receipt's line draws nothing of its own
  const joinedAnswer = (item: T) => {
    if (item.kind !== "message" || !item.message) return false;
    const id = handoffResultId(item.message);
    return Boolean(id && item.message.threadRef && handoffReceiptIn(lookup, id));
  };
  const out: Array<T | IncomingLineItem> = [];
  let index = 0;
  while (index < items.length) {
    const first = entryOf(items[index]!);
    if (!first) {
      out.push(items[index]!);
      index += 1;
      continue;
    }
    const entries: IncomingEntry[] = [first];
    let last = index;
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      const entry = entryOf(candidate);
      if (entry && entry.verb === first.verb) {
        const previous = entries.at(-1);
        if (answersReceipt(entry, previous)) entries[entries.length - 1] = { ...previous!, reply: entry.reply, ...(entry.trace ? { trace: entry.trace } : {}) };
        else entries.push(entry);
        last = cursor;
        cursor += 1;
        continue;
      }
      if (!entry && (silent(candidate) || joinedAnswer(candidate))) {
        cursor += 1;
        continue;
      }
      break;
    }
    const messages = items.slice(index, last + 1).flatMap(rowsOf);
    out.push({ kind: "incomingLine", id: `incoming:${messages[0]!.id}`, verb: first.verb, entries, messages });
    index = last + 1;
  }
  return out;
}

export interface IncomingParty {
  key: string;
  botId?: string;
  name?: string;
  color?: string;
  agent?: boolean;
  /** This party's requests on the line, newest first. */
  entries: IncomingEntry[];
}

/** One name per party, in the order they first asked. */
export function incomingParties(entries: readonly IncomingEntry[]): IncomingParty[] {
  const parties: IncomingParty[] = [];
  for (const entry of entries) {
    const known = parties.find((party) => party.key === entry.key);
    if (known) {
      known.entries.unshift(entry);
      known.name ??= entry.name;
      known.color ??= entry.color;
      continue;
    }
    parties.push({
      key: entry.key,
      ...(entry.botId ? { botId: entry.botId } : {}),
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.color ? { color: entry.color } : {}),
      ...(entry.agent ? { agent: true } : {}),
      entries: [entry],
    });
  }
  return parties;
}

/** What the line says after the names: how many requests when there are
 * more than names, else why a lone request left no answer. */
export function incomingTail(entries: readonly IncomingEntry[], parties: number): { count: number } | { trace: IncomingTrace } | null {
  if (entries.length > parties) return { count: entries.length };
  const trace = entries.length === 1 ? entries[0]!.trace : undefined;
  return trace ? { trace } : null;
}
