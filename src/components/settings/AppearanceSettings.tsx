// Settings > Appearance, laid out as Grok Bot's settings pages (0.5.6, JC):
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
import { setShowAllHistory, setShowSuggestions, useShowAllHistory, useShowSuggestions } from "@/lib/panel-visibility";
import { setShowThreads, setThreadsLocation, useShowThreadsChoice, useThreadsLocationChoice, type ThreadsLocation } from "@/lib/thread-preferences";
import { FRESH_TOPIC_AFTER_CHOICES, useFreshTopicAfter, writeFreshTopicAfter, type FreshTopicAfterHours } from "@/lib/fresh-topic";
import { setShowUnreadyProviders, useShowUnreadyProviders } from "@/lib/unready-providers-preference";
import { parseSidebarDensity, setSidebarDensity, SIDEBAR_DENSITIES, useSidebarDensity, type SidebarDensity } from "@/lib/sidebar-preferences";
import { setShowRunCard, useShowRunCard } from "@/lib/run-card-preferences";
import { parseSendKey, SEND_KEYS, sendKeyLabel, setSendKey, useSendKey } from "@/lib/send-key";
import { setShowSidebarLogo, useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { setShowRoutinesBadge, useShowRoutinesBadge } from "@/lib/routines-badge-preferences";
import { setShowInspectorButton, useShowInspectorButton } from "@/lib/inspector-preferences";
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

/** Grok Bot's "1 ⌄" pill (Computer > Other computers, #576): what a row
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

function InterfaceModeRow() {
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

/** Which keys send a message, on this device only. The grey line says the
 * one thing a Japanese-input user needs: the other choice still sends. */
function SendKeyRow() {
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

type ThreadsView = "hidden" | ThreadsLocation;

/** Hidden keeps the last place, for when threads come back. */
export function chooseThreadsView(next: ThreadsView): void {
  if (next === "hidden") {
    setShowThreads(false);
    return;
  }
  setThreadsLocation(next);
  setShowThreads(true);
}

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

/** HD mascots (src/lib/hd-mascots-preference.ts): painted art for the
 * characters that ship it, or the classic vector look everywhere. Shown only
 * while at least one character has HD art. */
export function HdMascotsGroup({ characters = HD_CHARACTERS }: { characters?: readonly string[] }) {
  const enabled = useHdMascots();
  if (characters.length === 0) return null;
  return (
    <div data-settings-card="appearance.mascots-hd">
      <SettingsGroup title={t("settings.group.mascots")} groupId="mascots">
        <DescribedRow label={t("settings.hdMascots.title")} description={t("settings.hdMascots.subtitle")} rowId="hdMascots">
          <Switch checked={enabled} aria-label={t("settings.hdMascots.title")} onClick={() => setHdMascotsEnabled(!enabled)} />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}

/** A server feature (every viewer of the installation sees it). */
function ToolCallsRow() {
  const { state, dispatch } = useStore();
  const enabled = showToolCallsEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { showToolCalls: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolCalls.error"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <DescribedRow
      label={t("settings.toolCalls.title")}
      rowId="toolCalls"
      below={error ? <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.toolCalls.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </DescribedRow>
  );
}

/** Desktop > App icon: the picker opens under its row. */
function AppIconRow() {
  const [open, setOpen] = useState(false);
  if (!appIconAvailable()) return null;
  return (
    <DescribedRow
      label={t("settings.appIcon.title")}
      rowId="appIcon"
      below={open && <div className="mt-2.5"><AppIconPicker /></div>}
    >
      <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.appIcon.title")}>
        {t(open ? "settings.appearance.hide" : "settings.appearance.choose")}
      </DisclosurePill>
    </DescribedRow>
  );
}

/** Desktop > Desktop mascots: five settings folded under one row (they were
 * a third of the page). Folded, every value set here still applies. */
function MascotsRow() {
  const [open, setOpen] = useState(false);
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  const call = useCallSettings();
  const captions = call.captions !== false;
  // the desktop app only: a browser has no global keys
  const hotkeyServed = typeof window !== "undefined" && Boolean((window.ogb?.floatingBots as { hotkey?: unknown } | undefined)?.hotkey);
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform || navigator.userAgent);
  return (
    <div data-settings-card="appearance.mascots" data-open={open ? "true" : "false"}>
      <CompactRow label={t("settings.mascotsCard.title")} rowId="mascots">
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.mascotsCard.title")}>
          {t(open ? "settings.appearance.hide" : "settings.appearance.show")}
        </DisclosurePill>
      </CompactRow>
      {open && (
        <div className="ml-3.5 border-l-[0.5px] border-border" data-mascot-rows="">
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

/** The two choices only the desktop shell honours (hardware acceleration
 * needs a restart; the spell checker is applied as the shell allows). */
function DesktopShellRows() {
  const acceleration = hardwareAccelerationChoice.use() === "true";
  const spelling = spellcheckChoice.use() === "true";
  const hotkeys = botHotkeysChoice.use() === "true";
  const chord = botHotkeyModifierChoice.use();
  if (!hasDesktopShellPreferences()) return null;
  // the bots' global shortcuts exist with the macOS menu bar list
  const menuBar = window.ogb?.platform === "darwin";
  return (
    <>
      <DescribedRow label={t("settings.hardwareAcceleration.title")} description={t("settings.hardwareAcceleration.note")} rowId="hardwareAcceleration">
        <Switch checked={acceleration} aria-label={t("settings.hardwareAcceleration.title")} onClick={() => hardwareAccelerationChoice.set(acceleration ? "false" : "true")} />
      </DescribedRow>
      <SwitchLine label={t("settings.spellcheck.title")} checked={spelling} onChange={(next) => spellcheckChoice.set(next ? "true" : "false")} rowId="spellcheck" />
      {menuBar && (
        <DescribedRow label={t("settings.botHotkeys.title")} description={t("settings.botHotkeys.note")} rowId="botHotkeys">
          <Switch checked={hotkeys} aria-label={t("settings.botHotkeys.title")} onClick={() => botHotkeysChoice.set(hotkeys ? "false" : "true")} />
        </DescribedRow>
      )}
      {menuBar && hotkeys && (
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

export function AppearanceSettings() {
  const { state } = useStore();
  const advanced = useAdvancedMode();
  const remoteActive = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const editConfig = canEditConfig(state.config);
  const runCard = useShowRunCard();
  const inspector = useShowInspectorButton();
  const unready = useShowUnreadyProviders();
  const logo = useShowSidebarLogo();
  const routinesBadge = useShowRoutinesBadge();
  const suggestions = useShowSuggestions();
  const allHistory = useShowAllHistory();
  return (
    <>
      <SettingsGroup title={t("settings.group.interface")} groupId="interface">
        <InterfaceModeRow />
        <FontRow />
      </SettingsGroup>
      <div data-settings-card="appearance.skin">
        <SettingsGroup title={t("settings.skin.title")} groupId="skin">
          <SkinPicker />
          <BotAccentRow />
        </SettingsGroup>
      </div>
      {/* the effect behind the conversation, chosen as the skins are (the
          "Glyph ripple on click" switch of 0.5.15 became one of them) */}
      <div data-settings-card="appearance.backgroundEffects">
        <SettingsGroup title={t("settings.backgroundEffects.title")} groupId="backgroundEffects">
          <BackgroundEffectsPicker />
        </SettingsGroup>
      </div>
      <SettingsGroup title={t("settings.group.conversation")} groupId="conversation">
        <ThreadsViewRow />
        <FreshTopicRow />
        <SendKeyRow />
        {advanced && !remoteActive && editConfig && <ToolCallsRow />}
        {advanced && <SwitchLine label={t("settings.runCard.title")} ariaLabel={t("settings.runCard.show")} checked={runCard} onChange={setShowRunCard} rowId="runCard" />}
        {advanced && <SwitchLine label={t("settings.inspectorButton.title")} ariaLabel={t("settings.inspectorButton.show")} checked={inspector} onChange={setShowInspectorButton} rowId="inspectorButton" />}
        {advanced && <SwitchLine label={t("settings.unreadyProviders.title")} ariaLabel={t("settings.unreadyProviders.show")} checked={unready} onChange={setShowUnreadyProviders} rowId="unreadyProviders" />}
      </SettingsGroup>
      <SettingsGroup title={t("settings.group.sidebar")} groupId="sidebar">
        <SidebarDensityRow />
        {advanced && <SwitchLine label={t("settings.sidebarLogo.title")} ariaLabel={t("settings.sidebarLogo.show")} checked={logo} onChange={setShowSidebarLogo} rowId="sidebarLogo" />}
        {advanced && <SwitchLine label={t("settings.routinesBadge.title")} ariaLabel={t("settings.routinesBadge.show")} checked={routinesBadge} onChange={setShowRoutinesBadge} rowId="routinesBadge" />}
        <SwitchLine label={t("settings.showSuggestions.title")} ariaLabel={t("settings.showSuggestions.show")} checked={suggestions} onChange={setShowSuggestions} rowId="showSuggestions" />
        <SwitchLine label={t("settings.allHistory.title")} ariaLabel={t("settings.allHistory.show")} checked={allHistory} onChange={setShowAllHistory} rowId="allHistory" />
        {/* Simple: the sidebar's own "Hidden (N)" row brings entries back. */}
        {advanced && <SidebarHiddenSettings />}
      </SettingsGroup>
      <HdMascotsGroup />
      <AccessibilityGroup />
      <SettingsGroup title={t("settings.group.desktop")} groupId="desktop">
        <AppIconRow />
        <MascotsRow />
        <DesktopShellRows />
      </SettingsGroup>
    </>
  );
}
