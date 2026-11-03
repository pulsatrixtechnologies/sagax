// Small pieces every view of Tools > Memory draws the same way, after the
// Perspicax console's: a tier's swatch, a tag chip, an author's initials, a
// card with its title, a row of stat tiles, a relative time in words.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { initials, jsonSummary, relTime } from "@/lib/memory-page";

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} aria-hidden="true" data-memory-swatch="" />;
}

export function TagChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-raised px-2 py-px text-[11px] leading-4 text-ink">{children}</span>;
}

export function AuthorBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-raised text-[10.5px] font-semibold text-ink" aria-hidden="true">{initials(name)}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** "9 h ago", "Yesterday", a date past a week; empty without a time. */
export function relLabel(at: number | undefined, now = Date.now()): string {
  const rel = relTime(at, now, activeLocale());
  if (!rel) return "";
  if (rel.key === "now") return t("memoryManager.rel.now");
  if (rel.key === "min") return t("memoryManager.rel.min", { n: rel.n });
  if (rel.key === "hour") return t("memoryManager.rel.hour", { n: rel.n });
  if (rel.key === "yesterday") return t("memoryManager.rel.yesterday");
  if (rel.key === "days") return t("memoryManager.rel.days", { n: rel.n });
  return rel.date;
}

export function fullDate(at: number | undefined): string {
  if (at == null || Number.isNaN(at)) return "";
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

/** A row's excerpt: the plain line, or for a JSON body "JSON · n keys" and the first key names. */
export function excerptLabel(excerpt: string | undefined): string {
  const summary = jsonSummary(excerpt);
  if (!summary) return excerpt ?? "";
  if (summary.array) return summary.count == null ? t("memoryManager.excerpt.json") : t("memoryManager.excerpt.jsonItems", { n: summary.count });
  const keys = summary.keys.join(", ");
  if (summary.count === 0) return t("memoryManager.excerpt.jsonEmpty");
  if (summary.count == null) return keys ? t("memoryManager.excerpt.jsonKeys", { keys: `${keys}…` }) : t("memoryManager.excerpt.json");
  return t("memoryManager.excerpt.jsonCount", { n: summary.count, keys: summary.count > summary.keys.length ? `${keys}…` : keys });
}

/** The console's card: a hairline, the page's panel colour, a title row. */
export function MemoryCard({ title, aside, children, className, ...rest }: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  return (
    <section {...rest} className={cn("min-w-0 rounded-xl border border-hairline/50 bg-panel", className)}>
      {(title || aside) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4">
          {title && <h3 className="text-[14px] font-semibold text-ink">{title}</h3>}
          {aside && <span className="text-[12.5px] text-ink-secondary">{aside}</span>}
        </header>
      )}
      <div className={cn("px-4 pb-4", !(title || aside) && "pt-4")}>{children}</div>
    </section>
  );
}

export interface StatTile {
  id: string;
  label: string;
  value: string | number;
  caption?: string;
}

/** The console's stat strip: tiles side by side, a label, a big number, a caption. */
export function StatStrip({ items, ...rest }: { items: StatTile[] } & { [key: `data-${string}`]: string | undefined }) {
  if (items.length === 0) return null;
  return (
    <div {...rest} className="grid min-w-0 gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {items.map((item) => (
        <div key={item.id} className="min-w-0 rounded-xl border border-hairline/50 bg-panel px-4 py-3" data-memory-stat={item.id}>
          <p className="truncate text-[12px] text-ink-secondary">{item.label}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums leading-7 text-ink">{item.value}</p>
          {item.caption && <p className="mt-0.5 truncate text-[11.5px] text-ink-tertiary" title={item.caption}>{item.caption}</p>}
        </div>
      ))}
    </div>
  );
}

/** A segmented switch inside a view (the list's order, the Quality tabs). */
export function MiniSegment<T extends string>({ label, value, options, onChange, ...rest }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
} & { [key: `data-${string}`]: string | undefined }) {
  return (
    <div {...rest} role="group" aria-label={label} className="flex shrink-0 items-center rounded-lg border border-hairline/50 bg-app p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("rounded-md px-2.5 py-1 text-[12px]", value === option.value ? "bg-raised font-medium text-ink" : "text-ink-secondary hover:text-ink")}
          data-memory-segment={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-tertiary";
export const OUTLINE_BUTTON = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-hairline/60 bg-raised/60 px-2.5 text-[12.5px] text-ink hover:bg-hover disabled:opacity-50";
export const PRIMARY_BUTTON = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50";
export const GHOST_BUTTON = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink hover:bg-hover disabled:opacity-50";
export const FIELD = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong";
