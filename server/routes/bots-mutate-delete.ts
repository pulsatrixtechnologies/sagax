// DELETE /api/bots/:id and guarded request interrupt (#1383).
// Never imports server/index.ts.
import type { BotsMutateEnv } from "./bots-mutate-helpers.ts";

export async function handleBotDeleteAndRequests(env: BotsMutateEnv): Promise<boolean> {
  if (await handleBotDelete(env)) return true;
  if (await handleBotGuardedRequest(env)) return true;
  return false;
}

async function handleBotDelete(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)$/);
  if (m && env.method === "DELETE") {
    if (env.auth.kind === "session" && !env.auth.scopes.includes("admin")) {
      const target = env.store.bot(m[1]);
      if (!target) {
        env.json(env.res, 404, { error: "no such bot" });
        return true;
      }
      if (!env.memberOwnsBot(env.auth, target)) {
        env.json(env.res, 403, { error: "forbidden: only the bot owner or an admin can delete it", code: "bot_delete_owner_only" });
        return true;
      }
    }
    const result = await env.deleteBotWithLifecycle(m[1]);
    env.json(env.res, result.status, result.body);
    return true;
  }
  return false;
}

async function handleBotGuardedRequest(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/requests\/([A-Za-z0-9_-]{16,80})(\/interrupt)?$/);
  if (m && ((env.method === "GET" && !m[3]) || (env.method === "POST" && m[3]))) {
    const body = env.method === "GET" ? { threadId: env.url.searchParams.get("threadId") } : await env.readBody(env.req);
    const id = env.z.string().regex(/^[\w-]+$/);
    const parsed = (env.method === "GET" ? env.z.object({ threadId: id }).strict() : env.z.object({
      threadId: id, messageId: id, expectedActiveLeafId: id.nullable(),
      expectedTurnId: env.z.string().min(1).max(200).nullable(), expectedExecutionId: id.nullable()
    }).strict()).safeParse(body);
    if (!parsed.success) {
      env.json(env.res, 400, { error: "A pinned thread and exact request snapshot are required" });
      return true;
    }
    const threadId = parsed.data.threadId;
    const requestBot = env.store.bot(m[1]);
    if (requestBot) env.routeThreadId(requestBot, threadId, env.method === "GET" ? "thread.read" : "thread.post");
    const snapshot = env.guardedRequestSnapshot(m[1], threadId, m[2]);
    env.res.setHeader("cache-control", "private, no-store");
    if (env.method === "GET") {
      env.json(env.res, 200, { ...snapshot, messages: env.projectMessages(threadId, snapshot.messages, env.viewerForApproval(env.auth)) });
      return true;
    }
    env.assertRequestTarget(snapshot, body);
    const owner = env.directRequestOwners.get(threadId);
    if (snapshot.phase === "untracked" || !owner || owner.messageId !== snapshot.messageId) {
      env.json(env.res, 409, { error: "This continuation cannot be safely stopped from this interface", code: "guarded_request_untracked" });
      return true;
    }
    if (snapshot.phase === "settled") throw env.requestConflict("This request has already settled");
    // No await between comparing the exact lease and revoking it. Retrying
    // this body cannot bind to a later setup claim with a null provider id.
    owner.stopped = true;
    env.handoffs.stoppedByPerson(threadId);
    await env.interruptDirectThread(m[1], threadId);
    env.json(env.res, 200, { ok: true, outcome: "stopped" });
    return true;
  }
  return false;
}
