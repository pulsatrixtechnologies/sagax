// @ts-nocheck
/** prewarmThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrewarmThread(getHost: () => Host): any {
function prewarmThread(botId: string, threadId: string, person: string, opts: PrewarmTurnOpts, windowMs?: number) {
  const host = getHost();

  if (host.threadPrewarm.has(threadId)) {
    const began = host.threadPrewarm.begin(threadId, person, async () => {}, windowMs);
    // QA 0.8.66: the conversation was opened (a warm without a prime), now the
    // person types: prime the provider cache on that same engine session.
    const primeSignal = opts.primeCache ? host.threadPrewarm.primeOnce(threadId) : null;
    if (primeSignal) {
      void host.threadPrewarm.join(threadId).then(() => {
        if (primeSignal.aborted || host.runningTurnEngines.has(threadId)) return;
        return host.startTurn(botId, "", { threadId, warmOnly: true, warmSignal: primeSignal, speaker: opts.speaker, primeCache: true });
      }).catch((error) => {
        console.error(`[prewarm] prime skipped: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
      });
    }
    return began;
  }
  if (host.prewarmRefusal(botId, threadId)) return "skipped";
  // Composer open / typing (#1975): a person looks at one conversation; drop
  // their other waiting warms so a thread switch does not keep mounting.
  // Routine and teammate warms keep the shared waiting pool.
  if (!opts.automationSource && !opts.runOn && !opts.warmCoordination) {
    host.threadPrewarm.cancelOthers(person, threadId);
  }
  const primeNow = opts.primeCache === true;
  const began = host.threadPrewarm.begin(threadId, person, (signal) => new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      // the driver closed its idle process (a turn's process stays)
      if (!host.runningTurnEngines.has(threadId)) {
        host.idleEngines.forget(threadId);
        host.perspicaxMcp?.noteEngineCold(threadId);
      }
    }, { once: true });
    void host.startTurn(botId, "", {
      threadId,
      warmOnly: true,
      warmSignal: signal,
      speaker: opts.speaker,
      ...(opts.runOn ? { runOn: opts.runOn } : {}),
      ...(opts.automationSource ? { automationSource: opts.automationSource } : {}),
      ...(opts.commsDepth ? { commsDepth: opts.commsDepth } : {}),
      ...(opts.cardContinuation ? { cardContinuation: true } : {}),
      ...(opts.warmCoordination ? { warmCoordination: true } : {}),
      ...(primeNow ? { primeCache: true } : {}),
      onWarmSettled: (ok, driverKind) => {
        // counted with the finished sessions, so the idle cap (#804) holds
        if (ok && !signal.aborted && !host.runningTurnEngines.has(threadId)) host.idleEngines.noteIdle(threadId, () => {
          host.threadPrewarm.cancel(threadId);
          setImmediate(() => {
            host.releaseWarmEngine(threadId);
            host.perspicaxMcp?.noteEngineCold(threadId);
          });
        }, host.idleEngineTtl(driverKind));
        resolve();
      }
    }).catch((error) => {
      console.error(`[prewarm] skipped: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
      resolve();
    });
  }), windowMs);
  // mark this warm primed, so a later typing warm does not prime it again
  if (primeNow && began === "started") host.threadPrewarm.primeOnce(threadId);
  return began;
}
  return prewarmThread;
}
