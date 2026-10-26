// Dev context pods: stacked cards in the chat's top-right corner while a bot
// works as a developer (Settings > Experimental, off by default).
//
// A pure overlay: the transcript keeps its centered column, width and
// padding whether the pods show or not. They sit in the free gutter right of
// the column when it is wide enough; otherwise they hide and the header
// button (DevPodsToggle) floats them over the transcript until Escape or a
// click elsewhere. They never reach the composer: the stack scrolls inside
// the room above it.
import "./dev-pods.css";
import "./all-pods";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode } from "react";
import { CodeXml } from "lucide-react";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effectivePlace, isComputerPlace } from "@/lib/place";
import type { ComputerStart } from "@/lib/computer-start";
import type { Action, Bot, Message } from "@/state/store";
import { DEV_MODE_OFF, DEV_WINDOW, devModeStep, devSignals, type DevModeState } from "./detector";
import { DevPod } from "./PodCard";
import { arrangePods, devPodDefinitions, devPodsVersion, subscribeDevPods, type DevPodContext } from "./registry";
import {
  movePod,
  setPodCollapsed,
  setPodHidden,
  markAutoFloated,
  setRailHidden,
  setThreadDismissed,
  showAllPods,
  updateDevPodsLive,
  useDevPodPrefs,
  useDevPodsLive,
} from "./prefs";

/** The transcript column (ChatView: max-w-[960px] inside px-5). */
export const TRANSCRIPT_MAX = 960;
export const TRANSCRIPT_PAD = 20;
export const RAIL_MAX = 300;
export const RAIL_MIN = 248;
/** From the pane's right edge, and the header's bottom. */
export const RAIL_EDGE = 16;
/** Kept clear between the transcript column and the rail. */
export const RAIL_GAP = 16;
/** The floating header's height (ChatView: min-h-[52px]). */
export const HEADER_HEIGHT = 52;
const EXIT_MS = 220;

/** Whether the rail fits in the gutter right of the centered transcript of
 * a pane this wide, and how wide it is drawn. */
export function railGeometry(paneWidth: number): { fits: boolean; width: number } {
  const transcript = Math.min(TRANSCRIPT_MAX, Math.max(0, paneWidth - 2 * TRANSCRIPT_PAD));
  const gutter = (paneWidth - transcript) / 2;
  const room = gutter - RAIL_EDGE - RAIL_GAP;
  if (room >= RAIL_MIN) return { fits: true, width: Math.floor(Math.min(RAIL_MAX, room)) };
  return { fits: false, width: Math.floor(Math.min(RAIL_MAX, Math.max(0, paneWidth - 2 * RAIL_EDGE))) };
}

/** Puts a card in the side-card column: the rail's right edge and width
 * (`railGeometry` of the pane), whether the rail is on screen or not. Its
 * own width is the pane's (the composer dock spans it), so the card above
 * the composer ("This run") lines up with the pods at the top. */
