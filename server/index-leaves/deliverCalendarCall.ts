// @ts-nocheck
/** deliverCalendarCall (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDeliverCalendarCall(getHost: () => Host): any {
function deliverCalendarCall(call: CalendarCall, scheduledFor: number) {
  const host = getHost();

  // A one-bot calendar entry remains a reminder that opens that bot's chat.
  // Multi-bot entries are rooms and begin with the shared event prompt.
  // 2026-10-30: the one bot may act on it (its proactive mode).
  if (call.botIds.length < 2) {
    const botId = call.botIds[0];
    if (botId) {
      host.offerProactive({
        botId, source: "calendar", key: `calendar:${call.id}:${scheduledFor}`,
        label: "Calendar entry due", summary: call.name,
        detail: [`Entry: ${call.name}`, `Starts: ${new Date(scheduledFor).toISOString()}`, `Length: ${call.durationMinutes} minutes`, call.description.trim() ? `Description: ${call.description.trim()}` : ""].filter(Boolean).join("\n"),
        hops: 0
      });
    }
    return;
  }
  let group: GroupRecord;
  try {
    group = host.ensureCalendarCallRoom(call);
  } catch (error) {
    console.warn(`calendar call "${call.name}" did not start: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const text = [
    `@everyone ${call.description.trim() || call.name}`,
    ...call.attachments.map((attachment) =>
      `<${attachment.kind === "image" ? "attached-image" : "attached-file"} path="${escapeAttribute(attachment.path)}" name="${escapeAttribute(attachment.name)}" />`
    ),
  ].join("\n\n");
  const sendId = `calendar_${call.id}_${scheduledFor}`;
  const threadIds = new Set([group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]);
  const messages = [...threadIds].flatMap((threadId) => host.store.messagesFor(threadId));
  if (messages.some((message) => message.sendId === sendId)) return;
  host.startGroupTurn(group.id, text, undefined, sendId);

}
  return deliverCalendarCall;
}
