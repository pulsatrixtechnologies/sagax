// The VM and the remote computer in the screen side panel (#4452, lot d).
// Nothing is drawn twice: the VM tab hosts SandboxDesktopView (the server
// environment's VNC desktop) or LocalLiveScreen (the Local VM's picture), the
// remote tab hosts RemoteLiveScreen (the control stream, the polled picture
// until it arrives), exactly the views the full-window takeover uses. The
// marks layer, the header and the feedback sender stay the panel's own. A
// place with no live stream shows its last picture with the time it was taken.
import { useEffect, useState, type RefObject } from "react";
import { Hand } from "lucide-react";
import { t, activeLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";
import { FOLD_CHIP, FOLD_CHIP_LABEL } from "./ScreenPanelChrome";
import { frameTime, screenPlaces, type ScreenPlaces, type VmSource } from "@/lib/screen-places";
import { loadServerEnvironment, type ServerEnvironmentStatus } from "@/lib/server-environment";
import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { useFocusedRemoteSession } from "@/lib/remote-session-focus";
import type { RemoteSessionView } from "../../shared/remote-session";
import type { Bot } from "@/state/store";
import { SandboxDesktopView } from "./SandboxDesktopView";
import { LocalLiveScreen } from "./computer/LocalLiveScreen";
import { RemoteLiveScreen, remoteControllable } from "./remote-session/RemoteScreenCard";
import { useRemoteSessions } from "./remote-session/use-remote-sessions";

const ENVIRONMENT_POLL_MS = 15_000;

/** The person's own places for this bot, kept current while the panel is open. */
export function useScreenPlaces(bot: Bot): ScreenPlaces {
  const bridge = useDesktopBridgeStatus();
  const { rows } = useRemoteSessions(bot.id);
  const focused = useFocusedRemoteSession(bot.id);
  const [environment, setEnvironment] = useState<ServerEnvironmentStatus | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => { loadServerEnvironment().then((next) => { if (!stop) setEnvironment(next); }).catch(() => { if (!stop) setEnvironment(null); }); };
    load();
    const timer = setInterval(load, ENVIRONMENT_POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  return screenPlaces({ bot, environment, bridge, sessions: rows, focused });
}

/** Whether the person may take the hand on this place (the browser owns its own bar). */
export function placeControllable(place: "vm" | "remote", vm: VmSource | null, remote: RemoteSessionView | null): boolean {
  return place === "vm" ? vm === "server" : remote !== null && remoteControllable(remote);
}

/** Watching | Take control: the one switch of the VM and the remote computer. */
/** Take or give back the VM and the remote computer, in the panel's top row:
 * the top bar's 36px labelled button (M-20261127-179), in the accent while
 * the person drives; a narrow panel folds it to its circle. */
export function ControlSwitch({ control, onChange }: { control: boolean; onChange: (next: boolean) => void }) {
  const label = t(control ? "sandboxDesktop.releaseControl" : "sandboxDesktop.takeControl");
  return (
    <button type="button" data-screen-control={control ? "driving" : "watching"} aria-pressed={control} onClick={() => onChange(!control)}
      aria-label={label}
      title={control ? t("sandboxDesktop.controlHint") : label}
      className={cn(CIRCLE_LABEL_BUTTON, FOLD_CHIP, control ? "border-transparent bg-accent text-accent-ink hover:bg-accent hover:brightness-110" : "text-ink-secondary hover:text-ink")}>
      <Hand size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className={cn("truncate", FOLD_CHIP_LABEL)}>{label}</span>
    </button>
  );
}

/** The time of the newest picture of a place that has no live stream. */
function LastPicture({ host }: { host: RefObject<HTMLElement | null> }) {
  const [shot, setShot] = useState<{ at: number; polled: boolean } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let seen = "";
    const read = () => {
      const polled = element.querySelector("[data-remote-frame-source=poll], [data-local-live-frame]") !== null;
      const image = element.querySelector<HTMLImageElement>("img[data-remote-session-shot], img[data-local-live-frame]");
      const src = image?.getAttribute("src") ?? "";
      if (!src) { setShot(null); seen = ""; return; }
      if (src !== seen) { seen = src; setShot({ at: Date.now(), polled }); } else setShot((current) => (current && current.polled !== polled ? { ...current, polled } : current));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "data-remote-frame-source"] });
    return () => watch.disconnect();
  }, [host]);
  if (!shot?.polled) return null;
  return <p data-screen-last-picture="" role="status" className="shrink-0 pt-1.5 text-[12px] text-ink-secondary">{t("screenPanel.lastPicture", { time: frameTime(shot.at, activeLocale()) })}</p>;
}

/** The VM tab: the server environment's live desktop, or the Local VM's picture. */
export function VmPane({ source, control, host }: { source: VmSource; control: boolean; host: RefObject<HTMLElement | null> }) {
  return (
    <>
      <div data-screen-pane="vm" data-vm-source={source} className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
        {source === "server" ? <SandboxDesktopView embedded dark control={control} /> : <LocalLiveScreen control={false} />}
      </div>
      <LastPicture host={host} />
    </>
  );
}

/** The remote computer tab: the session's live stream and its control. */
export function RemotePane({ botId, view, control, host }: { botId: string; view: RemoteSessionView; control: boolean; host: RefObject<HTMLElement | null> }) {
  return (
    <>
      <div data-screen-pane="remote" className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
        <RemoteLiveScreen key={view.id} botId={botId} view={view} control={control} />
      </div>
      <LastPicture host={host} />
    </>
  );
}
