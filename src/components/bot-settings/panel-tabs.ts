// The bot panel's tabs, as the reference design draws them (#2125): two pills,
// Activity and Library. Activity holds what the bot does (upcoming routines,
// suggestions, its computer, voice chat, then its coding activity, live
// work, remote sessions, a recent refusal and provenance, each folded when
// empty); Library holds its files. The computer view is no tab any more:
// Activity > Computer opens it, and every "open the computer" link still
// lands on it. What the bot receives is listed in Plugins > Installed for
// that bot, never as a panel tab (JC, 2026-11-01). No Roles tab either
// (JC, 2026-11-05): a recent refusal is one row in Activity > Permissions
// (RolePermissionsSection), the roles graph behind its disclosure.
// Every other section lives in the persona editor (lib/persona-sections).

export const PANEL_TABS = ["activity", "library"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/** The tabs the panel shows: both, in every mode. Simple and a bot that
 * works nowhere lose only the Computer card. A remote session's screen is
 * in the chat (RemoteScreenCard), never in this panel. */
export function visiblePanelTabs(_input: { advanced: boolean; computerOff: boolean }): PanelTab[] {
  return [...PANEL_TABS];
}

/** Whether Activity shows the Computer card (and the computer view opens in
 * the panel): Advanced, and a bot that works somewhere. */
export function showsComputer(input: { advanced: boolean; computerOff: boolean }): boolean {
  return input.advanced && !input.computerOff;
}
