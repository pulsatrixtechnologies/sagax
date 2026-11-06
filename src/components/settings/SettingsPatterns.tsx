// #2080 (L0, 2026-11-05): the shared patterns of the Settings redesign
// (ia.md sections 3 to 8). Every page draws these instead of its own links,
// filters, bulk bars and empty states. SettingsPrimitives re-exports them.
import { useEffect } from "react";
import { Building2, ExternalLink } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { DescribedRow, GROUP_CARD, PILL, PRIMARY_PILL } from "@/components/SettingsPrimitives";

/** A link out of Sagax (Perspicax, a console): a grey pill with the
 * external-link glyph. Never an accent-coloured text link. */
export function ExternalLinkPill({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" data-external-link-pill="" className={cn(PILL, "inline-flex items-center gap-1.5", className)}>
      {children}
      <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </a>
  );
}

const STATUS_TONE = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-ink-secondary",
} as const;

/** The state word of a row's grey line, coloured alone ("Connected" in
 * green, "Expired" in amber). The rest of the line stays grey. */
export function StatusText({ tone, children }: { tone: keyof typeof STATUS_TONE; children: React.ReactNode }) {
  return <span data-status-text={tone} className={STATUS_TONE[tone]}>{children}</span>;
}

/** A read-only value at a row's right ("+1 514 555 0142", "5 min"): the
 * size and grey of the neighbouring pill values, never status-coloured
 * large text (#2080). */
export function RowValue({ children }: { children: React.ReactNode }) {
  return <span data-row-value="" className="text-[13px] leading-[18px] text-ink-secondary tabular-nums">{children}</span>;
}

/** The first card of the Organization page: the organization's name and
 * the person's role on one grey line, with optional Manage in Perspicax. */
export function OrgBand({ name, role, action }: { name: string; role?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section data-settings-group="orgBand" data-org-band="" className={GROUP_CARD}>
      <DescribedRow label={name} icon={<Building2 size={14} />} description={role} rowId="orgBand">
        {action}
      </DescribedRow>
    </section>
  );
}

export type FilterChip<T extends string = string> = { id: T; label: string; count: number };

/** The one filter of Settings, in a group's `accessory` beside the title it
 * filters. A chip with no item is not drawn, and a filter left with one
 * chip is not drawn at all. */
export function FilterChips<T extends string>({ chips, value, onChange, label }: {
  chips: Array<FilterChip<T>>;
  value: T;
  onChange: (id: T) => void;
  /** The toolbar's spoken name. */
  label: string;
}) {
  const shown = chips.filter((chip) => chip.count > 0);
  if (shown.length < 2) return null;
  return (
    <div role="toolbar" aria-label={label} data-filter-chips="" className="ml-auto flex flex-wrap items-center gap-1.5">
      {shown.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={active}
            data-filter-chip={chip.id}
            onClick={() => onChange(chip.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors motion-reduce:transition-none",
              active ? "border-transparent bg-selected text-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
            )}
          >
            {chip.label}
            <span className="tabular-nums text-ink-tertiary">{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export type SelectionAction = { label: string; onClick: () => void; disabled?: boolean };

/** The bar of a list in "Edit several" mode, sticky under the list: the
 * count, Clear, at most two actions (the last one primary, at the right) and
 * Done. Escape closes the mode. Draws nothing while nothing is selected. */
export function SelectionBar({ count, onClear, onDone, actions }: {
  count: number;
  onClear: () => void;
  onDone: () => void;
  /** At most two; the last one is the primary pill. */
  actions: SelectionAction[];
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  if (count === 0) return null;
  const shown = actions.slice(0, 2);
  return (
    <div data-selection-dock="" className="sticky bottom-0 z-10 bg-app pb-3 pt-2">
      <div
        data-selection-bar=""
        role="toolbar"
        aria-label={t("settings.selection.count", { count })}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-[0.5px] border-border bg-elevated px-3 py-2 shadow-lg shadow-black/10"
      >
        <p className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
          <span>{t("settings.selection.count", { count })}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            data-selection-clear=""
            onClick={onClear}
            className="rounded-md px-1 text-ink-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {t("settings.selection.clear")}
          </button>
        </p>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <button type="button" className={PILL} data-selection-done="" onClick={onDone}>{t("settings.selection.done")}</button>
          {shown.map((action, index) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              className={index === shown.length - 1 ? PRIMARY_PILL : PILL}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The empty state of a page's main card: a 20px grey glyph, one sentence
 * and at most one action. Any other empty card is not drawn. */
export function SettingsEmpty({ icon: Icon, children, action }: {
  icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div data-settings-empty="" className="flex flex-col items-center gap-2 px-3.5 py-6 text-center">
      <Icon size={20} aria-hidden="true" className="text-ink-tertiary" />
      <p className="max-w-[360px] text-[13px] leading-[18px] text-ink-secondary">{children}</p>
      {action && <button type="button" className={PILL} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
