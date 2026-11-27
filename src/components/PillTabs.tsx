// The reference app's text tabs (its "sm" tablist): a row of borderless
// pills, 13 px labels on an 18 px line, 4 px by 8 px of padding (26 px
// high), 2 px between tabs; the selected one in primary ink on the soft
// secondary fill (the shared sliding TabIndicator), the others in secondary
// ink. Measured on the reference (docs/design, 2.4 ter, #4098; again for the
// routine page, #4357). One tablist for every page that has these tabs: the
// bot's page and a routine's page.
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TabIndicator, TabIndicatorGroup } from "@/components/TabIndicator";

export function PillTabs<T extends string>({ tabs, tab, onTab, ariaLabel, idPrefix, label, after, tabAttributes, tabClassName, wrapTab, className, variant = "pill", ...rest }: {
  /** "line": the detail pages' tabs, underlined with a count, on a hairline */
  variant?: "pill" | "line";
  tabs: readonly T[];
  tab: T;
  onTab: (tab: T) => void;
  ariaLabel: string;
  /** Ids: `<prefix>-tab-<id>`, each tab controlling `<prefix>-panel-<id>`. */
  idPrefix: string;
  label: (tab: T) => ReactNode;
  /** Beside the label: a count, an attention dot. */
  after?: (tab: T) => ReactNode;
  /** The page's own data attributes on each tab. */
  tabAttributes?: (tab: T) => Record<`data-${string}`, string | undefined>;
  tabClassName?: (tab: T) => string | false | undefined;
  /** Wrap each tab button (customize mode grip). */
  wrapTab?: (id: T, node: ReactNode) => ReactNode;
  className?: string;
} & Record<`data-${string}`, string>) {
  return (
    <div
      role="tablist"
      {...rest}
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        // Arrow keys move between tabs, as in any tab list.
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const index = (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
        onTab(tabs[index]!);
        event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
      }}
      className={cn("flex min-w-0 flex-wrap items-center", variant === "line" ? "gap-5 border-b border-hairline-weak" : "gap-0.5", className)}
    >
      <TabIndicatorGroup>
        {tabs.map((id) => {
          const button = (
            <button
              type="button"
              role="tab"
              {...tabAttributes?.(id)}
              id={`${idPrefix}-tab-${id}`}
              aria-controls={`${idPrefix}-panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTab(id)}
              className={cn(
                variant === "line"
                  ? "relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 py-2 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  : "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                variant === "line" && (tab === id ? "border-ink" : "border-transparent"),
                tab === id ? "text-ink" : "text-ink-secondary hover:text-ink",
                tabClassName?.(id),
              )}
            >
              {tab === id && variant === "pill" && <TabIndicator />}
              <span className="relative">{label(id)}</span>
              {after?.(id)}
            </button>
          );
          return (
            <span key={id} className="inline-flex">
              {wrapTab ? wrapTab(id, button) : button}
            </span>
          );
        })}
      </TabIndicatorGroup>
    </div>
  );
}

/** A count beside a tab's label ("Runs 9"): tabular figures, tertiary grey,
 * 6 px from the label (docs/design, the vault's tabs). */
export function PillTabCount({ count }: { count: number }) {
  return <span data-pill-tab-count="" className="relative tabular-nums text-ink-tertiary">{count}</span>;
}
