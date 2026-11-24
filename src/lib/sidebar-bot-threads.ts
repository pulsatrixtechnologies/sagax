// Settings > Appearance > Sidebar: "Show Bot threads"
// (`sagax.sidebarBotThreads.v1`, "on" | "off", off by default: the owner,
// 2026-11-23, #5239). Off, the sidebar does not draw the automatic "Bot
// threads" section (the conversations between two bots); on, it shows as
// before. Only the section's display changes: the threads themselves are
// neither deleted nor changed, and a bot's exchange stays reachable from its
// conversation. The choice follows the person to every device through the
// synced preferences (shared/user-preferences.ts), and a bot changes it
// through the settings tool (appearance.sidebarBotThreads).
import { localChoice } from "./local-choice";

export const sidebarBotThreads = localChoice("sagax.sidebarBotThreads.v1", ["on", "off"] as const, "off");

export function useSidebarBotThreads(): boolean {
  return sidebarBotThreads.use() === "on";
}
