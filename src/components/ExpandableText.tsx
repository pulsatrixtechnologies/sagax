import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** A question longer than this is collapsed until the person opens it.
 * Short asks stay fully visible, with no extra control. */
export const EXPANDABLE_TEXT_LIMIT = 280;

export type ExpandableLines = 2 | 4;

/** The guess used where the text has no layout to measure (no window, a
 * unit render): past the limit, or past a few more lines than the clamp.
 * On screen the clamp's own overflow decides (`ExpandableText`). */
export function expandableTextIsLong(text: string, lines: ExpandableLines = 4): boolean {
  return text.length > (EXPANDABLE_TEXT_LIMIT * lines) / 4 || text.split("\n").length > lines + 2;
}

/** Collapsed text is clamped. Expanded text is the whole string: no clamp,
 * no max height, and no overflow clipping. */
export function expandableTextClass(expanded: boolean, lines: ExpandableLines = 4): string {
  if (expanded) return "whitespace-pre-wrap break-words";
  return cn(lines === 2 ? "line-clamp-2" : "line-clamp-4", "whitespace-pre-wrap break-words");
}

const CONTROL = {
  accent: "mt-1 text-[12.5px] font-medium text-accent hover:underline",
  // The reference's quiet "Afficher plus" (docs/design/ux-reference-grokbot-cursor.md):
  // grey, small, darker on hover, no underline.
  quiet: "mt-0.5 text-[12px] leading-4 text-ink-secondary transition-colors hover:text-ink",
} as const;

/** Long text folded to `lines` lines with an ellipsis and one control under
 * it ("Show full question" / "Show less" by default). Text that fits shows
 * no control: on screen the clamp's overflow is measured, so the control
 * appears exactly when something is hidden. `expanded` and `onToggle` make
 * the fold controlled, for a caller that draws the open text elsewhere
 * (an exchange's subject unfolds into the scrolling transcript, #4043). */
export function ExpandableText({
  text,
  className,
  lines = 4,
  expanded: controlled,
  onToggle,
  moreLabel,
  lessLabel,
  tone = "accent",
  testId,
}: {
  text: string;
  className?: string;
  lines?: ExpandableLines;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  moreLabel?: string;
  lessLabel?: string;
  tone?: keyof typeof CONTROL;
  testId?: string;
}) {
  const [own, setOwn] = useState(false);
  const expanded = controlled ?? own;
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(() => expandableTextIsLong(text, lines));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => {
      // No layout (a unit render): keep the guess.
      if (el.clientHeight === 0) {
        setOverflows(expandableTextIsLong(text, lines));
        return;
      }
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, lines, expanded]);
  // Open text was folded before, so it always offers to fold back.
  const long = expanded || overflows;
  const toggle = () => {
    const next = !expanded;
    if (controlled === undefined) setOwn(next);
    onToggle?.(next);
  };
  return (
    <div data-testid={testId} data-expandable={long ? (expanded ? "open" : "folded") : undefined}>
      <div ref={ref} className={cn(className, expandableTextClass(expanded, lines))}>{text}</div>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          data-expandable-toggle=""
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          className={CONTROL[tone]}
        >
          {expanded ? (lessLabel ?? t("question.showLess")) : (moreLabel ?? t("question.showFull"))}
        </button>
      )}
    </div>
  );
}
