// A turn that messages other bots leaves one "Messaged" chip per recipient
// (server/comms-visibility.ts). The chat draws a run of them as ONE centered
// quiet line, "Messaged [face] Osprey and [face] test" (#3270), shown with
// Tool calls hidden too: it is the only trace of the send where the person
// reads. A failed send keeps its own chip, so its failure still shows.
//
// #3581: a send_to_bot receipt ("Sent to <bot> · state · summary") joins the
// same line, one form for every trace between bots: the reply is behind the
// name, and the state is the line's tail only when the send failed or waits
// on the person.
import type { Message } from "@/state/store";
import type { SendState } from "../../shared/send-receipt";

type Comm = NonNullable<Message["comm"]>;

export interface MessagedRecipient {
  /** The recipient bot, else its name. */
  key: string;
  comm: Comm;
  /** The latest chip naming this recipient. */
  message: Message;
}

export interface MessagedLineItem {
  kind: "messagedLine";
  id: string;
  /** One per recipient, in the order they were first messaged. */
  recipients: MessagedRecipient[];
  /** Every stored row the line covers, hidden ones included (unread divider, dates, search). */
  messages: Message[];
}

/** The most names drawn before "and N others". */
export const MESSAGED_LINE_SHOWN = 3;

/** A bot-to-bot "Messaged" chip that went out: sent by this bot into a bot
 * pair channel. Received chips, room posts, a teammate's reply and a failed
 * send stay as they are. */
export function messagedChip(message: Message, botDmIds: ReadonlySet<string>): Comm | null {
  const receipt = message.sendReceipt;
  if (receipt && !message.comm) {
    const brief = message.tool?.input?.trim();
    return {
      groupId: "",
      threadId: receipt.threadId,
      withBotId: receipt.botId,
      withName: message.threadRef?.title || receipt.botId,
      withColor: "blue",
      direction: "sent",
      ...(message.threadRef?.gone ? { gone: true } : {}),
      ...(brief ? { text: brief } : {}),
    };
  }
  const comm = message.comm;
  if (!comm || message.kind !== "activity" || !message.tool) return null;
  if (comm.direction === "received" || message.tool.ok === false) return null;
  if ((message as Message & { roomRequest?: unknown }).roomRequest) return null;
  if (comm.direction !== "sent" && !botDmIds.has(comm.groupId)) return null;
  return comm;
}

type AnyItem = { kind: string; message?: Message; messages?: readonly Message[] };

function rowsOf(item: AnyItem): Message[] {
  if (item.message) return [item.message];
  return item.messages ? [...item.messages] : [];
}

/** Fold every run of consecutive sent chips into one line. `silent` names
 * the rows that draw nothing (hidden tool steps): they sit inside a run
 * without breaking it, and stay outside one that ends before them. */
export function collapseMessagedLines<T extends AnyItem>(
  items: readonly T[],
  botDmIds: ReadonlySet<string>,
  silent: (item: T) => boolean,
): Array<T | MessagedLineItem> {
  const chipOf = (item: T) => (item.kind === "message" && item.message ? messagedChip(item.message, botDmIds) : null);
  const out: Array<T | MessagedLineItem> = [];
  let index = 0;
  while (index < items.length) {
    const first = items[index]!;
    if (!chipOf(first)) {
      out.push(first);
      index += 1;
      continue;
    }
    let last = index;
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      if (chipOf(candidate)) {
        last = cursor;
        cursor += 1;
        continue;
      }
      if (silent(candidate)) {
        cursor += 1;
        continue;
      }
      break;
    }
    const covered = items.slice(index, last + 1);
    const recipients: MessagedRecipient[] = [];
    for (const item of covered) {
      const comm = chipOf(item);
      if (!comm) continue;
      const key = comm.withBotId || comm.withName;
      const known = recipients.find((entry) => entry.key === key);
      if (known) known.message = item.message!;
      else recipients.push({ key, comm, message: item.message! });
    }
    const messages = covered.flatMap(rowsOf);
    out.push({ kind: "messagedLine", id: `messaged:${messages[0]!.id}`, recipients, messages });
    index = last + 1;
  }
  return out;
}

/** The room a names line has, measured on screen (#3581): the width each
 * name takes whole (its face, its name and the words that join it), the
 * width "and N others" takes for a count, and what is left for the names. */
export interface NamesFit {
  widths: readonly number[];
  others: (count: number) => number;
  available: number;
}

/** What a names line draws (Messaged, Asked, Asked by, Wrote to): every
 * name when there are few, else the first three and how many more. A name
 * is never cut (#3581): when the names do not fit the room, the line draws
 * fewer of them and a larger count ("A, B and 13 others", then "A and 14
 * others"), the count always whole, and at least one name. Opened, it is
 * the whole list. */
export function messagedLineNames<T>(parties: readonly T[], expanded: boolean, fit?: NamesFit): { shown: T[]; others: number } {
  if (expanded) return { shown: [...parties], others: 0 };
  let count = Math.min(parties.length, MESSAGED_LINE_SHOWN);
  if (fit && fit.available > 0) {
    const room = (shown: number) => fit.widths.slice(0, shown).reduce((sum, width) => sum + width, 0)
      + (shown < parties.length ? fit.others(parties.length - shown) : 0);
    while (count > 1 && room(count) > fit.available) count -= 1;
  }
  return { shown: parties.slice(0, count), others: parties.length - count };
}

/** Whether the line's tail (a count, a state) takes a line of its own under
 * the names: even one name whole and the count of the others leave it no
 * room on theirs (#4112, a phone line's number on a phone-width row).
 * `available` is the room for the names once the tail is set aside. */
export function tailOnOwnLine(count: number, fit: NamesFit | undefined, hasTail: boolean): boolean {
  if (!hasTail || !fit || !(fit.available > 0) || count === 0) return false;
  return (fit.widths[0] ?? 0) + (count > 1 ? fit.others(count - 1) : 0) > fit.available;
}

/** The locale's list ("A, B and C", "A, B et C") as element and literal
 * pieces, so each element can be drawn as a name with its face. */
export function conjunctionParts(count: number, locale: string): Array<{ type: "element"; index: number } | { type: "literal"; value: string }> {
  const placeholders = Array.from({ length: count }, (_, i) => `\u0000${i}\u0000`);
  let parts: { type: "element" | "literal"; value: string }[];
  try {
    parts = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).formatToParts(placeholders);
  } catch {
    parts = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).formatToParts(placeholders);
  }
  return parts.map((part) => part.type === "element"
    ? { type: "element" as const, index: Number(part.value.replaceAll("\u0000", "")) }
    : { type: "literal" as const, value: part.value });
}

/** The state the line says after its names: a send that failed, else one
 * that waits on the person; any other state is behind the name. */
export function messagedLineState(recipients: readonly MessagedRecipient[]): Extract<SendState, "failed" | "waiting"> | null {
  const states = recipients.map((recipient) => recipient.message.sendReceipt?.state);
  if (states.includes("failed")) return "failed";
  return states.includes("waiting") ? "waiting" : null;
}
