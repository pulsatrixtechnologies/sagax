// @ts-nocheck
/** finishVoiceCallRequestedByBot (#1388). Pure move from server/index.ts. */
import { voiceCallTurnSettle } from "../voice/voice-call-session.ts";
export type Host = Record<string, any>;

export function createFinishVoiceCallRequestedByBot(getHost: () => Host): any {
function finishVoiceCallRequestedByBot(threadId: string, settle: ReturnType<typeof voiceCallTurnSettle>) {
  const host = getHost();

  const ending = host.voiceCalls.settleEnding(threadId, settle);
  if (!ending) return;
  host.voiceWarmup.cancel(threadId, ending.callId);
  host.releaseWarmEngine(threadId);
  void host.perspicaxMcp?.endWarm(threadId);
  host.broadcastVoiceCallEnded(threadId, ending.callId, "bot");

}
  return finishVoiceCallRequestedByBot;
}
