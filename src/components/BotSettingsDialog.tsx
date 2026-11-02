// Per-bot settings as a right sidebar with fold-out (accordion) categories:
// same shell pattern as InspectorPanel. Every section lives under
// bot-settings/; their bodies and reads (overview, system-prompt, history)
// are useBotSectionContent, shared with the persona editor. This dialog owns
// which tab is up; every section but Details opens in the persona editor.
// The header holds the bot's one "..." menu (BotActionsMenu) and Close.
import { useEffect, useRef, useState } from "react";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { PanelRight } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useDataWindowItem } from "./DataWindowButton";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { reportAchievement } from "@/lib/achievements";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { BotActionsMenu, type BotActionsMenuAnchor } from "./bot-settings/BotActionsMenu";
import { LibraryTab } from "./bot-settings/LibraryTab";
import { RoutinesSection } from "./bot-settings/RoutinesSection";

import { visiblePanelTabs, type PanelTab } from "./bot-settings/panel-tabs";
import { ActivitySection } from "./bot-settings/ActivitySection";
import { BotTaskSection } from "./bot-settings/BotTaskSection";
import { SuggestionsSection } from "./bot-settings/SuggestionsSection";
import { InlineEditableText } from "./bot-settings/InlineEditableText";
import { PackageProvenance } from "./bot-settings/PackageProvenance";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { ComputerPanel } from "./ComputerPanel";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { t } from "@/lib/i18n";
import { canEditBotField, canSetBotHost, viewerOwnsBot } from "@/lib/bot-capabilities";
import { TeamBotVaultSection } from "./bot-settings/TeamBotVaultSection";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useBotSectionAvailability, useBotSectionContent } from "./bot-settings/useBotSectionContent";
import { botsReadOnlyText } from "@/lib/permissions";

