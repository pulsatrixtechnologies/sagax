// A teammate parked on a question for the person (server park and remind,
// 2026-10-19). The whole question, never cut, in the conversation the person
// reads, answered in place: the answer is the person's own message into the
// waiting work's conversation, which the runtime takes as the answer
// (coordinator.answer).
//
// #3438: it is drawn as the standard answerable card (AttentionCard, the
// same QuestionSheet every question in the chat uses), never a second box
// with a bare text area. When the card of a hand-off already asks the same
// thing in this conversation, that card is the one drawn
// (inputRequestsDrawnElsewhere). The pinned card over the composer draws the
// same card, so answering in either place settles both.
import { AttentionCard } from "./AttentionCard";
import { api, openThread, type Message } from "@/state/store";
import { useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { inputRequestCard } from "@/lib/pending-question";
import type { PersonAttentionCard } from "../../shared/person-attention";

/** Where a card sits: the conversation's thread, the bot that owns that
 * conversation (the server checks the thread against it, as Today does,
 * never against the bot whose work asks) and the card's message. */
export interface CardPlace {
  botId: string;
  threadId: string;
  messageId: string;
}

/** The person's answer to a question in words: their own message into the
 * thread the bot asked in, then the card it came on marked handled, so every
 * place that draws it (the chat, the pinned card, Today) settles. */
export async function answerPersonRequest(card: PersonAttentionCard, text: string, where?: CardPlace): Promise<void> {
  await api(`/api/bots/${card.botId}/messages`, { method: "POST", body: JSON.stringify({ text, threadId: card.threadId, sendId: crypto.randomUUID() }) });
  if (where) {
    void api("/api/approvals/handled", { method: "POST", body: JSON.stringify({ botId: where.botId, threadId: where.threadId, messageId: where.messageId, answered: true }) }).catch(() => undefined);
  }
}

/** #3471: the person skips a question in words: the server closes it as
 * skipped and tells the waiting work there is no answer. The card is folded
 * in the store at once, so the pinned card moves to the next item. */
export async function skipPersonRequest(where: CardPlace, dispatch?: ReturnType<typeof useStoreDispatch>, message?: Message): Promise<void> {
  if (dispatch && message) dispatch({ type: "messagePatched", threadId: where.threadId, message: skippedRequestMessage(message) });
  try {
    await api("/api/approvals/handled", { method: "POST", body: JSON.stringify({ ...where, skip: true }) });
  } catch (error) {
    if (dispatch && message) dispatch({ type: "messagePatched", threadId: where.threadId, message });
    throw error;
  }
}

/** The message as it reads once skipped (the server writes the same). */
export function skippedRequestMessage(message: Message): Message {
  if (message.inputRequest) return { ...message, inputRequest: { ...message.inputRequest, expired: true, skipped: true } };
  if (message.attention) return { ...message, attention: { ...message.attention, handledAt: Date.now(), closed: "skipped" } };
  return message;
}

/** The place of a card, once the conversation's thread is known. Without
 * the conversation's bot (a room's pinned card) the asking bot stands in. */
export function cardPlace(card: PersonAttentionCard, message: Message, threadId: string | undefined, conversationBotId: string | undefined): CardPlace | undefined {
  return message.attention && threadId ? { botId: conversationBotId ?? card.botId, threadId, messageId: message.id } : undefined;
}

/** Where a question in words is skipped: an attention card or an input
 * request row of the conversation (#3471). */
export function skipPlace(card: PersonAttentionCard, message: Message, threadId: string | undefined, conversationBotId: string | undefined): CardPlace | undefined {
  return (message.attention || message.inputRequest) && threadId ? { botId: conversationBotId ?? card.botId, threadId, messageId: message.id } : undefined;
}

/** One question in words, as the standard card. `threadId` is the
 * conversation the message sits in (the pinned card may hold one of an
 * earlier topic), `conversationBotId` the bot that owns it. */
export function PersonRequestCard({ message, card, threadId, conversationBotId, embedded }: { message: Message; card: PersonAttentionCard; threadId?: string; conversationBotId?: string; embedded?: boolean }) {
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  const owner = useStoreSelector((state) => state.bots.find((candidate) => candidate.id === card.botId));
  const request = message.inputRequest;
  const closedUnanswered = request && request.answered !== true && request.expired === true;
  const where = skipPlace(card, message, threadId, conversationBotId);
  return (
    <AttentionCard
      card={card}
      bot={owner}
      embedded={embedded}
      {...(closedUnanswered ? { settledNote: t(request.skipped ? "waitingCard.skipped" : request.defaulted ? "chat.inputRequest.defaulted" : "chat.inputRequest.expired") } : {})}
      // #3471: on the pinned card the control is on its own top row
      onSkip={!embedded && where ? () => skipPersonRequest(where, dispatch, message) : undefined}
      onOpenThread={showThreads ? (botId, target) => { openThread(dispatch, { botId, threadId: target }, getState(), showThreads); } : undefined}
      // an input request settles on the server once the work takes the
      // answer (settleInputRequests); a hand-off's card is marked handled
      onReply={(text) => answerPersonRequest(card, text, cardPlace(card, message, threadId, conversationBotId))}
    />
  );
}

export function InputRequestCard({ message, threadId, conversationBotId }: { message: Message; threadId?: string; conversationBotId?: string }) {
  const card = inputRequestCard(message);
  if (!card) return null;
  return (
    <div className="flex justify-start py-1" data-testid="input-request-card">
      <PersonRequestCard message={message} card={card} threadId={threadId} conversationBotId={conversationBotId} />
    </div>
  );
}
