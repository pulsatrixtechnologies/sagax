// Teach a task (#4208): the bar a recording shows at the top of the bot's
// browser in the screen window, in the reference's look (measured on the
// reference app's own teaching controls): one rounded row, 10px radius,
// 10px 10px 10px 12px padding, 16px gap, on the raised surface with a 12px
// blur; the sentence at the base size, then Stop (danger tint, a filled
// square and the elapsed time m:ss, "Stop and save recording") and a bare
// close mark that discards the recording. The screen under it carries a 2px
// red frame (TEACH_RECORDING_FRAME) while it records.
import { useEffect, useState } from "react";
import { Square, X } from "lucide-react";
import { t } from "@/lib/i18n";

/** The red frame over the screen while a recording runs (the reference's
 * 2px #aa122e border, drawn over the page and never in the way of a click). */
export const TEACH_RECORDING_FRAME = "pointer-events-none absolute inset-0 z-[5] border-2 border-solid border-[#aa122e]";

/** Elapsed time as the reference shows it: minutes and two-digit seconds. */
export function recordingElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TeachRecordingBar({ startedAt, onStop, onDiscard, now: fixedNow }: {
  /** When the recording started (ms since the epoch). */
  startedAt: number;
  onStop: () => void;
  onDiscard: () => void;
  /** A fixed clock (captures). */
  now?: number;
}) {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fixedNow]);
  const elapsed = recordingElapsed((fixedNow ?? now) - startedAt);
  return (
    <div className="flex w-full shrink-0 items-start px-2 pt-2">
      <div role="status" data-teach-recording=""
        className="relative flex w-full max-w-full shrink-0 items-center gap-4 rounded-[10px] bg-raised py-2.5 pl-3 pr-2.5 backdrop-blur-[12px]">
        <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{t("teach.recording")}</span>
        <button type="button" data-teach-stop="" onClick={onStop}
          aria-label={t("teach.stopAndSave")} title={t("teach.stop")}
          className="flex shrink-0 items-center gap-1 rounded-md bg-danger/12 px-1.5 py-1 text-[13px] font-medium leading-5 tabular-nums text-danger hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60">
          <Square size={11} fill="currentColor" aria-hidden="true" />{elapsed}
        </button>
        <button type="button" data-teach-discard="" onClick={onDiscard}
          aria-label={t("teach.discardRecording")} title={t("teach.discardRecording")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-danger hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
