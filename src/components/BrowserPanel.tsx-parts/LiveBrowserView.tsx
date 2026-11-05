// Live browser window chrome and page (extracted from LiveBrowser for #1383).
import type { RefObject, Dispatch, SetStateAction } from "react";
import { ArrowLeft, ArrowRight, Bot as BotIcon, EllipsisVertical, Globe, Hand, Loader2, Plus, RotateCw, Square, UserRound, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BrowserProfilesManager } from "../BrowserProfilesManager";
import { BrowserViewport, type BrowserFrame } from "../BrowserViewport";
import type { BrowserTakeStatus } from "@/lib/browser-control";
import { resolveAddressBarInput } from "@/lib/browser-address";
import { cn } from "@/lib/cn";
import { NetworkDebuggerDialog } from "../NetworkDebuggerDialog";
import { TeachStepsDialog } from "../TeachStepsDialog";
import type { TeachStep } from "../../../shared/teach-recording";
import { AnchoredPopover } from "../AnchoredPopover";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";

interface BrowserTab { tabId: string; title: string; url: string; active: boolean }
type ViewerFrame = BrowserFrame & { viewerId: string; generation: number };
const button = "rounded-md p-1.5 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";

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
  viewport: { width: number; height: number };
  takeStatus: BrowserTakeStatus;
  busy: boolean;
  reconnecting: boolean;
  showNetwork: boolean;
  setShowNetwork: Dispatch<SetStateAction<boolean>>;
  recording: boolean;
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
  action: (body: Record<string, unknown>, expected?: string) => Promise<unknown>;
  confirm: (opts: { title: string; confirmLabel: string; tone: "neutral" }) => Promise<boolean>;
  setError: Dispatch<SetStateAction<string>>;
}

