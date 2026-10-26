/** A thread another bot opened on this one (pair, work or an agent ask): a
 * bot-to-bot conversation, never shown to the person (JC's rule): not in the
 * sidebar, typing dots, unread counts or notifications. A bot's own thread
 * (opened by itself, e.g. its incidents thread) is not one. */
export function isInterBotThread(ownerBotId: string | undefined, task: { openedBy?: { botId?: string } }): boolean {
  const opener = task.openedBy?.botId;
  return Boolean(opener) && opener !== ownerBotId;
}

/** A conversation the person never sees in the sidebar: a routine's
 * detached execution, an AI client's hidden conversation (#291), or, with
 * the owning bot's id, a bot-to-bot thread. */
export function taskHiddenFromSidebar(task: { routineRunId?: string; routineResults?: true; hidden?: true; openedBy?: { botId?: string } }, ownerBotId?: string): boolean {
  // an automatic routine results thread (2026-10-22): no row, no dot; the
  // thread list still has it with threads shown
  return Boolean(task.routineRunId) || task.routineResults === true || task.hidden === true || (ownerBotId !== undefined && isInterBotThread(ownerBotId, task));
}

/** Sidebar dot, dock badge, and notifying pose.
 * A hidden routine execution is not a conversation, so it never counts, and
 * neither does an AI client's hidden conversation.
 * An archived thread's reply never counts: it stays put away.
 * Bots saved before task lists still use their own unread flag. */
export function botShowsUnread(bot: {
  id?: string;
  unread?: boolean;
  tasks?: ReadonlyArray<{ unread?: boolean; routineRunId?: string; routineResults?: true; hidden?: true; openedBy?: { botId?: string }; archivedAt?: number }> | null;
}): boolean {
  if (!bot.tasks?.length) return Boolean(bot.unread);
  return bot.tasks.some((task) => Boolean(task.unread) && task.archivedAt === undefined && !taskHiddenFromSidebar(task, bot.id ?? ""));
}

/** One sidebar row's place in the list, for the "more unread" pills. */
export interface UnreadRowBox {
  top: number;
  bottom: number;
  unread: boolean;
}

/** Unread rows scrolled out of the list's window: the count above and below,
 * and the row to jump to for each (the nearest one). A row cut by the edge
 * counts as seen once at least half of it shows. Rows are in list order. */
export function offscreenUnread(
  rows: readonly UnreadRowBox[],
  viewport: { top: number; bottom: number },
): { above: number; below: number; nearestAbove: number | null; nearestBelow: number | null } {
  let above = 0;
  let below = 0;
  let nearestAbove: number | null = null;
  let nearestBelow: number | null = null;
  rows.forEach((row, index) => {
    if (!row.unread) return;
    const middle = (row.top + row.bottom) / 2;
    if (middle < viewport.top) {
      above += 1;
      nearestAbove = index;
    } else if (middle > viewport.bottom) {
      below += 1;
      if (nearestBelow === null) nearestBelow = index;
    }
  });
  return { above, below, nearestAbove, nearestBelow };
}

/** Adds or removes one id from a selection, keeping its order. */
export function toggleSelected(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((entry) => entry !== id) : [...selection, id];
}
