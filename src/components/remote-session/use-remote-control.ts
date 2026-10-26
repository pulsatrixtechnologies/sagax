import { useCallback, useEffect, useRef, useState } from "react";

import type { ControlEvent } from "../../../shared/remote-control";
import { t } from "@/lib/i18n";
import {
  charVk,
  controlMessage,
  grantMessage,
  isForwardedKey,
  keyToVk,
  mouseButton,
  normalizedPoint,
  releaseMessage,
  wheelDelta,
} from "@/lib/remote-control-input";

type Phase = "idle" | "connecting" | "active";

/** Opens the control WebSocket for a session, draws its frames, and forwards
 * the technician's mouse and keyboard while control is granted. Input leaves
 * only after the grant, and the socket closes (control released) when the
 * component unmounts.
 *
 * `live`: the take-over window (SandboxDesktopModal): the socket opens at
 * once and `granted` follows the window's Take / Release control, so the
 * frames keep coming while the person only watches. */
export function useRemoteControl(botId: string, sessionId: string | undefined, options: { live?: boolean; granted?: boolean } = {}) {
  const live = options.live === true;
  const granted = options.granted !== false;
  const grantedRef = useRef(granted);
  grantedRef.current = granted;
  const [phase, setPhase] = useState<Phase>("idle");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<string | null>(null);
  const pending = useRef<ControlEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const stop = useCallback(() => {
    if (flushTimer.current) { clearInterval(flushTimer.current); flushTimer.current = null; }
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      try { if (socket.readyState === WebSocket.OPEN) socket.send(grantMessage(false)); } catch { /* closing */ }
      try { socket.close(); } catch { /* already closing */ }
    }
    if (frameRef.current) { URL.revokeObjectURL(frameRef.current); frameRef.current = null; }
    setFrameUrl(null);
    setPhase("idle");
  }, []);

  const flush = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || pending.current.length === 0) return;
    const batch = pending.current;
    pending.current = [];
    try { socket.send(controlMessage(batch)); } catch { /* the socket is closing */ }
  }, []);

  const sendRelease = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    flush();
    try { socket.send(releaseMessage()); } catch { /* closing */ }
  }, [flush]);

  const queue = useCallback((event: ControlEvent) => {
    // watching only: nothing the person does reaches the computer
    if (!grantedRef.current) return;
    pending.current.push(event);
    if (event.t !== "m") flush(); // send clicks and keys at once; moves batch
  }, [flush]);

  const start = useCallback(() => {
    if (!sessionId || typeof WebSocket === "undefined" || socketRef.current) return;
    setError(null);
    setPhase("connecting");
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${window.location.host}/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(sessionId)}/control`;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.onopen = () => {
      setPhase("active");
      try { socket.send(grantMessage(grantedRef.current)); } catch { /* closed */ }
      flushTimer.current = setInterval(flush, 40);
    };
    socket.onmessage = (message) => {
      if (typeof message.data === "string") {
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(message.data) as Record<string, unknown>; } catch { return; }
        if (obj.t === "meta" && typeof obj.w === "number" && typeof obj.h === "number" && obj.h > 0) {
          setAspect(obj.w / obj.h);
        } else if (obj.t === "error") {
          setError(typeof obj.message === "string" ? obj.message : t("remoteControl.lost"));
        } else if (obj.t === "closed") {
          setError(t("remoteControl.lost"));
        }
        return;
      }
      const blob = new Blob([message.data as ArrayBuffer], { type: "image/jpeg" });
      const next = URL.createObjectURL(blob);
      if (frameRef.current) URL.revokeObjectURL(frameRef.current);
      frameRef.current = next;
      setFrameUrl(next);
    };
    socket.onclose = () => { if (socketRef.current === socket) stop(); };
    socket.onerror = () => { setError(t("remoteControl.lost")); };
  }, [botId, sessionId, flush, stop]);

  // Release control when the session changes or the component unmounts.
  useEffect(() => stop, [sessionId, stop]);

  // The take-over window: connected while it is open.
  useEffect(() => {
    if (live && sessionId) start();
  }, [live, sessionId, start]);

  // Take / Release control in the window: one grant message, the frames go on.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // given back: what was not sent yet stays here (the server lifts held keys)
    if (!granted) pending.current = [];
    try { socket.send(grantMessage(granted)); } catch { /* closing */ }
  }, [granted]);

  const toggle = useCallback(() => {
    if (phase === "idle") start();
    else stop();
  }, [phase, start, stop]);

  const rect = () => surfaceRef.current?.getBoundingClientRect();

  const onPointerMove = useCallback((event: { clientX: number; clientY: number }) => {
    const r = rect();
    if (!r) return;
    const point = normalizedPoint(event.clientX, event.clientY, r);
    queue({ t: "m", x: point.x, y: point.y });
  }, [queue]);

  const onPointerDown = useCallback((event: { clientX: number; clientY: number; button: number; pointerId?: number; preventDefault(): void }) => {
    event.preventDefault();
    surfaceRef.current?.focus();
    // Keep receiving pointer events even if the cursor leaves the frame mid-drag.
    if (typeof event.pointerId === "number") { try { surfaceRef.current?.setPointerCapture(event.pointerId); } catch { /* unsupported */ } }
    const r = rect();
    if (r) { const point = normalizedPoint(event.clientX, event.clientY, r); queue({ t: "m", x: point.x, y: point.y }); }
    const button = mouseButton(event.button);
    if (button !== null) queue({ t: "d", b: button });
  }, [queue]);

  const onPointerUp = useCallback((event: { button: number; preventDefault(): void }) => {
    event.preventDefault();
    const button = mouseButton(event.button);
    if (button !== null) queue({ t: "u", b: button });
  }, [queue]);

  const onContextMenu = useCallback((event: { preventDefault(): void }) => { event.preventDefault(); }, []);

  const onWheel = useCallback((event: { deltaY: number; preventDefault(): void }) => {
    event.preventDefault();
    const d = wheelDelta(event.deltaY);
    if (d !== 0) queue({ t: "w", d });
  }, [queue]);

  // Keyboard is captured on the window while the surface holds focus.
  useEffect(() => {
    if (phase !== "active" || !granted) return;
    const owns = () => surfaceRef.current && document.activeElement === surfaceRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!owns()) return;
      const mods = { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
      if (isForwardedKey(event.code, mods)) {
        event.preventDefault();
        const vk = keyToVk(event.code) ?? charVk(event.key);
        if (vk !== null) queue({ t: "k", k: vk, d: 1 });
        return;
      }
      // A printable character with no modifier: type it as text so the host's
      // own keyboard layout turns it into the right key (accents included).
      if (event.key.length === 1) {
        event.preventDefault();
        queue({ t: "x", s: event.key });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!owns()) return;
      const mods = { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
      if (!isForwardedKey(event.code, mods)) return;
      event.preventDefault();
      const vk = keyToVk(event.code) ?? charVk(event.key);
      if (vk !== null) queue({ t: "k", k: vk, d: 0 });
    };
    // Losing focus or hiding the tab can swallow the keyup/pointerup, so ask
    // the server to lift everything held: nothing stays stuck on the host.
    const onBlur = () => sendRelease();
    const onVisibility = () => { if (document.hidden) sendRelease(); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, granted, queue, sendRelease]);

  return {
    phase,
    granted,
    frameUrl,
    aspect,
    error,
    surfaceRef,
    toggle,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onContextMenu,
    onWheel,
  };
}
