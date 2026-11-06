// This computer's live picture inside SandboxDesktopModal (Watching / You
// have control), opened from the bot panel's Computer card (#2342).
//
// In the desktop app the frames come from the Electron main process
// (window.ogb.screenFrame -> IPC "screen:frame" -> desktopCapturer), the same
// capture the ComputerPanel's local preview uses. The first real capture is
// what makes macOS show the Screen Recording prompt; repeated empty frames
// mean it was denied, so the window says so with the Settings repair path
// instead of spinning. Outside the app (a browser on the organization server)
// the person's computer is reached through the desktop bridge.
import { useEffect, useState } from "react";
import { Loader2, Monitor } from "lucide-react";

import { desktopLocalVm } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/is-mac-platform";

/** Empty frames in a row before the window stops waiting and says why. */
export const LOCAL_LIVE_MISSES = 2;
/** Cadence of the live picture while the window is open. */
export const LOCAL_LIVE_INTERVAL_MS = 2_000;

export function LocalLiveScreen({ desktopId, control }: { desktopId?: string; control: boolean }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const inApp = typeof window !== "undefined" && typeof window.ogb?.screenFrame === "function";

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setMisses(0);
    const grab = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const image = inApp
          ? await window.ogb!.screenFrame()
          : (await desktopLocalVm("screenshot", { desktopId })).image ?? null;
        if (cancelled) return;
        if (image) {
          setFrame(image);
          setMisses(0);
        } else {
          setMisses((n) => n + 1);
        }
      } catch {
        if (!cancelled) setMisses((n) => n + 1);
      } finally {
        inFlight = false;
      }
    };
    void grab();
    const timer = window.setInterval(() => void grab(), LOCAL_LIVE_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [desktopId, inApp]);

  const stuck = !frame && misses >= LOCAL_LIVE_MISSES;
  const needsPermission = stuck && inApp && isMacPlatform();
  return (
    <div data-computer-card-local-live={control ? "control" : "watch"} className="absolute inset-0 flex items-center justify-center bg-black">
      {frame ? (
        <img src={frame} alt="" data-local-live-frame="" className="h-full w-full object-contain" draggable={false} />
      ) : stuck ? (
        <div role="alert" data-local-live-error={needsPermission ? "screen-permission" : "unavailable"} className="flex max-w-sm flex-col items-center gap-2 px-6 text-center text-white/75">
          <Monitor size={22} aria-hidden="true" />
          <p className="text-[12px]">{t(needsPermission ? "computer.needsScreenPerm" : "computer.err.screenUnavailable")}</p>
          {needsPermission && window.ogb?.permOpenSettings && (
            <button
              type="button"
              data-local-live-settings=""
              onClick={() => void window.ogb?.permOpenSettings?.("screen")}
              className="mt-1 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/15"
            >
              {t("computer.openSettings")}
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
