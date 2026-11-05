import type { ReactNode } from "react";
import type { Message } from "@/state/store";
import { ApprovalCard, approvalCardStaysInChat } from "./ApprovalCard";
import { MeetingCard } from "./MeetingCard";
import { MessageBoundary } from "./MessageBoundary";
import { OptionCard, shouldHideOnboardingCard } from "./OptionCard";
import { PhoneCallConsentCard } from "./PhoneCallConsentCard";
import { QuestionCard } from "./QuestionCard";

/** The transcript row for an `options` message in a direct chat. Called, not
 * mounted: a quiz that has dropped out must come back as `null`, so the
 * transcript draws no row (and no day separator) for it. */
export function optionsCardRow({ message: m, transcript, botId, botName, threadId }: {
  message: Message;
  /** Active-branch messages, including ones outside the mounted window. */
  transcript: Message[];
  botId: string;
  botName: string;
  threadId: string;
}): ReactNode {
  // a live permission ask gets the approval box; a structured
  // ask gets the question box; anything else keeps the list
  // card. The first-run quiz drops out once they talk.
  // Cards are bot-authored and persisted, so one that will not
  // draw must fall back to its text on every open, not take the
  // whole page down every time this chat is selected.
  const card = m.card?.requestId && m.card.meetingRequest ? (
    <MeetingCard botId={botId} botName={botName} threadId={threadId} message={m} />
  ) : m.card?.requestId && m.card.phoneCallConsent ? (
    <PhoneCallConsentCard botId={botId} botName={botName} threadId={threadId} message={m} />
  ) : m.card?.requestId && m.card.questionRequest ? (
    <QuestionCard threadId={threadId} bot={{ id: botId, name: botName }} message={m} />
  ) : m.card?.requestId && m.card.tool ? (
    approvalCardStaysInChat(m.card) ? <ApprovalCard bot={{ name: botName }} message={m} threadId={threadId} /> : null
  ) : shouldHideOnboardingCard(m, transcript) ? null : (
    <OptionCard botId={botId} threadId={threadId} message={m} />
  );
  if (!card) return null;
  return (
    <MessageBoundary fallbackText={m.card?.subtitle || m.card?.title || ""}>
      {card}
    </MessageBoundary>
  );
}
