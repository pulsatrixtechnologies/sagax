// The reference's small segmented control (#4327, measured in the reference
// app: 24px tall, a grey track at 6% of the ink, 2px of padding, round, the
// chosen segment a shade lighter), written once. PageSegment's compact look
// (src/components/content-page.tsx) takes these constants; SegmentedChoice is
// the same control as a radio group, for a menu or a settings row: the
// model menu's Optimize for and Reasoning, the models window's Optimize for
// and effort.
// M-20261119-051: past four choices it splits into balanced lines (seven
// reasoning levels read 4 and 3), so every choice stays whole at the menu's
// width in every language, never cut at the edge.
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The track: its padding, its gap and its 6% grey (round or 12px corners by its lines). */
export const SEGMENT_TRACK = "gap-0.5 bg-ink/[0.06] p-0.5";
/** One segment: 20px tall in the 24px track, 12px text. */
export const SEGMENT_ITEM = "flex h-5 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
/** The chosen segment: a shade lighter, medium weight, the primary ink. */
export const SEGMENT_ON = "bg-ink/[0.1] font-medium text-ink";
export const SEGMENT_OFF = "text-ink-secondary hover:text-ink";

/** At most this many choices share one line. */
export const SEGMENTS_PER_LINE = 4;

/** The choices in lines: one line up to SEGMENTS_PER_LINE, else as few
 * balanced lines as hold them (seven read 4 and 3, eight 4 and 4). */
export function segmentLines<T>(items: readonly T[], perLine = SEGMENTS_PER_LINE): T[][] {
  if (items.length <= perLine) return [[...items]];
  const count = Math.ceil(items.length / perLine);
  const size = Math.ceil(items.length / count);
  const lines: T[][] = [];
  for (let at = 0; at < items.length; at += size) lines.push(items.slice(at, at + size));
  return lines;
}

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  /** Data attributes of this segment's button. */
  data?: DataAttributes;
}

/** A radio group of segments: the arrow keys (and Home, End) move and pick,
 * inside the group only; only the chosen segment is in the tab order. */
export function SegmentedChoice<T extends string>({ label, value, options, onPick, disabled = false, fill = false, className, ...rest }: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<SegmentOption<T>>;
  onPick: (value: T) => void;
  disabled?: boolean;
  /** Take the whole width, the segments of a line in equal parts (a label is
   * never cut: a longer one takes its own width); else as wide as its labels. */
  fill?: boolean;
  className?: string;
} & DataAttributes) {
  const lines = segmentLines(options);
  const at = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = Math.max(0, at);
    // left and right step through every choice; up and down move a line, and
    // leave a one-line group (or its first and last line) to the list around it
    const lineSize = lines[0]!.length;
    const vertical = event.key === "ArrowDown" ? from + lineSize : event.key === "ArrowUp" ? from - lineSize : undefined;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
      : vertical !== undefined ? (lines.length > 1 && vertical >= 0 && vertical < options.length ? vertical : -1)
      : step ? (from + step + options.length) % options.length : -1;
    if (to < 0 || disabled) return;
    event.preventDefault();
    // stays inside the group: a menu's own arrow keys must not move its list too
    event.stopPropagation();
    onPick(options[to]!.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]");
    requestAnimationFrame(() => buttons[to]?.focus());
  };
  return (
    <div {...rest} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      className={cn("flex min-w-0 flex-col", SEGMENT_TRACK, lines.length > 1 ? "rounded-xl" : "rounded-full", fill ? "w-full" : "w-max shrink-0", className)}>
      {lines.map((line, index) => (
        <div key={index} className="flex min-w-0 gap-0.5">
          {line.map((option) => {
            const on = option.value === value;
            return (
              <button key={option.value} type="button" role="radio" aria-checked={on} disabled={disabled}
                tabIndex={on || (at < 0 && option === options[0]) ? 0 : -1} title={option.title} {...option.data}
                // the menu keeps its focus where it was on a click
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option.value)}
                className={cn(SEGMENT_ITEM, "outline-none focus-visible:ring-2 focus-visible:ring-focus", (fill || lines.length > 1) && "flex-1", on ? SEGMENT_ON : SEGMENT_OFF)}>
                {option.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
