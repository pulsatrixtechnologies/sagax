// One step of a bot's work in the chat, drawn the way a reasoning line is
// in Claude or Cursor: quiet grey words in the interface font, no frame, a
// paler duration and a chevron that opens a readable detail underneath.
//
// Running: the words shimmer (the same sheen as "Thinking"). Done: nothing
// loud, no green check. Failed: the words turn a quiet danger colour.
// Every tool step, a folded run of steps, the turn digest and a bot's
// coordination receipts use this one row so the thread reads as one voice.
import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StepPhase } from "@/lib/step-label";

export function StepRow({
  label,
  target,
  extra,
  duration,
  phase = "done",
  icon,
  children,
  forceOpen = false,
  defaultOpen = false,
  ariaLabel,
  title,
  onActivate,
  testId,
  data,
  wide = false,
  quietChevron = false,
}: {
  label: string;
  /** what the step acted on, after the label in paler grey */
  target?: string;
  /** a small extra mark after the target (where the tool ran) */
  extra?: ReactNode;
  duration?: string;
  phase?: StepPhase;
  /** a discreet leading mark (a place, an avatar); none by default */
  icon?: ReactNode;
  /** the detail under the row. Absent: the row does not open. A function
   * renders only once the row is open. */
  children?: ReactNode | (() => ReactNode);
  /** a search hit inside: open, and stay open */
  forceOpen?: boolean;
  defaultOpen?: boolean;
  ariaLabel?: string;
  title?: string;
  /** a row that goes somewhere instead of opening (a receipt that opens a
   * conversation): shown with a side chevron */
  onActivate?: () => void;
  testId?: string;
  data?: Record<string, string | undefined>;
  /** the detail takes the column's width (messages), not a reading width */
  wide?: boolean;
  /** the chevron shows only on hover, focus or once open (the turn's line) */
  quietChevron?: boolean;
}) {
  const [open, setOpen] = useState(forceOpen || defaultOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const detailId = useId();
  const expandable = children !== undefined && children !== null && !onActivate;
  const interactive = expandable || Boolean(onActivate);
  const words = (
    <>
      {icon && <span className="flex shrink-0 items-center opacity-80">{icon}</span>}
      <span
        data-step-label
        className={cn(
          "min-w-0 truncate",
          phase === "running" && "thinking-shimmer animate-shimmer",
          phase === "failed" && "text-danger/90",
        )}
      >
        {label}
      </span>
      {target && <span data-step-target className="min-w-0 shrink-[2] truncate text-ink-tertiary" title={title ?? target}>{target}</span>}
      {extra}
      {duration && <span data-step-duration className="shrink-0 tabular-nums text-ink-tertiary opacity-80">{duration}</span>}
      {expandable && (
        <ChevronDown
          size={13}
          aria-hidden="true"
          data-quiet={quietChevron && !open ? "true" : undefined}
          className={cn(
            "shrink-0 text-ink-tertiary transition-[transform,opacity] duration-150",
            open && "rotate-180",
            quietChevron && !open && "opacity-0 group-hover/step:opacity-70 group-focus-visible/step:opacity-70 touch:opacity-70",
          )}
        />
      )}
      {onActivate && <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
    </>
  );
  const rowClass = cn(
    "group/step inline-flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-start text-[13px] leading-5 text-ink-secondary",
    interactive && "cursor-pointer hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  );
  return (
    <div className="flex min-w-0 max-w-full flex-col items-start" data-testid={testId} data-step-row data-phase={phase} {...data}>
      {interactive ? (
        <button
          type="button"
          className={rowClass}
          title={title}
          aria-label={ariaLabel}
          aria-expanded={expandable ? open : undefined}
          aria-controls={expandable && open ? detailId : undefined}
          onClick={() => (onActivate ? onActivate() : setOpen((value) => !value))}
        >
          {words}
        </button>
      ) : (
        <div className={rowClass} title={title} aria-label={ariaLabel} role={ariaLabel ? "group" : undefined}>{words}</div>
      )}
      {expandable && open && (
        <div id={detailId} data-step-detail className={cn("ms-1.5 mt-1 mb-1 border-s border-hairline/60 ps-3", wide ? "flex w-full flex-col gap-2 pe-1.5" : "w-[min(38rem,100%)]")}>
          {typeof children === "function" ? (children as () => ReactNode)() : children}
        </div>
      )}
    </div>
  );
}
