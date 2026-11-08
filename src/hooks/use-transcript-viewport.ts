// The scrolling transcript of a 1:1 chat or a room: which rows mount, when
// the pane follows the bottom, and how it holds still while rows are
// prepended. ChatView and GroupView both use this one copy, so a viewport fix
// lands once.
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type PointerEvent,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { BOTTOM_FOLLOW_THRESHOLD, shouldResumeBottomFollow, useBottomFollowResize } from "@/lib/bottom-follow";
import { useFocusMessage } from "@/lib/focus-message";
import { scrollMotion } from "@/lib/motion";
import {
  FIRST_PAINT_ROWS,
  TRANSCRIPT_WINDOW_SIZE,
  expandWindowStart,
  focusWindowRange,
  followWindowStart,
  nextPaintRows,
  paintedRows,
  resolveTranscriptWindow,
  tailWindowStart,
  whenIdle,
} from "@/lib/transcript-window";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";

export const AUTO_EXPAND_TOP_THRESHOLD = 250;

/** Upward wheel, in pixels, that leaves the bottom while the pane is still
 * resting there. Smaller deltas are trackpad inertia and elastic bounce:
 * they used to drop follow, then the next line grew below the fold. */
const UPWARD_WHEEL_DETACH = 16;

/** True when the gesture started inside a scrollable box nested in the
 * transcript (code block, table, pre) that can still move up: the box eats the
 * gesture, the transcript itself does not move. */
