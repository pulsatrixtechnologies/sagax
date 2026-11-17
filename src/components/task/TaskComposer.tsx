// A message into a running task (2026-10-29): drawn like the chat's own
// composer (the rounded field, the round send button at its right) and
// kept at the bottom of the sheet, where a composer sits. The message
// joins the work in progress (busyMode "steer").
import { useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function TaskComposer({ onSend, className }: {
  onSend: (text: string) => Promise<void>;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const submit = async () => {
    const words = text.trim();
    if (!words || state === "sending") return;
    setState("sending");
    try {
      await onSend(words);
      setText("");
      setState("sent");
    } catch {
      setState("error");
    }
  };
  return (
    <div data-activity-steer="" className={cn("flex flex-col gap-1", className)}>
      <div className="flex min-h-11 items-center gap-2 rounded-[22px] menu-edge bg-composer py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-[var(--composer-focus-edge)] motion-reduce:transition-none">
        <input
          id="activity-steer"
          value={text}
          onChange={(event) => { setText(event.target.value); if (state !== "sending") setState("idle"); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
          placeholder={t("activity.steer.label")}
          aria-label={t("activity.steer.label")}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!text.trim() || state === "sending"}
          aria-label={t("activity.steer.send")}
          title={t("activity.steer.send")}
          className="ui-button-primary flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
        >
          {state === "sending" ? <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} aria-hidden="true" />}
        </button>
      </div>
      {state === "sent" && <p role="status" className="px-4 text-[11.5px] text-ink-secondary">{t("activity.steer.sent")}</p>}
      {state === "error" && <p role="alert" className="px-4 text-[11.5px] text-danger">{t("botPanel.activity.error")}</p>}
    </div>
  );
}
