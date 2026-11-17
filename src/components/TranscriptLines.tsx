// One line of a live transcript by speaker: the live phone call card
// (OutboundCard) and the listening card (#4100, ListeningCard) draw their
// lines with it, in the same inset box. The speaker's label takes the tone
// of who speaks (the bot in the accent, the others in the secondary grey,
// a system line in the tertiary); a line still being spoken is grey.
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The inset box a transcript's lines sit in. */
export const TRANSCRIPT_BOX = "space-y-1.5 overflow-auto rounded-lg bg-inset px-3 py-2 text-[12.5px]";

export type TranscriptTone = "bot" | "other" | "system";

export function TranscriptLine({ speaker, tone = "other", live = false, stacked = false, children, ...data }: {
  speaker: ReactNode;
  tone?: TranscriptTone;
  /** still being spoken: its words in the secondary grey */
  live?: boolean;
  /** the label on its own line, the words under it (the listening card) */
  stacked?: boolean;
  children: ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const label = (
    <span className={cn("font-medium", tone === "bot" ? "text-accent" : tone === "system" ? "text-ink-tertiary" : "text-ink-secondary")}>
      {speaker}
    </span>
  );
  if (stacked) {
    return (
      <div {...data} className="break-words">
        <div className="text-[12px] leading-4">{label}</div>
        <p dir="auto" className={cn("whitespace-pre-wrap leading-snug", live ? "text-ink-secondary" : "text-ink")}>{children}</p>
      </div>
    );
  }
  return (
    <p {...data} className={cn("whitespace-pre-wrap break-words", live && "text-ink-secondary")}>
      {label}
      {" "}{children}
    </p>
  );
}
