// The bot's screen on an organization server: one large rounded frame with
// the live view when the computer runs, or the bot's mascot asleep / waking
// when it does not (Grok Bot calm style, 2026-11-01). "<Bot>'s screen" stays
// under the frame. Click (or Enter/Space) on an asleep screen wakes it; the
// next task also starts it. Hover/focus on a running screen shows one
// centered "Open" pill for the full view. Pause/Stop live on hover while it
// runs, or under Details. No Off badge, no technical sentence, no transport
// bar on the default asleep view.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Loader2, Maximize2, Monitor, Pause, Play, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { HoverIntent } from "@/lib/hover-intent";
import { t } from "@/lib/i18n";
import { BotAvatar } from "../Avatar";
import type { Bot } from "@/state/store";

export interface ScreenControls {
  play?: (() => void) | undefined;
  pause?: (() => void) | undefined;
  resume?: (() => void) | undefined;
  stop?: (() => void) | undefined;
}

export interface ScreenAction { label: string; onClick: () => void; primary?: boolean }

export function screenStateLabel(state: ScreenState): string {
  if (state === "off") return t("computerScreen.asleepShort");
  if (state === "starting") return t("computerScreen.waking");
  return t(`computerScreen.state.${state}`);
}

/** A state chip only where the screen does not already say it: running is
 * the live picture; asleep and waking have their own calm copy. */
export function showsStateChip(state: ScreenState): boolean {
  return state === "paused" || state === "error";
}

/** Transport controls are never forced on: asleep wakes by clicking the
 * screen; pause/stop show on hover while running, or under Details. */
export function controlsAlwaysShown(_state: ScreenState): boolean {
  return false;
}

/** Whether the Play / Pause / Stop bar is drawn: only while running or
 * paused (revealed on hover/focus). Asleep and waking stay calm. */
export function showsControlBar(state: ScreenState, controls: ScreenControls | undefined, _actions: ScreenAction[]): boolean {
  if (!controls) return false;
  if (state === "running" || state === "paused") {
    return Boolean(controls.pause || controls.resume || controls.stop || controls.play);
  }
  return false;
}

/** Classes of a control that shows only while the screen's controls are
 * revealed (data-controls="shown" on the screen). */
export const REVEALED_CONTROL = "opacity-0 pointer-events-none transition-opacity duration-200 focus-visible:opacity-100 group-data-[controls=shown]/screen:pointer-events-auto group-data-[controls=shown]/screen:opacity-100";

function useControlsRevealed(): [boolean, HoverIntent | null] {
  const [revealed, setRevealed] = useState(false);
  const intent = useRef<HoverIntent | null>(null);
  if (intent.current === null && typeof window !== "undefined") intent.current = new HoverIntent(setRevealed);
  useEffect(() => () => intent.current?.dispose(), []);
  return [revealed, intent.current];
}

/** Bold "z Z" glyphs beside a sleeping mascot (floating-bots sleep look). */
export function SleepGlyphs() {
  return (
    <span className="computer-sleep-zzz" data-sleep-glyphs="" aria-hidden="true">
      <span>z</span><span>z</span><span>Z</span>
    </span>
  );
}

