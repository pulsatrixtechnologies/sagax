// Surface and modal cases of reduceUi (#1383 function-size split).
import type { Action, AppState, ProfilePanelSnapshot } from "./model";
import { closedRightPanels } from "./reduce-views";

type ReduceFn = (state: AppState, action: Action) => AppState;

/** Plugins, memory, triggers, wizard, catalog, persona, tour, launch, welcome. */
export function reduceUiSurfaces(
  state: AppState,
  action: Action,
  reduce: ReduceFn,
): AppState | undefined {
  switch (action.type) {
    case "togglePlugins": {
      // Capabilities is a decided centred modal (like Settings). activeView
      // "apps" still marks it open so other views close it cleanly.
      const open = action.open ?? !(state.activeView === "apps" || state.pluginsOpen);
      if (!open) {
        return {
          ...state,
          pluginsOpen: false,
          pluginsBotId: null,
          pluginsPage: null,
          pluginsFocusApps: null,
          activeView: state.activeView === "apps" ? "chat" : state.activeView,
          ...(state.botCatalogTarget && !state.botCatalogOpen ? { botCatalogTarget: null } : {}),
        };
      }
      return {
        ...state,
        activeView: "apps",
        pluginsOpen: true,
        pluginsSurface: action.surface ?? state.pluginsSurface,
        // A bot panel opens it on that bot; a change of surface while it is
        // open keeps the bot it is on.
        pluginsBotId: action.page ? null : action.botId !== undefined ? action.botId : state.pluginsOpen ? state.pluginsBotId : null,
        pluginsPage: action.page === "accounts" ? "providers" : action.page ?? null,
        pluginsFocusApps: action.focusApps?.length ? action.focusApps : state.pluginsOpen ? state.pluginsFocusApps : null,
        botCatalogOpen: false,
        settingsOpen: false,
        appSettingsOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
      };
    }
    case "toggleMemoryManager": {
      // Memory is a main-column page (Automations / Team map family).
      const open = action.open ?? !(state.activeView === "memory" || state.memoryManagerOpen);
      if (!open) {
        return {
          ...state,
          memoryManagerOpen: false,
          activeView: state.activeView === "memory" ? "chat" : state.activeView,
        };
      }
      return {
        ...state,
        activeView: "memory",
        memoryManagerOpen: true,
        ...closedRightPanels,
        settingsOpen: false,
        computerOpen: false,
        personPanelId: null,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
      };
    }
    case "toggleTriggers": {
      // 2026-11-01 (lot 2, no modals): Triggers is Automations > Webhooks, not
      // a pop-up. Closing is a no-op on the view (the person leaves Automations).
      if (action.open === false) return { ...state, triggersOpen: false };
      return {
        ...state,
        activeView: "routines",
        routinesFocus: {
          section: "webhooks",
          view: undefined,
          botId: undefined,
          routineId: undefined,
          runStatus: undefined,
          runId: undefined,
          nonce: state.routinesFocus.nonce + 1,
        },
        triggersOpen: false,
        memoryManagerOpen: false,
        ...closedRightPanels,
        settingsOpen: false,
        appSettingsOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        pluginsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
      };
    }
    case "openBotWizard":
      // Centred creation window. Redo on an existing bot always opens; a new
      // bot opens even when create is refused so the window can show the
      // read-only note in place (no BotsReadOnly dialog).
      return {
        ...state,
        botWizard: { botId: action.botId ?? null, ...(action.redo ? { redo: true } : {}) },
        personaEditor: null,
        activeView: state.activeView === "apps" ? "chat" : state.activeView,
        newBotOpen: false, settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false, triggersOpen: false,
        memoryManagerOpen: false,
        archivedBotsOpen: false,
        orgImportOpen: false,
        botCatalogOpen: false,
      };
    case "closeBotWizard":
      return { ...state, botWizard: null };
    case "toggleNewBot": {
      // Lot 4: New bot opens the creation view (one option, one place).
      // Closing clears the wizard. defaultsMode still uses NewBotDialog locally.
      const wantOpen = action.open ?? !state.botWizard;
      if (!wantOpen) {
        return state.botWizard || state.newBotOpen
          ? { ...state, botWizard: null, newBotOpen: false }
          : state;
      }
      return reduce(state, { type: "openBotWizard" });
    }
    case "openBotCatalog": {
      // Browse Bots as its own centred window (restored after UX lot 5).
      // Capabilities still embeds the same pane on its Bots tab.
      const target = action.section ? { section: action.section, ...(action.installUrl ? { installUrl: action.installUrl } : {}) } : null;
      if (state.botCatalogOpen) return action.section ? { ...state, botCatalogTarget: target } : state;
      return {
        ...state,
        botCatalogOpen: true,
        botCatalogTarget: target,
        settingsOpen: false,
        appSettingsOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        triggersOpen: false,
        archivedBotsOpen: false,
        orgImportOpen: false,
      };
    }
    case "closeBotCatalog":
      return state.botCatalogOpen || state.botCatalogTarget
        ? { ...state, botCatalogOpen: false, botCatalogTarget: null }
        : state;
    case "openPersonaEditor":
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      return {
        ...state,
        personaEditor: {
          botId: action.botId,
          section: action.section ?? "overview",
          // What the right panel showed before the page: put back when it
          // closes (#2271). A page reopened over itself keeps the first.
          panel: state.personaEditor?.panel ?? profilePanelSnapshot(state),
        },
        // The profile page takes the main panel in place of the chat
        // (#2136): the right panel closes while it is open.
        settingsOpen: false,
        panelOwner: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        personPanelId: null,
        botWizard: null,
        activeView: "chat",
        appSettingsOpen: false,
        appSettingsSubPage: null,
        pluginsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        archivedBotsOpen: false,
        orgImportOpen: false,
      };
    case "personaEditorSection":
      return state.personaEditor && state.personaEditor.section !== action.section
        ? { ...state, personaEditor: { ...state.personaEditor, section: action.section } }
        : state;
    case "closePersonaEditor":
      return state.personaEditor ? { ...state, ...state.personaEditor.panel, personaEditor: null } : state;
    case "toggleShortcuts": {
      const open = action.open ?? !state.shortcutsOpen;
      return {
        ...state,
        shortcutsOpen: open,
      };
    }
    case "toggleTour": {
      const open = action.open ?? !state.tourOpen;
      return { ...state, tourOpen: open, appSettingsOpen: open ? false : state.appSettingsOpen };
    }
    case "toggleLaunch": {
      const open = action.open ?? !state.launchOpen;
      // Full-screen like the welcome tour: Settings closes underneath it.
      return {
        ...state,
        launchOpen: open,
        launchMode: action.mode ?? state.launchMode,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
    case "toggleWelcome": {
      const open = action.open ?? !state.welcomeOpen;
      // The tour is a full-screen surface; nothing else should stay open
      // underneath it, and Settings closes so the replay lands on the tour.
      return {
        ...state,
        welcomeOpen: open,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
  }
  return undefined;
}

/** The right panel's state, kept while the bot's profile page covers it. */
export function profilePanelSnapshot(state: AppState): ProfilePanelSnapshot {
  const { settingsOpen, panelOwner, computerOpen, inspectorOpen, activityOpen, personPanelId } = state;
  return { settingsOpen, panelOwner, computerOpen, inspectorOpen, activityOpen, personPanelId };
}
