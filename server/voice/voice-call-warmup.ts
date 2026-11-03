// One engine warm per live voice call.
//
// The page says the call started (POST /voice/call). This starts the bot's
// engine then, in parallel with the speech connection, so the first spoken
// turn reuses the process. A second start of the same call does nothing,
// including a keepalive after the warm has finished. A new call on the
// thread waits for the previous warm to finish before it starts, so two
// spawns cannot overwrite the pooled process. Hangup aborts the warm and
// forgets it, so a later start of that call id warms again. join still
// waits until the in-flight run has released the thread.

interface WarmJob {
  callId: string;
  controller: AbortController;
  done: Promise<void>;
  settle: () => void;
}

export class VoiceCallWarmup {
  private readonly jobs = new Map<string, WarmJob>();
  /** call id whose warm already finished on this thread */
  private readonly finished = new Map<string, string>();

  /** Register `run` synchronously. The same callId is a no-op, in flight or
   * already finished. A different callId aborts the previous warm and waits
   * for it before running. */
  begin(threadId: string, callId: string, run: (signal: AbortSignal) => Promise<void>): void {
    if (this.finished.get(threadId) === callId) return;
    const existing = this.jobs.get(threadId);
    if (existing?.callId === callId) return;
    const controller = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => { settle = resolve; });
    const job: WarmJob = { callId, controller, done, settle };
    this.jobs.set(threadId, job);
    this.finished.delete(threadId);
    const previous = existing;
    void (async () => {
      try {
        if (previous) {
          previous.controller.abort();
          await previous.done;
        }
        if (controller.signal.aborted) return;
        await run(controller.signal);
      } catch {
        // The run reports its own failure. join must still resolve.
      } finally {
        if (this.jobs.get(threadId) === job) {
          this.jobs.delete(threadId);
          // A hangup aborts. Remembering it would skip the next start.
          if (!controller.signal.aborted) this.finished.set(threadId, callId);
        }
        settle();
      }
    })();
  }

  /** Resolves when the in-flight warm has finished and released the thread.
   * Immediate when this thread has no warm. */
  join(threadId: string): Promise<void> {
    return this.jobs.get(threadId)?.done ?? Promise.resolve();
  }

  /** Abort that call's warm, or forget one that already finished. False when
   * the callId is neither. The in-flight job stays until the run finishes,
   * so join still waits. */
  cancel(threadId: string, callId: string): boolean {
    const finished = this.finished.get(threadId) === callId;
    if (finished) this.finished.delete(threadId);
    const job = this.jobs.get(threadId);
    if (!job || job.callId !== callId) return finished;
    job.controller.abort();
    return true;
  }
}
