// The VM and the remote computer in the screen side panel (#4452, lot d).
// Nothing is drawn twice: the VM tab hosts SandboxDesktopView (the server
// environment's VNC desktop) or LocalLiveScreen (the Local VM's picture), the
// remote tab hosts RemoteLiveScreen (the control stream, the polled picture
// until it arrives), exactly the views the full-window takeover uses. The
// marks layer, the header and the feedback sender stay the panel's own. A
// place with no live stream shows its last picture with the time it was taken.
// The screen fits the panel (M-20261127-181, ScreenFit): as wide or as tall as
// the column allows at its own proportions, at the top like the browser's page.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { t, activeLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { fitScreen, frameTime, screenPlaces, type ScreenPlaces, type ScreenSize, type VmSource } from "@/lib/screen-places";
import { loadServerEnvironment, type ServerEnvironmentStatus } from "@/lib/server-environment";
import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { useFocusedRemoteSession } from "@/lib/remote-session-focus";
import type { RemoteSessionView } from "../../shared/remote-session";
import type { Bot } from "@/state/store";
import { SandboxDesktopView } from "./SandboxDesktopView";
import { LocalLiveScreen } from "./computer/LocalLiveScreen";
import { RemoteLiveScreen, remoteControllable } from "./remote-session/RemoteScreenCard";
import { useRemoteSessions } from "./remote-session/use-remote-sessions";
import { frameImage, SCREEN_PICTURE } from "./ScreenMarks";

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

/** The picture's own size (the VNC framebuffer, the image's pixels) once it
 * shows. A VNC view counts only while connected; a new image still decoding
 * keeps the size the last one had. */
function shownPicture(room: HTMLElement, last: ScreenSize | null): ScreenSize | null {
  const drawing = room.querySelector(SCREEN_PICTURE);
  if (!drawing || drawing.closest("[data-sandbox-desktop]:not([data-sandbox-desktop=connected])")) return null;
  const found = frameImage(room);
  return found ? { width: found.width, height: found.height } : last;
}

const sameSize = (a: ScreenSize | null, b: ScreenSize | null) => a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);

/** The size of the screen in the room, fitted again when the panel or the
 * window resizes or when the picture changes size. */
export function useScreenFit(room: RefObject<HTMLElement | null>): ScreenSize | null {
  const [box, setBox] = useState<ScreenSize | null>(null);
  useEffect(() => {
    const element = room.current;
    if (!element) return;
    let space: ScreenSize = { width: 0, height: 0 };
    let picture: ScreenSize | null = null;
    const apply = () => { const next = fitScreen(space, picture); setBox((current) => sameSize(current, next) ? current : next); };
    const measure = () => { const rect = element.getBoundingClientRect(); space = { width: rect.width, height: rect.height }; apply(); };
    const read = () => { picture = shownPicture(element, picture); apply(); };
    measure(); read();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    const change = new MutationObserver(read);
    change.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "width", "height", "data-sandbox-desktop"] });
    element.addEventListener("load", read, true);
    return () => { resize?.disconnect(); change.disconnect(); element.removeEventListener("load", read, true); };
  }, [room]);
  return box;
}

/** A place's live screen fitted to the panel: the dark frame is exactly the
 * picture, at the top of the column and centred across, so no band of empty
 * screen shows above or below it. Until the picture shows (starting, a
 * problem) the frame fills the room, its words in the middle. */
function ScreenFit({ pane, source, children }: { pane: "vm" | "remote"; source?: VmSource; children: ReactNode }) {
  const room = useRef<HTMLDivElement>(null);
  const box = useScreenFit(room);
  return (
    <div ref={room} data-screen-room="" className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden">
      <div data-screen-pane={pane} data-vm-source={source} data-screen-fit={box ? "fitted" : "filling"}
        style={box ? { width: box.width, height: box.height } : undefined}
        className={cn("relative overflow-hidden bg-black", box ? "shrink-0" : "flex-1 self-stretch")}>
        {children}
      </div>
    </div>
  );
}

/** The VM tab: the server environment's live desktop, or the Local VM's picture. */
export function VmPane({ source, control, host }: { source: VmSource; control: boolean; host: RefObject<HTMLElement | null> }) {
  return (
    <>
      <ScreenFit pane="vm" source={source}>
        {source === "server" ? <SandboxDesktopView embedded dark control={control} /> : <LocalLiveScreen control={false} />}
      </ScreenFit>
      <LastPicture host={host} />
    </>
  );
}

/** The remote computer tab: the session's live stream and its control. */
export function RemotePane({ botId, view, control, host }: { botId: string; view: RemoteSessionView; control: boolean; host: RefObject<HTMLElement | null> }) {
  return (
    <>
      <ScreenFit pane="remote">
        <RemoteLiveScreen key={view.id} botId={botId} view={view} control={control} />
      </ScreenFit>
      <LastPicture host={host} />
    </>
  );
}
