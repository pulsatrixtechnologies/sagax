// A preview card that floats above a link in a bot reply. It opens when the
// pointer rests on the link, on keyboard focus, or on a long press, and
// shows what the app knows about the link without fetching it. HoverCard is
// also the mechanics of the bot library's files and of record cards
// (RecordLink.tsx), which ask for its optional intent, pin, warm switch and
// motion.
//
// Parts of the hover card behavior and motion (warm switch, pointer-rest
// intent, Escape keeping a dismissed card closed, grow-from-the-anchor
// entrance) are adapted from Arc, Copyright (c) 2026 Elia Kuratli, used under
// the MIT License (third_party/arc-library/LICENSE).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CircleDot, GitCommitHorizontal, GitBranch, GitPullRequest, Globe, Hash } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMenuMotion } from "@/components/MenuMotion";
import { githubRefLabel, type GithubRef, type GithubRefKind } from "@/lib/github-refs";

export const HOVER_OPEN_DELAY_MS = 300;
/** time to move the pointer from the link into the card */
export const HOVER_CLOSE_GRACE_MS = 150;
export const LONG_PRESS_MS = 500;
const GAP = 8;
const EDGE = 8;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** Above the link and centered on it, inside the window. Below when there
 * is no room above. */
export function placeCard(anchor: Box, card: { width: number; height: number }, view: { width: number; height: number }) {
  const maxLeft = Math.max(EDGE, view.width - card.width - EDGE);
  const left = Math.min(maxLeft, Math.max(EDGE, anchor.left + anchor.width / 2 - card.width / 2));
  const above = anchor.top - GAP - card.height;
  if (above >= EDGE) return { left, top: above, side: "above" as const };
  const below = anchor.bottom + GAP;
  return { left, top: Math.max(EDGE, Math.min(below, view.height - card.height - EDGE)), side: "below" as const };
}

export const GITHUB_REF_ICONS: Record<GithubRefKind, typeof GitPullRequest> = {
  pull: GitPullRequest,
  issue: CircleDot,
  commit: GitCommitHorizontal,
  ref: Hash,
};

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./i, "");
}

function pathOf(url: URL): string {
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  try {
    return decodeURI(rest);
  } catch {
    return rest;
  }
}

/** The card itself: a title, a short muted description, and the site with
 * an outward arrow, in the composer's surface and radius. */
