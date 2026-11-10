// A turn that messages other bots leaves one "Messaged" chip per recipient
// (server/comms-visibility.ts). The chat draws a run of them as ONE centered
// quiet line, "Messaged [face] Osprey and [face] test" (#3270), shown with
// Tool calls hidden too: it is the only trace of the send where the person
// reads. A failed send keeps its own chip, so its failure still shows.
import type { Message } from "@/state/store";

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

/** What the line names: every recipient when there are few, else the
 * first three and how many more. */
export function messagedLineNames(recipients: readonly MessagedRecipient[], expanded: boolean): { shown: MessagedRecipient[]; others: number } {
  if (expanded || recipients.length <= MESSAGED_LINE_SHOWN) return { shown: [...recipients], others: 0 };
  return { shown: recipients.slice(0, MESSAGED_LINE_SHOWN), others: recipients.length - MESSAGED_LINE_SHOWN };
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
