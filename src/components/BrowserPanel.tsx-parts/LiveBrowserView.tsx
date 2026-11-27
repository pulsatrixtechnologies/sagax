// Live browser chrome and page (extracted from LiveBrowser for #1383).
// Compact docked layout (M-20261127-064): one tab row with panel actions, one
// address row with a full-width editable URL, status pill and Take control
// icon; the page fills the rest with no framed card and no letterbox bands.
import type { RefObject, Dispatch, SetStateAction, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot as BotIcon, EllipsisVertical, Globe, Hand, Loader2, LockKeyhole, Plus, RotateCw, UserRound, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BrowserProfilesManager } from "../BrowserProfilesManager";
import { BrowserViewport, type BrowserFrame } from "../BrowserViewport";
import type { BrowserTakeStatus } from "@/lib/browser-control";
import { resolveAddressBarInput } from "@/lib/browser-address";
import { cn } from "@/lib/cn";
import { NetworkDebuggerDialog } from "../NetworkDebuggerDialog";
import { TeachStepsDialog } from "../TeachStepsDialog";
import { TEACH_RECORDING_FRAME, TeachRecordingBar } from "../TeachRecordingBar";
import type { TeachStep } from "../../../shared/teach-recording";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE } from "../menu-look";
import { AnchoredPopover } from "../AnchoredPopover";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { panelStageRef } from "@/lib/browser-panel-viewport";

interface BrowserTab { tabId: string; title: string; url: string; active: boolean }
type ViewerFrame = BrowserFrame & { viewerId: string; generation: number };
const button = "rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";
const iconBtn = `${button} flex size-7 items-center justify-center`;

/** Chrome the docked screen panel injects into the tab and address rows. */
export type LiveBrowserDocked = {
  title: string;
  chrome: ReactNode;
  placeSelector?: ReactNode;
};

