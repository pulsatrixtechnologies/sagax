// @ts-nocheck
/** askBotAndWait (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAskBotAndWait(getHost: () => Host): any {
function askBotAndWait(targetBotId: string, message: string, depth: number, fromBotId?: string, fromThreadId?: string, targetThreadId?: string,   options: { timeoutMs?: number; selfRelay?: boolean; speaker?: TurnSpeaker } = {}) {
  const host = getHost();

  const target = host.store.bot(targetBotId);
  if (!target) return Promise.resolve({ status: "error", text: "(no such bot)" });
  const threadId = targetThreadId ?? host.peerThreadFor(target);
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    // #4878: the failed turn the usage-limit failover took over, while the
    // next engine of the chain has not started it yet in this thread.
    let carried: AskBotOutcome | null = null;
    let carryTimer: ReturnType<typeof setTimeout> | undefined;
    const awaited = { threadId };
    host.awaitedAsks.add(awaited);
    const finish = (out: AskBotOutcome) => {
      if (done) return;
      done = true;
      host.awaitedAsks.delete(awaited);
      clearTimeout(timer);
      clearTimeout(carryTimer);
      unsub();
      resolve(out);
    };
    const unsub = host.bus.subscribe((e: RuntimeEvent) => {
      // A cancelled provider may flush text/completion after its replacement
      // has started on the same thread. Retired turn ids must never satisfy a
      // newer ask_bot waiter with the old partial reply.
      if (host.shouldIgnoreProviderEvent(e)) return;
      if (e.threadId !== threadId) return;
      if (e.type === "turn.started" && carried) {
        // the next engine took the work on: its turn's words are the result
        carried = null;
        clearTimeout(carryTimer);
        text = "";
      } else if (e.type === "item.completed" && e.itemType === "assistant_text") {
        text += (text ? "\n" : "") + e.text;
      } else if (e.type === "turn.completed") {
        if (e.ok) finish({ status: "reply", text: text || "(the bot finished without a text reply)" });
        else {
          const failed: AskBotOutcome = { status: "failed", text: host.stoppedTurnText(threadId, e.turnId, undefined, e.stopReason) };
          // #4878: the usage-limit failover took this turn over (the main
          // subscriber ran turnFailed first): the same work goes on here on
          // the next engine of the chain. Wait for it; with no engine left
          // to start it within the grace, the refusal is the outcome.
          if (!carried && host.limitTakeovers?.take(threadId, e.turnId)) {
            carried = failed;
            text = "";
            carryTimer = setTimeout(() => { if (carried) finish(carried); }, host.LIMIT_TAKEOVER_GRACE_MS ?? 30_000);
            return;
          }
          finish(failed);
        }
      }
    });
    // Timing out does NOT stop the peer's turn — the caller decides whether
    // the still-running work becomes a delegation claim ticket instead.
    const timer = setTimeout(() => finish({ status: "timeout", text }), options.timeoutMs ?? host.ASK_BOT_TIMEOUT_MS);
    // The asker's identity rides on the stored line as well as in the note
    // prefixed to it: the wording is for the model reading this turn, the
    // field is for anything that reads the transcript later.
    const asker = fromBotId ? host.store.bot(fromBotId) : undefined;
    const unattended = host.isUnattended(fromBotId, fromThreadId);
    host.startTurn(targetBotId, message, {
      threadId,
      commsDepth: depth + 1,
      unattended,
      // run_with_engine: the bot's own part on another engine, never a
      // teammate's message (its opening says so, server/run-with-engine.ts)
      peerAsk: asker && !options.selfRelay
        ? unattended
          ? { botId: asker.id, name: asker.name, unattended: true }
          : { botId: asker.id, name: asker.name }
        : undefined,
      ...(options.speaker ? { speaker: options.speaker } : asker ? { speaker: host.peerSpeaker(asker.id, fromThreadId) } : {}),
      onDispatchError: (reason) => finish({ status: "error", text: `(couldn't start that bot: ${reason})` })
    }).catch((err) =>
      finish({ status: "error", text: `(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})` }),
    );
  });

}
  return askBotAndWait;
}
