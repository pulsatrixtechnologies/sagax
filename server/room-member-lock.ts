// One room member, one room thread at a time.
//
// A room's threads run in parallel (each thread's turns stay serial on its
// own queue), but a bot is one provider process: it must finish the thread
// it is working in before it takes another. `bot.busy` already says that once
// a member turn has claimed the bot. This lock covers the gap before that
// claim: the wait for a busy member wakes every thread that was waiting on
// it at once, and without a claim taken in the same synchronous step each of
// them would read the bot as free, start setting up, and all but one would
// then be skipped as "became busy in another conversation".
//
// The claim is held by a room THREAD (threads are the unit of serial work),
// from the moment a waiting thread is told the member is free until that
// member's turn has marked the bot busy — or ended without doing so. Release
// notifies listeners so the next waiting thread can take its turn. Pure and
// in-memory: a restart has no live turns, so there is nothing to persist.

export type RoomMemberReleaseListener = (botId: string) => void;

export class RoomMemberLock {
  private readonly holders = new Map<string, string>();
  private readonly listeners = new Set<RoomMemberReleaseListener>();

  /** The room thread holding this bot, if any. */
  holder(botId: string): string | undefined {
    return this.holders.get(botId);
  }

  /** True while a different room thread holds this bot. */
  heldElsewhere(botId: string, threadId: string): boolean {
    const holder = this.holders.get(botId);
    return holder !== undefined && holder !== threadId;
  }

  /** Take the bot for this thread. Re-claiming from the holding thread is a
   * no-op success; another thread's claim is never overwritten. */
  claim(botId: string, threadId: string): boolean {
    if (this.heldElsewhere(botId, threadId)) return false;
    this.holders.set(botId, threadId);
    return true;
  }

  /** Give the bot back, only when this thread holds it. Listeners run after
   * the claim is gone, so a woken waiter can claim immediately. */
  release(botId: string, threadId: string): boolean {
    if (this.holders.get(botId) !== threadId) return false;
    this.holders.delete(botId);
    this.notify(botId);
    return true;
  }

  /** Every claim this thread still holds: the thread's drive ended (finished,
   * stopped, or failed) and nothing it reserved may outlive it. */
  releaseThread(threadId: string): string[] {
    const released: string[] = [];
    for (const [botId, holder] of this.holders) {
      if (holder === threadId) released.push(botId);
    }
    for (const botId of released) this.holders.delete(botId);
    for (const botId of released) this.notify(botId);
    return released;
  }

  onRelease(listener: RoomMemberReleaseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(botId: string): void {
    // A snapshot: a woken waiter unsubscribes (or a new one subscribes)
    // while this release is still being announced.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...this.listeners]) {
      try {
        listener(botId);
      } catch {
        // A waiter's own failure must not strand the others.
      }
    }
  }
}
