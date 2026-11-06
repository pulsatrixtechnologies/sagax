// @ts-nocheck
/** waitForGroupMemberBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWaitForGroupMemberBot(getHost: () => Host): any {
async function waitForGroupMemberBot(
  bot: BotRecord,
  operation: GroupTurnOperation,
  onWaiting: (detail: string) => void,
): Promise<GroupMemberBotWaitResult> {
  const host = getHost();
  operation.botIds.delete(bot.id);
  const initial = host.claimGroupMemberBot(bot.id, operation);
  if (initial !== "busy") return initial;
  onWaiting(`${bot.name} is finishing another conversation.`);

  return await new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    let unlockSubscription = () => {};
    const finish = (availability: GroupMemberBotWaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(waitCap);
      unsubscribe();
      unlockSubscription();
      operation.cancellation.signal.removeEventListener("abort", onAbort);
      resolve(availability);
    };
    // unref'd: a parked room must never keep the process alive on its own
    const waitCap = setTimeout(() => finish("timed_out"), host.GROUP_GOAL_WAIT_MAX_MS);
    waitCap.unref?.();
    const check = () => {
      if (settled) return;
      const availability = host.claimGroupMemberBot(bot.id, operation);
      if (availability !== "busy") finish(availability);
    };
    const onAbort = () => finish("cancelled");
    unsubscribe = host.store.onChange((change) => {
      if (
        (change.type === "bot" && change.botId === bot.id) ||
        (change.type === "bot.deleted" && change.botId === bot.id)
      ) {
        check();
      }
    });
    // Another room thread handing the member back is not a store change.
    unlockSubscription = host.roomMemberLock.onRelease((botId) => {
      if (botId === bot.id) check();
    });
    operation.cancellation.signal.addEventListener("abort", onAbort, { once: true });
    // Close the read→subscribe race: the bot may have settled between the
    // initial check and listener registration.
    check();
  });
}
  return waitForGroupMemberBot;
}
