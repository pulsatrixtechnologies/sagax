// @ts-nocheck
/** adminAuditRows (#1388). Pure move from server/index.ts. */
import { botChangeRows } from "../activity/admin-activity.ts";
import { parsedBodyOf } from "../harness/http.ts";
export type Host = Record<string, any>;

export function createAdminAuditRows(getHost: () => Host): any {
function adminAuditRows(   plan: AuditPlan,   req: IncomingMessage,   path: string,   before: { bot: Record<string, unknown> | null; botName?: string; hook?: WebhookTrigger; session?: ReturnType<typeof host.sessions.list>[number]; roomFloor?: unknown },   answered: unknown, ) {
  const host = getHost();

  const rows: Array<Omit<AdminActionRow, "at" | "actor">> = [];
  const reply = answered && typeof answered === "object" ? answered as Record<string, unknown> : {};
  const idOf = (value: unknown) => (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined);
  if (plan.botId) {
    rows.push(...botChangeRows({ id: plan.botId, name: host.store.bot(plan.botId)?.name }, before.bot, host.auditBot(plan.botId), host.requestedBotFields(req, path)));
  }
  if (plan.createsBots) {
    const created = [idOf(reply.bot), ...(Array.isArray(reply.bots) ? reply.bots.map(idOf) : [])].filter((id): id is string => Boolean(id));
    for (const id of new Set(created)) {
      const fields = host.auditBot(id);
      if (fields) rows.push({ category: "bot", action: "bot.create", target: { kind: "bot", id, name: host.store.bot(id)!.name }, after: fields });
    }
  }
  if (plan.deletesBot && before.bot && !host.store.bot(plan.deletesBot)) {
    rows.push({ category: "bot", action: "bot.delete", target: { kind: "bot", id: plan.deletesBot, ...(before.botName ? { name: before.botName } : {}) }, before: before.bot });
  }
  const hookTarget = (hook: WebhookTrigger) => ({ kind: "webhook", id: hook.id, name: hook.name });
  if (plan.createsWebhook) {
    const hook = host.auditHook(idOf(reply.webhook));
    if (hook) rows.push({ category: "webhook", action: "webhook.create", target: hookTarget(hook), after: host.hookFields(hook) });
  }
  if (plan.webhookId && before.hook) {
    const after = host.auditHook(plan.webhookId);
    if (!after) rows.push({ category: "webhook", action: "webhook.delete", target: hookTarget(before.hook), before: host.hookFields(before.hook) });
    else if (path.endsWith("/rotate")) rows.push({ category: "webhook", action: "webhook.rotate-secret", target: hookTarget(after) });
    else {
      const body = parsedBodyOf(req);
      const named = body && typeof body === "object" ? Object.keys(body) : [];
      const changed = host.WEBHOOK_AUDIT_FIELDS.filter((field) => named.includes(field) &&
        JSON.stringify(host.hookFields(before.hook!, [field])) !== JSON.stringify(host.hookFields(after, [field])));
      if (changed.length) {
        rows.push({ category: "webhook", action: "webhook.update", target: hookTarget(after), changed: [...changed], before: host.hookFields(before.hook, changed), after: host.hookFields(after, changed) });
      }
      // The value never goes in the row; that it changed always does.
      if (named.includes("signingSecret") && after.signingSecretSet) {
        rows.push({ category: "webhook", action: "webhook.set-signing-secret", target: hookTarget(after) });
      }
      if (named.includes("pollerCredentials")) {
        rows.push({ category: "webhook", action: "webhook.set-poller-credential", target: hookTarget(after) });
      }
    }
  }
  if (before.session && !host.sessions.list().some((session) => session.id === before.session!.id)) {
    const session = before.session;
    rows.push({ category: "session", action: "session.revoke", target: { kind: "session", id: session.id, name: session.email ?? session.label },
      before: { label: session.label, ...(session.email ? { email: session.email } : {}), scopes: session.scopes } });
  }
  if (plan.pairing) {
    const pairing = host.sessions.openPairings().find((candidate) => candidate.id === reply.id);
    if (pairing) rows.push({ category: "session", action: "pairing.create", target: { kind: "pairing", name: pairing.label }, after: { label: pairing.label, scopes: pairing.scopes } });
  }
  if (plan.engineAction) rows.push({ category: "engine", action: `engine.${plan.engineAction.action}`, target: { kind: "engine", id: plan.engineAction.id } });
  const roomBody = plan.roomId ? parsedBodyOf(req) : undefined;
  const room = plan.roomId ? host.store.group(plan.roomId) : undefined;
  if (room && roomBody && typeof roomBody === "object" && (roomBody as { resetAudience?: unknown }).resetAudience === true) {
    rows.push({ category: "visibility", action: "room.audience-reset", target: { kind: "room", id: room.id, name: room.name },
      changed: ["audienceFloor"], before: { audienceFloor: before.roomFloor ?? "everyone" }, after: { audienceFloor: room.audienceFloor ?? "everyone" } });
  }
  return rows;

}
  return adminAuditRows;
}