export function ComputerScreen({
  state, caption, live, message, hint, actions = [], controls, busy = false, error, source, icon,
  bot, computerName, onOpen, openAlwaysShown = false,
}: {
  state: ScreenState;
  caption: string;
  /** The live view, shown while running or paused. */
  live?: ReactNode;
  /** Extra status for error (and legacy callers). Asleep ignores this. */
  message?: string | undefined;
  /** Quiet note under waking (optional). */
  hint?: string | undefined;
  actions?: ScreenAction[];
  /** Play / Pause / Stop; a screen without power (the browser) has none. */
  controls?: ScreenControls | undefined;
  busy?: boolean;
  error?: string | undefined;
  /** remote: a Tailcat remote-support session (RemoteScreenCard). */
  source: "server" | "local" | "browser" | "remote";
  /** The state's icon when nothing is live and no bot mascot is given. */
  icon?: typeof Monitor;
  /** The bot whose mascot sleeps / wakes on this screen. */
  bot?: Pick<Bot, "id" | "name" | "color" | "mascotExpression" | "mascotBody" | "mascotSkin" | "mascotLook" | "avatarUrl" | "avatarCrop" | "avatarZoom" | "avatarFocusX" | "avatarFocusY"> | null;
  /** Place name for "<Computer> is asleep" (Cloud, Mac, Browser, host). */
  computerName?: string;
  /** Opens the full computer view (centered Open pill while running). */
  onOpen?: (() => void) | undefined;
  /** Keep the Open pill visible (not only on hover): the bot waits on the person. */
  openAlwaysShown?: boolean;
}) {
  const showLive = Boolean(live) && (state === "running" || state === "paused");
  // Setup / install primary actions keep the actionable empty state; a plain
  // off computer uses the calm asleep look (mascot + one line).
  const calmAsleep = state === "off" && actions.length === 0;
  const calmWaking = state === "starting" && actions.length === 0;
  const Icon = state === "starting" ? Loader2 : state === "error" ? AlertTriangle : icon ?? Monitor;
  const [revealed, intent] = useControlsRevealed();
  const shown = revealed || controlsAlwaysShown(state);
  const wake = controls?.play;
  const place = computerName?.trim() || t("computerScreen.computer");

  const wakeScreen = () => {
    if (busy || !wake) return;
    wake();
  };
  const onWakeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    wakeScreen();
  };
  const onOpenKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onOpen || (event.key !== "Enter" && event.key !== " ")) return;
    // Only when the screen itself is focused, not a child control.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onOpen();
  };

  const bar = controls && showsControlBar(state, controls, actions) ? (
    <div role="group" aria-label={t("computerScreen.controls")} data-screen-controls={shown ? "shown" : "hidden"}
      className={cn("flex items-center gap-1 rounded-full bg-black/60 p-1 shadow-sm transition-opacity duration-200",
        "absolute bottom-2 left-1/2 -translate-x-1/2",
        shown ? "opacity-100" : "pointer-events-none opacity-0")}>
      <ScreenButton icon={Play} label={state === "paused" ? t("computerScreen.resume") : t("computerScreen.play")}
        onClick={state === "paused" ? controls.resume : controls.play} busy={busy} />
      <ScreenButton icon={Pause} label={t("computerScreen.pause")} onClick={controls.pause} busy={busy} />
      <ScreenButton icon={Square} label={t("computerScreen.stop")} onClick={controls.stop} busy={busy} />
    </div>
  ) : null;

  const openPill = showLive && onOpen ? (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <button
        type="button"
        data-computer-open=""
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        className={cn(
          "pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-[13px] font-medium text-white shadow-md backdrop-blur-sm hover:bg-black/80 md:min-h-0",
          openAlwaysShown ? "opacity-100" : REVEALED_CONTROL,
        )}
        data-open-pill={openAlwaysShown ? "shown" : "hover"}
      >
        <Maximize2 size={15} aria-hidden="true" />
        {t("computerScreen.open")}
      </button>
    </div>
  ) : null;

  const empty = calmAsleep ? (
    <div
      data-screen-empty=""
      data-screen-calm="asleep"
      role={wake ? "button" : undefined}
      tabIndex={wake ? 0 : undefined}
      onClick={wake ? wakeScreen : undefined}
      onKeyDown={wake ? onWakeKey : undefined}
      className={cn(
        "flex min-h-0 max-w-[85%] flex-1 flex-col items-center justify-center gap-3 pb-2 pt-6 text-center",
        wake && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
      )}
    >
      <div className="relative flex items-center justify-center" data-computer-mascot="asleep">
        {bot ? (
          <div className="computer-sleep-mascot opacity-80">
            <BotAvatar bot={bot as Bot} state="sleeping" size={72} animated label={bot.name} />
          </div>
        ) : (
          <Monitor size={28} aria-hidden="true" className="text-ink-secondary opacity-70" />
        )}
        <SleepGlyphs />
      </div>
      <p role="status" className="text-[13px] font-medium text-ink">{t("computerScreen.asleep", { computer: place })}</p>
    </div>
  ) : calmWaking ? (
    <div data-screen-empty="" data-screen-calm="waking" className="flex min-h-0 max-w-[85%] flex-1 flex-col items-center justify-center gap-3 pb-2 pt-6 text-center text-ink-secondary">
      <div className="relative flex items-center justify-center" data-computer-mascot="waking">
        {bot ? (
          <BotAvatar bot={bot as Bot} state="idle" size={72} animated label={bot.name} />
        ) : (
          <Icon size={28} aria-hidden="true" className="animate-spin" />
        )}
      </div>
      <p role="status" data-waking-shimmer="" className="computer-waking-text text-[13px] font-medium text-ink">
        {t("computerScreen.waking")}
      </p>
      {hint && <p role="note" data-screen-hint="" className="text-[11px] leading-snug text-ink-tertiary">{hint}</p>}
    </div>
  ) : (
    <div data-screen-empty="" className="flex min-h-0 max-w-[85%] flex-1 flex-col items-center justify-center gap-2 pb-2 pt-9 text-center text-ink-secondary">
      <Icon size={28} aria-hidden="true" className={cn(state === "error" && "text-warning")} />
      <span className="text-[13px] font-medium text-ink">{screenStateLabel(state)}</span>
      {message && <p role="status" className="text-[12px] leading-relaxed">{message}</p>}
      {actions.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.onClick} disabled={busy} className={cn(
              "min-h-[44px] rounded-lg px-3 py-1.5 text-[12px] disabled:opacity-50 md:min-h-0",
              action.primary ? "bg-accent font-medium text-accent-ink hover:brightness-110" : "bg-control text-ink hover:bg-raised-hover",
            )}>{action.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <figure className="m-0 flex flex-col gap-1.5" data-computer-screen={state} data-computer-source={source}>
      <div
        data-controls={shown ? "shown" : "hidden"}
        tabIndex={showLive && onOpen ? 0 : undefined}
        onKeyDown={showLive && onOpen ? onOpenKey : undefined}
        onPointerEnter={(event) => intent?.pointerEnter(event.pointerType)}
        onPointerLeave={(event) => intent?.pointerLeave(event.pointerType)}
        onPointerDown={(event) => intent?.pointerDown(event.pointerType)}
        onFocus={() => intent?.focusIn()}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) intent?.focusOut(); }}
        className={cn(
          "group/screen relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-card",
          !showLive && "min-h-fit flex-col",
          showLive && onOpen && "outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        )}
      >
        {showLive ? live : empty}
        {showsStateChip(state) && (
          <span data-power={state} className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "paused" ? "bg-accent/50" : state === "error" ? "bg-danger" : "bg-white/50")} />
            {screenStateLabel(state)}
          </span>
        )}
        {openPill}
        {bar}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <figcaption className="truncate text-center text-[13px] text-ink-secondary" title={caption}>{caption}</figcaption>
    </figure>
  );
}

function ScreenButton({ icon: Icon, label, onClick, busy }: { icon: typeof Play; label: string; onClick: (() => void) | undefined; busy: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={!onClick || busy}
      className="flex size-9 items-center justify-center rounded-full text-white hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-transparent md:size-8">
      <Icon size={15} aria-hidden="true" fill={Icon === Square ? "currentColor" : "none"} />
    </button>
  );
}
