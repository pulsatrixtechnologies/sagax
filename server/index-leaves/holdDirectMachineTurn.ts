// @ts-nocheck
/** holdDirectMachineTurn (#1388). Pure move from server/index.ts. */
import { randomUUID } from "node:crypto";
export type Host = Record<string, any>;

export function createHoldDirectMachineTurn(getHost: () => Host): any {
function holdDirectMachineTurn(bot: BotRecord, threadId: string, text: string, opts: Parameters<typeof startTurn>[2]) {
  const host = getHost();
  const { directMachinePlan, enqueueOfflineTurn } = host;

  const plan = directMachinePlan({ host: bot.host, workers: host.registeredWorkers });
  if (plan.kind !== "hold") throw Object.assign(new Error("this bot does not run on a computer"), { status: 409 });
  let userMessage = opts?.userMessage;
  if (opts?.editedMessageId) {
    const edited = host.store.branchMessage(threadId, opts.editedMessageId, text, opts.sendId, opts.sender, opts.dataContext);
    if (!edited) throw Object.assign(new Error("only a user text message can be edited"), { status: 400 });
    userMessage = edited;
  }
  if (!userMessage) {
    if (opts?.cardContinuation) {
      const id = `card-${randomUUID()}`;
      host.machinePrompts.set(id, text);
      userMessage = { id, at: Date.now(), role: "user", kind: "text", text };
    } else {
      userMessage = host.store.appendMessage(threadId, {
        role: "user",
        kind: "text",
        text,
        replyToId: opts?.replyTo?.id,
        sendId: opts?.sendId,
        ...(opts?.dataContext ? { dataContext: opts.dataContext } : {}),
        peerAsk: opts?.peerAsk,
        sender: opts?.sender,
        ...(opts?.voiceCall ? { voiceCall: opts.voiceCall } : {}),
        ...(opts?.relayed ? { relayed: true } : {})
      });
    }
  }
  if (opts?.cardContinuation) host.machinePrompts.set(userMessage.id, text);
  host.replaceQueuedWorkerTurns(enqueueOfflineTurn({
    queued: host.queuedWorkerTurns,
    messageId: userMessage.id,
    deviceId: plan.deviceId,
    userId: plan.userId,
    authorId: userMessage.sender?.id ?? opts?.sender?.id ?? host.localPrincipalId(),
    botId: bot.id
  }));
  host.machineTurnDone.set(userMessage.id, {
    threadId,
    botId: bot.id,
    settle: opts?.onTurnSettled,
    coordination: opts?.coordination?.settle,
    onError: opts?.onDispatchError
  });
  if (!plan.online) {
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: host.MACHINE_OFFLINE_NOTE, ok: false }
    });
  } else {
    host.store.setTaskActivity(bot.id, threadId, "working");
  }
  return userMessage;

}
  return holdDirectMachineTurn;
}