export function LiveBrowserView(p: LiveBrowserViewProps) {
  const {
    bot, allowed, placeholder, frame, tabs, address, setAddress, connected, control, pending, error,
    showProfiles, setShowProfiles, showTyping, setShowTyping, viewport, takeStatus, busy, reconnecting,
    showNetwork, setShowNetwork, recording, taught, setTaught, teachNote, addressInput, profilesButton,
    profilesPopover, typingPopover, typingField, menuSummary, profileName, interactive, typingReady,
    commandsReady, heldElsewhere, taking, mine, pageTitle, holder, pill, generation, viewer, browserControl,
    urlEditing, command, input, reconnect, execute, startRecording, stopRecording, action, confirm, setError,
  } = p;
  return (
<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-card text-ink">
    <div className="flex min-h-12 items-center gap-1 px-2 pt-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.length ? tabs.map((tab) => <div key={tab.tabId} className={`flex max-w-52 shrink-0 items-center gap-1 rounded-xl px-1 text-[12px] ${tab.active ? "bg-inset text-ink" : "text-ink-secondary"}`}>
          <Globe size={13} className="ml-1.5 shrink-0 opacity-60" />
          <button className="truncate px-1 py-2 text-left disabled:cursor-default" disabled={!commandsReady} onClick={() => command({ type: "tab-select", tabId: tab.tabId })} title={tab.title || tab.url}>{tab.title || t("browser.tab.new")}</button>
          <button className={button} aria-label={tab.title ? t("browser.tab.close", { title: tab.title }) : t("browser.tab.closeUntitled")} disabled={!commandsReady} onClick={() => command({ type: "tab-close", tabId: tab.tabId })}><X size={13} /></button>
        </div>) : <div className="flex items-center gap-2 rounded-xl bg-inset px-3 py-2 text-[12px] text-ink-secondary"><Globe size={13} />{t("browser.tab.new")}</div>}
        <button className={`${button} shrink-0`} disabled={!commandsReady} aria-label={t("browser.tab.new")} title={t("browser.tab.new")} onClick={() => command({ type: "tab-new" })}><Plus size={17} /></button>
      </div>
      {/* Profiles can't switch while this window holds the browser: opening them hands it back now, not after the idle wait. */}
      <button ref={profilesButton} type="button" className={`${button} rounded-xl bg-inset p-2`} title={t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} aria-haspopup="dialog" onClick={() => { browserControl.current?.handBack(); setShowProfiles((open) => !open); }}><UserRound size={16} /></button>
    </div>
    <form className="flex h-12 items-center gap-1 border-b border-hairline/40 px-2" onSubmit={(e) => { e.preventDefault(); const url = resolveAddressBarInput(address); if (commandsReady && url) command({ type: "navigate", url }); else if (address.trim()) setError(t("browser.address.invalid")); }}>
      <div className="flex shrink-0 items-center">
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.back")} onClick={() => command({ type: "back" })}><ArrowLeft size={17} /></button>
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.forward")} onClick={() => command({ type: "forward" })}><ArrowRight size={17} /></button>
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.reload")} onClick={() => command({ type: "reload" })}><RotateCw size={17} /></button>
      </div>
      <input ref={addressInput} aria-label={t("browser.address.label")} readOnly={!commandsReady} value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => { urlEditing.current = true; if (commandsReady) e.target.select(); }} onBlur={() => { urlEditing.current = false; }} placeholder={connected ? "about:blank" : t("browser.live.connecting")} spellCheck={false} className="mx-1 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-center text-[12px] outline-none placeholder:text-ink-secondary focus:bg-inset focus:text-left" />
      <details className="relative shrink-0">
        <summary ref={menuSummary} className={`${button} list-none cursor-pointer [&::-webkit-details-marker]:hidden`} aria-label={t("browser.menu.label")} title={t("browser.menu.label")}><EllipsisVertical size={17} /></summary>
        <div className="absolute right-0 top-full z-20 mt-2 flex w-44 flex-col rounded-xl border border-hairline/50 bg-card p-1.5 text-[12px] shadow-xl">
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!typingReady} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setShowTyping(true); }}>{t("browser.menu.type")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!connected} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setShowNetwork(true); }}>{t("browser.menu.network")}</button>
          <button type="button" data-teach-record="" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!recording && !commandsReady} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            void (recording ? stopRecording() : startRecording());
          }}>{recording ? t("teach.stop") : t("teach.start")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset" onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); reconnect(); }}>{t("browser.menu.reconnect")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!connected || pending || taking} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            void (async () => {
              // Confirm is async; a reconnect (or stream replace) while the
              // dialog is open must cancel this restart for the old viewer.
              const generationAtClick = generation.current;
              if (!(await confirm({ title: t("browser.menu.restartConfirm"), confirmLabel: t("common.confirm"), tone: "neutral" }))) return;
              if (generation.current !== generationAtClick) return;
              void execute({ type: "restart" });
            })();
          }}>{t("browser.menu.restart")}</button>
        </div>
      </details>
    </form>
    {/* While a recording runs this bar stays at the top of the window, above
        the page, with the one action that ends it. */}
    {recording && <div role="status" data-teach-recording="" className="flex min-h-10 items-center gap-2 border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[12px] text-danger">
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" /></span>
      <span className="min-w-0 flex-1 font-medium">{t("teach.recording")}</span>
      <button type="button" data-teach-stop="" onClick={() => void stopRecording()}
        className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-danger px-3 py-1 font-medium text-danger-ink hover:brightness-110 md:min-h-0">
        <Square size={11} fill="currentColor" aria-hidden="true" />{t("teach.stop")}
      </button>
    </div>}
    {teachNote && !recording && <div role="status" className="border-b border-hairline/30 px-3 py-2 text-[12px] text-ink-secondary">{teachNote}</div>}
    <div data-browser-holder={mine ? "you" : heldElsewhere ? "elsewhere" : "bot"} className="flex min-h-10 items-center gap-2 border-b border-hairline/40 px-3 py-1.5 text-[12px]">
      <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", mine ? "font-medium text-accent-text" : "text-ink-secondary")}>
        {mine ? <Hand size={13} className="shrink-0" aria-hidden="true" /> : <BotIcon size={13} className="shrink-0" aria-hidden="true" />}
        <span className="shrink-0">{holder}</span>
        {pageTitle && <span className="min-w-0 truncate font-normal text-ink-secondary" title={pageTitle}>· {pageTitle}</span>}
      </span>
      {allowed && connected && !heldElsewhere && (mine
        ? <button type="button" data-browser-give-back="" onClick={() => browserControl.current?.handBack()}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-control px-3 py-1 font-medium text-ink hover:bg-raised-hover md:min-h-0">
            <BotIcon size={12} aria-hidden="true" />{t("browser.control.giveBack")}
          </button>
        : <button type="button" data-browser-take="" disabled={taking || pending} onClick={() => browserControl.current?.takeNow()}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50 md:min-h-0">
            <Hand size={12} aria-hidden="true" />{t("sandboxDesktop.takeControl")}
          </button>)}
    </div>
    {error && <div role={reconnecting ? "status" : "alert"} className={`flex items-center justify-between gap-2 border-b border-hairline/30 px-3 py-2 text-[12px] ${reconnecting ? "text-ink-secondary" : "text-danger"}`}><span>{error}</span>{!connected && <button className="shrink-0 underline" onClick={reconnect}>{t("browser.live.reconnect")}</button>}</div>}
    <div className={cn("relative min-h-0 flex-1 overflow-hidden bg-inset/40", recording && "ring-2 ring-inset ring-danger")}>
      {frame ? <BrowserViewport frame={frame} {...viewport} driving={interactive} input={input}
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
        : <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-secondary">{connected && heldElsewhere ? <Hand size={24} /> : error && !reconnecting ? <Globe size={24} /> : <Loader2 size={24} className="animate-spin" />}<span>{heldElsewhere ? t("browser.live.heldElsewhere") : reconnecting ? t("browser.live.reconnectingShort") : error ? t("browser.live.disconnected") : busy ? t("browser.live.botBusy", { name: bot.name }) : t("browser.live.opening")}</span></div>}
      {/* Status only, never a control: it floats over the top of the page,
          readable at any panel width, and every click passes through it. */}
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
    {taught && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={taught.steps} recordedAt={taught.recordedAt} onClose={() => setTaught(undefined)} />}
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
        <h2 id="browser-typing-title" className="mb-3 text-[14px] font-medium">{t("browser.typing.title")}</h2>
        <form className="flex flex-col gap-3" onSubmit={(e) => {
          e.preventDefault();
          const field = e.currentTarget.elements.namedItem("pageText") as HTMLInputElement;
          if (typingReady && field.value) {
            input({ type: "input_keyboard", eventType: "char", text: field.value });
            field.value = "";
            setShowTyping(false);
          }
        }}>
          <input ref={typingField} name="pageText" aria-label={t("browser.typing.field")} autoComplete="off" maxLength={4096} placeholder={t("browser.typing.placeholder")} className="rounded-lg bg-inset px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-accent" />
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
