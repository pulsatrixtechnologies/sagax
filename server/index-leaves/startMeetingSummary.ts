// @ts-nocheck
/** startMeetingSummary (#1388). Pure move from server/index.ts. */
import { isTurnAdmissionBlocked } from "../turns/turn-dispatch-guard.ts";
export type Host = Record<string, any>;

export function createStartMeetingSummary(getHost: () => Host): any {
function startMeetingSummary(botId: string, threadId: string, prompt: string, attempt = 0) {
  const host = getHost();

  const speaker = host.turnSpeakers.get(threadId);
  void host.startTurn(botId, prompt, { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) }).catch((error) => {
    if (!host.store.taskByThread(botId, threadId)) return;
    if (isTurnAdmissionBlocked(error) && attempt < 20) {
      setTimeout(() => startMeetingSummary(botId, threadId, prompt, attempt + 1), 30_000).unref();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: host.failedTurnTool(`the meeting notes could not start: ${message}`) });
  });

}
  return startMeetingSummary;
}
