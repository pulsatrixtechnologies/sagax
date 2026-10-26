// A Tailcat remote session's screen in the chat, drawn exactly like the bot's
// own computer screen (ComputerScreen): the live picture with rounded
// corners, "Take control" in the middle on intent (TakeControlPill), Play /
// Pause / Stop at the bottom, and "<POSTE>'s screen" under it. Play / Pause
// pause the live picture; Stop ends the session, on a second press.
//
// Take control opens the same large window as the bot's server environment
// (SandboxDesktopModal): its title, "Running · You have control", Release
// control, Play / Pause / Stop, full screen and close. Inside it the live
// control WebSocket (#950) streams the frames and carries the mouse and the
// keyboard while control is held. The Computer tab is never opened for a
// remote session anymore.
import { useCallback, useEffect, useRef, useState } from "react";

import { publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { ComputerScreen, type ScreenControls } from "@/components/computer/ComputerScreen";
import { SandboxDesktopModal } from "@/components/computer/SandboxDesktopModal";
import { TakeControlPill } from "@/components/SandboxDesktopView";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { controlSupportedOs } from "@/lib/remote-control-os";
import { clearRemoteSessionLocal } from "@/lib/remote-session-focus";
import { closeRemoteSession } from "./remote-session-client";
import { remoteClosePhase } from "./remote-close";
import { useRemoteControl } from "./use-remote-control";

/** How often the chat picture is refreshed while it plays. */
export const SCREEN_POLL_MS = 4000;
/** How long a first Stop waits for the second. */
export const STOP_CONFIRM_MS = 5000;

/** The name under the screen: the computer's name, else its support code. */
export function remoteScreenCaption(view: RemoteSessionView): string {
  return t("computer.screenOf", { name: publicText(view.hostname) || view.code });
}

/** Whether a session has a screen to show at all: connected, not a server
 * without a desktop. */
export function remoteHasScreen(view: RemoteSessionView): boolean {
  return view.state === "connected" && !view.headless;
}

/** Take control is offered where live control exists (Windows), once the OS
 * is known. Elsewhere the picture stays view-only. */
export function remoteControllable(view: RemoteSessionView): boolean {
  return view.osKnown !== false && controlSupportedOs(view.os);
}

/** Why there is no picture, in the person's words; undefined while it simply
 * loads. */
export function remoteScreenProblem(view: RemoteSessionView, missed: boolean): string | undefined {
  if (view.screenDenied) return t("remoteSession.screenDenied");
  const inventory = view.inventory ?? "ready";
  // the facts card under it asks for the OS; the screen only says it waits
  if (inventory === "os-unknown") return t("remoteSession.screenOsUnknown");
  if (inventory !== "ready" && inventory !== "pending") return t(`remoteSession.inventory.${inventory}`);
  if (missed && inventory === "ready") return t("remoteSession.screenFailed");
  return undefined;
}

/** A wait Sagax resolves by itself (it asks again): not an error. */
function remoteScreenWaits(view: RemoteSessionView): boolean {
  const inventory = view.inventory ?? "ready";
  return !view.screenDenied && (inventory === "os-unknown" || inventory === "no-answer" || inventory === "pending");
}

/** The state the screen shows (ComputerScreen): off once the session ended,
 * paused while the person paused it, running with a picture, an error with
 * its reason, starting while the first picture comes. */
export function remoteScreenState(view: RemoteSessionView, input: { shot: string | null; missed: boolean; paused: boolean }): ScreenState {
  if (view.state !== "connected") return "off";
  if (input.paused) return "paused";
  if (input.shot) return "running";
  return remoteScreenProblem(view, input.missed) && !remoteScreenWaits(view) ? "error" : "starting";
}

/** Poll the read-only screenshot. The server reads the computer again (its
 * OS, its facts) on the same call when the card still lacks them. */
export function useScreenPoll(botId: string, sessionId: string | undefined, enabled: boolean, intervalMs: number = SCREEN_POLL_MS) {
  const [shot, setShot] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  useEffect(() => {
    if (!sessionId || !enabled) return;
    let stop = false;
    let current: string | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(sessionId)}/screen`);
        if (stop) return;
        if (!res.ok) { setMissed(true); return; }
        const blob = await res.blob();
        if (stop) return;
        const next = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = next;
        setShot(next);
        setMissed(false);
      } catch {
        if (!stop) setMissed(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => { stop = true; clearInterval(timer); if (current) URL.revokeObjectURL(current); };
  }, [botId, sessionId, enabled, intervalMs]);
  return { shot, missed };
}

/** Stop ends the session on a second press within STOP_CONFIRM_MS (the same
 * two steps as Close in the panel, remoteClosePhase). */
function useStopSession(botId: string, view: RemoteSessionView) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const stop = useCallback(() => {
    if (remoteClosePhase(confirmId, view.id) === "ask") {
      setConfirmId(view.id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmId(null), STOP_CONFIRM_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirmId(null);
    setBusy(true);
    void closeRemoteSession(botId, view.id).then((failed) => {
      setBusy(false);
      if (failed) setError(failed);
      else clearRemoteSessionLocal(botId, view.id);
    });
  }, [botId, confirmId, view.id]);
  return { stop, confirming: confirmId === view.id, error, busy };
}

/** The live picture inside the take-over window: frames from the control
 * WebSocket, the polled picture until the first one arrives, and the mouse
 * and keyboard while control is held. */
export function RemoteLiveScreen({ botId, view, control }: { botId: string; view: RemoteSessionView; control: boolean }) {
  const live = useRemoteControl(botId, view.id, { live: true, granted: control });
  const fallback = useScreenPoll(botId, view.id, !live.frameUrl);
  const frame = live.frameUrl ?? fallback.shot;
  const ratio = live.aspect ?? 16 / 10;
  return (
    <div data-remote-live-screen="" data-remote-input={control && live.phase === "active" ? "control" : "none"}
      className="absolute inset-0 flex items-center justify-center" style={{ containerType: "size" }}>
      {frame ? (
        <div
          ref={live.surfaceRef}
          data-remote-control-viewport=""
          // the box is exactly the picture, so a click maps to the same point remotely
          style={{ aspectRatio: String(ratio), width: `min(100cqw, calc(100cqh * ${ratio}))`, ...(control ? { touchAction: "none", outline: "none" } : {}) }}
          tabIndex={control ? 0 : -1}
          onPointerMove={control ? live.onPointerMove : undefined}
          onPointerDown={control ? live.onPointerDown : undefined}
          onPointerUp={control ? live.onPointerUp : undefined}
          onContextMenu={control ? live.onContextMenu : undefined}
          onWheel={control ? live.onWheel : undefined}
        >
          <img data-remote-session-shot="" src={frame} alt={remoteScreenCaption(view)} draggable={false} className="block h-full w-full select-none object-contain" />
        </div>
      ) : (
        <p role="status" className="text-[12px] text-white/70">{remoteScreenProblem(view, fallback.missed) ?? t("remoteSession.screenLoading")}</p>
      )}
      {live.error && <p role="alert" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[12px] text-white">{live.error}</p>}
    </div>
  );
}

/** The take-over window for one session: the bot computer's own window. */
export function RemoteTakeover({ botId, view, state, controls, onClose }: {
  botId: string;
  view: RemoteSessionView;
  state: ScreenState;
  controls?: ScreenControls;
  onClose: () => void;
}) {
  return (
    <SandboxDesktopModal
      title={remoteScreenCaption(view)}
      state={state === "paused" ? "running" : state}
      {...(controls ? { controls } : {})}
      onClose={onClose}
      screen={(control) => <RemoteLiveScreen botId={botId} view={view} control={control} />}
    />
  );
}

/** The chat's screen card for a connected remote session. */
export function RemoteScreenCard({ botId, view }: { botId: string; view: RemoteSessionView }) {
  const [paused, setPaused] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const connected = view.state === "connected";
  // one picture source at a time: the window streams while it is open
  const { shot, missed } = useScreenPoll(botId, view.id, connected && !paused && !takeover);
  const ending = useStopSession(botId, view);
  const state = remoteScreenState(view, { shot, missed, paused });
  const caption = remoteScreenCaption(view);
  const controllable = remoteControllable(view);
  const controls: ScreenControls = {
    play: undefined,
    resume: paused ? () => setPaused(false) : undefined,
    pause: !paused && connected ? () => setPaused(true) : undefined,
    stop: connected ? ending.stop : undefined,
  };
  const live = shot ? (
    <>
      <img data-remote-session-shot="" src={shot} alt={caption} className="h-full w-full object-contain" draggable={false} />
      {controllable && state === "running" && <TakeControlPill onClick={() => setTakeover(true)} />}
    </>
  ) : undefined;
  return (
    <div data-remote-screen-card="" data-remote-screen-state={state}>
      <ComputerScreen
        source="remote"
        state={state}
        caption={caption}
        live={takeover
          ? <div data-remote-takeover-open="" className="flex h-full w-full items-center justify-center p-4 text-center text-[12px] text-ink-secondary">{t("sandboxDesktop.inWindow")}</div>
          : live}
        message={state === "error" || state === "starting" ? remoteScreenProblem(view, missed) ?? t("remoteSession.screenLoading") : undefined}
        busy={ending.busy}
        error={ending.error ?? undefined}
        controls={connected ? controls : undefined}
      />
      {ending.confirming && (
        <p role="status" data-remote-stop-confirm="" className="mt-1 text-center text-[12px] text-danger">{t("remoteSession.confirmStop")}</p>
      )}
      {takeover && connected && (
        <RemoteTakeover botId={botId} view={view} state={state} controls={controls} onClose={() => setTakeover(false)} />
      )}
    </div>
  );
}