export function LinkPreviewCard({ href, github }: { href: string; github?: GithubRef | null }) {
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    url = null;
  }
  const host = url ? hostOf(url) : href;
  const Icon = github ? GITHUB_REF_ICONS[github.kind] : null;
  const title = github
    ? github.kind === "commit"
      ? t("links.card.commit", { id: githubRefLabel(github, false) })
      : t(github.kind === "pull" ? "links.card.pullRequest" : github.kind === "issue" ? "links.card.issue" : "links.card.reference", { id: githubRefLabel(github, false) })
    : host;
  const description = github ? `${github.owner}/${github.repo}` : url ? pathOf(url) : "";
  return (
    <div className="w-[min(20rem,calc(100vw-1rem))] rounded-3xl bg-composer p-4 text-ink shadow-lg ring-1 ring-hairline/40">
      <div className="flex items-baseline gap-2">
        {Icon && <Icon size={15} aria-hidden="true" className="shrink-0 self-center text-ink-secondary" />}
        <div dir="auto" className="min-w-0 line-clamp-2 break-words text-[15px] font-semibold leading-snug">{title}</div>
      </div>
      {description && (
        <div dir="ltr" className="mt-1 line-clamp-3 break-all text-[13px] leading-5 text-ink-secondary [unicode-bidi:isolate]">
          {description}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-[13px] leading-5 text-ink-tertiary">
        {github ? <GitBranch size={14} aria-hidden="true" className="shrink-0" /> : <Globe size={14} aria-hidden="true" className="shrink-0" />}
        <span dir="ltr" className="min-w-0 flex-1 truncate [unicode-bidi:isolate]">{host}</span>
        <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
      </div>
    </div>
  );
}

/** Wraps a link: hover (after a short delay), keyboard focus or a long press
 * opens the card, leaving closes it after a grace period that lets the
 * pointer move into the card. */
export function LinkHoverCard({ href, github, children }: { href: string; github?: GithubRef | null; children: (anchor: AnchorProps) => ReactNode }) {
  return <HoverCard card={() => <LinkPreviewCard href={href} github={github} />} kind="link-preview">{children}</HoverCard>;
}

/** The pointer must rest this long on an anchor before `onIntent` runs (a
 * pointer crossing it on the way elsewhere asks for nothing). */
export const HOVER_INTENT_MS = 80;
/** A card that closed less than this long ago keeps the next one warm. */
export const HOVER_WARM_WINDOW_MS = 300;
/** ...which then opens after this long instead of HOVER_OPEN_DELAY_MS. */
export const HOVER_WARM_OPEN_MS = 80;
/** The exit of a card that animates (`motion`). */
export const HOVER_EXIT_MS = 120;

/** What a card's render function is told while it is open. */
export interface HoverCardState {
  /** pinned open by a click, Enter or Space on the anchor */
  pinned: boolean;
  /** close (and unpin) the card */
  close: () => void;
  /** pin the card open (a click inside it that goes somewhere) */
  pin: () => void;
}

type Mode = "closed" | "hover" | "pinned";

// When the last card that asked for the warm switch closed, and the one card
// that is pinned (only one at a time).
let warmClosedAt = Number.NEGATIVE_INFINITY;
let pinnedHolder: { close: () => void } | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The same mechanics around any card: `card` is called only while open
 * (so it may load what it shows lazily), `kind` names the floating box
 * (`data-<kind>`). Used by links, by the bot library's files and by record
 * cards. Every prop after `children` is optional and off by default, so the
 * first two users behave as before:
 *
 * - `onIntent`: runs once the pointer has rested on the anchor for 80 ms (a
 *   prefetch);
 * - `pinnable`: a click, Enter or Space on the anchor pins the card open. A
 *   pinned card is a non-modal dialog (named by `label`), keeps its place
 *   while the transcript scrolls, holds Tab inside, and closes on Escape
 *   (focus goes back to the anchor), a click outside or its own close. One
 *   card is pinned at a time. After Escape the card stays closed until the
 *   pointer has left the anchor;
 * - `warm`: a card that closed less than 300 ms ago makes the next one open
 *   after 80 ms;
 * - `motion`: the card fades in over 160 ms with a 4 px rise from the side
 *   of the anchor, and out over 120 ms; a fade only when warm or under
 *   reduced motion;
 * - `place`: the card is too large to sit against its anchor (a record card,
 *   #5053). It sits where `place` says in the window, whatever the anchor and
 *   the scroll, and `room` is the height it may take there
 *   (`--hover-card-room`).
 */
export function HoverCard({ card, kind, children, onIntent, pinnable = false, label, warm = false, motion = false, disabled = false, trigger = "hover", place }: {
  card: (state: HoverCardState) => ReactNode;
  kind: string;
  children: (anchor: AnchorProps) => ReactNode;
  onIntent?: () => void;
  pinnable?: boolean;
  label?: string;
  warm?: boolean;
  motion?: boolean;
  /** the anchor asks for no card (a card already open stays until it closes) */
  disabled?: boolean;
  /** "click": the card opens only on a click, Enter or Space (pinned), never on
   * hover, focus or long press; the pointer resting still runs `onIntent` */
  trigger?: "hover" | "click";
  place?: (card: { width: number; height: number }, view: { width: number; height: number }) => { left: number; top: number; room?: number };
}) {
  const byClick = trigger === "click";
  const [mode, setMode] = useState<Mode>("closed");
  const open = mode !== "closed";
  const pinned = mode === "pinned";
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const intent = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const dismissed = useRef(false);
  // whether the pointer is on the anchor or on the card right now: Escape keeps
  // a card closed only while that holds, so a later visit is never ignored
  const pointerOver = useRef(false);
  const openedWarm = useRef(false);
  // focus handed back to the anchor after Escape must not reopen the card
  const returning = useRef(false);
  const wasOpen = useRef(false);
  // where the card sits against its anchor once the person navigates inside it:
  // kept until it closes, so a card that changes height never flips or jumps
  const lock = useRef<{ dx: number; dy: number } | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const clearIntent = () => {
    if (intent.current) clearTimeout(intent.current);
    intent.current = undefined;
  };
  const later = useCallback((value: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => setMode((current) => value ? (current === "closed" ? "hover" : current) : current === "pinned" ? current : "closed"), ms);
  }, []);
  const closeNow = useCallback(() => {
    clear();
    setMode("closed");
  }, []);
  useEffect(() => () => { clear(); clearIntent(); }, []);

  const anim = useMenuMotion(motion && open, HOVER_EXIT_MS);
  const rendered = motion ? anim.shown : open;

  useEffect(() => {
    if (wasOpen.current && !open && warm) warmClosedAt = Date.now();
    wasOpen.current = open;
    if (!open) lock.current = null;
  }, [open, warm]);

  // one pinned card at a time
  useEffect(() => {
    if (!pinned) return;
    const holder = { close: closeNow };
    pinnedHolder?.close();
    pinnedHolder = holder;
    return () => { if (pinnedHolder === holder) pinnedHolder = null; };
  }, [pinned, closeNow]);

  // pinning moves focus into the card's first action; a card still loading
  // has none yet, so focus waits for it to arrive (and falls back to the
  // card's first control only if nothing took focus within four seconds)
  useEffect(() => {
    if (!pinned) return;
    let observer: MutationObserver | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const focusFirst = () => {
      const first = cardRef.current?.querySelector<HTMLElement>("[data-hover-card-first]");
      first?.focus({ preventScroll: true });
      return Boolean(first);
    };
    const frame = requestAnimationFrame(() => {
      const box = cardRef.current;
      if (!box || focusFirst()) return;
      observer = new MutationObserver(() => { if (focusFirst()) { observer?.disconnect(); if (giveUp) clearTimeout(giveUp); } });
      observer.observe(box, { childList: true, subtree: true });
      giveUp = setTimeout(() => {
        observer?.disconnect();
        if (!box.contains(document.activeElement)) box.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      }, 4_000);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (giveUp) clearTimeout(giveUp);
    };
  }, [pinned]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current, box = cardRef.current;
      if (!anchor || !box) return;
      if (place) {
        const spot = place({ width: box.offsetWidth, height: box.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        box.style.left = `${spot.left}px`;
        box.style.top = `${spot.top}px`;
        if (spot.room !== undefined) box.style.setProperty("--hover-card-room", `${spot.room}px`);
        box.style.visibility = "visible";
        return;
      }
      const rects = anchor.getClientRects();
      const rect = rects.length ? rects[0]! : anchor.getBoundingClientRect();
      const held = lock.current;
      if (held) {
        // the top-left stays where it was; a taller card grows downward and scrolls inside
        const left = Math.min(Math.max(EDGE, window.innerWidth - box.offsetWidth - EDGE), Math.max(EDGE, rect.left + held.dx));
        const top = Math.max(EDGE, rect.top + held.dy);
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.setProperty("--hover-card-room", `${Math.max(120, window.innerHeight - top - EDGE)}px`);
        box.style.visibility = "visible";
        return;
      }
      const spot = placeCard(rect, { width: box.offsetWidth, height: box.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      box.style.left = `${spot.left}px`;
      box.style.top = `${spot.top}px`;
      box.dataset.side = spot.side;
      box.style.visibility = "visible";
    };
    update();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      // A picker opened by the card is portalled to the document body.
      const pickers = cardRef.current?.querySelectorAll('[aria-expanded="true"][aria-controls]');
      for (const picker of pickers ?? []) {
        const menu = document.getElementById(picker.getAttribute("aria-controls")!);
        if (menu?.contains(target)) return;
      }
      closeNow();
    };
    // a card that loads grows or shrinks: it keeps its place against the anchor
    const observer = typeof ResizeObserver === "undefined" || !cardRef.current ? null : new ResizeObserver(update);
    if (observer && cardRef.current) observer.observe(cardRef.current);
    window.addEventListener("resize", update);
    // a scrolled transcript moves the link away from the card: an unpinned
    // card goes, a pinned one follows its anchor
    // (a card placed in the window does not follow its anchor: a scroll, its own included, moves nothing)
    const onScroll = pinned ? (place ? () => {} : update) : closeNow;
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, pinned, closeNow, place]);

  // Escape anywhere closes a pinnable card and keeps it closed while the
  // pointer still rests on the anchor
  useEffect(() => {
    if (!pinnable || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const holdsFocus = cardRef.current?.contains(document.activeElement) ?? false;
      dismissed.current = pointerOver.current;
      clear();
      setMode("closed");
      if (holdsFocus || pinned) returnFocus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pinnable, open, pinned]);

  /** focus goes back to the anchor without that focus opening the card again */
  const returnFocus = () => {
    returning.current = true;
    anchorRef.current?.focus({ preventScroll: true });
    returning.current = false;
  };

  const togglePin = () => {
    clear();
    setMode((current) => current === "pinned" ? "closed" : "pinned");
  };

  const anchor: AnchorProps = {
    ref: (node) => { anchorRef.current = node; },
    "aria-describedby": open && !pinned ? id : undefined,
    ...(pinnable ? { "aria-haspopup": "dialog" as const, "aria-expanded": pinned } : {}),
    onPointerEnter: (event) => {
      if (event.pointerType === "touch") return;
      pointerOver.current = true;
      if (dismissed.current || disabled) return;
      clearIntent();
      if (onIntent) intent.current = setTimeout(onIntent, HOVER_INTENT_MS);
      if (byClick) return;
      const isWarm = warm && Date.now() - warmClosedAt < HOVER_WARM_WINDOW_MS;
      openedWarm.current = isWarm;
      later(true, isWarm ? HOVER_WARM_OPEN_MS : HOVER_OPEN_DELAY_MS);
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "touch") return;
      pointerOver.current = false;
      dismissed.current = false;
      clearIntent();
      later(false, HOVER_CLOSE_GRACE_MS);
    },
    onFocus: (event) => {
      // keyboard focus only: a click focuses the link too
      if (!byClick && !returning.current && !disabled && event.currentTarget.matches(":focus-visible")) {
        clear();
        openedWarm.current = false;
        onIntent?.();
        setMode((current) => current === "closed" ? "hover" : current);
      }
    },
    onBlur: () => {
      if (pinned || byClick) return;
      later(false, 0);
    },
    onKeyDown: (event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        clear();
        dismissed.current = pinnable && pointerOver.current;
        setMode("closed");
        return;
      }
      // Space presses a link like a button; Enter already clicks it (a real
      // button does both itself)
      if (pinnable && !disabled && event.currentTarget.tagName !== "BUTTON" && event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        togglePin();
      }
    },
    onPointerDown: (event) => {
      if (byClick || event.pointerType !== "touch") return;
      pressed.current = false;
      pressStart.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = setTimeout(() => {
        pressed.current = true;
        setMode((current) => current === "closed" ? "hover" : current);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const start = pressStart.current;
      if (event.pointerType !== "touch" || !start || pressed.current) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        pressStart.current = null;
        clear();
      }
    },
    onPointerUp: (event) => {
      if (event.pointerType !== "touch") return;
      pressStart.current = null;
      if (!pressed.current) clear();
    },
    onClick: (event) => {
      // the long press showed the card; lifting the finger must not also
      // open the link
      if (pressed.current) {
        event.preventDefault();
        pressed.current = false;
        return;
      }
      // a click pins; Cmd or Ctrl + click is the owner's own (open it)
      if (pinnable && !disabled && !event.defaultPrevented && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        togglePin();
      }
    },
    onContextMenu: (event) => {
      if (pressed.current || open) event.preventDefault();
    },
  };

  const onCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!pinned || event.key !== "Tab") return;
    const box = cardRef.current;
    if (!box) return;
    const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.tabIndex >= 0);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0]!, last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !box.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !box.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const motionClass = !motion ? "" : anim.closing ? "hover-card-out" : openedWarm.current ? "hover-card-warm" : "hover-card-in";

  return (
    <>
      {children(anchor)}
      {rendered && createPortal(
        <div
          ref={cardRef}
          id={id}
          role={pinned ? "dialog" : "tooltip"}
          aria-label={pinned ? label : undefined}
          {...{ [`data-${kind}`]: "" }}
          data-pinned={pinned ? "" : undefined}
          className={cn("fixed z-50", motionClass)}
          style={{ left: 0, top: 0, visibility: "hidden" }}
          {...(motion ? anim.exitProps : {})}
          onKeyDown={onCardKeyDown}
          onPointerEnter={(event) => { if (event.pointerType !== "touch") { pointerOver.current = true; clear(); } }}
          onPointerLeave={(event) => { if (event.pointerType !== "touch") { pointerOver.current = false; dismissed.current = false; later(false, HOVER_CLOSE_GRACE_MS); } }}
        >
          {card({
            pinned,
            // closing a pinned card by hand puts focus back on its anchor
            close: () => {
              const held = pinned || (cardRef.current?.contains(document.activeElement) ?? false);
              closeNow();
              if (held) returnFocus();
            },
            pin: () => {
              clear();
              setMode("pinned");
              const a = anchorRef.current, box = cardRef.current;
              if (a && box && !lock.current) {
                const rects = a.getClientRects();
                const rect = rects.length ? rects[0]! : a.getBoundingClientRect();
                const at = box.getBoundingClientRect();
                lock.current = { dx: at.left - rect.left, dy: at.top - rect.top };
              }
            },
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export type AnchorProps = {
  ref: (node: HTMLElement | null) => void;
  "aria-describedby"?: string;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
};
