// @ts-nocheck
/** temporaryAgentSetting (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTemporaryAgentSetting(getHost: () => Host): any {
async function temporaryAgentSetting(input: { args: Record<string, unknown>; botId: string; threadId: string; generation: string }) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction, archiveMark, mayDeleteTemporary, peerInScope, primaryCovers } = host;
  const { args } = input;
  const key = args.key;
  if ((key !== "bot.hidden" && key !== "bot.delete") || (args.action !== "get" && args.action !== "set")) return null;
  if (key === "bot.delete" && args.action === "get") return null;
  const id = typeof args.target === "string" ? args.target.trim() : "";
  const bot = id ? host.store.bot(id) : undefined;
  const temporary = bot?.temporary;
  if (!bot) return null;
  const caller = host.store.bot(input.botId);
  if (!temporary) {
    // an ordinary bot: archiving it twice (or restoring a shown one) says
    // so instead of rewriting it; everything else is the screen's path
    if (key !== "bot.hidden" || args.action !== "set" || !caller || (caller.id !== bot.id && !(primaryCovers(caller, bot) && peerInScope(caller, bot)))) return null;
    const want = args.value !== false;
    if ((bot.hidden === true) !== want) return null;
    return { status: 200, body: { text: want ? `@${bot.name} is already archived. Nothing changed.` : `@${bot.name} is not archived. Nothing changed.` } };
  }
  const reply = (status: number, text: string): BotActResult => status >= 400 ? { status, body: { error: text } } : { status, body: { text } };
  const ownerKey = caller ? host.effectiveBotOwner(caller).trim().toLowerCase() : "";
  const creator = Boolean(caller && mayDeleteTemporary(temporary, { kind: "bot", botId: caller.id, ownerPrincipalId: ownerKey || null }));
  const covered = Boolean(caller && caller.id !== bot.id && primaryCovers(caller, bot) && peerInScope(caller, bot));
  if (!creator && !covered && caller?.id !== bot.id) return reply(404, "No such bot for this person.");
  const archived = Boolean(temporary.archived);
  if (args.action === "get") return reply(200, JSON.stringify({ key, value: archived || bot.hidden === true, temporaryAgent: true }));
  const archive = args.value !== false;
  if (key === "bot.delete" && !archive) return reply(200, `@${bot.name}: nothing to delete. Nothing changed.`);
  if (key === "bot.hidden" && !archive) {
    return archived
      ? reply(409, `@${bot.name} is a temporary agent and was archived; it cannot be restored. Create a new one with create_agent if the person still needs it.`)
      : reply(200, `@${bot.name} is not archived. Nothing changed.`);
  }
  if (archived) return reply(200, `@${bot.name} (temporary agent) is already archived. Nothing changed; it no longer appears in lists and is purged on its own.`);
  // a Primary Bot archives another's temporary agent on the person's words,
  // as archive_bot does for any bot (askedBotChange); its creator, at once
  if (!creator) {
    const quote = typeof args.quote === "string" ? args.quote : "";
    const gate = quote ? host.primaryTurnGate(input.botId, input.threadId, input.generation, "settings") : null;
    const proved = gate && !("error" in gate) && host.checkPersonQuote({ quote, message: gate.message.text, intent: "setting" }).ok
      ? host.askedBotChange({ key, family: "bot", value: true, quote, names: [bot.name], speakingBot: false, message: gate.message.text })
      : "pass quote, the person's own words asking to archive or delete this agent";
    if (proved !== true) return reply(403, `Not archived: ${proved}.`);
  }
  if (bot.busy || host.store.tasks(bot.id).some((task) => host.threadBusy(bot.id, task.threadId))) {
    for (const task of host.store.tasks(bot.id)) if (host.threadBusy(bot.id, task.threadId)) await host.interruptDirectThread(bot.id, task.threadId).catch(() => undefined);
  }
  const mark = archiveMark({ kind: "bot", botId: caller!.id }, "deleted", Date.now());
  host.store.setBotTemporary(bot.id, { ...temporary, archived: mark });
  appendAdminAction(DATA_DIR, { category: "setting", action: "setting.change", target: { kind: "bot", id: bot.id, name: bot.name }, changed: [key],
    after: { [key]: true, temporaryAgent: true, bot: caller!.id, purgeAt: mark.purgeAt }, actor: { kind: "loopback" } });
  return reply(200, `Done: @${bot.name} (temporary agent) is archived. It no longer appears in lists or takes work; it is purged after its retention.`);

}
  return temporaryAgentSetting;
}
