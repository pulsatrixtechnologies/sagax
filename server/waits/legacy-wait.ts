/** A bot-wide "waiting on you" slot outlives the thread that set it when
 * that thread is not the selected conversation. Closing the work thread
 * then leaves the roster saying the teammate is waiting on the user (#5011).
 * Another open thread that still waits keeps the slot. */
export function legacyWaitStillHeld(
  tasks: readonly { threadId: string; activity?: string; closedBy?: unknown }[],
  settledThreadId: string,
): boolean {
  return tasks.some((task) => task.threadId !== settledThreadId && !task.closedBy && task.activity === "waiting-on-you");
}
