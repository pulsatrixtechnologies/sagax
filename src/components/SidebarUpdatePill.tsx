// The foot's update progress (avatar, Connect apps, this): a 36px round
// button on the skin's accent, the avatar's size, shown while an update
// downloads, is staged or installs. A downloaded update is not here: it is
// told once, as the account menu's first row with Install (#4093, the
// reference's menu), and the avatar wears the reference's update dot. On
// hover or keyboard focus a wide foot shows the word (the download's
// progress); with reduced motion it does not animate. It takes no click:
// the work is under way.
import { Loader2 } from "lucide-react";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type UpdatePillView =
  | { kind: "progress"; percent: number | null; text: string; aria: string }
  | { kind: "busy"; text: string; aria: string };

/** What the foot's update button shows for an updater state, or null when
 * it stays away (no bridge, idle, a check, an error: the error has its own
 * card, a handed-off install finishes in a terminal; a downloaded update:
 * the account menu's first row offers it, #4093). */
export function updatePillView(state: UpdaterState | null): UpdatePillView | null {
  if (!state) return null;
  switch (state.status) {
    case "downloading": {
      const percent = state.percent == null ? null : Math.max(0, Math.min(100, Math.round(state.percent)));
      // the word stays short (the pill beside it gives way), the label says it all
      return {
        kind: "progress",
        percent,
        text: t("releaseNotes.percent", { percent: percent ?? 0 }),
        aria: percent === null ? t("sidebar.update.startingDownload") : t("sidebar.update.downloading", { percent }),
      };
    }
    case "preparing":
      return { kind: "busy", text: t("settings.updates.preparingShort"), aria: t("sidebar.update.preparing") };
    case "installing": {
      const handoff = state.installMode === "handoff";
      return {
        kind: "busy",
        text: handoff ? t("settings.updates.opening") : t("releaseNotes.restarting"),
        aria: state.message || (handoff ? t("sidebar.update.openingTerminal") : t("sidebar.update.installing")),
      };
    }
    default:
      return null;
  }
}

const RING = 2 * Math.PI * 7;

/** The download's progress as a ring around the arrow. */
function ProgressRing({ percent }: { percent: number | null }) {
  return (
    <svg viewBox="0 0 18 18" width={18} height={18} aria-hidden="true" data-update-ring="" className={cn(percent === null && "animate-spin")}>
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - (percent ?? 25) / 100)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

export function UpdatePillButton({ view, layout, onHot }: {
  view: UpdatePillView;
  /** the foot's two states: "compact" stays the circle beside the profile
   * (never widens, so it cannot cut the name), "wide" always shows its word
   * (the profile is the avatar alone). Left out: it widens on hover. */
  layout?: "compact" | "wide";
  /** pointer or keyboard on the button (the foot folds its profile then) */
  onHot?: (hot: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-sidebar-update-pill={view.kind}
      data-wide={layout === "wide" ? "" : undefined}
      data-layout={layout}
      data-percent={view.kind === "progress" && view.percent !== null ? view.percent : undefined}
      aria-label={view.aria}
      title={view.aria}
      onMouseEnter={onHot ? () => onHot(true) : undefined}
      onMouseLeave={onHot ? () => onHot(false) : undefined}
      onFocus={onHot ? (event) => { if (event.currentTarget.matches(":focus-visible")) onHot(true); } : undefined}
      onBlur={onHot ? () => onHot(false) : undefined}
      aria-disabled
      aria-busy
      onClick={(event) => event.stopPropagation()}
      className={cn(
        // w-9 pins the resting circle: nothing in the row can squeeze it, and
        // it widens only to show its word (the foot rule below), pushing
        // Connect apps left instead of floating over it
        "sidebar-update-pill group inline-flex h-9 w-9 shrink-0 cursor-default items-center justify-start overflow-hidden rounded-full bg-accent text-accent-ink shadow-sm outline-none",
        "focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        layout === "wide" && "min-w-9 shrink [&[data-layout=wide]]:w-auto",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center" data-update-icon="">
        {view.kind === "progress" ? <ProgressRing percent={view.percent} /> : <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
      </span>
      <span data-update-text="" aria-hidden="true" className="block whitespace-nowrap text-[13px] font-medium leading-5 tabular-nums">
        {view.text}
      </span>
    </button>
  );
}

/** The foot's update button, live on the updater bridge; nothing in the
 * browser, in dev, or while there is nothing to say. */
export function SidebarUpdatePill({ layout, onHot }: { layout?: "compact" | "wide"; onHot?: (hot: boolean) => void } = {}) {
  const view = updatePillView(useUpdaterState());
  if (!view) return null;
  return <UpdatePillButton view={view} layout={layout} onHot={onHot} />;
}
