// An AI client's hidden conversations (#291).
//
// When an AI client attached to Perspicax (the `sagax_send` MCP tool, the
// member API in ./org-member-routes.ts) works with a bot for a person, it
// works in a hidden thread, the way the reference design keeps its subagents'
// conversations out of the chat: the person's sidebar, previews, typing
// dots, unread counts and notifications never show it, and it is still
// reached from the bot's Activity panel or its thread link.
//
// Before this rule, `newThread: true` opened an ordinary thread and made it
// the bot's selected one, so a client's tests lit the person's sidebar and
// kept unread dots nobody could clear. `planHiddenAgentThreads` finds those
// threads once, from the admin activity rows the member API wrote
// (`client.message` with `newThread: true`), so the server can hide them.
import type { AdminActionRow } from "../admin-activity.ts";

export interface HiddenAgentThread {
  botId: string;
  threadId: string;
}

/** The threads an AI client opened with `newThread` that are still shown.
 * `taskOf` answers the stored thread (undefined when it is gone). Each
 * thread at most once. */
export function planHiddenAgentThreads(
  rows: readonly AdminActionRow[],
  taskOf: (botId: string, threadId: string) => { hidden?: true } | undefined,
): HiddenAgentThread[] {
  const seen = new Set<string>();
  const out: HiddenAgentThread[] = [];
  for (const row of rows) {
    if (row.category !== "client" || row.action !== "client.message") continue;
    if (row.actor?.kind !== "person" || row.actor.via !== "perspicax-mcp") continue;
    const after = row.after ?? {};
    if (after.newThread !== true) continue;
    const botId = row.target?.kind === "bot" ? row.target.id : undefined;
    const threadId = typeof after.threadId === "string" ? after.threadId : undefined;
    if (!botId || !threadId || seen.has(threadId)) continue;
    seen.add(threadId);
    const task = taskOf(botId, threadId);
    if (!task || task.hidden === true) continue;
    out.push({ botId, threadId });
  }
  return out;
}

/** One sweep (marker `agent-threads-hidden.v2`, 2026-10-12): what #291's
 * first sweep missed. Threads another bot opened on this one (openedBy names
 * a different bot) that are still stored shown, except the bot's own current
 * thread; and the threads the operator lists in `agent-threads-hide.list`
 * (one `botId threadId` per line): the AI-client fan-out of 2026-10-11,
 * started before #291 through the member API without `newThread`, so no
 * audit row marked it and it never got an owner. */
export function planHiddenBotThreads(
  bots: readonly { id: string; threadId?: string; tasks: readonly { threadId: string; hidden?: true; openedBy?: { botId?: string } }[] }[],
  listed: readonly HiddenAgentThread[] = [],
): HiddenAgentThread[] {
  const out: HiddenAgentThread[] = [];
  const seen = new Set<string>();
  const want = new Set(listed.map((entry) => `${entry.botId} ${entry.threadId}`));
  for (const bot of bots) {
    for (const task of bot.tasks) {
      if (task.hidden === true || seen.has(task.threadId)) continue;
      const interBot = Boolean(task.openedBy?.botId && task.openedBy.botId !== bot.id && task.threadId !== bot.threadId);
      if (!interBot && !want.has(`${bot.id} ${task.threadId}`)) continue;
      seen.add(task.threadId);
      out.push({ botId: bot.id, threadId: task.threadId });
    }
  }
  return out;
}

/** `botId threadId` lines; blank lines and `#` comments skipped. */
export function parseHideList(text: string): HiddenAgentThread[] {
  return text.split("\n").flatMap((line) => {
    const [botId, threadId] = line.replace(/#.*/, "").trim().split(/\s+/);
    return botId && threadId ? [{ botId, threadId }] : [];
  });
}
