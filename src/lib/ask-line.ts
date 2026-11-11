// A turn that hands work to teammates leaves one "Sent to <teammate>"
// receipt per teammate, and later each teammate's answer (lib/handoff-row).
// The unified chat draws a run of them as ONE quiet centered line, the
// Messaged line's (#3270): "Asking [face] A, [face] B and [face] C" while any
// teammate works, "Asked ..." once all are in, a request stopped or never
// sent said on the same line (#3289). Each name opens that teammate's
// exchange (the brief and its answer) in this column: nothing is lost.
import type { Message } from "@/state/store";
import { handoffPhase, handoffReceiptIn, handoffRequestId, handoffResultId, handoffResultIn, isHandoff } from "./handoff-row";

/** Where one ask stands. */
export type AskState = "running" | "done" | "stopped" | "couldNotAsk";

export interface AskEntry {
  key: string;
  botId: string;
  name: string;
  color?: string;
  /** The teammate's work thread: the exchange a click opens. */
  threadId: string;
  brief?: string;
  state: AskState;
  receipt: Message;
  result?: Message;
}

export interface AskLineItem {
  kind: "askLine";
  id: string;
  /** One per teammate, in the order they were asked. */
  asks: AskEntry[];
  /** Every stored row the line covers, hidden ones included (unread divider, dates, search). */
  messages: Message[];
}

/** The teammate's name on a receipt: the bot when known, else "Sent to <name>". */
function receiptName(message: Message, bots: readonly { id: string; name: string; color?: string }[]): { name: string; color?: string } {
  const ref = message.threadRef!;
  const bot = bots.find((candidate) => candidate.id === ref.botId);
  if (bot) return { name: bot.name, color: bot.color };
  const sent = /^Sent to (.+?)(?: · .+)?$/.exec(message.tool?.name ?? "")?.[1];
  return { name: sent || ref.title };
}

/** A hand-off this bot sent (not one it received, not an answer). */
export function askReceipt(message: Message, selfBotId: string): boolean {
  if (!isHandoff(message) || handoffResultId(message)) return false;
  return message.threadRef!.botId !== selfBotId;
}

/** Where an ask stands, from its receipt and the answer that came back. */
export function askState(receipt: Message, result: Message | undefined): AskState {
  if (receipt.tool?.ok === false) return "couldNotAsk";
  const phase = handoffPhase(receipt, result);
  if (phase === "running") return "running";
  return phase === "failed" ? "stopped" : "done";
}

/** One ask, as the line names it. */
export function askEntry(receipt: Message, lookup: readonly Message[], bots: readonly { id: string; name: string; color?: string }[]): AskEntry {
  const ref = receipt.threadRef!;
  const result = handoffResultIn(lookup, handoffRequestId(receipt));
  const { name, color } = receiptName(receipt, bots);
  return {
    key: handoffRequestId(receipt) ?? receipt.id,
    botId: ref.botId,
    name,
    ...(color ? { color } : {}),
    threadId: ref.threadId,
    ...(receipt.tool?.input?.trim() ? { brief: receipt.tool.input.trim() } : {}),
    state: askState(receipt, result),
    receipt,
    ...(result ? { result } : {}),
  };
}

/** The line's verb: still asking while any teammate works. */
export function askLineVerb(asks: readonly Pick<AskEntry, "state">[]): "asking" | "asked" {
  return asks.some((ask) => ask.state === "running") ? "asking" : "asked";
}

type AnyItem = { kind: string; message?: Message; messages?: readonly Message[] };

function rowsOf(item: AnyItem): Message[] {
  if (item.message) return [item.message];
  return item.messages ? [...item.messages] : [];
}

/** Fold every run of consecutive hand-off receipts into one line. An answer
 * whose receipt is in the transcript draws inside its receipt's line, so it
 * never breaks a run; `silent` rows (hidden tool steps) sit inside a run
 * without breaking it. */
export function collapseAskLines<T extends AnyItem>(
  items: readonly T[],
  options: { selfBotId: string; lookup: readonly Message[]; bots: readonly { id: string; name: string; color?: string }[]; silent: (item: T) => boolean },
): Array<T | AskLineItem> {
  const { selfBotId, lookup, bots, silent } = options;
  const receiptOf = (item: T) => (item.kind === "message" && item.message && askReceipt(item.message, selfBotId) ? item.message : null);
  // an answer drawn in its receipt's line: nothing of its own
  const joined = (item: T) => {
    if (item.kind !== "message" || !item.message) return false;
    const id = handoffResultId(item.message);
    return Boolean(id && item.message.threadRef && handoffReceiptIn(lookup, id));
  };
  const out: Array<T | AskLineItem> = [];
  let index = 0;
  while (index < items.length) {
    const first = items[index]!;
    if (!receiptOf(first)) {
      out.push(first);
      index += 1;
      continue;
    }
    let last = index;
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      if (receiptOf(candidate)) {
        last = cursor;
        cursor += 1;
        continue;
      }
      if (silent(candidate) || joined(candidate)) {
        cursor += 1;
        continue;
      }
      break;
    }
    const covered = items.slice(index, last + 1);
    const asks: AskEntry[] = [];
    for (const item of covered) {
      const receipt = receiptOf(item);
      if (!receipt) continue;
      const entry = askEntry(receipt, lookup, bots);
      const known = asks.findIndex((ask) => ask.key === entry.key);
      if (known >= 0) asks[known] = entry;
      else asks.push(entry);
    }
    const messages = covered.flatMap(rowsOf);
    out.push({ kind: "askLine", id: `ask:${messages[0]!.id}`, asks, messages });
    index = last + 1;
  }
  return out;
}
