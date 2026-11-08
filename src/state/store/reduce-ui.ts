// Domain slice of the client store reduce(ui).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {withoutFreshTopicFor} from "./model";
import {personaCategoryForSection} from "@/lib/persona-sections";
import {currentSettingsSection} from "@/lib/settings-sections";
import {profilePanelSnapshot, reduceUiSurfaces} from "./reduce-ui-surfaces";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceUi(state: AppState, action: Action, reduce: ReduceFn): AppState | undefined {
  const surfaces = reduceUiSurfaces(state, action, reduce);
  if (surfaces !== undefined) return surfaces;

  switch (action.type) {
    case "openPersonPanel": {
      const personId = action.personId?.trim() || null;
      if (!personId) return state.personPanelId === null ? state : { ...state, personPanelId: null };
      return { ...state, personPanelId: personId, settingsOpen: false, computerOpen: false, inspectorOpen: false, appSettingsOpen: false, personaEditor: null };
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
        const page = reduce(opened, { type: "openPersonaEditor", botId: targetId, section: category });
        // The panel the deep link opened for its section is not the one to
        // put back: keep what the person had before (#2271).
        return page.personaEditor
          ? { ...page, personaEditor: { ...page.personaEditor, panel: state.personaEditor?.panel ?? profilePanelSnapshot(state) } }
          : page;
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
      const expand = open ? named || (freshOpen && state.botSettingsSectionStored) : false;
      return {
        ...state,
        // #2149: a fresh opening, or one that expands a row, lands on Activity
        // (restoreBotPanel then puts the closed tab back).
        botPanelTab: open && (freshOpen || expand) ? null : state.botPanelTab,
        botPanelRestored: false,
        selectedId,
        settingsOpen: open,
        panelOwner: open ? owner : null,
        activityOpen: open ? false : state.activityOpen,
        // The pointer persists across bots and rooms (select) and across
        // switches to another bot's profile; a deep link names its target.
        botSettingsSection: action.section ?? state.botSettingsSection,
        // A bare fresh open re-expands the section this device last viewed;
        // a deep link expands the row it names.
        botSettingsExpandAccordion: expand,
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
        memoryManagerOpen: open ? false : state.memoryManagerOpen,
        // The bot's profile page fills the main area (#2136): opening the
        // bot panel gives the chat back.
        personaEditor: open ? null : state.personaEditor,
      };
    }
    case "openRoutine": {
      // #2624: one place for routines, the Routines sub-page of the bot page.
      const opened = reduce(state, { type: "openPersonaEditor", botId: action.botId, section: "routines" });
      if (opened === state) return state;
      return {
        ...opened,
        routineFocus: action.routineId ? { botId: action.botId, routineId: action.routineId } : { botId: action.botId, create: true },
      };
    }
    case "routineFocused":
      return state.routineFocus ? { ...state, routineFocus: null } : state;
    case "openRoutineRunWindow": {
      // #2272: the run opens as its own window over the bot's chat column
      // (ExchangeSheet, like a bot-to-bot exchange), whether or not its
      // report is loaded in the conversation. Never a thread or a panel.
      const known = state.routineRuns.find((candidate) => candidate.id === action.runId);
      const botId = action.botId ?? known?.botId;
      const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
      const routineId = action.routineId ?? known?.routineId;
      return {
        ...state,
        activeView: "chat",
        codingChat: null,
        routineRunWindow: { runId: action.runId, ...(routineId ? { routineId } : {}), ...(botId ? { botId } : {}) },
        personPanelId: null,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
        ...(bot && state.selectedId !== bot.id ? { selectedId: bot.id } : {}),
      };
    }
    case "closeRoutineRunWindow":
      return state.routineRunWindow ? { ...state, routineRunWindow: null } : state;
    // 2026-11-03: a coding task opens as a chat where the chat is, never in
    // the side panel (the panel stays open as it was, its Coding list the
    // entry point).
    case "openCodingChat":
      return {
        ...state,
        activeView: "chat",
        codingChat: action.target,
        routineRunWindow: null,
        personPanelId: null,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
      };
    case "closeCodingChat":
      return state.codingChat ? { ...state, codingChat: null } : state;
    case "openBotActivity": {
      const opened = reduce(state, { type: "toggleSettings", open: true, section: "routines", botId: action.botId });
      if (opened === state) return state;
      return { ...opened, botActivityTarget: { botId: action.botId, itemId: action.itemId } };
    }
    case "botActivityOpened":
      return state.botActivityTarget ? { ...state, botActivityTarget: null } : state;
    case "revealThread":
      return { ...state, revealThread: { threadId: action.threadId, nonce: (state.revealThread?.nonce ?? 0) + 1 } };
    case "setThreadReturn":
      return { ...state, threadReturn: action.threadReturn };
    case "freshTopic": {
      const current = state.freshTopic[action.botId];
      if (!action.threadId) {
        if (!current) return state;
        // Opening the bot, coming back to it: a New chat the person asked
        // for stays until they send, Back or open the topic it covers.
        if (action.keepAsked && !current.auto) return state;
        const { [action.botId]: _gone, ...rest } = state.freshTopic;
        return { ...state, freshTopic: rest };
      }
      if (current?.threadId === action.threadId && current.auto === Boolean(action.auto)) return state;
      // Coming back after a while never turns an asked-for New chat into an
      // invisible one over the same topic: it stays drawn empty.
      if (action.auto && current && !current.auto && current.threadId === action.threadId) return state;
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
        botPanelRestored: false,
        computerOpen: open,
        personPanelId: open ? null : state.personPanelId,
        settingsOpen: open ? false : state.settingsOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        personaEditor: open ? null : state.personaEditor,
      };
    }
    case "pickBotPanelTab":
      return state.botPanelTab?.botId === action.botId && state.botPanelTab.tab === action.tab
        ? state
        : { ...state, botPanelTab: { botId: action.botId, tab: action.tab } };
    case "rememberBotPanel": {
      // #2149 (JC 2026-11-06): the header pill closes the panel; its next
      // click reopens exactly this one.
      const botId = state.panelOwner?.botId ?? state.selectedId;
      if (!botId || !(state.settingsOpen || state.computerOpen)) return state;
      return {
        ...state,
        lastBotPanel: {
          botId,
          computer: state.computerOpen,
          tab: state.botPanelTab?.botId === botId ? state.botPanelTab.tab : "activity",
          section: state.botSettingsSection,
          expand: state.botSettingsExpandAccordion,
        },
      };
    }
    case "restoreBotPanel": {
      const botId = action.botId ?? state.panelOwner?.botId ?? state.selectedId;
      const last = state.lastBotPanel;
      if (!last || !botId || last.botId !== botId) {
        return reduce(state, { type: "toggleSettings", open: true, ...(action.botId ? { botId: action.botId } : {}) });
      }
      if (last.computer) {
        const opened = reduce(state, { type: "toggleComputer", open: true });
        return { ...opened, botPanelTab: { botId, tab: last.tab }, botPanelRestored: true };
      }
      const opened = reduce(state, { type: "toggleSettings", open: true, ...(action.botId ? { botId: action.botId } : {}) });
      if (opened === state) return state;
      return {
        ...opened,
        botSettingsSection: last.section,
        botSettingsExpandAccordion: last.expand,
        botSettingsExpandRemembered: false,
        botPanelTab: { botId, tab: last.tab },
        botPanelRestored: true,
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
  }
  return undefined;
}
