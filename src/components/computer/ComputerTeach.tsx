// Teach by demonstration on the bot's whole computer, inside the app's
// desktop viewer (parity R7, system 11, chat 71). While a recording runs,
// clicks on the remote screen, Enter, Tab and Escape, and "the person is
// typing" go to the server (src/lib/computer-teach-client.ts); the
// characters never do. Stop opens the same review dialog as the browser
// recording, which saves the steps as a skill of the bot, turned off.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Square } from "lucide-react";

import { t } from "@/lib/i18n";
import { keyEvent, pointFraction, stopTeach, teachAction, teachStatus, type ComputerTeachEvent } from "@/lib/computer-teach-client";
import { ApiError } from "@/state/store";
import { TeachStepsDialog } from "../TeachStepsDialog";
import type { TeachStep } from "../../../shared/teach-recording";

export function useComputerTeach({ botId, screen, connected }: { botId: string; screen: RefObject<HTMLElement | null>; connected: boolean }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [taught, setTaught] = useState<{ steps: TeachStep[]; recordedAt: string } | null>(null);
  // events go one after the other, in the order the person did them
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const typing = useRef(false);

  // control went back to the bot: the server ended the recording, unkept
  const lost = useCallback(() => {
    setRecording(false);
    setNote(t("computerTeach.controlLost"));
  }, []);

  const send = useCallback((event: ComputerTeachEvent) => {
    queue.current = queue.current.then(() => teachAction(botId, { action: "event", event })).catch((error) => {
      if (error instanceof ApiError && (error.body as { code?: unknown } | undefined)?.code === "control_lost") lost();
    });
  }, [botId, lost]);

  // the hand back can happen from the app's panel: ask every few seconds
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      teachStatus(botId).then((status) => { if (status.ended === "control_lost") lost(); }, () => {});
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [recording, botId, lost]);

  useEffect(() => {
    const element = screen.current;
    if (!recording || !element) return;
    const onPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const canvas = element.querySelector("canvas");
      const point = canvas ? pointFraction(event.clientX, event.clientY, canvas.getBoundingClientRect()) : null;
      if (!point) return;
      typing.current = false;
      send({ kind: "click", ...point });
    };
    const onKey = (event: KeyboardEvent) => {
      const step = keyEvent(event);
      if (!step) return;
      if (step.kind === "typing") {
        // one step for a run of characters
        if (typing.current) return;
        typing.current = true;
      } else {
        typing.current = false;
      }
      send(step);
    };
    // capture: seen before noVNC, never stopped
    element.addEventListener("pointerdown", onPointer, true);
    element.addEventListener("keydown", onKey, true);
    return () => {
      element.removeEventListener("pointerdown", onPointer, true);
      element.removeEventListener("keydown", onKey, true);
    };
  }, [recording, screen, send]);

  const start = useCallback(async () => {
    setBusy(true);
    setNote("");
    try {
      await teachAction(botId, { action: "start" });
      typing.current = false;
      setRecording(true);
    } catch (error) {
      setNote(error instanceof Error ? error.message : t("computerTeach.startFailed"));
    } finally {
      setBusy(false);
    }
  }, [botId]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await queue.current;
      const result = await stopTeach(botId);
      setRecording(false);
      if (result.expired) setNote(t("teach.expired"));
      else if (!result.steps?.length) setNote(t("computerTeach.nothing"));
      else setTaught({ steps: result.steps, recordedAt: result.recordedAt ?? new Date().toISOString() });
    } catch (error) {
      setNote(error instanceof Error ? error.message : t("computerTeach.startFailed"));
    } finally {
      setBusy(false);
    }
  }, [botId]);

  // the viewer lost the computer: the recording ends without steps
  useEffect(() => {
    if (connected || !recording) return;
    setRecording(false);
    void teachAction(botId, { action: "discard" }).catch(() => {});
  }, [connected, recording, botId]);

  return { recording, busy, note, taught, start: () => void start(), stop: () => void stop(), closeTaught: () => setTaught(null), clearNote: () => setNote("") };
}

export function ComputerTeachBanner({ teach, botId, botName }: { teach: ReturnType<typeof useComputerTeach>; botId: string; botName: string }) {
  return <>
    {teach.recording && <div role="status" data-computer-teach-recording="" className="absolute inset-x-3 top-3 z-20 mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-danger/40 bg-panel/95 px-3 py-2 text-[12px] text-danger shadow-lg">
      <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
      <span className="min-w-0 flex-1 font-medium">{t("computerTeach.recording")}</span>
      <button type="button" data-computer-teach-stop="" disabled={teach.busy} onClick={teach.stop}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50">
        <Square size={11} fill="currentColor" aria-hidden="true" />{t("teach.stop")}
      </button>
    </div>}
    {teach.note && !teach.recording && <button type="button" role="status" onClick={teach.clearNote}
      className="absolute inset-x-3 top-3 z-20 mx-auto max-w-xl rounded-xl border border-hairline bg-panel/95 px-3 py-2 text-left text-[12px] text-ink-secondary shadow-lg">{teach.note}</button>}
    {teach.taught && <TeachStepsDialog botId={botId} botName={botName} steps={teach.taught.steps} recordedAt={teach.taught.recordedAt} onClose={teach.closeTaught} />}
  </>;
}
