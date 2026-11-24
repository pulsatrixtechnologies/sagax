// A teammate's work, opened from its row in the Teammates card
// (DelegationList), as the bot-to-bot sheet it is (#3245, 2026-11-09):
// the "Owner ⇄ Teammate" pill on an opaque header, the lines as the
// bubbles of a 1:1 chat, one "Close Chat" pill at the bottom. Never a
// second chat with its own X and "Message <bot>" composer: the person
// reads a conversation between two bots, they do not take part in it.
// The thread stays live (useSideTranscript), so a teammate still at work
// keeps adding lines. While that thread's turn runs, the footer row offers
// Stop (#5233): it stops that turn only, never the bot's other work.
import type { ReactNode } from "react";
import { useStoreOptional, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useSideTranscript } from "@/lib/use-side-transcript";
import type { ExchangeRun } from "@/lib/bot-exchange";
import { ExchangeSheet } from "./BotExchangeChip";
import { creditedLines } from "./BotConversations";
import { PILL } from "./SettingsPrimitives";

export default function TeammateExchangeSheet({ owner, teammate, threadId, task, bots, footer, onClose }: {
  /** The bot that handed the work: it wrote the user-role lines. */
  owner?: Pick<Bot, "id" | "name" | "color">;
  teammate: { id: string; name: string; color?: string };
  threadId: string;
  /** The task, quiet under the header pill: two lines at most with
   * "Show more" (#4043). */
  task?: string;
  bots?: readonly Bot[];
  /** A footer row (the older and newer requests of one "Asked by" line). */
  footer?: ReactNode;
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
  // The teammate's own thread, live from the store: Stop shows only while
  // this thread's turn runs, and only where the app can send the stop.
  const store = useStoreOptional();
  const thread = store?.state.bots.find((bot) => bot.id === teammate.id)?.tasks?.find((item) => item.threadId === threadId);
  const running = Boolean(thread && (thread.busy || thread.activity === "working"));
  const stop = store && running ? (
    <button
      type="button"
      data-testid="bot-exchange-stop"
      className={PILL}
      onClick={() => store.dispatch({ type: "interrupt", botId: teammate.id, threadId })}
    >
      {t("chat.stop")}
    </button>
  ) : null;
  return (
    <ExchangeSheet
      run={run}
      bots={bots}
      loadError={transcript.failed && transcript.messages.length === 0}
      subject={task}
      footer={stop || footer ? <>{stop}{footer}</> : undefined}
      onClose={onClose}
    />
  );
}
