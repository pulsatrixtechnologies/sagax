// Live browser chrome and page (extracted from LiveBrowser for #1383).
// Compact docked layout (M-20261127-064): the screen panel's shared top row
// (ScreenPanelBar, M-20261127-181) holds the page tabs on the left and Take
// control at the spot it has in the VM; under it one address row with a
// full-width editable URL, profiles and the menu; the page fills the rest with
// no framed card and no letterbox bands. Its controls are the app's own sizes
// (M-20261127-179): the chat header's round buttons and glyphs (CIRCLE_BUTTON,
// CIRCLE_ICON), the 36px labelled chip (CIRCLE_LABEL) for the page tabs, the
// app's field (PLAIN_FIELD) for the address; while a row cannot hold its
// labels it folds them (ScreenBar), never a size and never a control.
import type { RefObject, Dispatch, FormEvent, SetStateAction, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot as BotIcon, EllipsisVertical, Globe, Hand, Loader2, LockKeyhole, Plus, RotateCw, UserRound, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BrowserProfilesManager } from "../BrowserProfilesManager";
import { BrowserViewport, type BrowserFrame } from "../BrowserViewport";
import type { BrowserTakeStatus } from "@/lib/browser-control";
import { tabLabel } from "@/lib/browser-page";
import { cn } from "@/lib/cn";
import { NetworkDebuggerDialog } from "../NetworkDebuggerDialog";
import { TeachStepsDialog } from "../TeachStepsDialog";
import { TEACH_RECORDING_FRAME, TeachRecordingBar } from "../TeachRecordingBar";
import type { TeachStep } from "../../../shared/teach-recording";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE } from "../menu-look";
import { AnchoredPopover } from "../AnchoredPopover";
import { PILL, PLAIN_FIELD, PRIMARY_PILL } from "../SettingsPrimitives";
import { panelStageRef } from "@/lib/browser-panel-viewport";
import { CIRCLE_ICON, CIRCLE_LABEL } from "@/lib/circle-button";
import { SCREEN_PANEL_TOOL, ScreenBar, type ScreenControlState, type ScreenPanelBarSlots } from "../ScreenPanelChrome";
import type { AddressBar } from "./useAddressBar";

interface BrowserTab { tabId: string; title: string; url: string; active: boolean }
type ViewerFrame = BrowserFrame & { viewerId: string; generation: number };
const button = "rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";
const iconBtn = `${button} flex size-7 items-center justify-center`;
/** A page tab of the docked panel: the labelled 36px chip, the page's title in regular weight. */
const DOCKED_TAB = cn(CIRCLE_LABEL, "max-w-48 gap-0 pl-0 pr-1 font-normal");
/** Its select button fills the chip up to the close, globe included: the whole tab is the target. */
const DOCKED_TAB_SELECT = "flex min-w-0 items-center gap-1 self-stretch pl-3 pr-0.5 text-left disabled:cursor-default";
const DOCKED_TAB_IDLE = "border-transparent bg-transparent text-ink-secondary hover:bg-circle-hover hover:text-ink";

/** The docked screen panel: its name, and its one top row, which the browser
 * fills with its page tabs and its Take control. Mark up draws over the page
 * only (`stageOverlay`), never over the two rows (M-20261127-180). */
export type LiveBrowserDocked = {
  title: string;
  bar: (slots: ScreenPanelBarSlots) => ReactNode;
  /** Drawn over the page only (the marks overlay), never over the two rows. */
  stageOverlay?: ReactNode;
};

