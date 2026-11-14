// @ts-nocheck
/** raiseHarnessQuestion (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRaiseHarnessQuestion(getHost: () => Host): any {
function raiseHarnessQuestion(threadId: string, choice: HarnessChoice, origin: "tool" | "output" = "tool"): { messageId: string } | null {
  const host = getHost();
  const { newId } = host;

  // #4219: a keyed card of a room is raised in the room, by the bot that asks
  const room = host.store.groupByThread(threadId);
  if (!host.store.botByThread(threadId) && !(room && choice.askerBotId && room.memberIds.includes(choice.askerBotId))) return null;
  const requestId = `ask-choice-${newId()}`;
  const header = choice.title !== "Your bot has a question" ? choice.title.slice(0, 40) : undefined;
  const questionOptions = choice.questionOptions?.length
    ? choice.questionOptions
    : choice.options.map((label) => ({ label }));
  host.bus.publish({
    eventId: newId(), provider: "harness" as RuntimeEvent["provider"], threadId, createdAt: new Date().toISOString(),
    type: "request.opened", requestType: "question", requestId,
    tool: choice.pageTargetChoice ? "choose_page_target" : "ask_choice",
    summary: choice.question,
    choices: choice.options,
    questions: [{
      ...(header ? { header } : {}),
      question: choice.question,
      options: questionOptions,
      ...(choice.pageTargetChoice ? { custom: false as const } : {}),
    }],
    origin, harnessAsk: true,
    // #4238: a card raised quiet shows and waits, without a notification
    ...(choice.quiet ? { quietAsk: true } : {}),
    ...(room && choice.askerBotId ? { askerBotId: choice.askerBotId } : {}),
    // #4205, #4219: the card's key, hold and addressee from its first frame,
    // so its notification reaches the right person
    ...(choice.card ? { askCard: choice.card } : {}),
    ...(choice.pageTargetChoice ? { pageTargetChoice: choice.pageTargetChoice } : {}),
  });
  const messageId = host.askMessageByRequest.get(`${threadId}:${requestId}`);
  return messageId ? { messageId, requestId } : null;

}
  return raiseHarnessQuestion;
}
