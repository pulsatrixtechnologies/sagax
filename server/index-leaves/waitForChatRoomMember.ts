// @ts-nocheck
/** waitForChatRoomMember (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWaitForChatRoomMember(getHost: () => Host): any {
async function waitForChatRoomMember(   operation: GroupTurnOperation,   threadId: string,   bot: BotRecord, ) {
  const host = getHost();

  const waitTool = {
    name: `${bot.name} is finishing another conversation — will reply here when free`,
    spoken: `${bot.name} is finishing another conversation`
  };
  let waitChip: Message | undefined;
  const availability = await host.waitForGroupMemberBot(bot, operation, () => {
    waitChip = host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: waitTool
    });
  });
  switch (availability) {
    case "ready":
      // The promise is kept the moment the turn starts; settle the chip so
      // the live label stops narrating a wait that is over.
      if (waitChip) host.store.patchMessage(threadId, waitChip.id, { tool: { ...waitTool, ok: true } });
      // Membership means the bot is part of the room operation NOW, so its
      // own Stop button reaches this turn rather than an idle 1:1 thread.
      operation.botIds.add(bot.id);
      return "run";
    case "cancelled":
      return "stop";
    case "unavailable":
      host.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        tool: { name: `${bot.name} is no longer available — skipped this round`, ok: false }
      });
      return "skip";
    case "timed_out": {
      const minutes = Math.max(1, Math.round(host.GROUP_GOAL_WAIT_MAX_MS / 60_000));
      const name =
        `${bot.name} stayed busy in another conversation for ${minutes} minute${minutes === 1 ? "" : "s"} — skipped this round`;
      // The cap only fires after a wait began, so the chip exists; append
      // rather than lose the verdict if that ever stops being true.
      if (waitChip) host.store.patchMessage(threadId, waitChip.id, { tool: { name, ok: false } });
      else {
        host.store.appendMessage(threadId, {
          role: "bot",
          kind: "activity",
          from: { botId: bot.id, name: bot.name, color: bot.color },
          tool: { name, ok: false }
        });
      }
      return "skip";
    }
  }

}
  return waitForChatRoomMember;
}