export function RailAligned({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setPaneWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const width = paneWidth > 0 ? railGeometry(paneWidth).width : RAIL_MAX;
  return (
    <div ref={ref} data-rail-aligned="" className={cn("flex justify-end", className)} style={{ paddingRight: RAIL_EDGE }}>
      <div className="flex min-w-0 max-w-full" style={{ width }}>{children}</div>
    </div>
  );
}

const devModes = new Map<string, { state: DevModeState; evaluated: string }>();
/** Per conversation, the person's last request for the coding view already
 * acted on. */
const revealed = new Map<string, string>();
/** A request older than this (scrollback, a reload) only counts as a signal. */
const REVEAL_FRESH_MS = 5 * 60_000;

/** The hysteresis for one conversation, stepped once per new transcript
 * state (not per render), kept across thread switches. */
function useDevMode(threadKey: string, score: number, evaluation: string, off = false): boolean {
  const entry = devModes.get(threadKey) ?? { state: DEV_MODE_OFF, evaluated: "" };
  if (entry.evaluated !== evaluation) {
    // the person asked for it off: at once, not after the quiet streak
    const next = { state: off ? DEV_MODE_OFF : devModeStep(entry.state, score), evaluated: evaluation };
    devModes.set(threadKey, next);
    return next.state.active;
  }
  return entry.state.active;
}

/** Stays true for `ms` after `value` turns false, so the exit can play. */
function useHeld(value: boolean, ms: number): boolean {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) {
      setHeld(true);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return value || held;
}

export function threadKeyOf(bot: Pick<Bot, "id" | "threadId">): string {
  return `${bot.id}:${bot.threadId}`;
}

/** The single mount in ChatView, inside the messages pane. Nothing at all
 * while the Experimental switch is off. */
export interface DevPodsProps {
  bot: Bot;
  messages: readonly Message[];
  composerHeight: number;
  /** The bot's computer while it starts for a turn (state.computerStarts). */
  computerStart: ComputerStart | undefined;
  dispatch: Dispatch<Action>;
}

export function DevPods(props: DevPodsProps) {
  const prefs = useDevPodPrefs();
  useEffect(() => {
    if (!prefs.enabled) updateDevPodsLive({ active: false, filled: false, overlayOpen: false, overlaySticky: false });
  }, [prefs.enabled]);
  if (!prefs.enabled) return null;
  return <DevPodsRail {...props} />;
}

function DevPodsRail({ bot, messages, composerHeight, computerStart, dispatch }: DevPodsProps) {
  const prefs = useDevPodPrefs();
  const live = useDevPodsLive();
  const threadKey = threadKeyOf(bot);
  const task = bot.tasks?.find((entry) => entry.threadId === bot.threadId);

  const computerActive = useMemo(() => {
    if (computerStart) return true;
    if (!isComputerPlace(effectivePlace(bot, task))) return false;
    return messages.slice(-DEV_WINDOW).some((message) => message.kind === "screen");
  }, [computerStart, bot, task, messages]);
  const signals = useMemo(() => devSignals({ messages, computerActive }), [messages, computerActive]);
  const last = messages.at(-1);
  const active = useDevMode(threadKey, signals.score, `${messages.length}:${last?.id ?? ""}:${last?.tool?.ok ?? ""}:${computerActive}`, signals.request?.mode === "off");
  const mounted = useHeld(active, EXIT_MS);

  const version = useSyncExternalStore(subscribeDevPods, devPodsVersion, devPodsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const definitions = useMemo(() => devPodDefinitions(), [version]);
  const arranged = useMemo(() => arrangePods(definitions, prefs.order, prefs.hidden), [definitions, prefs.order, prefs.hidden]);
  const ids = useMemo(() => arranged.map((definition) => definition.id), [arranged]);

  // Which pods have something to show, for this conversation only (the
  // pods remount per thread and report again).
  const presenceKey = useRef(threadKey);
  presenceKey.current = threadKey;
  const [presence, setPresence] = useState<{ key: string; pods: Record<string, boolean> }>({ key: threadKey, pods: {} });
  const onPresence = useCallback((id: string, present: boolean) => {
    setPresence((current) => {
      const key = presenceKey.current;
      if (current.key !== key) return { key, pods: { [id]: present } };
      return current.pods[id] === present ? current : { key, pods: { ...current.pods, [id]: present } };
    });
  }, []);
  const filled = presence.key === threadKey && arranged.some((definition) => presence.pods[definition.id]);

  // The pane's size and where it starts under the floating header.
  const anchor = useRef<HTMLSpanElement>(null);
  const [pane, setPane] = useState({ width: 0, height: 0, top: 0 });
  useLayoutEffect(() => {
    const node = anchor.current?.parentElement;
    if (!node) return;
    const measure = () => setPane((current) => {
      const next = { width: node.clientWidth, height: node.clientHeight, top: node.offsetTop };
      return next.width === current.width && next.height === current.height && next.top === current.top ? current : next;
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);
  const geometry = railGeometry(pane.width);
  const top = Math.max(RAIL_EDGE, HEADER_HEIGHT + RAIL_EDGE - pane.top);
  const maxHeight = Math.max(0, pane.height - top - composerHeight - RAIL_EDGE);

  useEffect(() => {
    updateDevPodsLive({ threadKey, active, filled, fits: geometry.fits });
  }, [threadKey, active, filled, geometry.fits]);
  // a floated stack never follows the person to another conversation
  useEffect(() => { updateDevPodsLive({ overlayOpen: false, overlaySticky: false }); }, [threadKey]);
  useEffect(() => () => updateDevPodsLive({ active: false, filled: false, overlayOpen: false, overlaySticky: false }), []);

  // The person just asked for the coding view: show it even where it was
  // dismissed, hidden from the header, or would wait behind the header
  // button on a narrow window. Once per request, and never for an old one
  // found in scrollback.
  const request = signals.request;
  useEffect(() => {
    if (!request || request.mode !== "on" || !active || !filled) return;
    if (revealed.get(threadKey) === request.id) return;
    revealed.set(threadKey, request.id);
    if (Date.now() - request.at > REVEAL_FRESH_MS) return;
    setThreadDismissed(threadKey, false);
    if (geometry.fits) setRailHidden(false);
    else {
      markAutoFloated(threadKey);
      updateDevPodsLive({ overlayOpen: true, overlaySticky: true });
    }
  }, [request, active, filled, threadKey, geometry.fits]);

  // The first activation of a conversation on a window too narrow for the
  // rail: the pods float open by themselves, like the header button does.
  // Closed there (Escape, a click elsewhere, the header button), they stay
  // closed for that conversation until the person asks.
  const autoFloated = prefs.autoFloated.includes(threadKey);
  const dismissedHere = prefs.dismissed.includes(threadKey);
  const measured = pane.width > 0 && maxHeight > 0;
  useEffect(() => {
    if (!active || !filled || !measured || geometry.fits || autoFloated || dismissedHere) return;
    markAutoFloated(threadKey);
    updateDevPodsLive({ overlayOpen: true, overlaySticky: true });
  }, [active, filled, measured, geometry.fits, autoFloated, dismissedHere, threadKey]);

  const dismissed = prefs.dismissed.includes(threadKey);
  const overlayOpen = live.threadKey === threadKey && live.overlayOpen && !geometry.fits;
  const open = active && filled && !dismissed && maxHeight > 0 && (geometry.fits ? !prefs.railHidden : overlayOpen);
  const mode = geometry.fits ? "rail" : "overlay";

  const railRef = useRef<HTMLDivElement>(null);
  const sticky = overlayOpen && live.overlaySticky;
  useEffect(() => {
    if (!overlayOpen) return;
    const close = () => updateDevPodsLive({ overlayOpen: false, overlaySticky: false });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => {
      // opened by itself: the person keeps working (the composer, the
      // transcript) with the pods beside them
      if (sticky) return;
      const target = event.target as Element | null;
      if (railRef.current?.contains(target) || target?.closest?.("[data-dev-pods-toggle],[role=menu]")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [overlayOpen, sticky]);

  const ctx: DevPodContext = useMemo(
    () => ({ bot, task, messages, threadKey, computerStart, dispatch }),
    [bot, task, messages, threadKey, computerStart, dispatch],
  );

  if (!mounted) return <span ref={anchor} hidden />;
  return (
    <>
      <span ref={anchor} hidden />
      <div
        ref={railRef}
        data-dev-pods=""
        data-open={open ? "true" : "false"}
        data-mode={mode}
        role="complementary"
        aria-label={t("devPods.rail.aria")}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        className={cn("dev-pods-rail absolute z-[3] flex flex-col gap-3 overflow-y-auto overscroll-contain", open ? "pointer-events-auto" : "pointer-events-none")}
        style={{ right: RAIL_EDGE, top, width: geometry.width, maxHeight }}
      >
        {arranged.map((definition, index) => (
          <DevPod
            key={`${threadKey}:${definition.id}`}
            definition={definition}
            ctx={ctx}
            chrome={{
              collapsed: prefs.collapsed[definition.id] === true,
              onToggleCollapsed: () => setPodCollapsed(definition.id, prefs.collapsed[definition.id] !== true),
              onPresence,
              actions: {
                canMoveUp: index > 0,
                canMoveDown: index < arranged.length - 1,
                onMoveUp: () => movePod(ids, definition.id, -1),
                onMoveDown: () => movePod(ids, definition.id, 1),
                onHide: () => setPodHidden(definition.id, true),
                onDismissThread: () => setThreadDismissed(threadKey, true),
                onShowAll: prefs.hidden.length ? showAllPods : undefined,
              },
            }}
          />
        ))}
      </div>
    </>
  );
}

/** The header button: shows or hides the pods. Only while they have
 * something to show in this conversation. */
export function DevPodsToggle({ bot }: { bot: Pick<Bot, "id" | "threadId"> }) {
  const prefs = useDevPodPrefs();
  const live = useDevPodsLive();
  const threadKey = threadKeyOf(bot);
  if (!prefs.enabled || live.threadKey !== threadKey || !live.active || !live.filled) return null;
  const dismissed = prefs.dismissed.includes(threadKey);
  const shown = !dismissed && (live.fits ? !prefs.railHidden : live.overlayOpen);
  const toggle = () => {
    if (dismissed) {
      setThreadDismissed(threadKey, false);
      if (live.fits) setRailHidden(false);
      else updateDevPodsLive({ overlayOpen: true, overlaySticky: false });
      return;
    }
    if (live.fits) setRailHidden(!prefs.railHidden);
    else updateDevPodsLive({ overlayOpen: !live.overlayOpen, overlaySticky: false });
  };
  const label = shown ? t("devPods.toggle.hide") : t("devPods.toggle.show");
  return (
    <button
      type="button"
      data-dev-pods-toggle=""
      aria-pressed={shown}
      aria-label={label}
      title={label}
      onClick={toggle}
      className={cn(CIRCLE_BUTTON, shown && "bg-elevated-hover")}
    >
      <CodeXml size={18} strokeWidth={1.75} />
    </button>
  );
}
