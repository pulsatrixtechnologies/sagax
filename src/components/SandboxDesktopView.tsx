// The desktop of the signed-in person's server environment (organization
// mode), live in the Computer panel: what bots doing computer use there see.
// Only the owner reaches it (/api/desktop-viewer/sandbox/me builds the target
// from the session). Read-only by default: the server hands the VNC server's
// view-only password; "Prendre le contrôle" (a button in the middle of the
// screen) asks for the full one, and while that view is open the server
// refuses the bots' clicks there (server/sandbox-control.ts). Nothing
// starts until the person asks to see it, and the view closes when the
// environment idles out.
import { useEffect, useRef, useState } from "react";
import type RFB from "@novnc/novnc";
import { ExternalLink, Eye, Hand, Loader2, Monitor, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { sandboxViewerPath, sandboxViewerProblem, type SandboxViewerProblem } from "@/lib/sandbox-desktop";
import { REVEALED_CONTROL } from "./computer/ComputerScreen";

/** "Take control" in the middle of a view-only screen, shown on intent
 * (REVEALED_CONTROL). The bot's server environment and a Tailcat remote
 * session (RemoteScreenCard) both use it. */
export function TakeControlPill({ onClick }: { onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <button type="button" onClick={onClick} data-take-control
        className={cn("flex min-h-[44px] items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-[13px] font-medium text-white shadow-md backdrop-blur-sm hover:bg-black/80 md:min-h-0", REVEALED_CONTROL)}>
        <Hand size={15} aria-hidden="true" />
        {t("sandboxDesktop.takeControl")}
      </button>
    </div>
  );
}

type ViewState = "idle" | "connecting" | "connected" | "stopped" | SandboxViewerProblem;

/** `onConnected`: the view is live (opening it may have started the
 * environment, so a power chip next to it should refresh). */
/** `embedded`: only the live screen, filling its parent (the Computer
 * tab's square, which draws the frame and the controls), connecting at once.
 * `onTakeControl`: the embedded square stays view-only and its "Take
 * control" opens the large window instead (SandboxDesktopModal).
 * `control`: set by that window, which owns taking and releasing control. */
export function SandboxDesktopView({ onConnected, embedded = false, onTakeControl, control: controlled }: {
  onConnected?: () => void; embedded?: boolean; onTakeControl?: () => void; control?: boolean;
} = {}) {
  const screen = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ViewState>("idle");
  const [ownControl, setControl] = useState(false);
  const control = controlled ?? ownControl;
  const [attempt, setAttempt] = useState(embedded ? 1 : 0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    let client: RFB | undefined;
    setState("connecting");
    const connect = async () => {
      try {
        const path = sandboxViewerPath(control);
        const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        if (!response.ok) {
          const reason = await response.json().catch(() => ({})) as { code?: unknown };
          setState(sandboxViewerProblem(response.status, reason.code));
          return;
        }
        const config = await response.json() as { password?: string; viewOnly?: boolean };
        // noVNC loads only when the person asks to see the desktop.
        const { default: Rfb } = await import("@novnc/novnc");
        if (controller.signal.aborted || !screen.current) return;
        const websocket = new URL(sandboxViewerPath(control, true), location.href);
        websocket.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        client = new Rfb(screen.current, websocket.href, { credentials: { password: config.password ?? "", username: "", target: "" } });
        client.viewOnly = config.viewOnly !== false;
        client.scaleViewport = true;
        client.background = "var(--color-inset)";
        client.addEventListener("connect", () => {
          if (controller.signal.aborted) return;
          setState("connected");
          onConnectedRef.current?.();
        });
        client.addEventListener("disconnect", () => { if (!controller.signal.aborted) setState("stopped"); });
      } catch {
        if (!controller.signal.aborted) setState("unavailable");
      }
    };
    void connect();
    return () => {
      controller.abort();
      client?.disconnect();
    };
  }, [attempt, control]);

  const show = () => setAttempt((value) => value + 1);
  const toggleControl = () => {
    setControl((value) => !value);
    if (attempt === 0) show();
  };
  const message = state === "idle" ? t("sandboxDesktop.help")
    : state === "connecting" ? t("sandboxDesktop.connecting")
    : state === "connected" ? t(control ? "sandboxDesktop.controlling" : "sandboxDesktop.watching")
    : t(`sandboxDesktop.${state}`);
  const live = state === "connected";

  if (embedded) {
    return (
      <div data-sandbox-desktop={state} data-control={control ? "1" : "0"} className="absolute inset-0">
        <div ref={screen} role="application" aria-label={t("sandboxDesktop.screen")} className="h-full w-full" />
        {live && !control && controlled === undefined && (
          // View-only: one button in the middle of the screen to take the
          // wheel (the server then refuses the bots' clicks there).
          <TakeControlPill onClick={onTakeControl ?? toggleControl} />
        )}
        {live && control && controlled === undefined && (
          <button type="button" onClick={toggleControl} data-release-control title={t("sandboxDesktop.controlHint")}
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[11.5px] font-medium text-accent-ink shadow-sm hover:brightness-110">
            <Hand size={12} aria-hidden="true" />
            {t("sandboxDesktop.releaseControl")}
          </button>
        )}
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-ink-secondary">
            {state === "connecting" && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            <p role="status">{message}</p>
            {state !== "connecting" && (
              <button type="button" onClick={show} className="ui-button flex min-h-[44px] items-center gap-2 md:min-h-0">
                <RefreshCw size={14} aria-hidden="true" />
                {t("sandboxDesktop.show")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-label={t("sandboxDesktop.title")} data-sandbox-desktop={state} data-control={control ? "1" : "0"} className="mt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px] text-ink-secondary">
        <span className="flex items-center gap-1.5"><Monitor size={14} aria-hidden="true" />{t("sandboxDesktop.title")}</span>
        {live && <span className="flex items-center gap-1 text-[11px]">{control ? <Hand size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}{t(control ? "sandboxDesktop.controlling" : "sandboxDesktop.watching")}</span>}
      </div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-hairline bg-inset">
        <div ref={screen} role="application" aria-label={t("sandboxDesktop.screen")} className="h-full w-full" />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-[12.5px] leading-relaxed text-ink-secondary">
            {state === "connecting" && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            <p role="status">{message}</p>
            {state !== "connecting" && (
              <button type="button" onClick={show} className="ui-button flex min-h-[44px] items-center gap-2 md:min-h-0">
                {state === "idle" ? <Monitor size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                {t("sandboxDesktop.show")}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleControl}
          aria-pressed={control}
          disabled={state === "connecting"}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50 md:min-h-0"
        >
          <Hand size={14} aria-hidden="true" />
          {t(control ? "sandboxDesktop.releaseControl" : "sandboxDesktop.takeControl")}
        </button>
        <button
          type="button"
          onClick={() => { window.open(`/desktop-viewer#${new URLSearchParams({ target: "sandbox/me" })}`, "_blank", "noopener"); }}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover md:min-h-0"
        >
          <ExternalLink size={14} aria-hidden="true" />
          {t("sandboxDesktop.openWindow")}
        </button>
      </div>
    </section>
  );
}
