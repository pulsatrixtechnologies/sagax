import type { ReactNode } from "react";
import { Bot as BotIcon, Loader2, Plus } from "lucide-react";
import type { Bot, Group } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { SplitWorkspace } from "@/components/SplitWorkspace";
import { SideThreadPanel } from "@/components/SideThreadPanel";
import { ComposeToPicker } from "@/components/ComposeToPicker";
import {
  AchievementsScreen, ActivityPanel, ApprovalsPage, ArtifactsHost, BotCatalogModal, BotSettingsDialog, BotWizard, CodePage, CommandPalette, InspectorPanel, KeyboardShortcutsModal, LocalVmWorkspace,
  MemoryManagerPanel, OrgImportDialog, PersonaEditorModal, PersonPanel, PluginsPanel, RemoteAgentSettingsPanel, RemoteDesktopPanel, RemoteSessionsAdminPage, RoutinesPage, SettingsModal, StagedOrgImport, TeamMapPage,
} from "@/components/lazy-screens";
import { ArchivedBotsPanel } from "@/components/Sidebar";
import { AboutPrompt } from "@/components/AboutDialog";
import { ReleaseNotesPrompt } from "@/components/ReleaseNotesPrompt";
import { TermsGate } from "@/components/TermsGate";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WindowCaptionButtons } from "@/components/WindowCaptionButtons";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { NoEngines } from "@/components/NoEngines";
import { OrgEngineNotice } from "@/components/OrgEngineSetup";
import { RetroAssistantHost } from "@/components/RetroAssistantHost";
import { AchievementToaster } from "@/components/achievements/AchievementToaster";
import { ConnectionNotice } from "@/components/ConnectionNotice";
import { MyChromeIndicator } from "@/components/MyChromeIndicator";
import { HostControlIndicator } from "@/components/HostControlIndicator";
import { FloatingBotsHost } from "@/components/FloatingBotsHost";
import { FloatingWindowsHost } from "@/components/floating/FloatingWindowsHost";
import { CallEngineHost } from "@/components/CallView";
import { RetroBootSlot, RetroChromeSlot } from "@/components/RetroChromeHost";
import { t } from "@/lib/i18n";
import { viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import { botsReadOnlyText } from "@/lib/permissions";
import { ModelWindowHost } from "@/components/ModelWindowHost";
import { ChatNotice } from "@/components/ChatErrorBanner";
import { TeamBotFromThreadHost } from "@/components/TeamBotFromThreadDialog";
import type { ShellNavigation } from "./useShellNavigation";

function BotSurface({ id, children }: { id: string; children: (bot: Bot) => ReactNode }) {
  const bot = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === id));
  return bot ? children(bot) : null;
}

function GroupSurface({ id, children }: { id: string; children: (group: Group) => ReactNode }) {
  const group = useStoreSelector((current) => current.groups.find((candidate) => candidate.id === id));
  return group ? children(group) : null;
}

