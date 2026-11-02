// "Take control" of the server environment desktop opens it here, large
// (92vw by 88vh, the remote screen scaled to fit and letterboxed), while the
// Computer tab's square stays view-only. The window chrome is calm: close on
// the left, collapse back to the panel on the right. The live screen sits in
// the middle with even margins and rounded corners. One segmented control
// under it chooses Watching (the bot drives) or Take control / You have
// control (you drive). Play / Pause / Stop and full screen live in a small
// "..." menu, never in the header. Closing releases control: the control
// view's WebSocket ends, so the server lets the bots' clicks through again
// and tells the bot, as before (server/sandbox-control.ts).
//
// Keys go to the VNC canvas while it has focus. Cmd/Ctrl+Shift+Escape always
// closes; a plain Escape closes only when focus is not in the remote screen
// (src/lib/sandbox-desktop.ts takeoverKey).
//
// The bot's browser takes control in this same window (BrowserPanel): its
// live browser in place of the VNC screen, without Play / Pause / Stop or
// the Watching / Take control segments (the browser bar owns that).
// Opening moves keyboard focus into the window; closing gives it back.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, Hand, Maximize2, Minimize2, MoreHorizontal, Pause, Play, Square, X } from "lucide-react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { takeoverKey } from "@/lib/sandbox-desktop";
import { SandboxDesktopView } from "../SandboxDesktopView";
import { type ScreenControls } from "./ComputerScreen";

