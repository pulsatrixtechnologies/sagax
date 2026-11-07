// Settings > Appearance, laid out as the reference design's settings pages (0.5.6):
// grey headings outside the cards, compact rows (label at the left, control
// at the right), pill menus rather than native selects, no help text but a
// short grey line where it avoids a mistake. The skin is chosen here only:
// its family, variant and Light, Dark or Auto (2026-10-19; General's Theme
// menu of #573 is gone, one option in one place).
import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { FLOATING_LIVELINESS, floatingBotPrefs, HOTKEY_CHOICES, hotkeyLabel, setFloatingBarkSound, setFloatingFlyAway, setFloatingHotkey, setFloatingLiveliness, subscribeFloatingBots, type FloatingLiveliness, type HotkeyChoice } from "@/lib/floating-bots";
import { useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canEditConfig } from "@/lib/viewer";
import { FONT_IDS, applyFont, readFont, type FontId } from "@/lib/fonts";
import { setAdvancedMode, useAdvancedMode } from "@/lib/interface-mode";
import { useSidebarHidden } from "@/lib/sidebar-hidden";
import { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";
import { useOrgPeople } from "@/lib/perspicax-org";
import { viewerActorId } from "@/lib/viewer";
import { setShowAllHistory, setShowPermissions, setShowSuggestions, useShowAllHistory, useShowPermissions, useShowSuggestions } from "@/lib/panel-visibility";
import { chooseThreadsView, useShowThreadsChoice, useThreadsLocationChoice, type ThreadsView } from "@/lib/thread-preferences";
import { FRESH_TOPIC_AFTER_CHOICES, useFreshTopicAfter, writeFreshTopicAfter, type FreshTopicAfterHours } from "@/lib/fresh-topic";
import { parseSidebarDensity, setSidebarDensity, SIDEBAR_DENSITIES, useSidebarDensity, type SidebarDensity } from "@/lib/sidebar-preferences";
import { setShowRunCard, useShowRunCard } from "@/lib/run-card-preferences";
import { setStreamReplies, useStreamReplies } from "@/lib/stream-replies-preference";
import { CHAT_WIDTHS, parseChatWidth, setChatWidth, useChatWidth, type ChatWidth } from "@/lib/chat-width-preference";
import { parseSendKey, SEND_KEYS, sendKeyLabel, setSendKey, useSendKey } from "@/lib/send-key";
import { setShowSidebarLogo, useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { setSidebarPeopleApart, useSidebarPeopleApart } from "@/lib/sidebar-people-apart-preference";
import { setShowRoutinesBadge, useShowRoutinesBadge } from "@/lib/routines-badge-preferences";
import { setShowInspectorButton, useShowInspectorButton } from "@/lib/inspector-preferences";
import { setShowTurnTiming, useShowTurnTiming } from "@/lib/turn-timing-preferences";
import { contrastChoice, CONTRAST_CHOICES, MOTION_CHOICES, motionChoice, TEXT_SIZE_CHOICES, textSizeChoice } from "@/lib/accessibility-preferences";
import { BOT_HOTKEY_MODIFIERS, botHotkeyModifierChoice, botHotkeysChoice, hardwareAccelerationChoice, hasDesktopShellPreferences, spellcheckChoice } from "@/lib/desktop-shell-preferences";
import { CompactRow, DescribedRow, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";
import { SidebarHiddenSettings } from "../SidebarHiddenSettings";
import { SkinPicker } from "../SkinPicker";
import { setBotAccentEnabled, useBotAccentEnabled } from "@/lib/bot-accent";
import { setHdMascotsEnabled, useHdMascots } from "@/lib/hd-mascots-preference";
import { HD_CHARACTERS } from "../hd-mascots/manifest";
import { AppIconPicker, appIconAvailable } from "./AppIconPicker";
import { BackgroundEffectsPicker } from "./BackgroundEffectsPicker";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";

/** The reference design's "1 ⌄" pill (Computer > Other computers, #576): what a row
 * folds, opened in place. `children` is the pill's text (a count, a word). */
export function DisclosurePill({ open, onToggle, label, children }: { open: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className="inline-flex h-7 min-h-[44px] items-center gap-1 rounded-full px-2.5 text-[13px] text-ink tabular-nums transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 aria-expanded:bg-hover motion-reduce:transition-none md:min-h-0"
    >
      {children}
      <ChevronDown size={13} aria-hidden="true" className={cn("text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </button>
  );
}

/** A local switch row: label at the left, the switch at the right. */
function SwitchLine({ label, checked, onChange, rowId, ariaLabel }: { label: string; checked: boolean; onChange: (next: boolean) => void; rowId?: string; ariaLabel?: string }) {
  return (
    <CompactRow label={label} rowId={rowId}>
      <Switch checked={checked} aria-label={ariaLabel ?? label} onClick={() => onChange(!checked)} />
    </CompactRow>
  );
}

/** Moved to App > Advanced (#2080 L2). Exported for AppPage. */
export function InterfaceModeRow() {
  const advanced = useAdvancedMode();
  // The one grey line kept: switching back to Simple loses nothing.
  return (
    <DescribedRow label={t("settings.advancedMode.title")} description={t("settings.advancedMode.subtitle")} rowId="advancedMode">
      <Switch checked={advanced} aria-label={t("settings.advancedMode.title")} onClick={() => setAdvancedMode(!advanced)} />
    </DescribedRow>
  );
}

function FontRow() {
  const [current, setCurrent] = useState<FontId>(readFont);
  return (
    <CompactRow label={t("settings.font.title")} rowId="font">
      <PillSelect
        value={current}
        ariaLabel={t("settings.font.aria")}
        onChange={(id) => {
          applyFont(id);
          setCurrent(id);
        }}
        options={FONT_IDS.map((id) => ({ value: id, label: t(`settings.font.${id}`) }))}
      />
    </CompactRow>
  );
}

/** Which keys send a message, on this device only. Moved to App > Input
 * (#2080 L2). The grey line says the other choice still sends. */
export function SendKeyRow() {
  const sendKey = useSendKey();
  return (
    <DescribedRow label={t("settings.sendKey.title")} description={t("settings.sendKey.short", { key: sendKeyLabel("mod-enter") })} rowId="sendKey">
      <PillSelect
        value={sendKey}
        ariaLabel={t("settings.sendKey.title")}
        onChange={(next) => setSendKey(parseSendKey(next))}
        options={SEND_KEYS.map((mode) => ({ value: mode, label: sendKeyLabel(mode) }))}
      />
    </DescribedRow>
  );
}

function SidebarDensityRow() {
  const density = useSidebarDensity();
  return (
    <CompactRow label={t("sidebar.density.title")} rowId="sidebarDensity">
      <PillSelect<SidebarDensity>
        value={density}
        ariaLabel={t("sidebar.density.chooseAria")}
        onChange={(next) => setSidebarDensity(parseSidebarDensity(next))}
        options={SIDEBAR_DENSITIES.map((option) => ({
          value: option,
          label: t(option === "icons" ? "sidebar.density.iconsOnly" : option === "compact" ? "sidebar.density.compact" : "sidebar.density.comfortable"),
        }))}
      />
    </CompactRow>
  );
}

function ChatWidthRow() {
  const width = useChatWidth();
  return (
    <CompactRow label={t("settings.chatWidth.title")} rowId="chatWidth">
      <PillSelect<ChatWidth>
        value={width}
        ariaLabel={t("settings.chatWidth.chooseAria")}
        onChange={(next) => setChatWidth(parseChatWidth(next))}
        options={CHAT_WIDTHS.map((option) => ({
          value: option,
          label: t(
            option === "wide"
              ? "settings.chatWidth.wide"
              : option === "full"
                ? "settings.chatWidth.full"
                : "settings.chatWidth.reading",
          ),
        }))}
      />
    </CompactRow>
  );
}


export { chooseThreadsView, type ThreadsView };

/** One choice for whether and where conversation threads show. Both stored
 * values stay: hiding keeps the last place for when they return. */
function ThreadsViewRow() {
  const enabled = useShowThreadsChoice();
  const location = useThreadsLocationChoice();
  const value: ThreadsView = enabled ? location : "hidden";
  return (
    <CompactRow label={t("settings.threadsView.title")} rowId="threadsView">
      <PillSelect<ThreadsView>
        value={value}
        ariaLabel={t("settings.threadsView.title")}
        onChange={chooseThreadsView}
        options={[
          { value: "hidden", label: t("settings.threadsView.single") },
          { value: "header", label: t("settings.threadsLocation.header") },
          { value: "sidebar", label: t("settings.threadsLocation.sidebar") },
        ]}
      />
    </CompactRow>
  );
}

/** One conversation only: how long away (or quiet) before coming back opens
 * a fresh topic (src/lib/fresh-topic.ts). Hidden while threads show. */
function FreshTopicRow() {
  const enabled = useShowThreadsChoice();
  const hours = useFreshTopicAfter();
  if (enabled) return null;
  return (
    <DescribedRow label={t("settings.freshTopic.title")} description={t("settings.freshTopic.subtitle")} rowId="freshTopic">
      <PillSelect<string>
        value={String(hours)}
        ariaLabel={t("settings.freshTopic.title")}
        onChange={(next) => writeFreshTopicAfter(Number(next) as FreshTopicAfterHours)}
        options={FRESH_TOPIC_AFTER_CHOICES.map((choice) => ({
          value: String(choice),
          label: choice === 0 ? t("settings.freshTopic.never") : t("settings.freshTopic.hours", { count: choice }),
        }))}
      />
    </DescribedRow>
  );
}

/** The open bot's colour as the app's accent (src/lib/bot-accent.ts). */
function BotAccentRow() {
  const enabled = useBotAccentEnabled();
  return (
    <DescribedRow label={t("settings.botAccent.title")} description={t("settings.botAccent.subtitle")} rowId="botAccent">
      <Switch checked={enabled} aria-label={t("settings.botAccent.title")} onClick={() => setBotAccentEnabled(!enabled)} />
    </DescribedRow>
  );
}

export function HdMascotsRow({ characters = HD_CHARACTERS }: { characters?: readonly string[] }) {
  const enabled = useHdMascots();
  if (characters.length === 0) return null;
  return (
    <DescribedRow label={t("settings.hdMascots.title")} description={t("settings.hdMascots.subtitle")} rowId="hdMascots">
      <Switch checked={enabled} aria-label={t("settings.hdMascots.title")} onClick={() => setHdMascotsEnabled(!enabled)} />
    </DescribedRow>
  );
}

/** Show tool calls. On an organization server (#1098, 2026-10-28) each
 * person's own display choice (/api/me/experimental), with no right to edit
 * the installation; elsewhere the installation's. */
export function ToolCallsRow() {
  const { state, dispatch } = useStore();
  const enabled = showToolCallsEnabled(state.config);
  // An older server refuses a member's own choice (shared/server-features.ts):
  // the switch shows the server's state, locked, with the neutral line.
  const personalServed = useServerFeature("memberPersonSettings") !== "no";
  const personal = state.config?.personalSettings === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const missing = personal && !personalServed;
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (personal) {
        await api("/api/me/experimental", { method: "PATCH", body: JSON.stringify({ features: { showToolCalls: !enabled } }) });
        dispatch({ type: "configStatus", config: await api<ConfigStatus>("/api/config") });
        return;
      }
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { showToolCalls: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      if (featureMissingOnServer("memberPersonSettings", cause)) return;
      setError(cause instanceof Error ? cause.message : t("settings.toolCalls.error"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <DescribedRow
      label={t("settings.toolCalls.title")}
      rowId="toolCalls"
      below={error ? <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>
        : missing ? <p role="note" data-needs-server-update="" className="mt-1 text-[12px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.toolCalls.aria")}
        disabled={saving || missing}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </DescribedRow>
  );
}

/** App icon: the picker opens under its row. Moved to App > Startup (#2080 L2). */
export function AppIconRow() {
  const [open, setOpen] = useState(false);
  if (!appIconAvailable()) return null;
  return (
    <DescribedRow
      label={t("settings.appIcon.title")}
      rowId="appIcon"
      keywords="dock taskbar"
      below={open && <div className="mt-2.5"><AppIconPicker /></div>}
    >
      <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.appIcon.title")}>
        {t(open ? "settings.appearance.hide" : "settings.appearance.choose")}
      </DisclosurePill>
    </DescribedRow>
  );
}

/** Desktop mascots: Behavior folds fly-away, liveliness, bark, hotkey, captions. */
function DesktopMascotsRows() {
  const [open, setOpen] = useState(false);
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  const call = useCallSettings();
  const captions = call.captions !== false;
  const hotkeyServed = typeof window !== "undefined" && Boolean((window.ogb?.floatingBots as { hotkey?: unknown } | undefined)?.hotkey);
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform || navigator.userAgent);
  const onDesktop = typeof window !== "undefined" && Boolean(window.ogb?.floatingBots);
  if (!onDesktop) return null;
  return (
    <div data-settings-card="appearance.mascots" data-open={open ? "true" : "false"}>
      <DescribedRow
        label={t("settings.mascots.behavior")}
        description={t("settings.mascotsCard.title")}
        rowId="mascotsBehavior"
        below={open && (
          <div className="mt-2 flex flex-col" data-mascot-rows="">
            <SwitchLine label={t("settings.floatingBots.flyAway.title")} checked={prefs.flyAway} onChange={setFloatingFlyAway} />
            <CompactRow label={t("settings.floatingBots.liveliness.title")}>
              <PillSelect<FloatingLiveliness>
                value={prefs.liveliness}
                ariaLabel={t("settings.floatingBots.liveliness.title")}
                onChange={setFloatingLiveliness}
                options={FLOATING_LIVELINESS.map((level) => ({ value: level, label: t(`settings.floatingBots.liveliness.${level}`) }))}
              />
            </CompactRow>
            <SwitchLine label={t("settings.floatingBots.barkSound.title")} checked={prefs.barkSound} onChange={setFloatingBarkSound} />
            {hotkeyServed && (
              <CompactRow label={t("settings.floatingBots.hotkey.title")}>
                <PillSelect<HotkeyChoice>
                  value={prefs.hotkeyKeys}
                  disabled={!prefs.hotkey}
                  ariaLabel={t("settings.floatingBots.hotkey.keys")}
                  onChange={(keys) => setFloatingHotkey({ keys })}
                  options={HOTKEY_CHOICES.map((keys) => ({ value: keys, label: hotkeyLabel(keys, mac) }))}
                />
                <Switch checked={prefs.hotkey} aria-label={t("settings.floatingBots.hotkey.title")} onClick={() => setFloatingHotkey({ on: !prefs.hotkey })} />
              </CompactRow>
            )}
            <SwitchLine label={t("settings.floatingBots.captions.title")} checked={captions} onChange={(next) => writeCallSettings({ captions: next })} />
          </div>
        )}
      >
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.mascots.behavior")}>
          {t(open ? "settings.appearance.hide" : "settings.appearance.show")}
        </DisclosurePill>
      </DescribedRow>
    </div>
  );
}

/** Settings > Appearance > Accessibility: motion, contrast and text size,
 * each its own key for sagax_settings (appearance.reduceMotion, highContrast,
 * textSize). */
export function AccessibilityGroup() {
  const motion = motionChoice.use();
  const contrast = contrastChoice.use();
  const size = textSizeChoice.use();
  return (
    <div data-settings-card="appearance.accessibility">
      <SettingsGroup title={t("settings.group.accessibility")} groupId="accessibility">
        <CompactRow label={t("settings.a11y.motion.title")} rowId="reduceMotion">
          <PillSelect
            value={motion}
            ariaLabel={t("settings.a11y.motion.title")}
            onChange={(next) => motionChoice.set(next)}
            options={MOTION_CHOICES.map((id) => ({ value: id, label: t(`settings.a11y.motion.${id}`) }))}
          />
        </CompactRow>
        <CompactRow label={t("settings.a11y.contrast.title")} rowId="highContrast">
          <PillSelect
            value={contrast}
            ariaLabel={t("settings.a11y.contrast.title")}
            onChange={(next) => contrastChoice.set(next)}
            options={CONTRAST_CHOICES.map((id) => ({ value: id, label: t(`settings.a11y.contrast.${id}`) }))}
          />
        </CompactRow>
        <CompactRow label={t("settings.a11y.textSize.title")} rowId="textSize">
          <PillSelect
            value={size}
            ariaLabel={t("settings.a11y.textSize.title")}
            onChange={(next) => textSizeChoice.set(next)}
            options={TEXT_SIZE_CHOICES.map((id) => ({ value: id, label: t(`settings.a11y.textSize.${id}`) }))}
          />
        </CompactRow>
      </SettingsGroup>
    </div>
  );
}

/** Spell check: App > Input (#2080 L2). */
export function SpellcheckRow() {
  const spelling = spellcheckChoice.use() === "true";
  if (!hasDesktopShellPreferences()) return null;
  return <SwitchLine label={t("settings.spellcheck.title")} checked={spelling} onChange={(next) => spellcheckChoice.set(next ? "true" : "false")} rowId="spellcheck" />;
}

/** GPU acceleration: App > Advanced (#2080 L2). */
export function HardwareAccelerationRow() {
  const acceleration = hardwareAccelerationChoice.use() === "true";
  if (!hasDesktopShellPreferences()) return null;
  return (
    <DescribedRow label={t("settings.hardwareAcceleration.title")} description={t("settings.hardwareAcceleration.note")} rowId="hardwareAcceleration">
      <Switch checked={acceleration} aria-label={t("settings.hardwareAcceleration.title")} onClick={() => hardwareAccelerationChoice.set(acceleration ? "false" : "true")} />
    </DescribedRow>
  );
}

/** Global bot hotkeys: App > Startup (#2080 L2). */
export function BotHotkeysRows() {
  const hotkeys = botHotkeysChoice.use() === "true";
  const chord = botHotkeyModifierChoice.use();
  if (!hasDesktopShellPreferences()) return null;
  const menuBar = window.ogb?.platform === "darwin";
  if (!menuBar) return null;
  return (
    <>
      <DescribedRow label={t("settings.botHotkeys.title")} description={t("settings.botHotkeys.note")} rowId="botHotkeys">
        <Switch checked={hotkeys} aria-label={t("settings.botHotkeys.title")} onClick={() => botHotkeysChoice.set(hotkeys ? "false" : "true")} />
      </DescribedRow>
      {hotkeys && (
        <CompactRow label={t("settings.botHotkeys.chord")} rowId="botHotkeyChord">
          <PillSelect
            value={chord}
            ariaLabel={t("settings.botHotkeys.chord")}
            onChange={(next) => botHotkeyModifierChoice.set(next)}
            options={BOT_HOTKEY_MODIFIERS.map((id) => ({ value: id, label: t(`settings.botHotkeys.chord.${id}`) }))}
          />
        </CompactRow>
      )}
    </>
  );
}

function ThemeCustomizeRows() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DescribedRow
        label={t("settings.theme.customize")}
        description={t("settings.theme.customizeSummary")}
        rowId="themeCustomize"
        below={open ? <div className="mt-2"><SkinPicker modeFirst={false} showFamilies={false} customizeOpen /><FontRow /></div> : null}
      >
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.theme.customize")}>
          {t(open ? "settings.appearance.hide" : "settings.appearance.show")}
        </DisclosurePill>
      </DescribedRow>
    </>
  );
}

function BackgroundChooseRow() {
  const [open, setOpen] = useState(false);
  return (
    <div data-settings-card="appearance.backgroundEffects">
      <DescribedRow
        label={t("settings.backgroundEffects.title")}
        rowId="backgroundEffects"
        below={open ? <div className="mt-2"><BackgroundEffectsPicker /></div> : null}
      >
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.backgroundEffects.title")}>
          {t(open ? "settings.appearance.hide" : "settings.background.choose")}
        </DisclosurePill>
      </DescribedRow>
    </div>
  );
}

function SidebarHiddenFold() {
  const [open, setOpen] = useState(false);
  const { state } = useStore();
  const hidden = useSidebarHidden();
  const people = useOrgPeople();
  const count = hiddenSidebarRows(hidden.items, { bots: state.bots, groups: state.groups, viewerId: viewerActorId(state.config), people }).length;
  return (
    <DescribedRow
      label={t("settings.sidebarHidden.title")}
      description={t("settings.sidebar.hiddenSummary", { count })}
      rowId="sidebarHiddenFold"
      below={open ? <div className="mt-2"><SidebarHiddenSettings /></div> : null}
    >
      <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.sidebarHidden.title")}>
        {t(open ? "settings.appearance.hide" : "settings.appearance.show")}
      </DisclosurePill>
    </DescribedRow>
  );
}

export function AppearanceSettings() {
  const { state } = useStore();
  const remoteActive = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const editConfig = canEditConfig(state.config);
  // #1098: on an organization server Show tool calls is each person's own.
  const personalSettings = state.config?.personalSettings === true;
  const runCard = useShowRunCard();
  const inspector = useShowInspectorButton();
  const turnTiming = useShowTurnTiming();
  const logo = useShowSidebarLogo();
  const peopleApart = useSidebarPeopleApart();
  const routinesBadge = useShowRoutinesBadge();
  const suggestions = useShowSuggestions();
  const allHistory = useShowAllHistory();
  const permissions = useShowPermissions();
  const streamReplies = useStreamReplies();
  return (
    <>
      <div data-settings-card="appearance.skin">
        <SettingsGroup title={t("settings.theme.title")} groupId="theme">
          <SkinPicker modeFirst customizeOpen={false} />
          <BotAccentRow />
          <ThemeCustomizeRows />
          <BackgroundChooseRow />
        </SettingsGroup>
      </div>
      <SettingsGroup title={t("settings.group.conversation")} groupId="conversation">
        <ChatWidthRow />
        <ThreadsViewRow />
        <FreshTopicRow />
        <SwitchLine label={t("settings.streamReplies.title")} ariaLabel={t("settings.streamReplies.show")} checked={streamReplies} onChange={setStreamReplies} rowId="streamReplies" />
        {(personalSettings || (!remoteActive && editConfig)) && <ToolCallsRow />}
      </SettingsGroup>
      <SettingsGroup title={[t("settings.runCard.title"), t("settings.inspectorButton.title"), t("settings.turnTiming.title")].join(", ")} groupId="conversationAdvanced" advanced>
        <SwitchLine label={t("settings.runCard.title")} ariaLabel={t("settings.runCard.show")} checked={runCard} onChange={setShowRunCard} rowId="runCard" />
        <SwitchLine label={t("settings.inspectorButton.title")} ariaLabel={t("settings.inspectorButton.show")} checked={inspector} onChange={setShowInspectorButton} rowId="inspectorButton" />
        <SwitchLine label={t("settings.turnTiming.title")} ariaLabel={t("settings.turnTiming.show")} checked={turnTiming} onChange={setShowTurnTiming} rowId="turnTiming" />
      </SettingsGroup>
      <SettingsGroup title={t("settings.group.sidebar")} groupId="sidebar">
        <SidebarDensityRow />
        <SwitchLine label={t("settings.sidebarPeopleApart.title")} ariaLabel={t("settings.sidebarPeopleApart.show")} checked={peopleApart} onChange={setSidebarPeopleApart} rowId="sidebarPeopleApart" />
        <SwitchLine label={t("settings.showSuggestions.title")} ariaLabel={t("settings.showSuggestions.show")} checked={suggestions} onChange={setShowSuggestions} rowId="showSuggestions" />
        <SwitchLine label={t("settings.allHistory.title")} ariaLabel={t("settings.allHistory.show")} checked={allHistory} onChange={setShowAllHistory} rowId="allHistory" />
        <SwitchLine label={t("settings.showPermissions.title")} ariaLabel={t("settings.showPermissions.show")} checked={permissions} onChange={setShowPermissions} rowId="showPermissions" />
        <SidebarHiddenFold />
      </SettingsGroup>
      <SettingsGroup title={[t("settings.sidebarLogo.title"), t("settings.routinesBadge.title")].join(", ")} groupId="sidebarAdvanced" advanced>
        <SwitchLine label={t("settings.sidebarLogo.title")} ariaLabel={t("settings.sidebarLogo.show")} checked={logo} onChange={setShowSidebarLogo} rowId="sidebarLogo" />
        <SwitchLine label={t("settings.routinesBadge.title")} ariaLabel={t("settings.routinesBadge.show")} checked={routinesBadge} onChange={setShowRoutinesBadge} rowId="routinesBadge" />
      </SettingsGroup>
      <div data-settings-card="appearance.mascots-hd">
        <SettingsGroup title={t("settings.group.mascots")} groupId="mascots">
          <HdMascotsRow />
          <DesktopMascotsRows />
        </SettingsGroup>
      </div>
      <AccessibilityGroup />
    </>
  );
}