/** Shell chrome and main column: sidebar, conversation surfaces, panels, modals. */
export function ShellLayout(shell: ShellNavigation) {
  const {
    dispatch,
    state,
    capabilities,
    captionChrome,
    remoteClient,
    drawerOpen,
    setDrawerOpen,
    uiLocale,
    setPaletteOpen,
    composeOpen,
    setComposeOpen,
    openCompose,
    toggleCompose,
    composeGroup,
    localVmWorkspaceBotId,
    setLocalVmWorkspaceBotId,
    bot,
    group,
    org,
    noEngines,
    panelBotId,
    panelSlot,
    setPanelSlot,
    botPanelOpen,
    mainIsTeamMap,
    mainIsMemory,
    mainIsCode,
    mainIsApprovals,
    mainIsRemoteSessions,
    mainIsAchievements,
    mainIsApps,
    archivedBots,
    calendarFillsMain,
    openLocalVmWorkspace,
    openComputerFromWorkspace,
    closeCalendar,
    openCalendarRoom,
    nativeViewOverlayOpen,
  } = shell;

  return (
    <div className="flex h-full flex-col" data-app-shell="">
      {/* What's new is a centred window above the update dialog. Both sit outside the layout flow. */}
      <ReleaseNotesPrompt />
      {/* About: centred modal from Settings > About, the profile menu, the app menu. */}
      <AboutPrompt />
      {/* The terms of use, once per account (App Store 1.2). */}
      <TermsGate />
      <UpdateBanner />
      {/* A bot driving the person's own Chrome: who, where, and Stop. */}
      <MyChromeIndicator />
      {/* A bot controlling this computer's own screen: who, and Stop. */}
      <HostControlIndicator />
      {/* The one bottom-left card at a time (only the star is left in Sagax). */}
      {/* Hibou 98 only: title bar, menus and toolbar (renders nothing otherwise) */}
      <RetroChromeSlot slot="top" onNewBot={() => setComposeOpen((open) => !open)} />
      <div className="app-shell-row relative flex min-h-0 flex-1">
      {/* the drawer on a phone, the icons rail up to 768px, then the
          person's own sidebar (AppSidebar.tsx) */}
      <AppSidebar
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        composeOpen={composeOpen}
        onCompose={toggleCompose}
      />
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col" data-sidebar-follower="">
      {/* nothing answers this person on an organization server: say so above
          the conversation, with the way back to the first-run step */}
      {org && (group || bot) && !calendarFillsMain && !mainIsTeamMap && !mainIsMemory && !mainIsCode && !mainIsApprovals && !mainIsRemoteSessions && !mainIsAchievements && !mainIsApps && <OrgEngineNotice />}
      {/* The split view (#1504): the main view below is one section; others
          show more conversations beside it (src/lib/split-view.ts). */}
      <SplitWorkspace panelSlot={panelSlot} main={composeOpen && (group || bot) ? (
        group ? <GroupSurface key={`${group.id}:${uiLocale}`} id={group.id}>{(current) => <GroupView group={current} />}</GroupSurface> : bot ? <BotSurface key={uiLocale} id={bot.id}>{(current) => <ChatView bot={current} />}</BotSurface> : null
      ) : calendarFillsMain ? (
        <RoutinesPage fill onBack={closeCalendar} onOpenRoom={openCalendarRoom} />
      ) : mainIsTeamMap ? (
        <TeamMapPage />
      ) : mainIsMemory ? (
        <MemoryManagerPanel />
      ) : mainIsCode ? (
        <CodePage />
      ) : mainIsApprovals ? (
        <ApprovalsPage />
      ) : mainIsRemoteSessions && org ? (
        <RemoteSessionsAdminPage />
      ) : mainIsAchievements ? (
        <AchievementsScreen />
      ) : mainIsApps ? (
        /* Capabilities centred modal (decided exception like Settings).
           Over the wizard when Tools opens it: botWizard stays set. */
        <PluginsPanel />
      ) : !remoteClient && localVmWorkspaceBotId ? (
        <LocalVmWorkspace
          primaryBotId={localVmWorkspaceBotId}
          overlayOpen={nativeViewOverlayOpen}
          onClose={() => setLocalVmWorkspaceBotId(null)}
          onOpenComputer={openComputerFromWorkspace}
        />
      ) : noEngines && !org ? (
        <NoEngines />
      ) : group ? (
        <GroupSurface key={`${group.id}:${uiLocale}`} id={group.id}>{(current) => <GroupView group={current} />}</GroupSurface>
      ) : bot ? (
        <BotSurface key={uiLocale} id={bot.id}>{(current) => <ChatView bot={current} />}</BotSurface>
      ) : (
        state.connected ? (
          // Connected with no bot: an empty state that invites creating one,
          // not a spinner (nothing is loading).
          <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
            <WindowDragStrip />
            {/* a chat link opened with no bots here still says it found nothing */}
            <div className="w-full max-w-md"><ChatNotice notice={state.notice} /></div>
            <BotIcon size={28} aria-hidden />
            <div className="text-center">
              <div className="text-[15px] text-ink">{t("app.empty.title")}</div>
              <div className="mt-1 text-[13px]">{t("app.empty.body")}</div>
            </div>
            {viewerCanCreateBots(state.config) ? (
              <button type="button" className="ui-button mt-1 inline-flex items-center gap-1.5" onClick={() => dispatch({ type: "openBotWizard" })}>
                <Plus size={14} aria-hidden />
                {t("app.empty.create")}
              </button>
            ) : viewerBotsReadOnly(state.config) && (
              <p role="note" data-bots-read-only className="max-w-sm text-center text-[13px]">{botsReadOnlyText(state.config)}</p>
            )}
          </main>
        ) : (
        <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <WindowDragStrip />
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.everConnected ? t("chat.reconnecting") : t("app.connecting")}
          </div>
          {!state.everConnected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
        )
      )} />
      {composeOpen && <ComposeToPicker key={composeGroup ? "group" : "browse"} startInGroup={composeGroup} onClose={() => setComposeOpen(false)} />}
      </div>
      {/* A bot thread opened beside the main chat (Open beside, or
          Option-click on a thread row); one at a time. */}
      <SideThreadPanel />
      {/* The panels below are siblings, so their keys must differ even
          though each is remounted per bot. Two siblings keyed `bot.id`
          collide in React's keyed reconciliation whenever both are open
          (Computer panel, then the usage chip): every re-render mounts a
          fresh settings panel and never removes the previous one, so the
          panels pile up and Close stops working. */}
      {/* One tabbed bot panel (Details, Routines, Files, Computer, Advanced) on the
          desktop; its Computer tab is the store's computer view, so both
          flags render the same panel under one key. */}
      {botPanelOpen && panelBotId && (
        <BotSurface key={`panel:${panelBotId}`} id={panelBotId}>{(current) => <BotSettingsDialog bot={current} onOpenVmWorkspace={openLocalVmWorkspace} />}</BotSurface>
      )}
      {/* A split-view group section's panel (GroupView, by a portal): the
          same right edge as every other panel. */}
      <div ref={setPanelSlot} data-split-panel-slot="" className="contents" />
      {remoteClient && state.settingsOpen && panelBotId && <BotSurface id={panelBotId}>{(current) => <RemoteAgentSettingsPanel bot={current} />}</BotSurface>}
      {state.personPanelId && <PersonPanel key={`person:${state.personPanelId}`} personId={state.personPanelId} />}
      {remoteClient && state.computerOpen && bot && (
        <BotSurface key={`computer:${bot.id}`} id={bot.id}>{(current) => <RemoteDesktopPanel bot={current} />}</BotSurface>
      )}
      {!remoteClient && state.inspectorOpen && bot && <BotSurface key={bot.threadId} id={bot.id}>{(current) => <InspectorPanel bot={current} />}</BotSurface>}
      {!remoteClient && state.activityOpen && bot && <BotSurface key={`activity:${bot.id}`} id={bot.id}>{(current) => <ActivityPanel bot={current} />}</BotSurface>}
      {state.appSettingsOpen && <SettingsModal />}
      {!remoteClient && <ModelWindowHost />}
      {/* Restored centred windows: Edit bot, New bot wizard, Browse Bots,
          archived bots, org import. Capabilities stays a decided modal. */}
      {!remoteClient && state.personaEditor && <PersonaEditorModal />}
      {!remoteClient && state.botWizard && <BotWizard />}
      {state.botCatalogOpen && <BotCatalogModal />}
      {state.archivedBotsOpen && (
        <ArchivedBotsPanel
          bots={archivedBots}
          onClose={() => dispatch({ type: "closeArchivedBots" })}
          onRestored={() => {}}
        />
      )}
      {state.orgImportOpen && (
        <OrgImportDialog
          staged={state.orgImportStaged}
          onClose={() => dispatch({ type: "closeOrgImport" })}
        />
      )}
      {state.shortcutsOpen && (
        <KeyboardShortcutsModal
          open={state.shortcutsOpen}
          onClose={() => dispatch({ type: "toggleShortcuts", open: false })}
        />
      )}
      {/* detached terminals and widgets: over the app, under the modals (z-40) */}
      <FloatingWindowsHost />
      {/* mounted after the modals: same z-50 tier, so DOM order keeps the
          palette on top when one of them is open underneath */}
      <CommandPalette onOpenChange={setPaletteOpen} onNewConversation={openCompose} />
      <ArtifactsHost />
      <StagedOrgImport />
      <TeamBotFromThreadHost />
      <RetroAssistantHost />
      <AchievementToaster />
      {/* #2013: server updating or unreachable, Perspicax unreachable, Reconnected */}
      <ConnectionNotice />
      <CallEngineHost />
      <FloatingBotsHost />
      <RetroBootSlot />
      {/* The drawer button comes before every header in the DOM, and a later
          drag region wins, so on a narrow window the header's drag region
          swallowed it. This no-drag twin, after the headers, cuts the
          button's corner back out. It paints nothing and takes no clicks. */}
      <span
        aria-hidden
        data-drawer-button-no-drag
        style={captionChrome.noDragStyle}
        className="pointer-events-none absolute left-3 top-3 size-[30px] sm:hidden"
      />
      </div>
      <RetroChromeSlot slot="status" />
      {/* Renderer-drawn caption buttons for the overlay-less frameless
          Windows window. Deliberately the LAST child of the shell: Blink
          resolves -webkit-app-region in DOM-walk order, so these no-drag
          buttons must come after every drag-region header to actually
          subtract from it — earlier placement let the header's drag region
          swallow the buttons (dead clicks, no hover). z-40 keeps true
          modals (z-50, later in DOM) painting above the buttons. */}
      <WindowCaptionButtons
        visible={capabilities.windowChrome === "win-caption" && Boolean(window.ogb?.windowControls)}
      />
    </div>
  );
}
