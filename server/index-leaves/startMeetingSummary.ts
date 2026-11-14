// @ts-nocheck
/** startMeetingSummary (#1388). Pure move from server/index.ts. Also the
 * turn a listening session's stop starts (#4100): same retry while the
 * thread is busy, its own words when it cannot start, and the person who
 * listened as the speaker. */
import { isTurnAdmissionBlocked } from "../turns/turn-dispatch-guard.ts";
export type Host = Record<string, any>;

export function createStartMeetingSummary(getHost: () => Host): any {
function startMeetingSummary(botId: string, threadId: string, prompt: string, options: { speaker?: unknown; what?: string; attempt?: number } = {}) {
  const host = getHost();
  const attempt = options.attempt ?? 0;
  const speaker = options.speaker ?? host.turnSpeakers.get(threadId);
  void host.startTurn(botId, prompt, { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) }).catch((error) => {
    if (!host.store.taskByThread(botId, threadId)) return;
    if (isTurnAdmissionBlocked(error) && attempt < 20) {
      setTimeout(() => startMeetingSummary(botId, threadId, prompt, { ...options, attempt: attempt + 1 }), 30_000).unref();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: host.failedTurnTool(`${options.what ?? "the meeting notes"} could not start: ${message}`) });
  });

}
  return startMeetingSummary;
}
