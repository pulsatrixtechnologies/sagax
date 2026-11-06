// @ts-nocheck
/** scheduleVoiceCallWatchdog (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleVoiceCallWatchdog(getHost: () => Host): any {
function scheduleVoiceCallWatchdog(botId: string, threadId: string) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  if (!host.voiceCalls.active(threadId)) return;
  const timer = setTimeout(() => {
    try {
      if (!host.voiceCalls.active(threadId) || host.threadBusy(botId, threadId) || hasQueuedSteeredMessages(botId, threadId)) return;
      if (host.stoppingThreads.has(threadId) || host.activeGroupTurnForBot(botId) || host.botAtThreadCapacity(botId)) return;
      const bot = host.store.projectBotForTask(botId, threadId);
      if (!bot || !host.store.taskByThread(botId, threadId)) return;
      const words = host.unansweredCallMessage(host.store.activePath(threadId), { stoppedAt: host.threadStoppedAt.get(threadId), stoppedUtteranceId: host.threadStoppedUtterance.get(threadId), retried: host.voiceCallRetried });
      if (!words) return;
      host.voiceCallRetried.add(words.id);
      if (host.voiceCallRetried.size > 5_000) host.voiceCallRetried.delete(host.voiceCallRetried.values().next().value!);
      console.warn(`[voice-call] thread ${threadId}: no answer to the words said on the call; running the turn again`);
      void host.startTurn(botId, host.voiceCallRecoveryPrompt(words.text ?? ""), {
        threadId,
        userMessage: words,
        // the words ride in the prompt: not twice through the replay
        excludeMessageIds: [words.id],
        ...(words.sender ? { sender: words.sender } : {})
      }).catch((error) => console.warn(`[voice-call] thread ${threadId}: the retry could not start: ${error instanceof Error ? error.message : String(error)}`));
    } catch (error) {
      console.warn("[voice-call] watchdog failed", error);
    }
  }, host.VOICE_CALL_WATCHDOG_MS);
  timer.unref?.();

}
  return scheduleVoiceCallWatchdog;
}