export function BotSettingsDialog({ bot, onOpenVmWorkspace }: {
  bot: Bot;
  onOpenVmWorkspace?: (botId: string) => void;
  /** Accepted for upstream callers; this panel is a resizable column. */
  overlay?: boolean;
}) {
  const advanced = useAdvancedMode();
  const { state, dispatch } = useStore();
  const { padClass, dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const section = state.botSettingsSection;
  const dialogRef = useRef<HTMLElement | null>(null);
  // Keep expansion in the store too: header deep links can arrive while
  // this panel is already mounted, including after collapsing the same row.
  const collapsed = !state.botSettingsExpandAccordion;
  // Every deep link that reaches the panel (Details, Routines) lands on Details.
  const [pickedTab, setPickedTab] = useState<Exclude<PanelTab, "computer">>("details");
  useEffect(() => {
    if (!collapsed) setPickedTab("details");
  }, [collapsed, section]);
  // The Computer tab is the store's computer view, so every existing
  // "open the computer" link still lands on it. A bot that works nowhere
  // (Works on: Off) has no computer to show; Works on stays in the editor.
  const computerOff = bot.computer === "off";
  const panelTabs = visiblePanelTabs({ advanced, computerOff });
  // Simple has no computer tab. An open computer panel is otherwise closed
  // by the shell; until that lands, the tab the person picked stays up.
  const tab: PanelTab = advanced && state.computerOpen && panelTabs.includes("computer") ? "computer" : pickedTab;
  // the Library holds the bot's files (an achievement teaches it)
  useEffect(() => {
    if (tab === "library") reportAchievement("files.opened");
  }, [tab]);
  const chooseTab = (next: PanelTab) => {
    if (next === "computer") {
      if (!panelTabs.includes("computer")) return;
      dispatch({ type: "toggleComputer", open: true });
      return;
    }
    if (state.computerOpen || !collapsed) dispatch({ type: "toggleSettings", open: true });
    setPickedTab(next);
  };
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };
  const dockedPanel = useDockedPanelWidth();
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
      // BotInstructionsDialog portals to document.body, so it is not in this
      // subtree: a key pressed with focus outside this dialog belongs to
      // whatever holds focus, never to us.
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

  return (
    <>
      <aside
        ref={dialogRef}
        role="dialog"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        style={{ width: dockedPanel.width }}
        data-panel-bot={bot.id}
        className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      >
        <DockedPanelResizeHandle label="Resize settings" panel={dockedPanel} />
        {(macInset || browser) && <div className="content-topbar-strip" />}
        {/* Top bar: only the controls, the way the reference design's panel opens. On
            Windows it drops below the caption buttons (padClass). */}
        <div {...dragProps} className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-end px-3", padClass)}>
          <div className="flex items-center gap-2">
            <BotActionsMenu
              bot={bot}
              anchor={actionsMenu}
              onAnchor={setActionsMenu}
              onRename={() => setRenameRequest((count) => count + 1)}
              data={dataItem}
            />
            <button
              type="button"
              onClick={closePanel}
              aria-label={t("common.close")}
              title={t("common.close")}
              className={CIRCLE_BUTTON}
            >
              <PanelRight size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0">
          {viewerBotsReadOnly(state.config) && (
            <p role="note" data-bots-read-only className="mx-4 mb-2 rounded-lg bg-raised/60 px-3 py-2 text-center text-[12.5px] leading-snug text-ink-secondary">{botsReadOnlyText(state.config)}</p>
          )}
          {/* Who this is, then the tabs */}
          <div className="flex shrink-0 flex-col items-center px-4 pb-3">
            <BotProfileAvatarCard
              bot={bot}
              activeState={derived.activeState}
              mascotMotion={derived.mascotMotion}
              onPatch={derived.patch}
              onContextMenu={openActionsAt}
            />
            {/* Name and label are edited where they show; the name stays
                centered on its own line. The description is not shown here. */}
            <div
              className="-mt-1 flex max-w-full items-center justify-center"
              // the bot's menu on the name too, as on the mascot
              onContextMenu={openActionsAt}
            >
              <InlineEditableText
                id="bot-settings-title"
                value={bot.name}
                required
                maxLength={BOT_PROFILE_LIMITS.name}
                ariaLabel={t("botPanel.name.edit")}
                onSave={canEditBotField(state.config, bot, "name") ? (name) => derived.patch({ name }) : undefined}
                editRequest={renameRequest}
                className="text-[17px] font-medium leading-6 text-ink"
              />
            </div>
            {/* The label shows when there is one; adding one is in the
                editor's Profile. */}
            {bot.title?.trim() && (
              <InlineEditableText
                value={bot.title}
                maxLength={BOT_PROFILE_LIMITS.title}
                placeholder={t("botPanel.label.add")}
                ariaLabel={t("botPanel.label.edit")}
                onSave={canEditBotField(state.config, bot, "title") ? (title) => derived.patch({ title }) : undefined}
                muted
                className="mt-0.5 text-[12.5px] leading-4"
              />
            )}
            <div
              role="tablist"
              aria-label={t("botPanel.tabsAria")}
              onKeyDown={(event) => {
                // Arrow keys move between tabs, as in any tab list.
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = panelTabs[(panelTabs.indexOf(tab) + step + panelTabs.length) % panelTabs.length]!;
                chooseTab(next);
                event.currentTarget.querySelector<HTMLElement>(`[data-panel-tab="${next}"]`)?.focus();
              }}
              className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5"
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
                    "rounded-md px-1.5 py-1 text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    tab === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                  )}
                >
                  {t(`botPanel.tab.${id}`)}
                </button>
              ))}
            </div>
          </div>

          {tab === "details" && (
            <div className="flex flex-col gap-6 px-4 pb-6 pt-2">
              <SuggestionsSection bot={bot} routineCount={derived.botRoutines.length} />
              <BotTaskSection botId={bot.id} />
              <ActivitySection bot={bot} />
              {(bot.grants?.length || bot.directGrants?.length) && (viewerOwnsBot(state.config, bot) || canSetBotHost(state.config, bot)) && (
                <TeamBotVaultSection botId={bot.id} botName={bot.name} />
              )}
              <section data-bot-settings-section="routines" className="flex flex-col gap-2">
                <RoutinesSection bot={bot} routines={derived.botRoutines} runs={state.routineRuns} grouped />
              </section>
              <PackageProvenance bot={bot} />
            </div>
          )}

          {tab === "library" && <LibraryTab bot={bot} />}

          {tab === "computer" && (
            <div className="px-4 pt-2">
              <ComputerPanel bot={bot} onOpenVmWorkspace={onOpenVmWorkspace} embedded />
            </div>
          )}

        </div>
      </aside>
      {dialogs}
    </>
  );
}
