// @ts-nocheck
/** setBotApprovalModeFromConsole (#1388). Pure move from server/index.ts. */
import { approvalModeFor } from "../../shared/approval-mode.ts";
export type Host = Record<string, any>;

export function createSetBotApprovalModeFromConsole(getHost: () => Host): any {
function setBotApprovalModeFromConsole(botId: string, mode: "ask" | "auto", threads: boolean): { before: string; after: string; threadsMoved: string[] } {
  const host = getHost();
  const { MEMBER_AUTO_NOT_ALLOWED } = host;

  const bot = host.store.bot(botId);
  if (!bot) throw new host.ConsoleRefusal(404, "not_found", "No such bot.");
  const before = approvalModeFor(bot);
  if (before === "full" || before === "custom") {
    throw new host.ConsoleRefusal(409, "elevated_level", `This bot is on ${before === "full" ? "Full access" : "Custom"}: only its owner can change that level.`);
  }
  if (!host.supportsApprovalMode(bot.modelSelection, mode)) {
    throw new host.ConsoleRefusal(400, "mode_not_supported", `This bot's engine has no ${mode === "auto" ? "Approve for me" : "Ask"} mode.`);
  }
  if (bot.approvalGrant) throw new host.ConsoleRefusal(409, "busy", "The bot's approval level is still being confirmed.");
  const tasks = threads && mode === "auto" ? host.store.tasks(bot.id) : [];
  // 2026-10-17 (re-review of #688): an admin's console never saves an
  // automatic level on a member's bot, or its threads, while the
  // organization turned them off; refused, never stored.
  if (host.memberAutoRefused(bot, [before, ...tasks.map((task) => task.approvalMode)], mode)) {
    throw new host.ConsoleRefusal(403, MEMBER_AUTO_NOT_ALLOWED.code, MEMBER_AUTO_NOT_ALLOWED.error);
  }
  if (bot.busy || host.threadBusy(bot.id, bot.threadId) || tasks.some((task) => host.threadBusy(bot.id, task.threadId))) {
    throw new host.ConsoleRefusal(409, "busy", "The bot is working: try again when its turn ends.");
  }
  if (before !== mode) host.store.patchBot(bot.id, { approvalMode: mode, autoApprove: mode === "auto" });
  const threadsMoved: string[] = [];
  for (const task of tasks) {
    if (task.threadId === bot.threadId || task.approvalMode !== "ask") continue;
    if (!host.supportsApprovalMode(task.modelSelection ?? bot.modelSelection, "auto")) continue;
    host.store.patchTask(bot.id, task.threadId, { approvalMode: "auto", autoApprove: true });
    threadsMoved.push(task.threadId);
  }
  const updated = host.store.bot(bot.id);
  if (updated && (before !== mode || threadsMoved.length)) host.broadcast({ kind: "bot", bot: host.wireBot(updated) });
  return { before, after: updated ? approvalModeFor(updated) : mode, threadsMoved };

}
  return setBotApprovalModeFromConsole;
}