function nestedCanScrollUp(target: EventTarget | null, root: HTMLElement | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function useTranscriptViewport<T extends { id: string; role?: string }>({
  ownerId,
  threadId,
  messages,
  pinOn,
  transcriptShown = true,
  hasMore = false,
  onLoadOlder,
  loadingOlder: loadingOlderOverride,
}: {
  /** The bot or room. Opening another conversation — another owner, or
   * another thread of this owner — re-arms bottom-follow. */
  ownerId: string;
  threadId: string;
  /** The full transcript. Only a window of it mounts. */
  messages: readonly T[];
  /** Besides a new row, what moves a following reader to the end: busy
   * flags, the composer's padding. Same length on every render. */
  pinOn: DependencyList;
  /** False while something else covers the transcript (a room's set-up form). */
  transcriptShown?: boolean;
  /** True when older messages remain on the server before messages[0]. */
  hasMore?: boolean;
  /** Side / split panes hold their own transcript outside the store: call
   * this instead of dispatching `loadOlderMessages`. */
  onLoadOlder?: () => void;
  /** Pending flag when `onLoadOlder` is set; otherwise the store's. */
  loadingOlder?: boolean;
}) {
  const dispatch = useStoreDispatch();
  const focusMessage = useStoreSelector((current) => current.focusMessage?.threadId === threadId ? current.focusMessage : null);
  const loadingOlder = useStoreSelector((current) => current.loadingOlder[threadId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Scroll pinning: follow the bottom while the user hasn't scrolled away.
  // Follow breaks ONLY on an upward user gesture (wheel/touch/scrollbar/
  // keys), never on scroll position checks — content growth flickers "at
  // bottom" false for a frame, and breaking there kills follow permanently
  // (upstream-verified failure). Scrolling back to the end re-arms it.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const previousScrollTop = useRef(0);
  const touchY = useRef(0);

  // Windowed transcript: only a tail of the thread mounts (screenshots make
  // full threads DOM-heavy). The boundary is per owner+thread; a render-phase
  // reset re-tails it on switch so the old thread's boundary never flashes
  // into the new one. While the reader follows the bottom, new rows slide the
  // boundary up so the window stays one window long, except that it stops at
  // the person's newest message while that message is mounted and at most one
  // more window back: the question stays on screen while a turn of hidden tool
  // steps answers it, and the window never passes two windows. A thread that
  // shrinks (a branch switch) re-tails it (followWindowStart). The boundary
  // holds still once they have scrolled away, so the rows they are reading
  // stay put.
  // Callers derive everything else (last reply, working dots) from the FULL
  // list.
  const transcriptKey = `${ownerId}:${threadId}`;
  const tailStart = tailWindowStart(messages.length);
  const [transcriptWindow, setTranscriptWindow] = useState<{
    key: string;
    start: number;
    end: number | null;
  }>(() => ({
    key: transcriptKey,
    start: tailStart,
    end: null,
  }));
  const switched = transcriptWindow.key !== transcriptKey;
  const nextStart = switched
    ? tailStart
    : follow && transcriptWindow.end === null
      ? followWindowStart(messages, transcriptWindow.start)
      : transcriptWindow.start;
  if (switched || nextStart !== transcriptWindow.start) {
    setTranscriptWindow({ key: transcriptKey, start: nextStart, end: null });
  }
  const {
    visible: fullWindow,
    hiddenCount,
    laterCount,
    startIndex,
    endIndex,
  } = useMemo(
    () => resolveTranscriptWindow(messages, transcriptWindow.start, TRANSCRIPT_WINDOW_SIZE, transcriptWindow.end),
    [messages, transcriptWindow.start, transcriptWindow.end],
  );
  // Progressive paint (#2595): a switch to another bot or thread mounts its
  // last FIRST_PAINT_ROWS rows only, so the view transition's synchronous
  // render stays short; the rest of the window arrives in idle steps, as a
  // low-priority transition, while the pane stays pinned to the bottom (or
  // holds the row being read). The first mount paints everything, and a
  // search-focus window (a finite end) is never capped.
  const [paint, setPaint] = useState<{ key: string; rows: number }>(() => ({ key: transcriptKey, rows: Number.POSITIVE_INFINITY }));
  const paintRows = transcriptWindow.end !== null ? Number.POSITIVE_INFINITY : paint.key === transcriptKey ? paint.rows : FIRST_PAINT_ROWS;
  const windowedMessages = useMemo(() => paintedRows(fullWindow, paintRows), [fullWindow, paintRows]);
  const windowCount = fullWindow.length;
  const paintHeight = useRef<number | null>(null);
  useEffect(() => {
    if (paintRows === Number.POSITIVE_INFINITY) return;
    if (paintRows >= windowCount) {
      setPaint({ key: transcriptKey, rows: Number.POSITIVE_INFINITY });
      return;
    }
    return whenIdle(() => {
      paintHeight.current = scrollRef.current?.scrollHeight ?? null;
      startTransition(() => setPaint({ key: transcriptKey, rows: nextPaintRows(paintRows, windowCount) }));
    });
  }, [transcriptKey, paintRows, windowCount]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const height = paintHeight.current;
    paintHeight.current = null;
    if (!el || height === null) return;
    if (followRef.current) el.scrollTop = el.scrollHeight;
    else el.scrollTop += el.scrollHeight - height;
    previousScrollTop.current = el.scrollTop;
  }, [paintRows]);

  const setBottomFollow = useCallback((next: boolean) => {
    followRef.current = next;
    setFollow(next);
  }, []);
  // The pane can only move up when it overflows AND is not already at the
  // top. A short chat has nothing to scroll, so an upward gesture there must
  // not switch follow off (the "Jump to latest" pill would show for nothing).
  const canScrollUp = () => {
    const el = scrollRef.current;
    return Boolean(el && el.scrollHeight - el.clientHeight > BOTTOM_FOLLOW_THRESHOLD && el.scrollTop > 0);
  };
  useBottomFollowResize(scrollRef, transcriptRef, followRef, transcriptShown ? transcriptKey : null);

  // A thread switch keeps the same owner, so the key is the transcript.
  // The search-focus effect below still turns follow off for a jump.
  useEffect(() => setBottomFollow(true), [transcriptKey, setBottomFollow]);

  // A search result may be hundreds of rows before the mounted tail. Open a
  // bounded window around it first; useFocusMessage then scrolls and flashes
  // the row after React commits that window.
  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    const focus = focusMessage;
    if (!focus || focus.consumed || focus.threadId !== threadId || appliedFocus.current === focus.nonce) return;
    const targetIndex = messages.findIndex((message) => message.id === focus.messageId);
    if (targetIndex < 0) return;
    appliedFocus.current = focus.nonce;
    const range = focusWindowRange(messages.length, targetIndex);
    setBottomFollow(false);
    setTranscriptWindow({ key: transcriptKey, start: range.start, end: range.end });
  }, [threadId, messages, setBottomFollow, focusMessage, transcriptKey]);
  useFocusMessage(threadId, messages.length > 0);

  // Sending a message re-arms follow: the person wants the reply in view, even
  // if an earlier stray gesture switched follow off. Declared before the pin
  // effect so that effect already sees follow on. Only a NEW last user row
  // counts, never the first load of a thread.
  const lastRow = messages.at(-1);
  const lastUserRowId = lastRow?.role === "user" ? lastRow.id : null;
  const seenUserRow = useRef<{ key: string; id: string | null }>({ key: transcriptKey, id: lastUserRowId });
  if (seenUserRow.current.key !== transcriptKey) {
    seenUserRow.current = { key: transcriptKey, id: lastUserRowId };
  } else if (lastUserRowId !== null && lastUserRowId !== seenUserRow.current.id) {
    seenUserRow.current.id = lastUserRowId;
    if (transcriptShown && !followRef.current) {
      followRef.current = true;
      queueMicrotask(() => setFollow(true));
    }
  } else if (lastUserRowId === null) {
    seenUserRow.current.id = null;
  }

  // deps track the FULL messages.length, so expanding the window (which only
  // changes windowedMessages) can never re-trigger this bottom scrollTo.
  // `follow` is intentionally omitted: flipping it true used to yank the
  // viewport to the end. Re-pinning only arms future content; Jump to latest
  // and this effect on new rows do the scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !followRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
    previousScrollTop.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinOn is the caller's dependency list
  }, [transcriptKey, messages.length, ...pinOn]);

  // Rows prepended at the front — Show earlier widening the local window, or
  // an older page arriving from the server — would push the row under the
  // reader down. Capture the height first, then after the commit shift
  // scrollTop by the growth so that row stays put (browser scroll anchoring
  // is disabled on this container). The capture belongs to the thread it was
  // taken in, and transcriptKey is a dependency so a switch drops a capture
  // from the thread being left instead of shifting the new one.
  const preExpandHeight = useRef<{ key: string; height: number } | null>(null);
  const expandingRef = useRef(false);

  const holdRowForPrepend = () => {
    preExpandHeight.current = scrollRef.current ? { key: transcriptKey, height: scrollRef.current.scrollHeight } : null;
    // reading scrollback: a mid-expand stream event must not pin the bottom
    setBottomFollow(false);
  };
  const oldestId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const captured = preExpandHeight.current;
    if (!captured || !el) {
      expandingRef.current = false;
      return;
    }
    preExpandHeight.current = null;
    if (captured.key !== transcriptKey) {
      expandingRef.current = false;
      return;
    }
    el.scrollTop += el.scrollHeight - captured.height;
    // keep the resume-follow heuristic from reading the restore as a
    // downward user scroll
    previousScrollTop.current = el.scrollTop;
    expandingRef.current = false;
  }, [transcriptWindow.start, oldestId, transcriptKey]);

  const showEarlier = () => {
    holdRowForPrepend();
    const start = expandWindowStart(startIndex);
    setTranscriptWindow((w) => ({ ...w, start }));
  };
  const showLater = () => {
    setBottomFollow(false);
    const nextEnd = Math.min(messages.length, endIndex + TRANSCRIPT_WINDOW_SIZE);
    setTranscriptWindow((w) => ({ ...w, end: nextEnd >= messages.length ? null : nextEnd }));
  };
  // Scrollback across the network: the snapshot holds a bounded page, and
  // everything before it is still on the server. A side / split pane passes
  // its own loader; the main chat uses the store.
  const olderPending = onLoadOlder ? Boolean(loadingOlderOverride) : Boolean(loadingOlder);
  const requestOlder = useCallback(() => {
    if (onLoadOlder) onLoadOlder();
    else dispatch({ type: "loadOlderMessages", threadId });
  }, [onLoadOlder, dispatch, threadId]);
  const loadOlder = () => {
    holdRowForPrepend();
    requestOlder();
  };

  useEffect(() => {
    if (!olderPending) expandingRef.current = false;
  }, [olderPending]);

  // Seamless reverse infinite scroll: automatically reveals earlier messages
  // when scrolling up near the top.
  const triggerAutoEarlier = useCallback(() => {
    if (expandingRef.current) return;
    if (hiddenCount > 0) {
      expandingRef.current = true;
      holdRowForPrepend();
      const start = expandWindowStart(startIndex);
      setTranscriptWindow((w) => ({ ...w, start }));
    } else if (hasMore && !olderPending) {
      expandingRef.current = true;
      holdRowForPrepend();
      requestOlder();
    }
  }, [hiddenCount, startIndex, hasMore, olderPending, requestOlder, transcriptKey]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !followRef.current) {
          triggerAutoEarlier();
        }
      },
      { root, rootMargin: "250px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [triggerAutoEarlier]);

  // keyboard is a scroll gesture too (upstream lesson): PageUp/Home/ArrowUp
  // break follow like an upward wheel; the at-end onScroll check re-arms it.
  // ArrowUp only counts outside inputs — in the composer it edits, not scrolls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PageUp" && e.key !== "Home" && e.key !== "ArrowUp") return;
      // Only a key that scrolls the transcript counts: not while typing, nor
      // inside a menu, listbox, dialog or editable region, where the key
      // moves a selection or the caret.
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          'textarea, input, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="dialog"], [role="tablist"], [role="slider"]',
        )
      ) {
        return;
      }
      if (canScrollUp()) setBottomFollow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canScrollUp reads refs only
  }, [setBottomFollow]);

  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_FOLLOW_THRESHOLD;
  };
  const jumpToLatest = () => {
    setBottomFollow(true);
    setTranscriptWindow({ key: transcriptKey, start: tailStart, end: null });
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: scrollMotion() });
    });
  };

  // For the scrolling element, next to ref={scrollRef}.
  const scrollHandlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      // grabbing the scrollbar is a scroll gesture too — the lane lives
      // past the content box (clientWidth excludes it)
      const el = scrollRef.current;
      if (el && e.target === el && e.nativeEvent.offsetX >= el.clientWidth) setBottomFollow(false);
    },
    onWheel: (e: WheelEvent<HTMLDivElement>) => {
      // A real upward move: not a mostly horizontal swipe, not momentum noise,
      // not a nested scroller (code block, table) that can still move up.
      if (e.deltaY < -1 && Math.abs(e.deltaY) >= Math.abs(e.deltaX) && !nestedCanScrollUp(e.target, scrollRef.current)) {
        // Still resting on the bottom: only a real upward move detaches.
        // A small delta there is bounce, and follow must stay so the next
        // line does not open above the fold.
        if (canScrollUp() && (!atEnd() || e.deltaY <= -UPWARD_WHEEL_DETACH)) setBottomFollow(false);
        const el = scrollRef.current;
        if (el && el.scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
          triggerAutoEarlier();
        }
      } else if (atEnd()) {
        setBottomFollow(true);
      }
    },
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => {
      touchY.current = e.touches[0]?.clientY ?? 0;
    },
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY.current + 4) {
        if (canScrollUp() && !nestedCanScrollUp(e.target, scrollRef.current)) setBottomFollow(false);
        const el = scrollRef.current;
        if (el && el.scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
          triggerAutoEarlier();
        }
      } else if (atEnd()) {
        setBottomFollow(true);
      }
    },
    onScroll: () => {
      const el = scrollRef.current;
      if (!el) return;
      const scrollTop = el.scrollTop;
      const prevScrollTop = previousScrollTop.current;
      const resume = shouldResumeBottomFollow({
        following: followRef.current,
        previousScrollTop: previousScrollTop.current,
        scrollTop,
        distanceFromBottom: el.scrollHeight - scrollTop - el.clientHeight,
      });
      previousScrollTop.current = scrollTop;
      // At the rest position with follow off (stale state): arm it again. No
      // scroll is issued, so this never moves the viewport.
      const atRest = el.scrollHeight - scrollTop - el.clientHeight < BOTTOM_FOLLOW_THRESHOLD;
      // The pixels moved up, off the bottom. A wheel that never leaves the
      // rest position must not detach follow; this does, once they have.
      if (followRef.current && scrollTop + 1 < prevScrollTop && !atRest) {
        setBottomFollow(false);
      } else if (resume || (!followRef.current && atRest && scrollTop >= prevScrollTop)) {
        setBottomFollow(true);
      } else if (!followRef.current && scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
        triggerAutoEarlier();
      }
    },
  };

  return {
    scrollRef,
    transcriptRef,
    topSentinelRef,
    transcriptKey,
    following: follow,
    /** Read outside render (an observer callback): whether the pane follows the bottom. */
    followRef,
    /** Stop following the bottom: a jump the caller makes itself (the single
     * stream's earlier topics) must not be pulled back by the next growth. */
    stopFollowing: () => setBottomFollow(false),
    windowedMessages,
    hiddenCount,
    laterCount,
    olderPending,
    hasEarlier: hiddenCount > 0 || Boolean(hasMore),
    showEarlier,
    showLater,
    loadOlder,
    jumpToLatest,
    scrollHandlers,
  };
}
