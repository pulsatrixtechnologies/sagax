// Show a task in my Chrome (server/browser/my-chrome/recorder.ts): Sagax
// opens a new tab in the person's own Chrome and records what they do there
// (pages, clicks, typed text; never a password or a secret) plus the notes
// they type or dictate here. Stop hands the steps to the editable list
// (TeachStepsDialog), saved as a skill of the bot.
// 2026-11-01 lot 7: anchored popover on the composer + (url + note at most).
import { useEffect, useRef, useState, type RefObject } from "react";
import { Mic, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import type { DictationEngine } from "@/lib/composer-dictation";
import type { LocaleKey } from "@/locales";
import { myChromeRecord, type MyChromeRecording, type MyChromeRecordingResult } from "@/lib/my-chrome";
import { useComposerDictation } from "./useComposerDictation";
import type { TeachStep } from "../../shared/teach-recording";
import { readableError } from "@/lib/plain-error";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const POLL_MS = 1_000;
const input = "min-w-0 flex-1 rounded-md bg-inset px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent";
const iconButton = "rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-30";

/** One recorded step in a few words, for the live list. */
export function recordedStepLine(step: TeachStep): string {
  const what = step.target?.name || step.target?.role || "";
  switch (step.kind) {
    case "open": return t("myChrome.record.line.open", { url: step.url ?? "" });
    case "click": return t("myChrome.record.line.click", { what });
    case "type": return step.secret ? t("myChrome.record.line.secret", { what }) : t("myChrome.record.line.type", { what, text: step.text ?? "" });
    case "press": return t("myChrome.record.line.press", { key: step.key ?? "Enter" });
    case "note": return t("myChrome.record.line.note", { text: step.text ?? "" });
    default: return t(`teach.step.${step.kind}` as LocaleKey);
  }
}

export function MyChromeRecordDialog({ botId, botName, dictationEngine, anchorRef, onDone, onClose }: {
  botId: string;
  botName: string;
  dictationEngine: DictationEngine | null;
  /** The composer + that opened this recording. */
  anchorRef: RefObject<HTMLElement | null>;
  onDone: (result: MyChromeRecordingResult) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = anchorRef.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  const [phase, setPhase] = useState<"setup" | "starting" | "recording" | "stopping">("setup");
  const [url, setUrl] = useState("");
  const [recording, setRecording] = useState<MyChromeRecording | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const dictation = useComposerDictation({ engine: dictationEngine, botId, text: note, editText: setNote });
  const stopping = useRef(false);
  const recordingNow = phase === "recording" || phase === "stopping";
  // While recording, outside press must not discard the capture by accident.
  usePopoverDismiss(!recordingNow, dismissRoot, onClose);

  useEffect(() => {
    popoverRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  useEffect(() => {
    let live = true;
    myChromeRecord("status").then((answer) => {
      if (!live) return;
      setUnavailable(answer.unavailable);
      if (answer.recording?.recording) { setRecording(answer.recording); setPhase("recording"); }
    }, (cause) => { if (live) setUnavailable(readableError(cause)); });
    return () => { live = false; };
  }, []);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    setPhase("stopping");
    if (dictation.phase !== "idle") dictation.cancel();
    try {
      const { result } = await myChromeRecord("stop");
      if (!result || !result.steps.length) {
        setError(t("myChrome.record.nothing"));
        setPhase("setup");
        return;
      }
      onDone(result);
      onClose();
    } catch (cause) {
      setError(readableError(cause));
      setPhase("setup");
    } finally {
      stopping.current = false;
    }
  };

  const stopNow = useRef(stop);
  stopNow.current = stop;
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      void myChromeRecord("status").then((answer) => {
        if (!answer.recording) { setPhase("setup"); setError(t("myChrome.record.expired")); return; }
        setRecording(answer.recording);
        if (!answer.recording.recording) void stopNow.current();
      }, () => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  const start = async () => {
    setError("");
    setPhase("starting");
    try {
      const answer = await myChromeRecord("start", { url: url.trim() });
      setRecording(answer.recording);
      setPhase("recording");
    } catch (cause) {
      setError(readableError(cause));
      setPhase("setup");
    }
  };
  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    if (dictation.phase !== "idle") dictation.stop();
    try {
      const answer = await myChromeRecord("note", { text });
      if (answer.recording) setRecording(answer.recording);
      setNote("");
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const cancel = () => {
    if (phase === "recording") void myChromeRecord("discard").catch(() => undefined);
    onClose();
  };

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      side="top"
      align="start"
      role="dialog"
      aria-labelledby="my-chrome-record-title"
      data-my-chrome-record={phase}
      className="flex w-[min(420px,calc(100vw-24px))] max-h-[min(520px,calc(100dvh-96px))] flex-col overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated text-ink shadow-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <div className="border-b border-hairline/40 px-4 py-3">
        <h2 id="my-chrome-record-title" className="text-[14px] font-medium">{t("myChrome.record.title")}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-[12px]">
        {!recordingNow ? <>
          <p className="leading-relaxed text-ink-secondary">{t("myChrome.record.intro", { bot: botName })}</p>
          {unavailable && <p role="alert" data-my-chrome-record-unavailable="" className="rounded-lg bg-inset px-3 py-2 text-ink">{unavailable}</p>}
          <label className="flex flex-col gap-1"><span className="font-medium">{t("myChrome.record.start")}</span>
            <input className={input} value={url} spellCheck={false} placeholder="https://" onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !unavailable) void start(); }} /></label>
          <p className="text-[11px] leading-relaxed text-ink-secondary">{t("myChrome.record.privacy")}</p>
        </> : <>
          <div role="status" data-my-chrome-recording="" className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
            <span className="min-w-0 flex-1 font-medium">{t("myChrome.record.recording")}</span>
            <span className="shrink-0 tabular-nums">{t("myChrome.record.count", { count: String(recording?.steps ?? 0) })}</span>
          </div>
          <p className="leading-relaxed text-ink-secondary">{t("myChrome.record.recordingHint")}</p>
          {Boolean(recording?.recent.length) && <ol className="flex flex-col gap-1" aria-label={t("teach.steps")} data-my-chrome-recent="">
            {recording!.recent.map((step) => <li key={step.id} className="truncate rounded-md bg-inset px-2 py-1">{recordedStepLine(step)}</li>)}
          </ol>}
          <label className="flex flex-col gap-1"><span className="font-medium">{t("myChrome.record.note")}</span>
            <span className="flex items-center gap-1.5">
              <input className={input} value={note} maxLength={500} placeholder={t("myChrome.record.notePlaceholder")} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addNote(); } }} />
              {dictationEngine && <button type="button" className={`${iconButton} ${dictation.phase === "recording" ? "text-danger" : ""}`}
                aria-label={t(dictation.phase === "recording" ? "myChrome.record.dictateStop" : "myChrome.record.dictate")} aria-pressed={dictation.phase === "recording"}
                onClick={() => { if (dictation.phase === "recording") dictation.stop(); else void dictation.start(); }}><Mic size={15} /></button>}
              <button type="button" className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] hover:bg-raised-hover disabled:opacity-50" disabled={!note.trim()} onClick={() => void addNote()}>{t("myChrome.record.addNote")}</button>
            </span>
          </label>
          {dictation.error && <p role="alert" className="text-danger">{dictation.error}</p>}
        </>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-hairline/40 px-4 py-3">
        <button type="button" className={PILL} onClick={cancel}>{t(recordingNow ? "myChrome.record.discard" : "teach.close")}</button>
        {recordingNow
          ? <button type="button" data-my-chrome-record-stop="" className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50" disabled={phase === "stopping"} onClick={() => void stop()}>
            <Square size={11} fill="currentColor" aria-hidden="true" />{t("myChrome.record.stop")}</button>
          : <button type="button" data-my-chrome-record-start="" className={PRIMARY_PILL} disabled={phase === "starting" || Boolean(unavailable)} onClick={() => void start()}>
            {phase === "starting" ? t("myChrome.record.starting") : t("myChrome.record.go")}</button>}
      </div>
    </AnchoredPopover>
  );
}
