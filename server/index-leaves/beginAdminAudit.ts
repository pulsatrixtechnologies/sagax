// @ts-nocheck
/** beginAdminAudit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBeginAdminAudit(getHost: () => Host): any {
function beginAdminAudit(req: IncomingMessage, res: ServerResponse, method: string, path: string, auth: RequestAuth) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  const plan = host.DESKTOP_MANAGED ? null : host.adminAuditPlan(method, path, { requiredScope, lendingEnabled: host.lendingEnabled });
  const actor = plan ? host.adminActorFor(auth, req) : null;
  // Whether several people share the workspace as the request begins: a
  // change that ends sharing (the last chat-only phone signed out) is kept.
  const sharedAtStart = plan ? host.adminActivityRecording() : false;
  const scope: AdminActorScope = plan?.config && actor ? { actor, sharedAtStart } : null;
  if (!plan || !actor) return scope;
  const before = {
    bot: host.auditBot(plan.botId ?? plan.deletesBot),
    botName: host.store.bot(plan.botId ?? plan.deletesBot ?? "")?.name,
    hook: host.auditHook(plan.webhookId),
    session: plan.sessionId ? host.sessions.list().find((session) => session.id === plan.sessionId) : undefined,
    roomFloor: plan.roomId ? host.store.group(plan.roomId)?.audienceFloor ?? "everyone" : undefined
  };
  let answered: unknown;
  if (plan.createsBots || plan.createsWebhook || plan.pairing) onJsonBody(res, (body) => (answered = body));
  res.once("finish", () => {
    if (res.statusCode >= 400 || (!sharedAtStart && !host.adminActivityRecording())) return;
    try {
      for (const row of host.adminAuditRows(plan, req, path, before, answered)) appendAdminAction(DATA_DIR, { ...row, actor });
    } catch (error) {
      console.warn(`admin activity: could not record ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return scope;

}
  return beginAdminAudit;
}
