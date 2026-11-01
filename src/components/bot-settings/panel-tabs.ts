// The bot panel's tabs. Details holds what the bot is doing (its coding
// activity), its routines and who it is (name and label are edited in place
// at the panel's top; the description stays on the bot and is edited in the
// persona editor); Library holds its files; Computer is the computer view.
// What the bot receives is listed in Plugins > Installed for that bot, never
// as a panel tab (JC, 2026-11-01).
// Every other section lives in the persona editor (lib/persona-sections).
import { simpleHidesPanelTab } from "@/lib/interface-visibility";

export const PANEL_TABS = ["details", "library", "computer"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/** The tabs the panel shows. Simple hides Computer, and a bot that works
 * nowhere has no computer of its own. A remote session's screen is in the
 * chat (RemoteScreenCard), never in this tab. */
export function visiblePanelTabs(input: { advanced: boolean; computerOff: boolean }): PanelTab[] {
  return PANEL_TABS.filter((id) => (input.advanced || !simpleHidesPanelTab(id)) && (id !== "computer" || !input.computerOff));
}
