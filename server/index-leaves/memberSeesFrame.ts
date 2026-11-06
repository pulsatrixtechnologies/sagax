// @ts-nocheck
/** memberSeesFrame (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberSeesFrame(getHost: () => Host): any {
function memberSeesFrame(payload: Record<string, unknown>, viewerId: string) {
  const host = getHost();

  // A webhook frame names its bot inside the record
  // (and an attempt only its webhook): the same people as GET /api/webhooks.
  if (host.IDENTITY.kind === "perspicax" && payload.kind === "webhook") {
    const hook = payload.webhook && typeof payload.webhook === "object" ? payload.webhook as { botId?: unknown } : null;
    return host.webhookSeenBy(hook?.botId, viewerId);
  }
  if (host.IDENTITY.kind === "perspicax" && payload.kind === "webhook.attempt") {
    const attempt = payload.attempt && typeof payload.attempt === "object" ? payload.attempt as { webhookId?: unknown } : null;
    const hook = host.webhooks.list().find((candidate) => candidate.id === attempt?.webhookId);
    return Boolean(hook) && host.webhookSeenBy(hook!.botId, viewerId);
  }
  // A routine or run frame names its bot and room inside the record.
  if (payload.kind === "routine" || payload.kind === "routine.run") {
    const held = payload.kind === "routine" ? payload.routine : payload.run;
    return Boolean(held) && typeof held === "object" && host.routineSeenBy(held as Record<string, unknown>, viewerId);
  }
  // A bot's routine folders (2026-10-28): its owner, or whoever is shown one
  // of its routines.
  if (payload.kind === "routine.folders") {
    const botId = typeof payload.botId === "string" ? payload.botId : "";
    const bot = host.store.bot(botId);
    if (!bot) return false;
    if (host.effectiveBotOwner(bot)?.toLowerCase() === viewerId.toLowerCase()) return true;
    return Boolean(host.routines?.listRoutines().some((routine) => routine.botId === botId && host.routineSeenBy(routine as unknown as Record<string, unknown>, viewerId)));
  }
  const groupField = payload.group && typeof payload.group === "object" ? (payload.group as { id?: unknown }).id : undefined;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : typeof groupField === "string" ? groupField : undefined;
  if (typeof groupId === "string") {
    const group = host.store.group(groupId);
    // A channel frame is judged by the channel alone (its people, teams and
    // section), never by the speaking bot's grants.
    if (group) return host.groupVisible(group, viewerId);
  }
  // A frame names its thread at the top (message, message.patch), inside a
  // runtime event, or inside a notification; and its bot the same ways.
  const nested = (key: "event" | "notification", field: "threadId" | "botId"): string | undefined => {
    const holder = payload[key];
    const value = holder && typeof holder === "object" ? (holder as Record<string, unknown>)[field] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  const threadId = typeof payload.threadId === "string" ? payload.threadId : nested("event", "threadId") ?? nested("notification", "threadId");
  if (typeof threadId === "string") {
    const group = host.store.groupByThread(threadId);
    if (group) return host.groupVisible(group, viewerId);
    // A bot's own conversation: the viewer sees it only when they see the
    // bot, and on an organization server only when it is theirs.
    const owner = host.store.botByThread(threadId);
    if (owner && !host.listedBotVisible(owner, viewerId)) return false;
    if (owner && !host.botThreadReadable(owner, threadId, viewerId, "thread.stream")) return false;
  }
  const botField = payload.bot && typeof payload.bot === "object" ? (payload.bot as { id?: unknown }).id : undefined;
  const botId = typeof payload.botId === "string" ? payload.botId : typeof botField === "string" ? botField : nested("notification", "botId") ?? nested("event", "botId");
  if (typeof botId === "string") {
    const bot = host.store.bot(botId);
    if (bot && !host.listedBotVisible(bot, viewerId)) return false;
  }
  return true;

}
  return memberSeesFrame;
}
