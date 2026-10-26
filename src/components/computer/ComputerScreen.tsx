// The bot's screen on an organization server, drawn like the solo panel: one
// large rounded screen with the live view when the computer runs (or a
// monitor icon and its state when it does not), Play / Pause / Stop on the
// screen itself, and "<Bot>'s screen" below. The two computers it can show
// (ServerComputerScreen, LocalComputerScreen) only feed it a state.
//
// The screen stays clean: no "Running" chip over a live screen (a chip only
// for a state the screen does not make obvious), and the controls over it
// (Play / Pause / Stop here, Take control in SandboxDesktopView) show on
// intent only (src/lib/hover-intent.ts), through `data-controls` on the
// screen, except Play on a machine that is off: it is the only action.
//
// Nothing on the screen overlaps: when nothing is live, the bar sits under
// the state in the screen's own flow (the screen grows rather than clip),
// and a screen that shows a state with its own action (Démarrer on a machine
// that is off, Réessayer on an error) shows that button alone, without the
// bar. The caption stays on one line.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, Monitor, Moon, Pause, Play, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { HoverIntent } from "@/lib/hover-intent";
import { t } from "@/lib/i18n";

export interface ScreenControls {
  play?: (() => void) | undefined;
  pause?: (() => void) | undefined;
  resume?: (() => void) | undefined;
  stop?: (() => void) | undefined;
}

export interface ScreenAction { label: string; onClick: () => void; primary?: boolean }

export function screenStateLabel(state: ScreenState): string {
  return t(`computerScreen.state.${state}`);
}

/** A state chip only where the screen does not already say it: a live
 * running screen is obviously running. */
export function showsStateChip(state: ScreenState): boolean {
  return state !== "running";
}

/** The controls over the screen are always shown on a machine that is off
 * (Play is the only thing to do), else on intent. */
export function controlsAlwaysShown(state: ScreenState): boolean {
  return state === "off";
}

/** Whether the Play / Pause / Stop bar is drawn at all: not for a screen
 * with no power (the bot's browser), and not over a state that offers its
 * own action (Démarrer replaces Play on a machine that is off, Réessayer
 * stands alone on an error): the bar never meets those buttons. */
export function showsControlBar(state: ScreenState, controls: ScreenControls | undefined, actions: ScreenAction[]): boolean {
  if (!controls) return false;
  if (state === "off") return !actions.some((action) => action.primary);
  if (state === "error" || state === "starting") return actions.length === 0;
  return true;
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

export function ComputerScreen({
  state, caption, live, message, hint, actions = [], controls, busy = false, error, source, icon,
}: {
  state: ScreenState;
  caption: string;
  /** The live view, shown while running or paused. */
  live?: ReactNode;
  /** What the screen says when nothing is live (never raw output). */
  message?: string | undefined;
  /** One quiet line under the state (small, tertiary, no alert colour): why
   * a start takes longer than usual, never a problem. */
  hint?: string | undefined;
  actions?: ScreenAction[];
  /** Play / Pause / Stop; a screen without power (the browser) has none. */
  controls?: ScreenControls | undefined;
  busy?: boolean;
  error?: string | undefined;
  /** remote: a Tailcat remote-support session (RemoteScreenCard). */
  source: "server" | "local" | "browser" | "remote";
  /** The state's icon when nothing is live (a monitor by default). */
  icon?: typeof Monitor;
}) {
  const showLive = Boolean(live) && (state === "running" || state === "paused");
  const Icon = state === "starting" ? Loader2 : state === "error" ? AlertTriangle : icon ?? Monitor;
  const [revealed, intent] = useControlsRevealed();
  const shown = revealed || controlsAlwaysShown(state);
  const bar = controls && showsControlBar(state, controls, actions) ? (
    <div role="group" aria-label={t("computerScreen.controls")} data-screen-controls={shown ? "shown" : "hidden"}
      className={cn("flex items-center gap-1 rounded-full bg-black/60 p-1 shadow-sm transition-opacity duration-200",
        showLive ? "absolute bottom-2 left-1/2 -translate-x-1/2" : "mb-2 shrink-0",
        shown ? "opacity-100" : "pointer-events-none opacity-0")}>
      <ScreenButton icon={Play} label={state === "paused" ? t("computerScreen.resume") : t("computerScreen.play")}
        onClick={state === "paused" ? controls.resume : controls.play} busy={busy} />
      <ScreenButton icon={Pause} label={t("computerScreen.pause")} onClick={controls.pause} busy={busy} />
      <ScreenButton icon={Square} label={t("computerScreen.stop")} onClick={controls.stop} busy={busy} />
    </div>
  ) : null;
  return (
    <figure className="m-0 flex flex-col gap-1.5" data-computer-screen={state} data-computer-source={source}>
      <div
        data-controls={shown ? "shown" : "hidden"}
        onPointerEnter={(event) => intent?.pointerEnter(event.pointerType)}
        onPointerLeave={(event) => intent?.pointerLeave(event.pointerType)}
        onPointerDown={(event) => intent?.pointerDown(event.pointerType)}
        onFocus={() => intent?.focusIn()}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) intent?.focusOut(); }}
        className={cn("group/screen relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-card",
          !showLive && "min-h-fit flex-col")}>
        {showLive ? live : (
          <div data-screen-empty="" className="flex min-h-0 max-w-[85%] flex-1 flex-col items-center justify-center gap-2 pb-2 pt-9 text-center text-ink-secondary">
            <Icon size={28} aria-hidden="true" className={cn(state === "starting" && "animate-spin", state === "error" && "text-warning")} />
            <span className="text-[13px] font-medium text-ink">{screenStateLabel(state)}</span>
            {message && <p role="status" className="text-[12px] leading-relaxed">{message}</p>}
            {hint && (
              <p role="note" data-screen-hint="" className="flex items-start justify-center gap-1 text-[11px] leading-snug text-ink-tertiary">
                <Moon size={11} aria-hidden="true" className="mt-[2px] shrink-0 opacity-70" />
                <span>{hint}</span>
              </p>
            )}
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
        )}
        {showsStateChip(state) && (
          <span data-power={state} className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "paused" || state === "starting" ? "bg-accent/50" : state === "error" ? "bg-danger" : "bg-white/50")} />
            {screenStateLabel(state)}
          </span>
        )}
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
