// Settings sub-pages: a setting too long for a card gets its own page inside
// the Settings modal (push navigation) instead of a card that grows. The
// section shows a SettingsSubPageRow (title, one-line summary, Edit); the
// page shows a back arrow and the breadcrumb "General > About me". The back
// arrow, the section name in the breadcrumb and Escape return to the section.
// Which page is open lives in the store (`appSettingsSubPage`), so a deep
// link can open it: dispatch toggleAppSettings with `subPage`. To add a page,
// register it in SUB_PAGES (settings/settings-sub-pages.tsx).
import { useEffect } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";

type KeyLike = { key: string; defaultPrevented: boolean; isComposing?: boolean; target?: EventTarget | null };

/** Escape on a sub-page goes back to its section, not out of Settings,
 * unless something else already took it (a child editor, an IME, the
 * Settings search clearing its query, or a field that cancels its own edit
 * with it: `data-keeps-escape`, an account's name being renamed, #4376). */
export function subPageKeyAction(event: KeyLike): "back" | null {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return null;
  const target = event.target as { closest?: (selector: string) => unknown } | null | undefined;
  if (typeof target?.closest === "function" && target.closest("[data-settings-search], [data-keeps-escape]")) return null;
  return "back";
}

/** The row on a section that opens a sub-page: title, a one-line summary
 * and an Edit cue. One card level; the row itself is the button. */
export function SettingsSubPageRow({
  cardId,
  title,
  summary,
  actionLabel,
  onOpen,
  bare = false,
}: {
  cardId: string;
  title: string;
  summary: React.ReactNode;
  actionLabel: string;
  onOpen: () => void;
  /** A row of a settings group's card (General's Account and System), not
   * a card of its own. */
  bare?: boolean;
}) {
  return (
    <div data-settings-card={cardId} data-settings-subpage-row className={bare ? undefined : "rounded-[14px] border-[0.5px] border-border"}>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full min-w-0 items-center gap-3 px-3.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none ${bare ? "py-2.5" : "rounded-[14px] py-3"}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-[18px] text-ink">{title}</span>
          <span data-card-summary className="mt-0.5 block truncate text-[12.5px] leading-[18px] text-ink-secondary">{summary}</span>
        </span>
        <span className="shrink-0 text-[12.5px] font-medium text-accent">{actionLabel}</span>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
    </div>
  );
}

/** A sub-page: back arrow, breadcrumb, and the page filling the rest. */
export function SettingsSubPage({
  pageId,
  sectionLabel,
  title,
  onBack,
  children,
}: {
  pageId: string;
  sectionLabel: string;
  title: React.ReactNode;
  onBack: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Capture phase: runs before the modal's own Escape (close Settings),
    // which skips an event already handled.
    const onKey = (event: KeyboardEvent) => {
      if (subPageKeyAction(event) !== "back") return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onBack]);

  return (
    <div data-settings-subpage={pageId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pr-12 pt-3 sm:px-6 sm:pt-5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("settings.subPage.back", { section: sectionLabel })}
          title={t("settings.subPage.back", { section: sectionLabel })}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <nav aria-label={t("settings.subPage.breadcrumb")} className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1 text-[15px] leading-6 sm:text-[17px]">
            <li className="shrink-0">
              <button type="button" onClick={onBack} className="rounded-md text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
                {sectionLabel}
              </button>
            </li>
            <li aria-hidden="true" className="shrink-0 text-ink-secondary"><ChevronRight size={15} /></li>
            <li aria-current="page" className="min-w-0 truncate font-semibold tracking-[-0.008em] text-ink">{title}</li>
          </ol>
        </nav>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-3 sm:px-8">{children}</div>
    </div>
  );
}