export interface LiveBrowserViewProps {
  bot: Bot;
  allowed: boolean;
  placeholder?: string;
  frame: ViewerFrame | null;
  tabs: BrowserTab[];
  addressBar: AddressBar;
  connected: boolean;
  control: { held: boolean; controlling: boolean; owned: boolean };
  pending: boolean;
  error: string;
  showProfiles: boolean;
  setShowProfiles: Dispatch<SetStateAction<boolean>>;
  showTyping: boolean;
  setShowTyping: Dispatch<SetStateAction<boolean>>;
  masked: boolean;
  setMasked: Dispatch<SetStateAction<boolean>>;
  takeControl: () => void;
  handBack: () => void;
  viewport: { width: number; height: number };
  takeStatus: BrowserTakeStatus;
  busy: boolean;
  reconnecting: boolean;
  showNetwork: boolean;
  setShowNetwork: Dispatch<SetStateAction<boolean>>;
  recording: boolean;
  /** When the running recording started (ms), for its elapsed time. */
  recordingStartedAt: number | null;
  taught: { steps: TeachStep[]; recordedAt: string } | undefined;
  setTaught: Dispatch<SetStateAction<{ steps: TeachStep[]; recordedAt: string } | undefined>>;
  teachNote: string;
  addressInput: RefObject<HTMLInputElement | null>;
  profilesButton: RefObject<HTMLButtonElement | null>;
  profilesPopover: RefObject<HTMLDivElement | null>;
  typingPopover: RefObject<HTMLDivElement | null>;
  typingField: RefObject<HTMLInputElement | null>;
  menuSummary: RefObject<HTMLElement | null>;
  /** The ⋯ menu: Escape or a press outside closes it (useLiveBrowserMenu). */
  menu: { root: RefObject<HTMLDetailsElement | null>; toggled: (open: boolean) => void };
  profileName: string;
  interactive: boolean;
  typingReady: boolean;
  commandsReady: boolean;
  heldElsewhere: boolean;
  taking: boolean;
  mine: boolean;
  pageTitle: string;
  holder: string;
  pill: string;
  generation: RefObject<number>;
  viewer: RefObject<string>;
  browserControl: RefObject<{ handBack: () => void; takeNow: () => void } | null>;
  command: (body: Record<string, unknown>) => void;
  input: (body: Record<string, unknown>) => void;
  reconnect: () => void;
  execute: (body: Record<string, unknown>) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;
  action: (body: Record<string, unknown>, expected?: string) => Promise<unknown>;
  confirm: (opts: { title: string; confirmLabel: string; tone: "neutral" }) => Promise<boolean>;
  setError: Dispatch<SetStateAction<string>>;
  /** When set, render the compact docked chrome (side panel). */
  docked?: LiveBrowserDocked;
}

