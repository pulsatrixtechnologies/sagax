// Seen-by receipts in the transcript (server/messages/read-receipts.ts).
//
// The server keeps one read position per participant per thread: a person's
// principal id, or `bot:<botId>`, to the newest message they have seen. The
// transcript shows each participant once, under the last message they have
// read: a row of small avatars in a room or a conversation between people
// (Messenger, Teams), a quiet "Seen" caption in a 1:1 with a bot. The
// viewer's own position is never drawn.
import { t } from "@/lib/i18n";
import type { ThreadReadPosition } from "../../shared/wire";

export type ThreadReads = Record<string, ThreadReadPosition>;

export interface SeenEntry {
  participantId: string;
  at: number;
}

const BOT_PREFIX = "bot:";

export function isBotParticipant(participantId: string): boolean {
  return participantId.startsWith(BOT_PREFIX);
}

export function botIdOfParticipant(participantId: string): string | null {
  return isBotParticipant(participantId) ? participantId.slice(BOT_PREFIX.length) : null;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a) && Boolean(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

/** Who wrote a message, as a participant id: the bot that said it, or the
 * person whose session sent it. Null when the line names nobody. */
export function messageParticipant(message: { role: string; from?: { botId: string }; sender?: { id?: string } }, soloBotId?: string): string | null {
  if (message.role === "user") return message.sender?.id?.trim().toLowerCase() || null;
  const botId = message.from?.botId ?? soloBotId;
  return botId ? `${BOT_PREFIX}${botId}` : null;
}

/**
 * For every message that gets a seen row, who has read up to it, oldest
 * reader first. Each participant appears once: under the newest message at
 * or before their position that is drawn as a bubble (`anchorable`) and that
 * they did not write themselves (seeing your own line says nothing). The
 * viewer (`self`) is left out, and so is a position on a message this page
 * has not loaded.
 */
export function seenRows(input: {
  order: readonly { id: string }[];
  anchorable: ReadonlySet<string>;
  reads: ThreadReads;
  self: string | null;
  authorOf: (messageId: string) => string | null;
}): Map<string, SeenEntry[]> {
  const index = new Map(input.order.map((message, at) => [message.id, at]));
  const rows = new Map<string, SeenEntry[]>();
  for (const [participantId, position] of Object.entries(input.reads)) {
    if (same(participantId, input.self)) continue;
    const from = index.get(position.messageId);
    if (from === undefined) continue;
    for (let at = from; at >= 0; at -= 1) {
      const id = input.order[at]!.id;
      if (!input.anchorable.has(id) || same(input.authorOf(id), participantId)) continue;
      const row = rows.get(id) ?? [];
      row.push({ participantId, at: position.at });
      rows.set(id, row);
      break;
    }
  }
  for (const row of rows.values()) row.sort((a, b) => a.at - b.at || a.participantId.localeCompare(b.participantId));
  return rows;
}

/**
 * A 1:1 with a bot: where its "Seen" caption goes, if anywhere. Under the
 * last message the bot consumed, and only until it has answered below it
 * (the answer says it saw it).
 */
export function botSeenCaption(input: {
  order: readonly { id: string; role: string; kind: string }[];
  anchorable: ReadonlySet<string>;
  reads: ThreadReads;
  botId: string;
  authorOf: (messageId: string) => string | null;
}): { messageId: string; at: number } | null {
  const participantId = `${BOT_PREFIX}${input.botId}`;
  const read = input.reads[participantId];
  if (!read) return null;
  const rows = seenRows({ order: input.order, anchorable: input.anchorable, reads: { [participantId]: read }, self: null, authorOf: input.authorOf });
  const [messageId] = [...rows.keys()];
  if (!messageId) return null;
  const at = input.order.findIndex((message) => message.id === messageId);
  if (input.order.slice(at + 1).some((message) => message.role === "bot" && message.kind === "text")) return null;
  return { messageId, at: read.at };
}

/** "Seen by Alice at 14:02, Quasar at 14:03". */
export function seenTooltip(entries: ReadonlyArray<{ name: string; at: number }>, time: (at: number) => string): string {
  return t("seen.by", { list: entries.map((entry) => t("seen.entry", { name: entry.name, time: time(entry.at) })).join(", ") });
}

/** One reader as their avatar's tooltip says it: "Sam Taylor · 2:46 PM". */
export function seenFaceLabel(name: string, time: string): string {
  return t("seen.face", { name, time });
}

/** "Seen", or "Seen at 14:03" once a minute or more has passed since the
 * message was sent. */
export function seenCaption(sentAt: number, seenAt: number, time: (at: number) => string): string {
  return seenAt - sentAt < 60_000 ? t("seen.caption") : t("seen.captionAt", { time: time(seenAt) });
}

/** The positions after a `thread.read` frame: the new one replaces the
 * participant's, never moving it back. */
export function applyReadFrame(reads: ThreadReads, participantId: string, read: ThreadReadPosition): ThreadReads {
  const current = reads[participantId];
  if (current && current.messageId === read.messageId && current.at === read.at) return reads;
  return { ...reads, [participantId]: read };
}
