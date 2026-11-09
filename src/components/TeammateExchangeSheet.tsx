// A teammate's work, opened from its row in the Teammates card
// (DelegationList), as the bot-to-bot sheet it is (#3245, 2026-11-09):
// the "Owner ⇄ Teammate" pill on an opaque header, the lines as the
// bubbles of a 1:1 chat, one "Close Chat" pill at the bottom. Never a
// second chat with its own X and "Message <bot>" composer: the person
// reads a conversation between two bots, they do not take part in it.
// The thread stays live (useSideTranscript), so a teammate still at work
// keeps adding lines.
import type { Bot } from "@/state/store";
import { useSideTranscript } from "@/lib/use-side-transcript";
import type { ExchangeRun } from "@/lib/bot-exchange";
import { ExchangeSheet } from "./BotExchangeChip";
import { creditedLines } from "./BotConversations";

export default function TeammateExchangeSheet({ owner, teammate, threadId, task, bots, onClose }: {
  /** The bot that handed the work: it wrote the user-role lines. */
  owner?: Pick<Bot, "id" | "name" | "color">;
  teammate: { id: string; name: string; color?: string };
  threadId: string;
  /** The task, quiet under the header pill. */
  task?: string;
  bots?: readonly Bot[];
  onClose: () => void;
}) {
  const transcript = useSideTranscript(threadId);
  // The owner wrote the asks (user role), the teammate the answers.
  // Without the owner (a card that does not name it), the lines stay as
  // stored and the sheet credits them to the teammate.
  const messages = owner ? creditedLines(transcript.messages, owner, teammate, "out") : transcript.messages;
  const run: ExchangeRun = {
    id: `conversation:${threadId}`,
    messages,
    party: teammate,
    ends: owner ? [{ id: owner.id, name: owner.name, color: owner.color }, teammate] : [teammate],
  };
  return (
    <ExchangeSheet
      run={run}
      bots={bots}
      showToolCalls={false}
      loadError={transcript.failed && transcript.messages.length === 0}
      meta={task}
      onClose={onClose}
    />
  );
}