export function LiveBrowserView(p: LiveBrowserViewProps) {
  const {
    bot, allowed, placeholder, frame, tabs, addressBar, connected, control, pending, error,
    showProfiles, setShowProfiles, showTyping, setShowTyping, masked, setMasked, takeControl, handBack,
    viewport, takeStatus, busy, reconnecting,
    showNetwork, setShowNetwork, recording, recordingStartedAt, taught, setTaught, teachNote, addressInput, profilesButton,
    profilesPopover, typingPopover, typingField, menuSummary, menu, profileName, interactive, typingReady,
    commandsReady, heldElsewhere, taking, mine, pageTitle, holder, pill, generation, viewer,
    command, input, reconnect, execute, startRecording, stopRecording, discardRecording, action, confirm, setError,
    docked,
  } = p;
  const compact = Boolean(docked);
  const shell = compact
    ? "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app text-ink"
    : "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-card text-ink";

  // The docked panel draws the app's sizes; the large window keeps its own bar.
  const tool = compact ? SCREEN_PANEL_TOOL : iconBtn;
  const glyph = compact ? CIRCLE_ICON : { size: 15 };

  const pageTabs = (
    <div data-browser-tabs={compact ? "" : undefined} className={cn("flex min-w-0 flex-1 items-center overflow-x-auto", compact ? "gap-1" : "gap-0.5")}>
      {/* A page with no title yet reads as its site, never as a new tab (tabLabel). */}
      {tabs.length ? tabs.map((tab) => (
        <div key={tab.tabId} data-browser-tab="" className={compact ? cn(DOCKED_TAB, !tab.active && DOCKED_TAB_IDLE) : cn("flex max-w-44 shrink-0 items-center gap-0.5 rounded-lg px-0.5 text-[12px]", tab.active ? "bg-inset text-ink" : "text-ink-secondary")}>
          {compact ? (
            <button data-browser-tab-title="" className={DOCKED_TAB_SELECT} disabled={!commandsReady} onClick={() => command({ type: "tab-select", tabId: tab.tabId })} title={tab.title || tab.url}>
              <Globe size={16} strokeWidth={1.75} className="shrink-0 opacity-60" aria-hidden="true" />
              <span className="truncate">{tabLabel(tab) || t("browser.tab.new")}</span>
            </button>
          ) : (
            <>
              <Globe size={12} className="ml-1 shrink-0 opacity-60" aria-hidden="true" />
              <button data-browser-tab-title="" className="truncate px-1 py-1.5 text-left disabled:cursor-default" disabled={!commandsReady} onClick={() => command({ type: "tab-select", tabId: tab.tabId })} title={tab.title || tab.url}>{tabLabel(tab) || t("browser.tab.new")}</button>
            </>
          )}
          <button className={compact ? "ui-icon-button shrink-0 rounded-full" : button} aria-label={tabLabel(tab) ? t("browser.tab.close", { title: tabLabel(tab) }) : t("browser.tab.closeUntitled")} disabled={!commandsReady} onClick={() => command({ type: "tab-close", tabId: tab.tabId })}><X size={compact ? 14 : 12} strokeWidth={compact ? 1.75 : 2} /></button>
        </div>
      )) : (
        <div data-browser-tab="" className={compact ? cn(DOCKED_TAB, "gap-1 px-3 text-ink-secondary") : "flex min-w-0 items-center gap-1.5 rounded-lg bg-inset px-2 py-1 text-[12px] text-ink-secondary"}><Globe size={compact ? 16 : 12} strokeWidth={compact ? 1.75 : 2} aria-hidden="true" /><span data-browser-tab-title="" className={compact ? undefined : "truncate"}>{t("browser.tab.new")}</span></div>
      )}
      <button className={`${tool} shrink-0`} disabled={!commandsReady} aria-label={t("browser.tab.new")} title={t("browser.tab.new")} onClick={() => command({ type: "tab-new" })}><Plus {...glyph} /></button>
    </div>
  );

  // Docked: who has the browser is the shared switch's state, at the spot the
  // VM's Take control has; its tooltip says who drives and on which page.
  const dockedControl: ScreenControlState | null = compact && allowed && connected && !heldElsewhere ? {
    on: mine,
    onChange: (next) => { if (next) takeControl(); else handBack(); },
    disabled: !mine && (taking || pending),
    title: mine ? t("browser.control.giveBack") : pageTitle ? `${holder} · ${pageTitle}` : holder,
    attributes: mine ? { "data-browser-holder": "you", "data-browser-give-back": "" } : { "data-browser-holder": "bot", "data-browser-take": "" },
  } : null;

  const tabsRow = docked ? docked.bar({ leading: pageTabs, control: dockedControl }) : (
    <div data-browser-tabs="" className="flex min-h-12 items-center gap-0.5 px-2 pt-1.5">
      {pageTabs}
      <button ref={profilesButton} type="button" className={`${button} rounded-xl bg-inset p-2`} title={t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} aria-haspopup="dialog" onClick={() => { handBack(); setShowProfiles((open) => !open); }}><UserRound size={16} /></button>
    </div>
  );

  const submitAddress = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addressBar.submit();
  };
  const addressContent = (
    <>
      <div className={cn("flex shrink-0 items-center", compact && "gap-1")}>
        <button type="button" className={tool} disabled={!commandsReady} aria-label={t("browser.nav.back")} onClick={() => command({ type: "back" })}><ArrowLeft {...glyph} /></button>
        <button type="button" className={tool} disabled={!commandsReady} aria-label={t("browser.nav.forward")} onClick={() => command({ type: "forward" })}><ArrowRight {...glyph} /></button>
        <button type="button" className={tool} disabled={!commandsReady} aria-label={t("browser.nav.reload")} onClick={() => command({ type: "reload" })}><RotateCw {...glyph} /></button>
      </div>
      <input
        ref={addressInput}
        data-screen-bar-flex=""
        aria-label={t("browser.address.label")}
        aria-invalid={addressBar.error ? true : undefined}
        readOnly={addressBar.readOnly}
        value={addressBar.value}
        onChange={(e) => addressBar.change(e.target.value)}
        onFocus={(e) => addressBar.focus(e.target)}
        onBlur={addressBar.blur}
        onKeyDown={(e) => { if (e.key === "Escape" && addressBar.revert()) e.preventDefault(); }}
        placeholder={connected ? "about:blank" : t("browser.live.connecting")}
        spellCheck={false}
        className={compact
          ? cn(PLAIN_FIELD, "flex-1 text-left")
          : "mx-1 min-w-0 flex-1 rounded-md bg-inset/60 px-2 py-1 text-center text-[12px] outline-none placeholder:text-ink-secondary focus:bg-inset focus:text-left focus:ring-1 focus:ring-accent/50"}
      />
      {compact && (
        <button ref={profilesButton} type="button" className={tool} title={docked?.title ? `${t("browser.profile.current", { name: profileName })} · ${docked.title}` : t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} aria-haspopup="dialog" onClick={() => { handBack(); setShowProfiles((open) => !open); }}><UserRound {...glyph} /></button>
      )}
      <details ref={menu.root} onToggle={(e) => menu.toggled(e.currentTarget.open)} className="relative shrink-0">
        <summary ref={menuSummary} className={`${tool} list-none cursor-pointer [&::-webkit-details-marker]:hidden`} aria-label={t("browser.menu.label")} title={t("browser.menu.label")}><EllipsisVertical {...glyph} /></summary>
        <div role="menu" aria-label={t("browser.menu.label")} className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute right-0 top-full z-20 mt-1")}>
          {compact && (
            <div role="none" className="border-b border-hairline/40 px-2.5 py-1.5 text-[11px] text-ink-secondary" title={docked?.title}>{docked?.title}</div>
          )}
          <button type="button" role="menuitem" className={MENU_ROW} disabled={!typingReady} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setMasked(false); setShowTyping(true); }}>{t("browser.menu.type")}</button>
          <button type="button" role="menuitem" className={MENU_ROW} disabled={!typingReady} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setMasked(true); setShowTyping(true); }}>{t("browser.typeSecret")}</button>
          <button type="button" role="menuitem" className={MENU_ROW} disabled={!connected} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setShowNetwork(true); }}>{t("browser.menu.network")}</button>
          <button type="button" role="menuitem" data-teach-record="" className={MENU_ROW} disabled={!recording && !commandsReady} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            void (recording ? stopRecording() : startRecording());
          }}>{recording ? t("teach.stop") : t("teach.start")}</button>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); reconnect(); }}>{t("browser.menu.reconnect")}</button>
          <button type="button" role="menuitem" className={MENU_ROW} disabled={!connected || pending || taking} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            void (async () => {
              const generationAtClick = generation.current;
              if (!(await confirm({ title: t("browser.menu.restartConfirm"), confirmLabel: t("common.confirm"), tone: "neutral" }))) return;
              if (generation.current !== generationAtClick) return;
              void execute({ type: "restart" });
            })();
          }}>{t("browser.menu.restart")}</button>
        </div>
      </details>
    </>
  );
  const addressRow = compact
    ? <ScreenBar as="form" data-browser-address-row="" onSubmit={submitAddress} className="flex min-h-12 items-center gap-1 border-b border-hairline/40 px-3 py-1.5">{addressContent}</ScreenBar>
    : <form data-browser-address-row="" onSubmit={submitAddress} className="flex h-12 items-center gap-0.5 border-b border-hairline/40 px-2">{addressContent}</form>;

  const legacyHolder = !compact && (
    <div data-browser-holder={mine ? "you" : heldElsewhere ? "elsewhere" : "bot"} className="flex min-h-10 items-center gap-2 border-b border-hairline/40 px-3 py-1.5 text-[12px]">
      <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", mine ? "font-medium text-accent-text" : "text-ink-secondary")}>
        {mine ? <Hand size={13} className="shrink-0" aria-hidden="true" /> : <BotIcon size={13} className="shrink-0" aria-hidden="true" />}
        <span className="shrink-0">{holder}</span>
        {pageTitle && <span className="min-w-0 truncate font-normal text-ink-secondary" title={pageTitle}>· {pageTitle}</span>}
      </span>
      {allowed && connected && !heldElsewhere && (mine
        ? <button type="button" data-browser-give-back="" onClick={handBack}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-control px-3 py-1 font-medium text-ink hover:bg-raised-hover md:min-h-0">
            <BotIcon size={12} aria-hidden="true" />{t("browser.control.giveBack")}
          </button>
        : <button type="button" data-browser-take="" disabled={taking || pending} onClick={takeControl}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50 md:min-h-0">
            <Hand size={12} aria-hidden="true" />{t("sandboxDesktop.takeControl")}
          </button>)}
    </div>
  );

  const empty = compact && connected && !frame && !placeholder && !heldElsewhere && !error && !busy && !reconnecting;

  return (
<div className={shell} data-browser-compact={compact ? "" : undefined}>
    {tabsRow}
    {addressRow}
    {addressBar.error && <div role="alert" data-browser-address-error="" className="border-b border-hairline/30 px-3 py-2 text-[12px] text-danger">{addressBar.error}</div>}
    {recording && <TeachRecordingBar startedAt={recordingStartedAt ?? Date.now()} onStop={() => void stopRecording()} onDiscard={() => void discardRecording()} />}
    {teachNote && !recording && <div role="status" className="border-b border-hairline/30 px-3 py-2 text-[12px] text-ink-secondary">{teachNote}</div>}
    {legacyHolder}
    {error && <div role={reconnecting ? "status" : "alert"} className={`flex items-center justify-between gap-2 border-b border-hairline/30 px-3 py-2 text-[12px] ${reconnecting ? "text-ink-secondary" : "text-danger"}`}><span>{error}</span>{!connected && <button className="shrink-0 underline" onClick={reconnect}>{t("browser.live.reconnect")}</button>}</div>}
    <div ref={panelStageRef} data-browser-stage="" className={cn("relative min-h-0 flex-1 overflow-hidden", compact ? "bg-app" : "bg-inset/40")}>
      {recording && <div aria-hidden="true" data-recording-frame="" className={TEACH_RECORDING_FRAME} />}
      {frame ? <BrowserViewport frame={frame} {...viewport} driving={interactive} input={input} fillWidth={compact}
        onReturnToToolbar={() => addressInput.current?.focus()}
        acknowledge={(seq) => { if (generation.current === frame.generation && viewer.current === frame.viewerId) void action({ type: "ack", seq }, frame.viewerId).catch(() => {}); }}
        onDecodeError={() => { if (generation.current === frame.generation && viewer.current === frame.viewerId) setError(t("browser.frame.decodeError")); }} />
        : placeholder && !heldElsewhere && !(error && !reconnecting)
          ? <div data-browser-placeholder="" className="absolute inset-0">
            <img src={placeholder} alt="" draggable={false} className="h-full w-full select-none object-contain opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`${pill} border-hairline text-ink`}><Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />{busy ? t("browser.live.botBusy", { name: bot.name }) : t("browser.live.connecting")}</span>
            </div>
          </div>
        : empty
          ? <div data-browser-empty="" className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
              <Globe size={28} className="text-ink-tertiary" aria-hidden="true" />
              <span className="text-[13px] font-medium text-ink">{t("browser.panel.browseWith", { name: bot.name })}</span>
              <p className="max-w-xs text-[12px] leading-relaxed text-ink-secondary">{t("browser.panel.browseWithHint")}</p>
            </div>
        : <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-secondary">
            {heldElsewhere ? <Hand size={24} /> : error && !reconnecting ? <Globe size={24} /> : <Loader2 size={24} className="animate-spin" />}
            <span>{heldElsewhere ? t("browser.live.heldElsewhere") : reconnecting ? t("browser.live.reconnectingShort") : error ? t("browser.live.disconnected") : busy ? t("browser.live.botBusy", { name: bot.name }) : t("browser.live.opening")}</span>
          </div>}
      <div role="status" className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
        {takeStatus === "slow" ? <span className={`${pill} border-hairline text-ink-secondary`}>
          <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" /><span className="truncate">{t("browser.control.waiting", { name: bot.name })}</span>
        </span> : takeStatus === "stale" ? <span className={`${pill} border-accent-border text-accent-text`}>
          <Hand size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{t("browser.control.stale", { name: bot.name })}</span>
        </span> : null}
      </div>
      {docked?.stageOverlay}
    </div>
    {showProfiles && (
      <AnchoredPopover
        anchorRef={profilesButton}
        popoverRef={profilesPopover}
        side="bottom"
        align="end"
        role="dialog"
        aria-labelledby="browser-profiles-title"
        data-browser-profiles=""
        className="w-[min(360px,calc(100vw-24px))] max-h-[min(480px,calc(100dvh-96px))] overflow-auto rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setShowProfiles(false);
        }}
      >
        <h2 id="browser-profiles-title" className="mb-3 text-[14px] font-medium">{t("browser.profiles.open")}</h2>
        {(heldElsewhere || (control.owned && (pending || taking))) && <p className="mb-3 text-[12px] text-ink-secondary">{t(heldElsewhere ? "browser.profiles.heldElsewhere" : "browser.profiles.busy")}</p>}
        <BrowserProfilesManager bot={bot} disabled={pending || control.held} onProfileChanged={() => { setShowProfiles(false); reconnect(); }} />
      </AnchoredPopover>
    )}
    {showNetwork && <NetworkDebuggerDialog botId={bot.id} botName={bot.name} onClose={() => setShowNetwork(false)} />}
    {taught && (
      <div className="absolute inset-0 z-20 flex min-h-0 flex-col">
        <TeachStepsDialog inline botId={bot.id} botName={bot.name} steps={taught.steps} recordedAt={taught.recordedAt} onClose={() => setTaught(undefined)} />
      </div>
    )}
    {showTyping && (
      <AnchoredPopover
        anchorRef={menuSummary}
        popoverRef={typingPopover}
        side="bottom"
        align="end"
        role="dialog"
        aria-labelledby="browser-typing-title"
        data-browser-typing=""
        className="w-[min(360px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setShowTyping(false);
        }}
      >
        <h2 id="browser-typing-title" className="mb-3 text-[14px] font-medium">{masked ? t("browser.typeSecret.title") : t("browser.typing.title")}</h2>
        <form className="flex flex-col gap-3" onSubmit={(e) => {
          e.preventDefault();
          const field = e.currentTarget.elements.namedItem("pageText") as HTMLInputElement;
          if (typingReady && field.value) {
            input({ type: "input_keyboard", eventType: "char", text: field.value });
            field.value = "";
            setShowTyping(false);
          }
        }}>
          <input key={masked ? "secret" : "text"} ref={typingField} name="pageText" type={masked ? "password" : "text"} aria-label={masked ? t("browser.typeSecret.field") : t("browser.typing.field")} autoComplete={masked ? "new-password" : "off"} spellCheck={false} maxLength={4096} placeholder={masked ? "••••••••" : t("browser.typing.placeholder")} className="rounded-lg bg-inset px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-accent" />
          {masked && <p className="flex items-center gap-1 text-[11.5px] text-ink-tertiary"><LockKeyhole size={11} aria-hidden="true" />{t("browser.typeSecret.note")}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={PILL} onClick={() => setShowTyping(false)}>{t("browser.typing.close")}</button>
            <button type="submit" disabled={!typingReady} className={PRIMARY_PILL}>{t("browser.typing.send")}</button>
          </div>
        </form>
      </AnchoredPopover>
    )}
  </div>
  );
}
