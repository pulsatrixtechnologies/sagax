// A bot's words on a card (M-20261119-045): the question of an ask, the
// card's context line, an option's detail, a pinned item's text. They used to
// be drawn as raw text, so "**Ce qu'elle confirme**" kept its asterisks, a
// "- " list stayed bare and a record link showed whole. They are drawn by the
// chat's own Markdown renderer (ChatMarkdown), the one the bot's bubble uses:
// bold, lists, and a sagax://record link as the record chip. This is not a
// second renderer: only the card's own size and line height are kept.
import { cn } from "@/lib/cn";
import { ChatMarkdown } from "./ChatMarkdown";

/** The composer a record chip's "Ask" writes in: the room's when the card
 * is in a room (by its id, or by the thread it was asked in), else the
 * bot's conversation on screen. Undefined when neither is known: the chip
 * then offers no "Ask", as a chip without a composer does. */
export function cardDraftId(
  state: { bots?: readonly { id: string; threadId?: string }[]; groups?: readonly { id: string; threadId?: string }[] },
  botId: string | undefined,
  threadId: string | undefined,
  groupId?: string,
): string | undefined {
  const room = groupId
    ? state.groups?.find((group) => group.id === groupId)
    : threadId ? state.groups?.find((group) => group.threadId === threadId) : undefined;
  if (room) return `group:${room.id}:${room.threadId ?? ""}`;
  const bot = botId ? state.bots?.find((candidate) => candidate.id === botId) : undefined;
  return bot ? `bot:${bot.id}:${bot.threadId ?? ""}` : undefined;
}

/** The bot's Markdown at the size of the text around it. `inert` inside a
 * control (an option row is a button): a record link reads as its label
 * there, since a chip is a control of its own. */
export function CardMarkdown({ text, draftId, inert = false, className }: { text: string; draftId?: string; inert?: boolean; className?: string }) {
  return (
    // inert: a link the words hold is read, never pressed, so a click on it is the row's own
    <div data-card-markdown="" className={cn("min-w-0 break-words [&_.chat-md]:leading-[inherit]", inert && "[&_a]:pointer-events-none", className)}>
      <ChatMarkdown text={text} draftId={draftId} inert={inert} />
    </div>
  );
}
