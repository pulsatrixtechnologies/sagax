/**
 * GET /api/bots (#1388 B1). Literal path, ahead of every /api/bots/:id pattern.
 * Never imports server/index.ts.
 */
import { memberBot, memberGroup } from "../bots/bot-visibility.ts";
import { peopleDmForViewer } from "../people/people-dms.ts";
import { withoutForeignTeamFields } from "../threads/thread-privacy.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreListRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json }) => {
    const {
      store,
      refreshGroupUsage,
      pageSize,
      listedBotVisible,
      publicBotQueuedMessages,
      threadsWithActiveCoordination,
      privateThreads,
      ensureViewerThread,
      wireBot,
      viewerBotActivity,
      listedTasks,
      threadsShownTo,
      wireTask,
      messagePage,
      viewerForApproval,
      threadKeyedForViewer,
      orgVisibleSections,
      groupVisible,
      peopleDmProjection,
      groupReaderId,
      knowsPersonThreads,
      publicGroupState,
      botComputerControlSnapshot,
    } = deps;
    const visible = deps.visibleFor(auth, path);
    const viewerId = deps.viewerId(auth);

    if (method === "GET" && path === "/api/bots") {
      try { refreshGroupUsage(); } catch { /* accounting must not block a snapshot */ }
      const limit = pageSize(url.searchParams.get("messages"));
      if (limit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // wireBot(), not publicBot(): this snapshot answers with the page it
      // was asked for, not the default one. tasks stays explicit, as in
      // publicBot(): wireBot() omits the key entirely for a bot record
      // carrying no tasks, where clients expect [].
      // A member on a workspace with a restricted bot gets only what they may
      // see (bot-visibility.ts); for everyone else these filters keep all.
      // Temporary agents (create_agent) are never listed in the app.
      const shownBots = store.bots.filter((bot) => !bot.temporary && visible.bot(bot.id) && listedBotVisible(bot, viewerId));
      const queued = publicBotQueuedMessages();
      const coordinated = threadsWithActiveCoordination();
      // Organization server: each person opens a bot on their own thread
      // (started for them the first time) and lists only their threads.
      const listed = shownBots.map((bot) => {
        const mine = viewerId && privateThreads() ? ensureViewerThread(bot, viewerId) : undefined;
        const record = mine ? store.projectBotForTask(bot.id, mine) ?? bot : bot;
        const wired = withoutForeignTeamFields(wireBot(record), viewerId, typeof bot.ownerUserId === "string" ? bot.ownerUserId : undefined);
        return memberBot({
          ...wired,
          // busy while any of the viewer's threads works, not only the one shown
          ...(viewerId && privateThreads() ? viewerBotActivity(bot, viewerId) : {}),
          tasks: listedTasks(record.threadId, threadsShownTo(bot, store.tasks(bot.id), viewerId)).map((task) => wireTask(task, bot.modelSelection, coordinated)),
          ...messagePage(record.threadId, limit, null, viewerForApproval(auth)),
        }, visible as never);
      });
      return json(res, 200, {
        bots: listed,
        botQueuedMessages: threadKeyedForViewer(visible.everything ? queued : Object.fromEntries(Object.entries(queued).filter(([threadId]) => visible.thread(threadId))), viewerId),
        sections: orgVisibleSections(visible.sections(store.sections), viewerId),
        groups: store.groups.filter((g) => visible.group(g.id) && groupVisible(g, viewerId)).map((g) => {
          // A person conversation opens on the thread this person has open
          // (a client that knows threads), else on its default thread.
          const room = g.peopleDm
            ? peopleDmProjection(g, groupReaderId(auth), knowsPersonThreads(req), { limit, viewer: viewerForApproval(auth) })
            : peopleDmForViewer({ ...publicGroupState(g), ...messagePage(g.threadId, limit, null, viewerForApproval(auth)) }, groupReaderId(auth));
          return visible.everything ? room : memberGroup(room);
        }),
        computerControl: Object.fromEntries(
          shownBots.map((bot) => {
            const snapshot = botComputerControlSnapshot(bot.id);
            return [bot.id, { held: snapshot.held, helpReason: snapshot.helpReason }];
          }),
        ),
      });
    }
    return PASS;
  };
}
