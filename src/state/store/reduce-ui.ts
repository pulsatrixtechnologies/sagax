// Domain slice of the client store reduce(ui).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {withoutFreshTopicFor} from "./model";
import {personaCategoryForSection} from "@/lib/persona-sections";
import {currentSettingsSection} from "@/lib/settings-sections";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceUi(state: AppState, action: Action, reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "openPersonPanel": {
      const personId = action.personId?.trim() || null;
      if (!personId) return state.personPanelId === null ? state : { ...state, personPanelId: null };
      return { ...state, personPanelId: personId, settingsOpen: false, computerOpen: false, inspectorOpen: false, appSettingsOpen: false };
    }
    case "toggleSettings": {
      // Only Details (and Routines) live in the bot panel. A deep link to any
      // other section opens the persona editor on that section's own page
      // over the panel.
      // A split-view section's pill names its bot or group as the owner: the
      // panel is that one's and the main chat stays as it is. A link for another bot
      // (or the main pill, owner null) gives the panel back to the main chat;
      // one without a bot, from inside the panel, stays with its owner.
      const owner = action.owner !== undefined
        ? action.owner
        : state.panelOwner && (action.botId === undefined || action.botId === state.panelOwner.botId) ? state.panelOwner : null;
      const category = action.open !== false && action.section !== undefined ? personaCategoryForSection(action.section) : null;
      if (category !== null) {
        const targetId = action.botId ?? owner?.botId ?? state.selectedId;
        if (!targetId) return state;
        const opened = reduce(state, { type: "toggleSettings", open: true, ...(owner ? { owner } : { botId: action.botId, owner: null }) });
        return reduce(opened, { type: "openPersonaEditor", botId: targetId, section: category });
      }
      if (action.botId !== undefined && !state.bots.some((bot) => bot.id === action.botId && !bot.hidden)) return state;
      if (owner?.botId !== undefined && !state.bots.some((bot) => bot.id === owner.botId && !bot.hidden)) return state;
      if (owner?.groupId !== undefined && !state.groups.some((group) => group.id === owner.groupId)) return state;
      const selectedId = owner ? state.selectedId : action.botId ?? state.selectedId;
      // A targeted settings link opens that bot without navigating to chat
      // or marking its conversations read, even when another panel is open.
      const open = action.open ?? (action.botId !== undefined || !state.settingsOpen);
      const freshOpen = open && !state.settingsOpen;
      const named = action.section !== undefined;
      return {
        ...state,
        selectedId,
        settingsOpen: open,
        panelOwner: open ? owner : null,
        activityOpen: open ? false : state.activityOpen,
        // The pointer persists across bots and rooms (select) and across
        // switches to another bot's profile; a deep link names its target.
        botSettingsSection: action.section ?? state.botSettingsSection,
        // A bare fresh open re-expands the section this device last viewed;
        // a deep link expands the row it names.
        botSettingsExpandAccordion: open ? named || (freshOpen && state.botSettingsSectionStored) : false,
        // Only an opening that expanded the remembered row sets this; a deep
        // link forces the full view for sections Simple skips.
        botSettingsExpandRemembered: open ? !named && freshOpen && state.botSettingsSectionStored : false,
        botSettingsSectionStored: named || state.botSettingsSectionStored,
        personPanelId: open ? null : state.personPanelId,
        // Settings and the computer panel share one slot. Opening settings
        // closes the computer view; its gear opens settings again.
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "openRoutine": {
      const opened = reduce(state, { type: "toggleSettings", open: true, section: "routines", botId: action.botId });
      if (opened === state) return state;
      return { ...opened, routineFocus: { botId: action.botId, routineId: action.routineId } };
    }
    case "routineFocused":
      return state.routineFocus ? { ...state, routineFocus: null } : state;
    case "openRoutineRunSheet": {
      const known = state.routineRuns.find((candidate) => candidate.id === action.runId);
      const botId = action.botId ?? known?.botId;
      const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
      const next: AppState = {
        ...state,
        activeView: "chat",
        routineRunSheet: { runId: action.runId, ...(action.routineId ?? known?.routineId ? { routineId: action.routineId ?? known?.routineId } : {}) },
        // Keep the bot panel if it was already open; otherwise land on chat.
        personPanelId: null,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
      if (bot && state.selectedId !== bot.id) {
        return { ...next, selectedId: bot.id };
      }
      return next;
    }
    case "closeRoutineRunSheet":
      return state.routineRunSheet ? { ...state, routineRunSheet: null } : state;
    case "openBotActivity": {
      const opened = reduce(state, { type: "toggleSettings", open: true, section: "routines", botId: action.botId });
      if (opened === state) return state;
      return { ...opened, botActivityTarget: { botId: action.botId, itemId: action.itemId } };
    }
    case "botActivityOpened":
      return state.botActivityTarget ? { ...state, botActivityTarget: null } : state;
    case "togglePlugins": {
      const open = action.open ?? !state.pluginsOpen;
      return {
        ...state,
        pluginsOpen: open,
        pluginsSurface: action.surface ?? state.pluginsSurface,
        // A bot panel opens it on that bot; a change of surface while it is
        // open keeps the bot it is on.
        pluginsBotId: !open ? null : action.page ? null : action.botId !== undefined ? action.botId : state.pluginsOpen ? state.pluginsBotId : null,
        pluginsPage: open ? (action.page === "accounts" ? "providers" : action.page ?? null) : null,
        pluginsFocusApps: !open ? null : action.focusApps?.length ? action.focusApps : state.pluginsOpen ? state.pluginsFocusApps : null,
        // where a link to Browse Bots asked it to open (its Templates) lasts
        // while Connect apps is open (2026-10-29)
        ...(!open && state.botCatalogTarget && !state.botCatalogOpen ? { botCatalogTarget: null } : {}),
        ...(open ? { settingsOpen: false, appSettingsOpen: false, newBotOpen: false, shortcutsOpen: false, triggersOpen: false } : {}),
      };
    }
    case "toggleTriggers": {
      const open = action.open ?? !state.triggersOpen;
      return {
        ...state,
        triggersOpen: open,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, newBotOpen: false, shortcutsOpen: false, pluginsOpen: false } : {}),
      };
    }
    case "openBotWizard":
      // Its own screen over the app: what was open closes, as New bot does.
      // A new bot needs the right to create one (a bot's own Redo does not).
      if (!action.botId && state.config?.viewer?.canCreateBots === false) return state;
      return {
        ...state,
        botWizard: { botId: action.botId ?? null, ...(action.redo ? { redo: true } : {}) },
        newBotOpen: false, settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false, triggersOpen: false,
      };
    case "closeBotWizard":
      return { ...state, botWizard: null };
    case "toggleNewBot": {
      const open = (action.open ?? !state.newBotOpen) && state.config?.viewer?.canCreateBots !== false;
      return {
        ...state, newBotOpen: open,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false, triggersOpen: false } : {}),
      };
    }
    case "revealThread":
      return { ...state, revealThread: { threadId: action.threadId, nonce: (state.revealThread?.nonce ?? 0) + 1 } };
    case "setThreadReturn":
      return { ...state, threadReturn: action.threadReturn };
    case "freshTopic": {
      const current = state.freshTopic[action.botId];
      if (!action.threadId) {
        if (!current) return state;
        const { [action.botId]: _gone, ...rest } = state.freshTopic;
        return { ...state, freshTopic: rest };
      }
      if (current?.threadId === action.threadId && current.auto === Boolean(action.auto)) return state;
      return { ...state, freshTopic: { ...state.freshTopic, [action.botId]: { threadId: action.threadId, auto: Boolean(action.auto) } } };
    }
    case "focusMessage":
      return {
        ...state,
        // A link or a search hit into a topic of a bot under a fresh topic
        // shows that topic: the fresh one gives way.
        freshTopic: withoutFreshTopicFor(state, action.threadId),
        focusMessage: {
          threadId: action.threadId,
          messageId: action.messageId,
          matchText: action.matchText,
          nonce: (state.focusMessage?.nonce ?? 0) + 1,
          consumed: false,
        },
      };
    case "focusMessageConsumed":
      if (!state.focusMessage || state.focusMessage.nonce !== action.nonce) return state;
      return { ...state, focusMessage: { ...state.focusMessage, consumed: true } };
    case "unreadDividerDone":
      return state.unreadDivider?.threadId === action.threadId ? { ...state, unreadDivider: null } : state;
    case "toggleComputer": {
      const open = action.open ?? !state.computerOpen;
      return {
        ...state,
        computerOpen: open,
        personPanelId: open ? null : state.personPanelId,
        settingsOpen: open ? false : state.settingsOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleInspector": {
      const open = action.open ?? !state.inspectorOpen;
      return {
        ...state,
        inspectorOpen: open,
        personPanelId: open ? null : state.personPanelId,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleActivity": {
      const open = action.open ?? !state.activityOpen;
      return {
        ...state,
        activityOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        appSettingsOpen: open,
        activityOpen: open ? false : state.activityOpen,
        appSettingsSection: action.section ? currentSettingsSection(action.section) : state.appSettingsSection,
        appSettingsSubPage: open ? action.subPage ?? null : null,
        personPanelId: open ? null : state.personPanelId,
        appSettingsPhonePairing: action.phonePairing && open ? state.appSettingsPhonePairing + 1 : 0,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        pluginsOpen: open ? false : state.pluginsOpen,
        triggersOpen: open ? false : state.triggersOpen,
        personaEditor: open ? null : state.personaEditor,
      };
    }
    case "openBotCatalog": {
      // Browse Bots is Connect apps' Bots tab (2026-10-29): every link to it
      // opens that tab, on its Templates when it asks (a new object, so an
      // open tab follows a later link). Its own window (botCatalogOpen) keeps
      // its content for a window that is already open.
      const target = action.section ? { section: action.section, ...(action.installUrl ? { installUrl: action.installUrl } : {}) } : null;
      if (state.botCatalogOpen) return action.section ? { ...state, botCatalogTarget: target } : state;
      const opened = reduce(state, { type: "togglePlugins", open: true, surface: "apps", page: "bots" });
      return { ...opened, botCatalogTarget: target };
    }
    case "closeBotCatalog":
      return state.botCatalogOpen ? { ...state, botCatalogOpen: false, botCatalogTarget: null } : state;
    case "openPersonaEditor":
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      return {
        ...state,
        personaEditor: { botId: action.botId, section: action.section ?? "overview" },
        appSettingsOpen: false,
        appSettingsSubPage: null,
        pluginsOpen: false,
        triggersOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
      };
    case "personaEditorSection":
      return state.personaEditor && state.personaEditor.section !== action.section
        ? { ...state, personaEditor: { ...state.personaEditor, section: action.section } }
        : state;
    case "closePersonaEditor":
      return state.personaEditor ? { ...state, personaEditor: null } : state;
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
