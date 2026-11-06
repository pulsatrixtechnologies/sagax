import { botRoutineRuns } from "@/state/view-slices";
// The bot panel, as the reference design draws it (#2125): a round gear at
// the top left (the bot's profile page) and a round X at the top right, a
// mascot sized to Grok Bot (#2196) and "Name · Label" on one line, then two
// tabs, Activity and Library. Once the body scrolls past the tabs, the head
// compacts into one row: gear, tabs centered, X. The bot's menu (archive,
// primary, export, copy link, float) opens on a right click on the mascot or
// the name, and the profile page holds the same actions. Every section lives
// under bot-settings/; their bodies and reads are useBotSectionContent, shared
// with the persona editor. Activity > Computer opens the live desktop
// window directly (SandboxDesktopModal); other links may still open ComputerPanel.
import { useCallback, useEffect, useRef, useState } from "react";
import { BOT_PANEL_BOUNDS, DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { ArrowLeft, Settings, X } from "lucide-react";

import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import type { Bot } from "@/state/store";
import { useDataWindowItem } from "./DataWindowButton";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { reportAchievement } from "@/lib/achievements";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { BotActionsMenu, type BotActionsMenuAnchor } from "./bot-settings/BotActionsMenu";
import { LibraryTab } from "./bot-settings/LibraryTab";
import { RolePermissionsSection } from "./bot-settings/RolePermissionsSection";
import { RoutinesSection } from "./bot-settings/RoutinesSection";

import { showsComputer, visiblePanelTabs, type PanelTab } from "./bot-settings/panel-tabs";
import { ComputerCard } from "./bot-settings/ComputerCard";
import { VoiceChatCard } from "./bot-settings/VoiceChatCard";
import { ActivitySection } from "./bot-settings/ActivitySection";
import { BotTaskSection } from "./bot-settings/BotTaskSection";
import { SuggestionsSection } from "./bot-settings/SuggestionsSection";
import { BotNameTitleStack } from "./bot-settings/BotNameTitleStack";
import { PackageProvenance } from "./bot-settings/PackageProvenance";
import { ComputerPanel } from "./ComputerPanel";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { t } from "@/lib/i18n";
import { setCodingPanelHost } from "@/lib/coding-panel-host";
import { canEditBotField } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useBotSectionAvailability, useBotSectionContent } from "./bot-settings/useBotSectionContent";
import { botsReadOnlyText } from "@/lib/permissions";
import { RemoteSessionsSection } from "./remote-session/RemoteSessionsSection";
import { PanelPageHostProvider } from "./bot-settings/PanelPage";

/** #2149: the panel body's scroll per bot and tab, put back when the header
 * pill reopens the panel it closed. */
const panelScroll = new Map<string, number>();

/**
 * Bot panel mascot box size (#2196). A shape's painted body fills ~65% of its
 * box (30×28 in a 46 box); 92 yields a ~60px visible form, matching Grok Bot.
 * Locked by BotSettingsDialog.mascot-size.test.ts — do not shrink.
 */
export const BOT_PANEL_AVATAR_SIZE = 92;