export interface LiveBrowserViewProps {
  bot: Bot;
  allowed: boolean;
  placeholder?: string;
  frame: ViewerFrame | null;
  tabs: BrowserTab[];
  address: string;
  setAddress: Dispatch<SetStateAction<string>>;
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
  urlEditing: RefObject<boolean>;
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
    bot, allowed, placeholder, frame, tabs, address, setAddress, connected, control, pending, error,
    showProfiles, setShowProfiles, showTyping, setShowTyping, masked, setMasked, takeControl, handBack,
    viewport, takeStatus, busy, reconnecting,
    showNetwork, setShowNetwork, recording, recordingStartedAt, taught, setTaught, teachNote, addressInput, profilesButton,
    profilesPopover, typingPopover, typingField, menuSummary, profileName, interactive, typingReady,
    commandsReady, heldElsewhere, taking, mine, pageTitle, holder, pill, generation, viewer,
    urlEditing, command, input, reconnect, execute, startRecording, stopRecording, discardRecording, action, confirm, setError,
    docked,
  } = p;
  const compact = Boolean(docked);
  const shell = compact
    ? "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app text-ink"
    : "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-card text-ink";

  const tabsRow = (
    <div data-browser-tabs="" className={cn("flex items-center gap-0.5 px-1.5", compact ? "min-h-9 border-b border-hairline/40" : "min-h-12 pt-1.5 px-2")}>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.length ? tabs.map((tab) => (
          <div key={tab.tabId} className={cn("flex max-w-44 shrink-0 items-center gap-0.5 rounded-lg px-0.5 text-[12px]", tab.active ? "bg-inset text-ink" : "text-ink-secondary")}>
            <Globe size={12} className="ml-1 shrink-0 opacity-60" />
            <button className="truncate px-1 py-1.5 text-left disabled:cursor-default" disabled={!commandsReady} onClick={() => command({ type: "tab-select", tabId: tab.tabId })} title={tab.title || tab.url}>{tab.title || t("browser.tab.new")}</button>
            <button className={button} aria-label={tab.title ? t("browser.tab.close", { title: tab.title }) : t("browser.tab.closeUntitled")} disabled={!commandsReady} onClick={() => command({ type: "tab-close", tabId: tab.tabId })}><X size={12} /></button>
          </div>
        )) : (
          <div className="flex items-center gap-1.5 rounded-lg bg-inset px-2 py-1 text-[12px] text-ink-secondary"><Globe size={12} />{t("browser.tab.new")}</div>
        )}
        <button className={`${iconBtn} shrink-0`} disabled={!commandsReady} aria-label={t("browser.tab.new")} title={t("browser.tab.new")} onClick={() => command({ type: "tab-new" })}><Plus size={15} /></button>
      </div>
      {!compact && (
        <button ref={profilesButton} type="button" className={`${button} rounded-xl bg-inset p-2`} title={t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} aria-haspopup="dialog" onClick={() => { handBack(); setShowProfiles((open) => !open); }}><UserRound size={16} /></button>
      )}
      {compact && docked?.chrome}
    </div>
  );

  const addressRow = (
    <form
      data-browser-address-row=""
      className={cn("flex items-center gap-0.5 border-b border-hairline/40", compact ? "min-h-9 px-1.5" : "h-12 px-2")}
      onSubmit={(e) => {
        e.preventDefault();
        const url = resolveAddressBarInput(address);
        if (commandsReady && url) command({ type: "navigate", url });
        else if (address.trim()) setError(t("browser.address.invalid"));
      }}
    >
      <div className="flex shrink-0 items-center">
        <button type="button" className={iconBtn} disabled={!commandsReady} aria-label={t("browser.nav.back")} onClick={() => command({ type: "back" })}><ArrowLeft size={15} /></button>
        <button type="button" className={iconBtn} disabled={!commandsReady} aria-label={t("browser.nav.forward")} onClick={() => command({ type: "forward" })}><ArrowRight size={15} /></button>
        <button type="button" className={iconBtn} disabled={!commandsReady} aria-label={t("browser.nav.reload")} onClick={() => command({ type: "reload" })}><RotateCw size={15} /></button>
      </div>
      <input
        ref={addressInput}
        aria-label={t("browser.address.label")}
        readOnly={!commandsReady}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onFocus={(e) => { urlEditing.current = true; if (commandsReady) e.target.select(); }}
        onBlur={() => { urlEditing.current = false; }}
        placeholder={connected ? "about:blank" : t("browser.live.connecting")}
        spellCheck={false}
        className={cn(
          "min-w-0 flex-1 rounded-md bg-inset/60 px-2 py-1 text-[12px] outline-none placeholder:text-ink-secondary focus:bg-inset focus:ring-1 focus:ring-accent/50",
          compact ? "text-left" : "mx-1 text-center focus:text-left",
        )}
      />
      {compact && docked?.placeSelector}
      {compact && allowed && connected && !heldElsewhere && (
        <span data-browser-holder={mine ? "you" : "bot"} className="flex shrink-0 items-center gap-0.5">
          <span
            className={cn("flex max-w-[9rem] items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10.5px]", mine ? "bg-accent/15 font-medium text-accent-text" : "bg-inset text-ink-secondary")}
            title={pageTitle ? `${holder} · ${pageTitle}` : holder}
          >
            {mine ? <Hand size={11} className="shrink-0" aria-hidden="true" /> : <BotIcon size={11} className="shrink-0" aria-hidden="true" />}
            <span className="truncate">{mine ? holder : bot.name}</span>
          </span>
          {mine ? (
            <button type="button" data-browser-give-back="" onClick={handBack}
              className={iconBtn}
              aria-label={t("browser.control.giveBack")}
              title={t("browser.control.giveBack")}>
              <BotIcon size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" data-browser-take="" disabled={taking || pending} onClick={takeControl}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-accent px-2 text-[11px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
              aria-label={t("sandboxDesktop.takeControl")}
              title={t("sandboxDesktop.takeControl")}>
              <Hand size={12} aria-hidden="true" />
              <span className="max-w-[7rem] truncate">{t("sandboxDesktop.takeControl")}</span>
            </button>
          )}
        </span>
      )}
      {compact && (
        <button ref={profilesButton} type="button" className={iconBtn} title={docked?.title ? `${t("browser.profile.current", { name: profileName })} · ${docked.title}` : t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} aria-haspopup="dialog" onClick={() => { handBack(); setShowProfiles((open) => !open); }}><UserRound size={14} /></button>
      )}
      <details className="relative shrink-0">
        <summary ref={menuSummary} className={`${iconBtn} list-none cursor-pointer [&::-webkit-details-marker]:hidden`} aria-label={t("browser.menu.label")} title={t("browser.menu.label")}><EllipsisVertical size={15} /></summary>
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
    </form>
  );

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
