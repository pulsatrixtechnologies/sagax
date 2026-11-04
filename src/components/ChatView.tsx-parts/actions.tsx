import { Check, Copy, Reply, X } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { messageActionClass } from "@/components/MessageActions";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** Reply to one message: the curved back arrow beside the bubble, in a
 * room and in a 1:1 chat alike (2026-10-14). */
export function ReplyAction({ onReply, className = messageActionClass }: { onReply: () => void; className?: string }) {
  return (
    <button type="button" onClick={onReply} aria-label={t("chat.replyToMessage")} title={t("chat.reply")} className={className}>
      <Reply size={14} aria-hidden="true" />
    </button>
  );
}

/** Hover/focus-revealed copy control shared by user + bot bubbles. Rooms use
 * the same button beside a message. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { state, copy } = useCopyFeedback(text);
  const label = t(state === "copied" ? "chat.copyMessageDone" : state === "failed" ? "chat.copyMessageFailed" : "chat.copyMessage");
  return (
    <button
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
        state !== "idle" && "opacity-100",
        className,
      )}
    >
      {state === "copied" ? <Check size={14} className="text-success" /> : state === "failed" ? <X size={14} className="text-danger" /> : <Copy size={14} />}
    </button>
  );
}
