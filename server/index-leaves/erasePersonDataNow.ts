// @ts-nocheck
/** erasePersonDataNow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createErasePersonDataNow(getHost: () => Host): any {
async function erasePersonDataNow(principalId: string): Promise<{ bots: number; threads: number }> {
  const host = getHost();
  const { ATTACHMENTS_DIR, TASK_WORKSPACES_DIR, dataEngine, store } = host;
  const person = principalId.trim().toLowerCase();
  let bots = 0;
  let threads = 0;
  const confidentialThreads: Array<{ botId: string; threadId: string }> = [];
  const confidentialEngines: Array<{ threadId: string; keys: string[] }> = [];
  const ordinaryThreads: Array<{ botId: string; threadId: string; attachments: string[] }> = [];
  for (const bot of host.store.bots.slice()) { // a copy: deleting changes the list
    if (host.recordedBotOwner(bot) === person) {
      if ((await host.deleteBotWithLifecycle(bot.id)).status === 200) bots++;
      continue;
    }
    for (const task of host.store.tasks(bot.id)) {
      if (task.ownerPrincipalId !== person) continue;
      // Loi 25 (2026-10-17): a confidential thread leaves nothing behind,
      // as when its owner deletes it (its folder, files and Data)
      const confidential = host.store.isConfidentialThread(task.threadId);
      // the stored files its messages point at, read before they go
      const files = host.confidentialThreadAttachments(bot.id, task.threadId);
      const engineKeys = confidential ? host.threadEngineKeys(bot.id, task.threadId) : [];
      if (!host.store.deleteTask(bot.id, task.threadId)) continue;
      threads++;
      if (confidential) {
        host.wipeConfidentialThread(bot.id, task.threadId, files, []);
        confidentialEngines.push({ threadId: task.threadId, keys: engineKeys });
        confidentialThreads.push({ botId: bot.id, threadId: task.threadId });
      } else {
        ordinaryThreads.push({ botId: bot.id, threadId: task.threadId, attachments: files });
      }
    }
  }
  // their confidential threads' engine transcripts, in one pass
  host.purgeDeletedThreadEngines(confidentialEngines, "person erased");
  // Loi 25 (2026-10-17, follow-up of #696): their ordinary threads' files
  // too (each thread's own folder, its tool results, the stored files no
  // thread that stays points at), never a folder another thread works in
  // (person-thread-erase.ts)
  if (ordinaryThreads.length) {
    for (const name of ordinaryThreads.flatMap((thread) => thread.attachments)) host.attachmentThreads.delete(name);
    const plan = host.planPersonThreadErasure({
      threads: ordinaryThreads, tasksRoot: TASK_WORKSPACES_DIR, attachmentsDir: ATTACHMENTS_DIR, toolResultsDir: host.TOOL_RESULTS_DIR,
      keptFolders: host.store.bots.flatMap((bot) => [bot.cwd, ...store.tasks(bot.id).map((task) => task.cwd)]).filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0),
      referencedElsewhere: (name) => host.threadsReferencing(name).length > 0
    });
    host.erasePersonThreadFiles(plan, ATTACHMENTS_DIR);
    for (const { threadId } of ordinaryThreads) host.memoryUpkeep.dropThread(threadId);
  }
  // Loi 25 (2026-10-17, re-review of #689): their own Data on every other
  // bot and their confidential threads' Data (data/erase.ts), awaited, so
  // the answer means it is gone
  await host.erasePersonData({
    principalId: person, botIds: host.store.bots.map((bot) => bot.id), confidentialThreads, engine: dataEngine, sheets: host.dataSheets
  });
  await host.userSandbox?.removeNow(principalId).catch((error: unknown) => console.warn(`account deletion: server environment not removed: ${String(error)}`));
  host.userPreferenceStore.remove(principalId);
  host.moderationStore.forgetPerson(principalId);
  try { host.credentialVault.drop(person); } catch (error) { console.warn(`account deletion: credential vault not removed: ${String(error)}`); }
  // their content keys: whatever is still sealed under them never opens again
  try { host.eraseContentOwner(person); } catch (error) { console.warn(`account deletion: content keys not destroyed: ${error instanceof Error ? error.message : "unknown"}`); }
  host.presence.forget(principalId);
  host.viewerBotOverrideStore.remove(principalId);
  host.achievementStore.remove(principalId);
  host.pushDevices.removePerson(principalId);
  host.androidPushDevices.removePerson(principalId);
  host.pushActivities.removePerson(principalId);
  host.reachMeSettings.removePerson(principalId);
  host.botSettings.forgetPerson(principalId);
  // Their Perspicax sign-in on this server: grants and routine delegation,
  // cached keys and photo, sessions and pairing codes (the back-channel
  // logout's effect), then their name, address and photo on the principal
  // (Loi 25; the record stays, emptied, see PrincipalRegistry.erase).
  const principal = host.principals.byId(person);
  if (principal?.subject) {
    const { iss, sub } = principal.subject;
    host.perspicaxDirectory?.forgetSubject(sub);
    host.perspicaxDirectory?.forgetAvatar(sub);
    host.perspicaxMcp?.forgetSubject(iss, sub);
    host.routineConsents?.endForSubject(iss, sub);
    host.idpSessions?.backchannelLogout({ iss, sub });
  }
  for (const session of host.sessions.list()) if (session.principalId === principalId) host.sessions.revoke(session.id);
  host.principals.erase(person);
  return { bots, threads };

}
  return erasePersonDataNow;
}
