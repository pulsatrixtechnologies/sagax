// This computer's live picture inside SandboxDesktopModal (Watching / You
// have control), opened from the bot panel's Computer card (#2342).
//
// The frames come from the desktop app's main process (window.ogb.screenFrame
// -> IPC "screen:frame" -> desktopCapturer), on the local page and on this
// app's page served by the organization server alike. Without the desktop app
// (a web browser) nothing can see this screen, so the window says so at once.
// When frames stay empty the window says the real reason (the
// vague "temporarily unavailable" hid a missing bridge): Screen Recording not
// allowed (with the button to the right System Settings pane, never a
// prompt), allowed but still empty (relaunch), or the capture's own error.
import { useEffect, useState } from "react";
import { Loader2, MonitorOff } from "lucide-react";

import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/is-mac-platform";
import { SCREEN_PROBLEM_LINE, localScreenProblem, useScreenPermission } from "@/lib/computer-screen-state";

/** Empty frames in a row before the window stops waiting and says why. */
export const LOCAL_LIVE_MISSES = 2;
/** Cadence of the live picture while the window is open. */
export const LOCAL_LIVE_INTERVAL_MS = 2_000;

export function LocalLiveScreen({ control }: { desktopId?: string; control: boolean }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const inApp = typeof window !== "undefined" && typeof window.ogb?.screenFrame === "function";
  const { screen: screenPermission } = useScreenPermission();

  useEffect(() => {
    if (!inApp) return;
    let cancelled = false;
    let inFlight = false;
    setMisses(0);
    const grab = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const image = await window.ogb!.screenFrame();
        if (cancelled) return;
        if (image) {
          setFrame(image);
          setMisses(0);
          setFailure(null);
        } else {
          setMisses((n) => n + 1);
        }
      } catch (error) {
        if (cancelled) return;
        setFailure(error instanceof Error && error.message ? error.message : String(error ?? ""));
        setMisses((n) => n + 1);
      } finally {
        inFlight = false;
      }
    };
    void grab();
    const timer = window.setInterval(() => void grab(), LOCAL_LIVE_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [inApp]);

  const stuck = !inApp || (!frame && misses >= LOCAL_LIVE_MISSES);
  const problem = localScreenProblem({ inApp, mac: isMacPlatform(), screenPermission, failed: failure !== null, failure });
  const canOpenSettings = problem === "permission" && typeof window.ogb?.permOpenSettings === "function";
  return (
    <div data-computer-card-local-live={control ? "control" : "watch"} className="absolute inset-0 flex items-center justify-center bg-black">
      {frame && inApp ? (
        <img src={frame} alt="" data-local-live-frame="" className="h-full w-full object-contain" draggable={false} />
      ) : stuck ? (
        <div role="alert" data-local-live-error={problem} className="flex max-w-sm flex-col items-center gap-2 px-6 text-center text-white/75">
          <MonitorOff size={22} aria-hidden="true" />
          <p className="text-[12px]">{t(SCREEN_PROBLEM_LINE[problem])}</p>
          {problem === "capture-failed" && failure && (
            <p data-local-live-failure="" className="break-words text-[11px] text-white/50">{failure}</p>
          )}
          {canOpenSettings && (
            <button
              type="button"
              data-local-live-settings=""
              onClick={() => void window.ogb?.permOpenSettings?.("screen")}
              className="mt-1 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/15"
            >
              {t("computerThumb.allowScreen")}
            </button>
          )}
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2 text-[12px] text-white/70">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {t("computer.capturingLocal")}
        </p>
      )}
    </div>
  );
}
