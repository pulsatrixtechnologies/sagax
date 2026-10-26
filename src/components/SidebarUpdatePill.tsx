// The update button of Grok Bot's foot (avatar, Connect apps, this). Since
// the foot became the avatar alone beside the Connect apps pill (#575), the
// account row's round cloud button never showed (it is drawn only beside a
// full name), so a waiting update left the foot silent (JC, 2026-10-18).
//
// It is a 36px round button on the skin's accent, the avatar's size, at the
// right of the pill, shown while an update downloads, is staged, is ready or
// installs. On hover or keyboard focus it widens to show its word ("Update",
// or the download's progress) and the pill gives way; it also widens for a
// few seconds when an update lands, once per version. With reduced motion
// it does not animate: the word simply shows on hover or focus. A click on a
// ready update opens the "Update ready" dialog (UpdateBanner,
// openUpdatePrompt), the same as the old button: its release notes, then
// Update, which installs through the existing updater.
import { useEffect, useRef, useState } from "react";
import { CloudDownload, Loader2 } from "lucide-react";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { openUpdatePrompt } from "@/lib/update-prompt";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** How long the button stays wide after an update lands. */
export const UPDATE_PILL_ANNOUNCE_MS = 5000;

export type UpdatePillView =
  | { kind: "progress"; percent: number | null; text: string; aria: string }
  | { kind: "busy"; text: string; aria: string }
  | { kind: "ready"; text: string; aria: string; version: string | null };

/** What the foot's update button shows for an updater state, or null when
 * it stays away (no bridge, idle, a check, an error: the error has its own
 * card, a handed-off install finishes in a terminal). */
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
    case "downloaded": {
      const version = state.version?.trim() || null;
      return {
        kind: "ready",
        text: t("sidebar.update.pill"),
        aria: version ? t("sidebar.update.pillAria", { app: brand().name, version }) : t("sidebar.update.pill"),
        version,
      };
    }
    default:
      return null;
  }
}

/** Wide while hovered or focused, and for a moment after an update lands
 * (once per version). */
function useAnnounce(version: string | null | undefined): boolean {
  const [announcing, setAnnouncing] = useState(false);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (version === undefined) {
      setAnnouncing(false);
      return;
    }
    const key = version ?? "";
    if (announced.current === key) return;
    announced.current = key;
    setAnnouncing(true);
    const timer = setTimeout(() => setAnnouncing(false), UPDATE_PILL_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [version]);
  return announcing;
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

export function UpdatePillButton({ view, wide: forcedWide = false, onOpen = openUpdatePrompt }: {
  view: UpdatePillView;
  /** the announcement after an update lands */
  wide?: boolean;
  onOpen?: () => void;
}) {
  const ready = view.kind === "ready";
  return (
    <button
      type="button"
      data-sidebar-update-pill={view.kind}
      data-wide={forcedWide ? "" : undefined}
      data-percent={view.kind === "progress" && view.percent !== null ? view.percent : undefined}
      aria-label={view.aria}
      title={view.aria}
      aria-disabled={ready ? undefined : true}
      aria-busy={ready ? undefined : true}
      onClick={(event) => {
        event.stopPropagation();
        if (ready) onOpen();
      }}
      className={cn(
        // w-9 pins the resting circle: nothing in the row can squeeze it, and
        // it widens only to show its word (the foot rule below), pushing
        // Connect apps left instead of floating over it
        "sidebar-update-pill group inline-flex h-9 w-9 shrink-0 items-center justify-start overflow-hidden rounded-full bg-accent text-accent-ink shadow-sm outline-none",
        "focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        ready ? "cursor-pointer hover:brightness-95" : "cursor-default",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center" data-update-icon="">
        {view.kind === "progress" ? <ProgressRing percent={view.percent} />
          : view.kind === "busy" ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          : <CloudDownload size={18} strokeWidth={2.2} aria-hidden="true" />}
      </span>
      <span data-update-text="" aria-hidden="true" className="block whitespace-nowrap text-[13px] font-medium leading-5 tabular-nums">
        {view.text}
      </span>
    </button>
  );
}

/** The foot's update button, live on the updater bridge; nothing in the
 * browser, in dev, or while there is nothing to say. */
export function SidebarUpdatePill() {
  const view = updatePillView(useUpdaterState());
  const announcing = useAnnounce(view?.kind === "ready" ? view.version : undefined);
  if (!view) return null;
  return <UpdatePillButton view={view} wide={announcing} />;
}
