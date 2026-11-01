// Page + chat layout for lot 5 of the Grok convergence (2026-10-31).
//
// Evidence kinds (see docs/plans/grok-convergence-interface-evidence.md):
//   Documented (docs.x.ai/grok-bot/files-and-results): page fills the window;
//     chat usable "beside" it. Phone: full screen; close returns to chat.
//   Source-derived (Grok Bot 0.78.1 eager-app bundle): page kinds diverge.
//     `file` (HTML artifacts Root opened natively): data-page-stage-chat
//     docked composer on the page (`framed`|`bare`); Message about title is
//     the stage-chat aria-label (j7O9JP), not the visible placeholder.
//     `canvas` alone gets companion:`chat-pane` (side transcript).
//   Measured (Root 2026-10-31, Grok 0.78.1 macOS + Sagax 0.8.23 iOS): HTML
//     Pages fill the main frame with a floating composer; no transcript
//     beside at rest/focus; visible placeholder stays Message <botname>.
//
// Default Sagax path for published HTML pages = stage (cover + docked
// composer), matching measured file artifacts. Optional `beside` is a
// deliberate Sagax richer control (and mirrors Grok canvas chat-pane) when
// the person asks and the ChatView host is wide enough.
//
// Beside vs cover uses the ChatView host width (ResizeObserver), not the
// window, so split panes and sidebars stay correct.
import { useLayoutEffect, useState, type RefObject } from "react";

/** Matches Tailwind `md`. Optional beside needs at least this many CSS pixels of host. */
export const PAGE_CHAT_SIDE_MIN_PX = 768;

/**
 * How an open page shares the ChatView host.
 * - stage: measured HTML/file path. Page covers the mounted chat; composer
 *   docks on the page (Grok data-page-stage-chat=docked).
 * - beside: optional side transcript when the host is wide (Grok canvas
 *   companion chat-pane / Sagax richer Show conversation).
 */
export type PageChatSurface = "stage" | "beside";

/** Default for Sagax published HTML pages: measured file/stage path. */
export const PAGE_CHAT_SURFACE_DEFAULT: PageChatSurface = "stage";

/** True when the ChatView host is wide enough for an optional side chat. */
export function pageHostIsWide(hostWidthPx: number): boolean {
  return Number.isFinite(hostWidthPx) && hostWidthPx >= PAGE_CHAT_SIDE_MIN_PX;
}

/** Optional side transcript: person asked for beside and the host is wide. */
export function pageBesideChat(pageOpen: boolean, wide: boolean, surface: PageChatSurface = PAGE_CHAT_SURFACE_DEFAULT): boolean {
  return pageOpen && surface === "beside" && wide;
}

/**
 * Page covers the mounted conversation. Stage always covers. Beside covers
 * only when the host is too narrow for a side pane.
 */
export function pageCoversChat(pageOpen: boolean, wide: boolean, surface: PageChatSurface = PAGE_CHAT_SURFACE_DEFAULT): boolean {
  if (!pageOpen) return false;
  if (surface === "stage") return true;
  return !wide;
}

/** Docked stage composer on the page (measured HTML path). */
export function pageStageComposer(pageOpen: boolean, surface: PageChatSurface = PAGE_CHAT_SURFACE_DEFAULT): boolean {
  return pageOpen && surface === "stage";
}

/**
 * Version to ask for when opening from a conversation card.
 * A superseded card ("Updated below") opens the latest page, not the old one.
 */
export function pageCardOpenVersion(
  status: "proposed" | "published" | "declined" | "superseded" | "revoked" | "draft" | "deleted" | null | undefined,
  cardVersion: number,
): number | undefined {
  if (status === "superseded") return undefined;
  return cardVersion;
}

/**
 * Card status when the thread already names a newer version than this card.
 * Keeps declined as declined; otherwise a newer thread version means Updated below.
 */
export function pageCardStatusWithThreadLatest(
  status: "proposed" | "published" | "declined" | "superseded" | "revoked" | "draft" | "deleted" | null,
  cardVersion: number,
  threadLatestVersion: number | undefined,
): typeof status {
  if (status === "deleted" || status === "declined") return status;
  if (threadLatestVersion !== undefined && threadLatestVersion > cardVersion) return "superseded";
  return status;
}

/**
 * Subscribe to the ChatView host element's width. Sidebar / split panes that
 * leave a tiny host on a wide desktop report narrow (beside falls back to cover).
 */
export function usePageChatHostWide(hostRef: RefObject<HTMLElement | null>): boolean {
  // Default wide so SSR / first paint does not flash a cover on a desktop host
  // when the person has asked for beside.
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => {
      const next = pageHostIsWide(el.getBoundingClientRect().width);
      setWide((current) => (current === next ? current : next));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hostRef]);
  return wide;
}
