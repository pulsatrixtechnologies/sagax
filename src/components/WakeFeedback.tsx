// #2694: feedback where the proactive bot spoke. A heartbeat or an email or
// calendar wake (its report card), an attention card on Today, and each point
// of a brief in the chat. Same row as the suggestion cards (SuggestionFeedback).
// The bot's owner rates, in a group too; another member of the group does not.
import { api, type Message } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { SuggestionFeedback, type SuggestionFeedbackChoice } from "./SuggestionFeedback";

/** The signed-in person owns this bot: solo, an operator, or its owner. */
export function useOwnsBot(botId: string | undefined): boolean {
  return useStoreSelector((state) => {
    const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
    return Boolean(bot) && viewerOwnsBot(state.config, bot!);
  });
}

/** Thumbs and "Moins de ça" on one wake kind (heartbeat, mail, calendar, attention). */
export function WakeFeedback({ botId, topic, value, threadId, messageId, className }: {
  botId: string;
  topic: string;
  value?: SuggestionFeedbackChoice;
  threadId?: string;
  messageId?: string;
  className?: string;
}) {
  const owns = useOwnsBot(botId);
  if (!owns) return null;
  return (
    <SuggestionFeedback
      className={className}
      value={value}
      onPick={async (choice) => {
        await api(`/api/bots/${botId}/background-brief/wake/feedback`, {
          method: "POST",
          body: JSON.stringify({ choice, topic, ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) })
        });
      }}
    />
  );
}

/** Each point of a brief message, rated in place. */
export function BriefItemsFeedback({ message, botId, threadId }: { message: Message; botId: string; threadId: string }) {
  const owns = useOwnsBot(botId);
  const widths = useChatBubbleWidthClasses();
  const items = message.briefItems ?? [];
  if (!owns || !items.length) return null;
  return (
    <ul data-brief-items className={`${widths.fit} self-start mt-1 flex flex-col gap-2 rounded-xl border border-hairline/50 bg-bubble-bot px-3 py-2`}>
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-0.5">
          <span className="text-[13px] leading-5 text-ink">{item.text}</span>
          <SuggestionFeedback
            value={item.feedback}
            onPick={async (choice) => {
              await api(`/api/bots/${botId}/background-brief/${item.id}/feedback`, {
                method: "POST",
                body: JSON.stringify({ choice, threadId, messageId: message.id })
              });
            }}
          />
        </li>
      ))}
    </ul>
  );
}