export function BotSettingsDialog({ bot, onOpenVmWorkspace }: {
  bot: Bot;
  onOpenVmWorkspace?: (botId: string) => void;
  /** Accepted for upstream callers; this panel is a resizable column. */
  overlay?: boolean;
}) {
  const advanced = useAdvancedMode();
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({ botSettingsSection: current.botSettingsSection, botSettingsExpandAccordion: current.botSettingsExpandAccordion, computerOpen: current.computerOpen, config: current.config, botPanelTab: current.botPanelTab, botPanelRestored: current.botPanelRestored, codingChat: current.codingChat }), shallowEqual);
  const runs = useStoreSelector((current) => botRoutineRuns(current, bot.id), shallowEqual);
  const { padClass, dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const section = state.botSettingsSection;
  const dialogRef = useRef<HTMLElement | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const asideRef = useCallback((node: HTMLElement | null) => { dialogRef.current = node; setPanelHost(node); }, []);
  // Keep expansion in the store too: header deep links can arrive while
  // this panel is already mounted, including after collapsing the same row.
  const collapsed = !state.botSettingsExpandAccordion;
  // Every deep link that reaches the panel (the old Details, Routines)
  // lands on Activity: the store resets the tab then (#2149: kept in the
  // store so the header pill can reopen the panel on the tab it closed).
  const pickedTab: PanelTab = state.botPanelTab?.botId === bot.id ? state.botPanelTab.tab : "activity";
  // The computer view is the store's computerOpen, so every existing "open
  // the computer" link (the old Computer tab's included) still lands on it,
  // pushed over Activity. A bot that works nowhere (Works on: Off) and
  // Simple have no computer to show: the link lands on Activity.
  const computerOff = bot.computer === "off";
  const computerShown = showsComputer({ advanced, computerOff });
  const computerView = computerShown && state.computerOpen;
  // an organization server's bots act as Perspicax roles: a recent refusal
  // shows as one row in Activity > Permissions
  const rolesOn = Boolean(state.config?.viewer?.role);
  // The Coding tab shows only while this bot's coding chat is the open
  // conversation (JC 2026-11-06); leaving it, a Coding pick falls back to
  // Activity.
  const codingChatKey = state.codingChat?.botId === bot.id ? state.codingChat.itemId : null;
  const panelTabs = visiblePanelTabs({ advanced, computerOff, coding: codingChatKey !== null });
  const tab: PanelTab = panelTabs.includes(pickedTab) ? pickedTab : "activity";
  // Opening a coding chat brings its tab forward, where its session is.
  useEffect(() => {
    if (codingChatKey !== null) dispatch({ type: "pickBotPanelTab", botId: bot.id, tab: "coding" });
  }, [codingChatKey, bot.id, dispatch]);
  // the Library holds the bot's files (an achievement teaches it)
  useEffect(() => {
    if (tab === "library" && !computerView) reportAchievement("files.opened");
  }, [tab, computerView]);
  const chooseTab = (next: PanelTab) => {
    if (state.computerOpen || !collapsed) dispatch({ type: "toggleSettings", open: true });
    dispatch({ type: "pickBotPanelTab", botId: bot.id, tab: next });
  };
  // Suggested > Add to meeting opens a new routine in Upcoming.
  const [meetingRequest, setMeetingRequest] = useState(0);
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };
  const dockedPanel = useDockedPanelWidth(BOT_PANEL_BOUNDS);
  // Compact head: once the in-flow tabs reach the top bar, they move into it.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const codingHost = useCallback((element: HTMLDivElement | null) => setCodingPanelHost(bot.id, element), [bot.id]);
  const codingActivityHost = useCallback((element: HTMLDivElement | null) => setCodingPanelHost(bot.id, element, "activity"), [bot.id]);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const onBodyScroll = () => {
    const body = bodyRef.current;
    const tabs = tabsRef.current;
    if (!body || !tabs) return;
    setCompact(body.scrollTop > 0 && tabs.offsetTop - body.scrollTop <= 0);
  };
  // #2149: reopened by the header pill, the panel scrolls back where it was.
  const restoredScroll = useRef(state.botPanelRestored ? panelScroll.get(`${bot.id}:${tab}`) : undefined);
  useEffect(() => {
    const top = restoredScroll.current;
    restoredScroll.current = undefined;
    if (!top) return;
    const frame = window.requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = top;
      onBodyScroll();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  // The bot's "..." menu: under its button in the header, or where a right
  // click on the mascot or the name happened.
  const [actionsMenu, setActionsMenu] = useState<BotActionsMenuAnchor | null>(null);
  const [renameRequest, setRenameRequest] = useState(0);
  const openActionsAt = (event: React.MouseEvent) => {
    event.preventDefault();
    setActionsMenu({ x: event.clientX, y: event.clientY });
  };
  const dataItem = useDataWindowItem(bot);
  const { slackUrl } = useBotSectionAvailability(bot.id);
  const { dialogs, derived } = useBotSectionContent(bot, {
    section,
    expanded: !collapsed,
    // Sections other than Details open in the persona editor (store).
    onOpenSection: (target) => dispatch({ type: "toggleSettings", open: true, section: target }),
    returnFocusRef: dialogRef,
    slackUrl,
  });

  useEffect(() => {
    // A deep link to Routines scrolls to its row.
    if (collapsed) return;
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside this one (the routine editor, a skill
      // review, the model picker's popover, a computer warning) owns Escape
      // while it is up: Escape closes only that layer.
      // Only a *visible* nested dialog owns Escape. A hidden or
      // zero-size leftover (display:none, empty hit box) must not trap
      // the settings panel's own dismiss path.
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      // A pushed page (PanelPage) inside this panel owns Escape: it is a
      // nested [role=dialog] and the check above leaves it alone. A key
      // pressed with focus outside this panel belongs to whoever holds it.
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
        dispatch({ type: "toggleComputer", open: false });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  const tabList = (inBar: boolean) => (
    <div
      role="tablist"
      aria-label={t("botPanel.tabsAria")}
      data-panel-tabs-compact={inBar ? "" : undefined}
      onKeyDown={(event) => {
        // Arrow keys move between tabs, as in any tab list.
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = panelTabs[(panelTabs.indexOf(tab) + step + panelTabs.length) % panelTabs.length]!;
        chooseTab(next);
        event.currentTarget.querySelector<HTMLElement>(`[data-panel-tab="${next}"]`)?.focus();
      }}
      className="flex max-w-full items-center gap-1"
    >
      {panelTabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-panel-tab={id}
          aria-selected={tab === id}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => chooseTab(id)}
          className={cn(
            "rounded-full px-3 py-[3px] text-[14px] font-normal leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            tab === id ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
          )}
        >
          {t(`botPanel.tab.${id}`)}
        </button>
      ))}
    </div>
  );
  const showCompact = compact && !computerView;

  return (
    <>
      <PanelPageHostProvider value={panelHost}>
      <aside
        ref={asideRef}
        role="dialog"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        style={{ width: dockedPanel.width }}
        data-panel-bot={bot.id}
        className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-[var(--bot-panel-bg)] outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      >
        <DockedPanelResizeHandle label="Resize settings" panel={dockedPanel} />
        {(macInset || browser) && <div className="content-topbar-strip" />}
        {/* Top bar: only the controls, the way the reference design's panel opens. On
            Windows it drops below the caption buttons (padClass). */}
        <div {...dragProps} className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
          {computerView ? (
            <button
              type="button"
              data-bot-panel-back=""
              onClick={() => dispatch({ type: "toggleSettings", open: true })}
              aria-label={t("botPanel.computerCard.back")}
              title={t("botPanel.computerCard.back")}
              className={CIRCLE_BUTTON}
            >
              <ArrowLeft size={18} strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              data-bot-panel-gear=""
              // a Settings section, so the bot's profile page opens on its Settings tab (#2126)
              onClick={() => dispatch({ type: "openPersonaEditor", botId: bot.id, section: "appearance" })}
              aria-label={t("botPanel.editPersona")}
              title={t("botPanel.editPersona")}
              className={CIRCLE_BUTTON}
            >
              <Settings size={18} strokeWidth={1.75} />
            </button>
          )}
          {showCompact && <div className="pointer-events-none absolute inset-x-14 flex justify-center [&>*]:pointer-events-auto">{tabList(true)}</div>}
          <div className="flex items-center gap-2">
            <BotActionsMenu
              bot={bot}
              anchor={actionsMenu}
              onAnchor={setActionsMenu}
              onRename={() => setRenameRequest((count) => count + 1)}
              data={dataItem}
              trigger={false}
            />
            <button
              type="button"
              onClick={closePanel}
              aria-label={t("common.close")}
              title={t("common.close")}
              className={CIRCLE_BUTTON}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          onScroll={(event) => {
            panelScroll.set(`${bot.id}:${tab}`, event.currentTarget.scrollTop);
            onBodyScroll();
          }}
          className="content-card-body relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0"
        >
          {viewerBotsReadOnly(state.config) && (
            <p role="note" data-bots-read-only className="mx-4 mb-2 rounded-lg bg-raised/60 px-3 py-2 text-center text-[12.5px] leading-snug text-ink-secondary">{botsReadOnlyText(state.config)}</p>
          )}
          {computerView ? (
            <div data-bot-panel-computer="" className="px-4 pt-2">
              <ComputerPanel bot={bot} onOpenVmWorkspace={onOpenVmWorkspace} embedded />
            </div>
          ) : (
            <>
              {/* Who this is: it scrolls away, the tabs stay */}
              <div className="flex shrink-0 flex-col items-center px-4 pb-1">
                <BotProfileAvatarCard
                  bot={bot}
                  size={BOT_PANEL_AVATAR_SIZE}
                  activeState={derived.activeState}
                  mascotMotion={derived.mascotMotion}
                  onPatch={derived.patch}
                  onContextMenu={openActionsAt}
                />
                {/* The name on its line, the title under it, smaller and
                    secondary (JC: never "Name · Title" on one line); both
                    edited where they show. Spacing matches Grok Bot's panel
                    header (#2196). */}
                <BotNameTitleStack
                  name={bot.name}
                  title={bot.title}
                  onSaveName={canEditBotField(state.config, bot, "name") ? (name) => derived.patch({ name }) : undefined}
                  onSaveTitle={canEditBotField(state.config, bot, "title") ? (title) => derived.patch({ title }) : undefined}
                  renameRequest={renameRequest}
                  onContextMenu={openActionsAt}
                />
              </div>
              {/* The tabs; once scrolled to the top they move into the top bar.
                  pt-10 keeps ~40px under the title, as on Grok Bot (#2196). */}
              <div ref={tabsRef} data-bot-panel-tabs="" className={cn("flex justify-center px-4 pb-4 pt-10", showCompact && "invisible")}>
                {tabList(false)}
              </div>

              {tab === "activity" && (
                <div className="flex flex-col gap-5 px-4 pb-6">
                  {/* #2285: an open coding window's pods that are not coding
                      work of their own (Connectors) stay here. */}
                  <div ref={codingActivityHost} data-coding-activity-host="" className="flex flex-col gap-5 empty:hidden" />
                  <section data-bot-settings-section="routines" className="flex flex-col gap-2">
                    <RoutinesSection bot={bot} routines={derived.botRoutines} runs={runs} grouped upcoming createRequest={meetingRequest} />
                  </section>
                  <SuggestionsSection
                    bot={bot}
                    routineCount={derived.botRoutines.length}
                    slackUrl={slackUrl}
                    onAddToMeeting={() => setMeetingRequest((count) => count + 1)}
                  />
                  {computerShown && (
                    <ComputerCard
                      bot={bot}
                      onPatch={derived.patch}
                      readOnly={!canEditBotField(state.config, bot, "computer")}
                    />
                  )}
                  <VoiceChatCard bot={bot} onPatch={derived.patch} readOnly={!canEditBotField(state.config, bot, "voice")} />
                  {/* What the bot does now and did: each folds away when empty. */}
                  <BotTaskSection botId={bot.id} />
                  <ActivitySection bot={bot} />
                  {/* Temporary attended remote sessions: only while active.
                      Unattended hosts live in the Computer place picker. */}
                  <RemoteSessionsSection bot={bot} />
                  {rolesOn && <RolePermissionsSection botId={bot.id} />}
                  <PackageProvenance bot={bot} />
                </div>
              )}

              {tab === "library" && <LibraryTab bot={bot} />}

              {/* #2285, JC 2026-11-06: the open coding chat's session
                  (Status, Duration, Tokens) and dev pods (Environment,
                  Context, Changes, Background tasks, Outputs). */}
              {tab === "coding" && (
                <div data-bot-panel-coding="" className="flex flex-col gap-5 px-4 pb-6">
                  <div ref={codingHost} data-coding-panel-host="" className="flex flex-col gap-5 empty:hidden" />
                </div>
              )}
            </>
          )}

        </div>
      </aside>
      </PanelPageHostProvider>
      {dialogs}
    </>
  );
}