export function SandboxDesktopModal({ title, state, controls, busy = false, onClose, onConnected, screen: content, kind = "sandbox" }: {
  /** "<Bot>'s screen": the environment the bot works in. */
  title: string;
  state: ScreenState;
  /** Play / Pause / Stop in the "..." menu; none for the browser. */
  controls?: ScreenControls;
  busy?: boolean;
  /** Also releases control (the view unmounts). */
  onClose: () => void;
  onConnected?: () => void;
  /** The live screen, given whether the person has control (the server
   * environment's VNC desktop by default). */
  screen?: (control: boolean) => ReactNode;
  kind?: "sandbox" | "browser";
}) {
  const [control, setControl] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const moreOpenRef = useRef(moreOpen);
  moreOpenRef.current = moreOpen;

  useEffect(() => {
    // Capture phase on window: before the VNC canvas and before the panels
    // behind this window (their own Escape must not fire too).
    const capture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (moreOpenRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMoreOpen(false);
        return;
      }
      const inScreen = event.target instanceof Node && Boolean(screen.current?.contains(event.target));
      if (takeoverKey(event, inScreen) !== "close") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    const screenChange = () => setFullscreen(document.fullscreenElement === panel.current && panel.current !== null);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    window.addEventListener("keydown", capture, true);
    document.addEventListener("fullscreenchange", screenChange);
    return () => {
      window.removeEventListener("keydown", capture, true);
      document.removeEventListener("fullscreenchange", screenChange);
      if (document.fullscreenElement && document.fullscreenElement === panel.current) void document.exitFullscreen().catch(() => {});
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target) && !moreMenuRef.current?.contains(event.target)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [moreOpen]);

  const toggleFullscreen = () => {
    setMoreOpen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void panel.current?.requestFullscreen().catch(() => {});
  };

  const setWatching = () => setControl(false);
  const setDriving = () => setControl(true);

  const powerItems = controls
    ? [
        {
          id: "play",
          label: state === "paused" ? t("computerScreen.resume") : t("computerScreen.play"),
          icon: <Play size={14} aria-hidden="true" />,
          disabled: busy || !(state === "paused" ? controls.resume : controls.play),
          onSelect: () => { (state === "paused" ? controls.resume : controls.play)?.(); },
        },
        {
          id: "pause",
          label: t("computerScreen.pause"),
          icon: <Pause size={14} aria-hidden="true" />,
          disabled: busy || !controls.pause,
          onSelect: () => { controls.pause?.(); },
        },
        {
          id: "stop",
          label: t("computerScreen.stop"),
          icon: <Square size={14} aria-hidden="true" fill="currentColor" />,
          disabled: busy || !controls.stop,
          onSelect: () => { controls.stop?.(); },
        },
      ]
    : [];

  const body = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" data-sandbox-takeover data-takeover-kind={kind} data-power={state}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={cn(
          "flex flex-col overflow-hidden bg-[#161618] text-white shadow-2xl outline-none dark:bg-[#121214]",
          fullscreen ? "h-full w-full" : "h-[88vh] w-[92vw] rounded-2xl border border-white/10",
        )}>
        {/* Window chrome only: close left, collapse to panel right. */}
        <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
          <button
            type="button"
            aria-label={t("sandboxDesktop.closeWindow")}
            title={t("sandboxDesktop.closeWindow")}
            onClick={onClose}
            data-takeover-close
            className="group flex size-7 items-center justify-center rounded-full bg-[#ff5f57]/90 text-transparent hover:text-black/70"
          >
            <X size={10} strokeWidth={3} aria-hidden="true" className="opacity-0 group-hover:opacity-100" />
          </button>
          <button
            type="button"
            aria-label={t("sandboxDesktop.collapseToPanel")}
            title={t("sandboxDesktop.collapseToPanel")}
            onClick={onClose}
            data-takeover-collapse
            className="flex size-7 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
          >
            <Minimize2 size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-1">
          <div
            ref={screen}
            className={cn(
              "relative min-h-0 flex-1 overflow-hidden rounded-xl",
              kind === "browser" ? "flex flex-col bg-[#1c1c1e]" : "bg-black",
            )}
          >
            {content ? content(control) : <SandboxDesktopView embedded control={control} onConnected={onConnected} />}
          </div>

          {/* Watching | Take control under the screen; power / expand in "...". */}
          <div className="relative mt-4 flex shrink-0 items-center justify-center gap-2">
            {kind !== "browser" && (
              <div
                role="radiogroup"
                aria-label={t("sandboxDesktop.controlMode")}
                data-takeover-segments=""
                className="inline-flex items-center gap-0.5 rounded-full bg-white/8 p-0.5"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!control}
                  data-takeover-control={control ? "release" : "watch"}
                  title={control ? t("sandboxDesktop.controlHint") : undefined}
                  onClick={setWatching}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                    !control ? "bg-white/16 text-white shadow-sm" : "text-white/55 hover:text-white/80",
                  )}
                >
                  <Eye size={13} aria-hidden="true" />
                  {t("sandboxDesktop.watching")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={control}
                  data-takeover-control={control ? "drive" : "take"}
                  onClick={setDriving}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                    control ? "bg-white/16 text-white shadow-sm" : "text-white/55 hover:text-white/80",
                  )}
                >
                  <Hand size={13} aria-hidden="true" />
                  {t(control ? "sandboxDesktop.controlling" : "sandboxDesktop.takeControl")}
                </button>
              </div>
            )}

            <div ref={moreRef} className={cn("absolute right-0", kind === "browser" && "static")}>
              <button
                ref={moreButtonRef}
                type="button"
                aria-label={t("sandboxDesktop.windowMenu")}
                title={t("sandboxDesktop.windowMenu")}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                data-takeover-more=""
                onClick={() => setMoreOpen((value) => !value)}
                className="flex size-8 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
              {moreOpen && (
                <AnchoredPopover
                  anchorRef={moreButtonRef}
                  popoverRef={moreMenuRef}
                  role="menu"
                  aria-label={t("sandboxDesktop.windowMenu")}
                  side="top"
                  align="end"
                  className="flex w-[220px] flex-col gap-0.5 rounded-xl border border-white/10 bg-[#1c1c1e] p-1.5 text-[13px] leading-[18px] text-white shadow-lg"
                >
                  {powerItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      data-takeover-power={item.id}
                      aria-label={item.label}
                      disabled={item.disabled}
                      onClick={() => { setMoreOpen(false); item.onSelect(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-white/90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    data-takeover-fullscreen=""
                    aria-label={t(fullscreen ? "sandboxDesktop.exitFullscreen" : "sandboxDesktop.fullscreen")}
                    onClick={toggleFullscreen}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-white/90 hover:bg-white/10"
                  >
                    {fullscreen
                      ? <Minimize2 size={14} aria-hidden="true" />
                      : <Maximize2 size={14} aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">
                      {t(fullscreen ? "sandboxDesktop.exitFullscreen" : "sandboxDesktop.fullscreen")}
                    </span>
                  </button>
                </AnchoredPopover>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? body : createPortal(body, document.body);
}
