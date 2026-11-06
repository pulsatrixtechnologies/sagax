// @ts-nocheck
/** journalRowsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createJournalRowsFor(getHost: () => Host): any {
function journalRowsFor(viewer: InboxViewer, days: number): { rows: JournalRow[]; truncated: boolean } {
  const host = getHost();
  const { DATA_DIR, EVENTS_DIR, readDecisionRange, store } = host;
  const cacheKey = `${viewer.principalId}|${days}`;
  const cached = host.journalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < host.JOURNAL_CACHE_MS) return cached;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60_000);
  const owned = new Map<string, boolean>();
  // the person's own bots and their own confidential threads, never anyone
  // else's (no multi-person view here: that stays in Perspicax)
  const owns = (botId: string | undefined, threadId: string) => {
    if (!botId) return false;
    const key = `${botId}|${threadId}`;
    let mine = owned.get(key);
    if (mine === undefined) {
      const bot = host.store.bot(botId);
      mine = Boolean(bot) && host.cardAnswererId(bot!, threadId || undefined, undefined) === viewer.principalId;
      owned.set(key, mine);
    }
    return mine;
  };
  const threads: Array<{ botId: string; threadId: string; mtime: number }> = [];
  for (const bot of host.store.bots) {
    if (host.effectiveBotOwner(bot) !== viewer.principalId) continue;
    for (const threadId of new Set([bot.threadId, ...store.tasks(bot.id).map((task) => task.threadId)])) {
      if (!threadId) continue;
      try {
        const mtime = statSync(join(EVENTS_DIR, `${threadId}.ndjson`)).mtimeMs;
        if (mtime >= from.getTime()) threads.push({ botId: bot.id, threadId, mtime });
      } catch {
        /* no events yet */
      }
    }
  }
  threads.sort((a, b) => b.mtime - a.mtime);
  const fromIso = from.toISOString();
  const runs = threads.slice(0, host.JOURNAL_THREADS_MAX).map(({ botId, threadId }) => ({
    botId,
    runs: host.readToolRuns(EVENTS_DIR, threadId).filter((run) => run.at >= fromIso)
  }));
  const own = host.customRules.rulesOf(viewer.principalId);
  const built = buildJournal({
    decisions: readDecisionRange(DATA_DIR, { from, to }),
    agentAudit: readAdminActivityRange(DATA_DIR, { from, to }).filter((row) => row.action.startsWith("agents.")),
    runs,
    owns,
    botName: (botId) => host.store.bot(botId)?.name,
    rule: (source, ruleId, botId) => {
      if (source.startsWith("custom-rule") || source === "auto-review") {
        const rule = own.find((row) => row.id === ruleId);
        return rule ? { text: rule.when, behavior: rule.behavior, ...(rule.org ? { org: true } : {}) } : undefined;
      }
      if (source.startsWith("owner-rule")) {
        const rule = host.ownerApprovals.rulesOf(viewer.principalId, botId).find((row) => row.id === ruleId);
        return rule ? { text: rule.description, behavior: rule.behavior } : undefined;
      }
      return undefined;
    },
    answeredBy: (actor) => {
      if (!actor || actor.kind === "loopback") return JOURNAL_SELF;
      if (actor.kind === "worker") return actorLabel(actor);
      if (actor.userId === viewer.principalId) return JOURNAL_SELF;
      return actor.userId ? host.inboxPersonName(actor.userId) : undefined;
    },
    deletedBot: "Deleted bot"
  });
  const kept = { at: Date.now(), ...built };
  host.journalCache.set(cacheKey, kept);
  if (host.journalCache.size > 200) host.journalCache.delete(host.journalCache.keys().next().value!);
  return kept;

}
  return journalRowsFor;
}
