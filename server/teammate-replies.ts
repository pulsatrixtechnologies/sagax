// What keeps a teammate's reply coming back to the conversation that waits
// for it (owner report, 2026-11-01: "the bots talk to each other, they do not answer
// me, I have to relaunch them").
//
// Two holes sent the reply nowhere, so the person had to start the bot again:
// - Every interrupt of a direct turn stopped awaiting the teammates
//   (coordinator.stopAwaitingDirect), the person's Stop and also the cuts that
//   are not one: the safe-point cut that lets the bot read the person's new
//   words (server/safe-point-preempt.ts), a turn parked on a busy computer, an
//   engine whose connection changed. The work went on; its reply was dropped.
// - The resume's admission (canAdmitDirectTurn) counted the person's main
//   conversation against the bot's thread capacity, which startTurn never
//   does: the reply waited behind the bot's other work until the tree failed
//   as stalled, while the person could still write there.
//
// Pure rules, no IO: index.ts owns the interrupt and the store.

/** Why a direct conversation's running turn is interrupted. */
export type DirectInterruptCause =
  /** The person's Stop (or the agent API's interrupt for its caller). */
  | "stop"
  /** Cut at a safe point to read the person's waiting words. */
  | "safe-point"
  /** Parked on a busy computer; a resume is registered. */
  | "computer-park"
  /** The engine's connection changed under the turn. */
  | "engine-change";

/** Whether the work this conversation handed out still reports back to it
 * after the interrupt. Only a Stop ends it: nothing resumes into a stopped
 * chat, and the teammates already working are named for a second Stop. */
export function interruptKeepsTeammates(cause: DirectInterruptCause): boolean {
  return cause !== "stop";
}

/** startTurn's capacity rule: the person's main conversation is never at
 * capacity; any other thread takes a slot of the bot's maximum. */
export function atThreadCapacity(input: { busyThreads: number; max: number; threadId?: string; mainThreadId?: string }): boolean {
  if (input.threadId && input.threadId === input.mainThreadId) return false;
  return input.busyThreads >= input.max;
}
