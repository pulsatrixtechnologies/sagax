// Settings > Appearance > Sidebar: "Show Bot threads"
// (`sagax.sidebarBotThreads.v1`, "on" | "off", off by default: the owner,
// 2026-11-23, #5239). Off, the sidebar does not draw the automatic "Bot
// threads" section (the conversations between two bots); on, it shows as
// before. Only the section's display changes: the threads themselves are
// neither deleted nor changed, and a bot's exchange stays reachable from its
// conversation. On also lists the threads bots opened on a bot (a hand-off,
// start_thread) in that bot's normal thread list, sidebar and header picker
// (#5289, shared/background-threads.ts); off keeps them behind "Show
// background". On, a thread the background sweep archived stays a row, and
// those rows fold after six of their own, beside the person's six. The choice follows the person to every device through the
// synced preferences (shared/user-preferences.ts), and a bot changes it
// through the settings tool (appearance.sidebarBotThreads).
import { localChoice } from "./local-choice";

export const sidebarBotThreads = localChoice("sagax.sidebarBotThreads.v1", ["on", "off"] as const, "off");

export function useSidebarBotThreads(): boolean {
  return sidebarBotThreads.use() === "on";
}
