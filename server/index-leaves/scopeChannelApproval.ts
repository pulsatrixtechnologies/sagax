// @ts-nocheck
/** scopeChannelApproval (#1388). Pure move from server/index.ts. */
import { approvalAudience, receivesApprovalCard } from "../approvals/approval-audience.ts";
export type Host = Record<string, any>;

export function createScopeChannelApproval(getHost: () => Host): any {
function scopeChannelApproval(
  payload: Record<string, unknown>,
  viewer: ApprovalViewer,
): { action: "same" } | { action: "drop" } | { action: "replace"; payload: Record<string, unknown> } {
  const host = getHost();

  const kind = String(payload.kind ?? "");
  if (kind === "message" || kind === "message.patch") {
    const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
    const message = payload.message;
    if (!threadId || !message || typeof message !== "object") return { action: "same" };
    if (host.privateRowHidden(message, viewer)) return { action: "drop" };
    const toggle = host.routineToggleForApprovalViewer(message, viewer);
    if (toggle === null) return { action: "drop" };
    if (toggle !== message) return { action: "replace", payload: { ...payload, message: toggle } };
    const next = host.scopeApprovalMessage(threadId, message, viewer);
    if (next === message) return { action: "same" };
    return { action: "replace", payload: { ...payload, message: next } };
  }
  if (kind === "group") {
    const group = payload.group;
    if (!group || typeof group !== "object") return { action: "same" };
    const record = group as { threadId?: string; messages?: unknown[] };
    if (!record.threadId || !record.messages) return { action: "same" };
    const messages = host.projectMessages(record.threadId, record.messages, viewer);
    if (messages === record.messages) return { action: "same" };
    return { action: "replace", payload: { ...payload, group: { ...record, messages } } };
  }
  if (kind === "bot") {
    const bot = payload.bot;
    if (!bot || typeof bot !== "object") return { action: "same" };
    const record = bot as { threadId?: string; messages?: unknown[] };
    if (!record.threadId || !record.messages) return { action: "same" };
    const messages = host.projectMessages(record.threadId, record.messages, viewer);
    if (messages === record.messages) return { action: "same" };
    return { action: "replace", payload: { ...payload, bot: { ...record, messages } } };
  }
  if (kind === "notify") {
    const notification = payload.notification;
    if (!notification || typeof notification !== "object") return { action: "same" };
    const note = notification as { kind?: unknown; threadId?: unknown; botId?: unknown; audience?: unknown };
    // A refused turn's notification follows its access card: its person only.
    if (Array.isArray(note.audience)) {
      const viewerId = viewer.userId.toLowerCase();
      return viewerId && note.audience.some((id) => typeof id === "string" && id.toLowerCase() === viewerId) ? { action: "same" } : { action: "drop" };
    }
    if (note.kind !== "approval" && !(note.kind === "question"
      && host.noteCard(note.threadId, (note as { requestId?: unknown }).requestId)?.approvalOrigin)) return { action: "same" };
    const bot = host.approvalBot(note);
    if (!bot) return { action: "drop" };
    const audience = approvalAudience({ ownerUserId: host.cardAnswererId(bot, typeof note.threadId === "string" ? note.threadId : undefined, host.noteCard(note.threadId, (note as { requestId?: unknown }).requestId)), host: host.approvalHostOf(bot) });
    if (receivesApprovalCard(viewer, audience)) return { action: "same" };
    // A team-memory card also reaches the section members who may confirm it.
    // cheap exits first: the card is looked up only for a viewer who could be a member
    if (!viewer.userId || !host.teamMemoryShared()) return { action: "drop" };
    return host.teamMemoryMemberMayAnswer(String(note.threadId ?? ""), host.noteCard(note.threadId, (note as { requestId?: unknown }).requestId), viewer.userId, bot.id) ? { action: "same" } : { action: "drop" };
  }
  if (kind === "runtime") {
    const event = payload.event;
    if (!event || typeof event !== "object") return { action: "same" };
    const row = event as { type?: unknown; threadId?: unknown; requestType?: unknown; botId?: unknown; requestId?: unknown; tool?: unknown; mcpTool?: unknown };
    if (row.type !== "request.opened" || row.requestType !== "permission") return { action: "same" };
    const bot = host.approvalBot(row);
    if (!bot) return { action: "drop" };
    // The event is broadcast before its card exists: judge the speaker's own
    // destination from the turn itself (destinationOfCall), as the card will.
    const threadId = typeof row.threadId === "string" ? row.threadId : undefined;
    const tool = typeof row.mcpTool === "string" ? row.mcpTool : typeof row.tool === "string" ? row.tool : undefined;
    const destination = threadId ? host.destinationOfCall(bot, threadId, tool, host.cloudGuestDriven(threadId)) : null;
    const answerer = destination && !destination.byOwner ? destination.person : host.cardAnswererId(bot, threadId, host.noteCard(row.threadId, row.requestId));
    const audience = approvalAudience({ ownerUserId: answerer, host: host.approvalHostOf(bot) });
    return receivesApprovalCard(viewer, audience) ? { action: "same" } : { action: "drop" };
  }
  return { action: "same" };

}
  return scopeChannelApproval;
}
