// "Take control" of the server environment desktop opens it here, over the
// whole app window (#3386: no dimmed backdrop, no modal frame; the remote
// screen scaled to fit and letterboxed), while the
// Computer tab's square stays view-only. The window chrome is calm: one
// round X (CIRCLE_CLOSE_BUTTON, JC 2026-11-06) at the top right closes it
// back to the panel (no red close dot, 2026-11-02). The live screen fills
// the window edge to edge; while it is not ready it shows DesktopStarting.
// One segmented control under it, bottom center, chooses Watching (the bot
// drives) or Take control / You have control (you drive). No Play / Pause / Stop here: the computer's
// lifecycle runs on its own and lives in the bot's settings (JC 2026-11-02).
// Closing releases control: the control
// view's WebSocket ends, so the server lets the bots' clicks through again
// and tells the bot, as before (server/sandbox/sandbox-control.ts).
//
// Keys go to the VNC canvas while it has focus. Cmd/Ctrl+Shift+Escape always
// closes; a plain Escape closes only when focus is not in the remote screen
// (src/lib/sandbox-desktop.ts takeoverKey).
//
// The bot's browser takes control in this same window (BrowserPanel): its
// live browser in place of the VNC screen, without the Watching / Take
// control segments (the browser bar owns that).
// Opening moves keyboard focus into the window; closing gives it back.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, Hand, X } from "lucide-react";

import { CIRCLE_CLOSE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { takeoverKey } from "@/lib/sandbox-desktop";
import { SandboxDesktopView } from "../SandboxDesktopView";

export function SandboxDesktopModal({ title, state, onClose, onConnected, screen: content, kind = "sandbox" }: {
  /** "<Bot>'s screen": the environment the bot works in. */
  title: string;
  state: ScreenState;
  /** Also releases control (the view unmounts). */
  onClose: () => void;
  onConnected?: () => void;
  /** The live screen, given whether the person has control (the server
   * environment's VNC desktop by default). */
  screen?: (control: boolean) => ReactNode;
  kind?: "sandbox" | "browser";
}) {
  const [control, setControl] = useState(true);
  const panel = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // Capture phase on window: before the VNC canvas and before the panels
    // behind this window (their own Escape must not fire too).
    const capture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const inScreen = event.target instanceof Node && Boolean(screen.current?.contains(event.target));
      if (takeoverKey(event, inScreen) !== "close") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    window.addEventListener("keydown", capture, true);
    return () => {
      window.removeEventListener("keydown", capture, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);


  const setWatching = () => setControl(false);
  const setDriving = () => setControl(true);

  const body = (
    // The whole app window (#3386): no dimmed backdrop and no modal frame.
    // A thin top row holds the one control that leaves, the screen fills
    // the rest edge to edge, and the switch sits at the bottom center.
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      data-sandbox-takeover data-takeover-kind={kind} data-power={state} data-takeover-layout="full-window"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
      {/* Window chrome only: the round X (CIRCLE_BUTTON) closes, top right. */}
      <div className="flex shrink-0 items-center justify-end px-3 py-2">
        <button
          type="button"
          aria-label={t("sandboxDesktop.closeWindow")}
          title={t("sandboxDesktop.closeWindow")}
          onClick={onClose}
          data-takeover-close
          data-takeover-collapse
          className={CIRCLE_CLOSE_BUTTON}
        >
          <X {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      </div>

      <div
        ref={screen}
        data-takeover-screen=""
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          kind === "browser" ? "flex flex-col bg-[#1c1c1e]" : "bg-black",
        )}
      >
        {content ? content(control) : <SandboxDesktopView embedded dark control={control} onConnected={onConnected} />}
      </div>

      {/* Watching | Take control, bottom center. */}
      {kind !== "browser" && (
        <div className="flex shrink-0 items-center justify-center py-3">
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
        </div>
      )}
    </div>
  );
  return typeof document === "undefined" ? body : createPortal(body, document.body);
}
