// @ts-nocheck
/** routeSteeredMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRouteSteeredMessage(getHost: () => Host): any {
async function routeSteeredMessage(input: { botId: string; threadId: string; handle: string; mode: "parallel" | "after"; title?: string; resources: string[] }):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();
  const { queueSteeredMessage } = host;

  let entry = host.routableSteers.get(input.handle);
  // the steer's acknowledgement can trail the turn reading the words
  for (let waited = 0; entry && !entry.messageId && waited < 3_000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    entry = host.routableSteers.get(input.handle);
  }
  if (!entry || entry.botId !== input.botId || entry.threadId !== input.threadId || !entry.messageId) {
    return { status: 404, body: { error: "no message to route with that handle in this conversation" } };
  }
  if (entry.routed) return { status: 200, body: { routed: entry.routed, ...(entry.target ? { target: entry.target } : {}), already: true } };
  const row = host.store.messagesFor(input.threadId).find((message) => message.id === entry!.messageId);
  if (!row || !host.store.taskByThread(input.botId, input.threadId)) return { status: 404, body: { error: "that message is no longer in this conversation" } };
  const { context } = entry;
  // Claimed before any await: two calls with one handle never start two tasks.
  entry.routed = input.mode;
  if (input.mode === "parallel") {
    let started: Awaited<ReturnType<typeof host.startParallelTask>>;
    try {
      started = await host.startParallelTask({
        botId: input.botId, threadId: input.threadId, text: entry.text, existingRequestId: row.id,
        ...context, ...(input.title ? { title: input.title } : {}), ...(input.resources.length ? { resources: input.resources } : {})
      });
    } catch (error) {
      // refused (the per-person limit...): the bot may still route it after
      entry.routed = undefined;
      throw error;
    }
    entry.target = started.parallel.threadId;
    host.handoffs.routedAway(input.threadId, row.id);
    console.log(`[busy-route] ${input.botId}/${input.threadId} parallel (bot) -> ${started.parallel.threadId} ${started.parallel.state}`);
    return { status: 200, body: { routed: "parallel", target: started.parallel.threadId, state: started.parallel.state } };
  }
  host.store.patchMessage(input.threadId, row.id, { steered: false });
  const queued = queueSteeredMessage(input.botId, input.threadId, entry.text, {
    existingMessageId: row.id,
    prompt: `[You set this message aside earlier to handle once your previous work was done. Handle it now.]\n${promptWithReply(entry.text, context.replyTo, context.sender?.name || cfg.profile?.name?.trim() || "User")}`,
    ...(context.replyTo ? { replyToId: context.replyTo.id } : {}),
    sender: context.sender, trigger: context.trigger, speaker: context.speaker
  });
  entry.target = queued.id;
  host.handoffs.routedAway(input.threadId, row.id);
  console.log(`[busy-route] ${input.botId}/${input.threadId} after (bot) -> queue ${queued.id}`);
  return { status: 200, body: { routed: "after", queueId: queued.id } };

}
  return routeSteeredMessage;
}
