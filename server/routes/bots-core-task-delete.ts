/**
 * DELETE /api/bots/:id/tasks/:threadId and POST .../title (#1388 B1).
 * Own match scratch. The thread path is matched before the /title path.
 * Never imports server/index.ts.
 */
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";
import { titleConversationExcerpt } from "../threads/thread-title.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreTaskDeleteRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const {
      store,
      wireTask,
      viewerForApproval,
      routines,
      projectBotTranscript,
      publicBot,
      threadBusy,
      phoneSecretSubmissions,
      stagedSkillCleanupsForThread,
      coordinator,
      cancelTeamSetupResumesForThread,
      confidentialThreadAttachments,
      threadEngineKeys,
      wipeConfidentialThread,
      clearTurnDigestState,
      revokeInternalCapabilitiesForThread,
      handoffs,
      routableSteers,
      directTurnGenerationByThread,
      settleDirectFollowup,
      rejectDeletedThreadSkillStages,
      threadTitleGate,
      titleRegenerations,
      generateThreadTitle,
    } = deps;
    const THREAD_DELETED = deps.threadDeletedMessage;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot || !store.taskByThread(bot.id, m[2])) {
        return json(res, 404, { error: "no such task" });
      }
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      if (phoneSecretSubmissions.hasThread(m[2])) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      if (threadBusy(bot.id, m[2]) || routines.isActiveThread(m[2])) {
        return json(res, 409, { error: "this task is running — stop it first" });
      }
      const stagedSkillCleanups = stagedSkillCleanupsForThread(m[2]);
      coordinator.cancelDirect(m[2], THREAD_DELETED);
      cancelTeamSetupResumesForThread(m[2]);
      // A confidential thread leaves nothing behind (server/threads/confidential-threads.ts):
      // its files are listed before its messages go.
      const confidentialFiles = store.isConfidentialThread(m[2]) ? confidentialThreadAttachments(m[1], m[2]) : null;
      // and the keys of its engine transcripts, before its record and logs go
      const confidentialEngineKeys = confidentialFiles ? threadEngineKeys(m[1], m[2]) : [];
      const updated = store.deleteTask(m[1], m[2]);
      if (!updated) return json(res, 404, { error: "no such task" });
      if (confidentialFiles) wipeConfidentialThread(m[1], m[2], confidentialFiles, confidentialEngineKeys);
      clearTurnDigestState(m[2]);
      revokeInternalCapabilitiesForThread(m[2]);
      handoffs.forget(m[2]);
      routableSteers.forgetThread(m[2]);
      settleDirectFollowup(directTurnGenerationByThread.get(m[2]));
      rejectDeletedThreadSkillStages(stagedSkillCleanups);
      return json(res, 200, { bot: projectBotTranscript(publicBot(updated), viewerForApproval(auth)) });
    }
    // Regenerate title (#1858): name the thread again from its conversation
    // as it is now. The person asked, so the result replaces any title, but
    // only the one this started from: a rename that lands while the one-shot
    // runs wins, and the late result is dropped.
    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)\/title$/);
    if (m && method === "POST") {
      const current = store.projectBotForTask(m[1], m[2]);
      if (!current) return json(res, 404, { error: "no such task" });
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      const gate = threadTitleGate(current, sessionPrincipal(auth));
      if (!gate.ok) return json(res, 409, { error: gate.refusal });
      if (titleRegenerations.has(m[2])) return json(res, 409, { error: "a new title is already being generated for this thread" });
      const excerpt = titleConversationExcerpt(store.messagesTail(m[2], 200).messages);
      if (!excerpt) return json(res, 409, { error: "this thread has no messages to take a title from yet" });
      const startedFrom = store.taskByThread(m[1], m[2])!.title;
      titleRegenerations.add(m[2]);
      try {
        const title = await generateThreadTitle(gate.instance, excerpt, "conversation");
        if (!title) return json(res, 502, { error: "couldn't generate a title — try again, or rename the thread" });
        const task = store.retitleTask(m[1], m[2], startedFrom, title) ?? store.taskByThread(m[1], m[2]);
        if (!task) return json(res, 404, { error: "no such task" });
        return json(res, 200, { task: wireTask(task, store.bot(m[1])!.modelSelection) });
      } finally {
        titleRegenerations.delete(m[2]);
      }
    }
    return PASS;
  };
}
