import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { TeamMapSection } from "@/lib/team-map";
import { COMPUTER_DRAG_TYPE, fitTeams, layoutTeams, loadTeamCanvasLayout, orderBots, parseBotOrders, parsePositions, reorderBot, teamCanvasKeys, wheelCanvasDelta, zoomAt, type Point, type TeamCanvasKeys, type View } from "@/lib/team-canvas";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { fetchEnvironmentDescriptor } from "@/lib/environment-descriptor";
import { readableError } from "@/lib/plain-error";
import { TeamCanvasOverlay } from "./TeamCanvas.tsx-parts/TeamCanvasOverlay";
import { TeamSectionsLayer } from "./TeamCanvas.tsx-parts/TeamSectionsLayer";

type Gesture = {
  id: number;
  start: Point;
  view: View;
  positions: Record<string, Point>;
  moved: boolean;
} & ({ kind: "pan" } | { kind: "team"; key: string; origin: Point } | { kind: "bot"; bot: Bot });

export function TeamCanvas({ sections, canManage, onMove, onInstructions, onMemory, onEditTeam, onDeleteTeam, onComputer, onComputerDrop, onTeamComputer, teamComputers = {}, connectedBotIds = [] }: {
  sections: TeamMapSection<Bot>[];
  canManage: boolean;
  onMove: (bot: Bot, destination: string) => Promise<boolean | void>;
  onInstructions: (key: string, label: string) => void;
  onMemory?: (key: string, label: string) => void;
  onEditTeam: (section: string, rename?: boolean) => void;
  onDeleteTeam: (section: string) => void;
  isEmpty: (section: string) => boolean;
  onComputer?: (bot: Bot) => void;
  onComputerDrop?: (resourceId: string, sectionKey: string) => void;
  onTeamComputer?: (sectionKey: string) => void;
  teamComputers?: Record<string, { name: string; state?: string }>;
  connectedBotIds?: string[];
}) {
  const { state } = useStore();
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const keyboardFocus = useRef(false);
  const spaceHeld = useRef(false);
  const storageKeys = useRef<TeamCanvasKeys | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [botOrders, setBotOrders] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<View>({ x: 40, y: 40, scale: 1 });
  const [dragged, setDragged] = useState<{ bot: Bot; point: Point } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [computerDropKey, setComputerDropKey] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<{ botId: string; after: boolean } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [menuAbove, setMenuAbove] = useState<string | null>(null);
  const tiles = useMemo(() => layoutTeams(sections, positions), [sections, positions]);
  const current = useRef({ view, positions, tiles, selectedId: state.selectedId, settingsOpen: state.settingsOpen });
  current.current = { view, positions, tiles, selectedId: state.selectedId, settingsOpen: state.settingsOpen };

  // Layout is personal presentation, not team configuration. Key it to the
  // workspace's identity so switching hosted workspaces never shares a layout;
  // on an organization server it is the person's own and follows them to
  // every device (team-canvas.ts loadTeamCanvasLayout).
  useEffect(() => {
    let active = true;
    const environment = fetchEnvironmentDescriptor({ signal: AbortSignal.timeout(5_000) }).then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));
    void Promise.all([environment, loadPerspicaxOrg()]).then(([environment, org]) => {
      if (!active || typeof environment.environmentId !== "string") return;
      try {
        const layout = loadTeamCanvasLayout(localStorage, environment.environmentId, org !== null);
        storageKeys.current = layout.keys;
        setPositions((previous) => ({ ...layout.positions, ...previous }));
        setBotOrders(layout.botOrders);
      } catch {
        storageKeys.current = teamCanvasKeys(environment.environmentId, org !== null);
        /* Private browsing may disable storage; the canvas still works. */
      }
    }).catch(() => { /* Older companions can use the canvas without persistence. */ }).finally(() => { if (active) setLayoutLoaded(true); });
    return () => { active = false; };
  }, []);
  // The same layout changed on another of the person's devices.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const keys = storageKeys.current;
      if (!keys) return;
      try {
        if (event.key === null || event.key === keys.positions) setPositions(parsePositions(localStorage.getItem(keys.positions)));
        if (event.key === null || event.key === keys.botOrder) setBotOrders(parseBotOrders(localStorage.getItem(keys.botOrder)));
      } catch { /* storage refused: the canvas keeps what it shows */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const savePositions = (next: Record<string, Point>) => {
    setPositions(next);
    if (!storageKeys.current) return;
    try {
      localStorage.setItem(storageKeys.current.positions, JSON.stringify(Object.fromEntries(sections
        .filter((section) => Object.hasOwn(next, section.key)).map((section) => [section.key, next[section.key]]))));
    } catch { /* A full/disabled store must not prevent arranging teams. */ }
  };
  const personalOrder = (key: string) => Object.hasOwn(botOrders, key) ? botOrders[key] : [];
  const saveBotOrder = (section: TeamMapSection<Bot>, lane: Bot[], bot: Bot, index: number) => {
    const next = { ...botOrders, [section.key]: [
      ...reorderBot(lane, bot.id, index),
      ...orderBots(bot.chiefOfStaff ? section.members : section.chiefs, personalOrder(section.key)).map((item) => item.id),
    ] };
    setBotOrders(next);
    if (storageKeys.current) {
      try { localStorage.setItem(storageKeys.current.botOrder, JSON.stringify(next)); }
      catch { /* Personal ordering remains usable when browser storage is unavailable. */ }
    }
    setAnnouncement(t("canvas.arrangedBot", { name: bot.name, team: section.key ? section.name : t("sidebar.section.general") }));
  };
  const arrangeBot = (bot: Bot, delta: number) => {
    const section = sections.find((item) => item.key === (bot.section?.trim() ?? ""));
    if (!section) return;
    const lane = orderBots(bot.chiefOfStaff ? section.chiefs : section.members, personalOrder(section.key));
    saveBotOrder(section, lane, bot, lane.findIndex((item) => item.id === bot.id) + delta);
  };
  const fit = useCallback(() => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds) setView(fitTeams(current.current.tiles, bounds.width, bounds.height));
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let previousSize: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      if (!previousSize) fit();
      else {
        const card = current.current.settingsOpen ? [...element.querySelectorAll<HTMLElement>("[data-bot-id]")]
          .find((node) => node.dataset.botId === current.current.selectedId)?.getBoundingClientRect() : undefined;
        const dx = card ? bounds.width / 2 - (card.left - bounds.left + card.width / 2) : (bounds.width - previousSize.width) / 2;
        const dy = card ? bounds.height / 2 - (card.top - bounds.top + card.height / 2) : (bounds.height - previousSize.height) / 2;
        setView((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
      }
      previousSize = { width: bounds.width, height: bounds.height };
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
  // Fit membership changes too: a growing team can push later rows outside
  // the view. Ordinary status updates and manual arranging never trigger this.
  const teamSizes = JSON.stringify(tiles.map(({ key, width, height }) => [key, width, height]));
  useEffect(() => { fit(); }, [fit, teamSizes, layoutLoaded]);
  useEffect(() => {
    const open = viewport.current?.querySelector<HTMLDetailsElement>("details[open]");
    const bounds = viewport.current?.getBoundingClientRect();
    if (open && bounds) setMenuAbove(open.getBoundingClientRect().bottom > bounds.bottom - 210 * view.scale
      ? open.closest<HTMLElement>("[data-team-key]")?.dataset.teamKey ?? null : null);
  }, [view, teamSizes]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("details[open]")) return;
      event.preventDefault();
      if (gesture.current) return;
      const previous = current.current.view;
      const bounds = element.getBoundingClientRect();
      const delta = wheelCanvasDelta(event, bounds.height);
      if (delta.kind === "zoom") {
        const scale = Math.min(1.5, Math.max(0.3, previous.scale * delta.factor));
        setView(zoomAt(previous, scale, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }));
        return;
      }
      setView({ ...previous, x: previous.x - delta.dx, y: previous.y - delta.dy });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const clearTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) selection.removeAllRanges();
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || gesture.current) return;
    const middle = event.button === 1;
    const left = event.button === 0;
    if (!middle && !left) return;
    const forcePan = middle || spaceHeld.current;
    if (forcePan) {
      // Middle-click autoscroll and Space+drag must not select text or activate controls.
      event.preventDefault();
      clearTextSelection();
    }
    const element = event.target as HTMLElement;
    if (forcePan) {
      const common = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, view, positions, moved: false };
      gesture.current = { ...common, kind: "pan" };
      suppressClick.current = false;
      return;
    }
    const botId = element.closest<HTMLElement>("[data-bot-id]")?.dataset.botId;
    const teamKey = element.closest<HTMLElement>("[data-arrange-team]")?.dataset.arrangeTeam;
    const bot = botId ? sections.flatMap((section) => [...section.chiefs, ...section.members]).find((item) => item.id === botId) : undefined;
    if (!bot && teamKey === undefined && element.closest("button, details, a, input, [data-team-key]")) return;
    if (bot && (moving || !layoutLoaded)) return;
    if (teamKey !== undefined && !layoutLoaded) return;
    // Empty-space pan: stop the browser from selecting card text under the drag.
    if (!bot && teamKey === undefined) {
      event.preventDefault();
      clearTextSelection();
    }
    const common = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, view, positions, moved: false };
    const tile = teamKey === undefined ? undefined : tiles.find((item) => item.key === teamKey);
    gesture.current = bot ? { ...common, kind: "bot", bot } : tile ? { ...common, kind: "team", key: tile.key, origin: tile } : { ...common, kind: "pan" };
    suppressClick.current = false;
    // Capture only after the drag threshold, otherwise a simple button click
    // would be retargeted to the canvas and never open settings.
  };
  const destinationAt = (x: number, y: number) => {
    const section = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-team-key]");
    return section && viewport.current?.contains(section) ? section.dataset.teamKey ?? null : null;
  };
  const insertionAt = (bot: Bot, y: number) => {
    const section = sections.find((item) => item.key === (bot.section?.trim() ?? ""));
    if (!section) return null;
    const lane = orderBots(bot.chiefOfStaff ? section.chiefs : section.members, personalOrder(section.key));
    const remaining = lane.filter((item) => item.id !== bot.id);
    const cards = [...(viewport.current?.querySelectorAll<HTMLElement>("[data-bot-id]") ?? [])];
    const index = remaining.findIndex((item) => {
      const card = cards.find((node) => node.dataset.botId === item.id);
      // a card held off screen (#2791) carries its id on its own box
      const bounds = (card?.closest("article") ?? card)?.getBoundingClientRect();
      return bounds ? y < bounds.top + bounds.height / 2 : false;
    });
    return { section, lane, remaining, index: index < 0 ? remaining.length : index };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    if (event.buttons === 0) { finish(event, true); return; }
    const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    if (!active.moved) {
      // Crossing the drag threshold: kill any native text selection so the
      // next pan is not blocked by a lingering selection drag.
      event.preventDefault();
      clearTextSelection();
    }
    active.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (active.kind === "pan") {
      setIsPanning(true);
      setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
    }
    if (active.kind === "team") setPositions({ ...active.positions, [active.key]: { x: active.origin.x + dx / view.scale, y: active.origin.y + dy / view.scale } });
    if (active.kind === "bot") {
      const bounds = event.currentTarget.getBoundingClientRect();
      setDragged({ bot: active.bot, point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
      const destination = destinationAt(event.clientX, event.clientY);
      const sameTeam = destination === (active.bot.section?.trim() ?? "");
      setDropKey(sameTeam || canManage ? destination : null);
      const position = sameTeam ? insertionAt(active.bot, event.clientY) : null;
      const anchor = position?.remaining[position.index] ?? position?.remaining.at(-1);
      setInsertion(position && anchor ? { botId: anchor.id, after: position.index === position.remaining.length } : null);
    }
  };
  const finish = (event?: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = gesture.current;
    if (!active || (event && active.id !== event.pointerId)) return;
    gesture.current = null;
    suppressClick.current = active.moved;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    setIsPanning(false);
    setDragged(null);
    setDropKey(null);
    setInsertion(null);
    if (viewport.current?.hasPointerCapture(active.id)) viewport.current.releasePointerCapture(active.id);
    if (cancelled) { setPositions(active.positions); setView(active.view); return; }
    if (!active.moved) return;
    if (active.kind === "team" && event) savePositions({ ...active.positions, [active.key]: {
      x: active.origin.x + (event.clientX - active.start.x) / active.view.scale,
      y: active.origin.y + (event.clientY - active.start.y) / active.view.scale,
    } });
    if (active.kind === "bot" && event) {
      const destination = destinationAt(event.clientX, event.clientY);
      if (destination === null) return;
      if (destination === (active.bot.section?.trim() ?? "")) {
        const position = insertionAt(active.bot, event.clientY);
        if (position) saveBotOrder(position.section, position.lane, active.bot, position.index);
        return;
      }
      if (!canManage) return;
      setMoving(active.bot.id);
      setAnnouncement(t("canvas.reviewMove", { name: active.bot.name, team: destination || t("settings.section.general") }));
      void onMove(active.bot, destination).then((moved) => {
        setAnnouncement(moved === false ? t("canvas.moveCancelled") : t("canvas.moved", { name: active.bot.name, team: destination || t("settings.section.general") }));
      }).catch((error: unknown) => {
        setAnnouncement(readableError(error));
      }).finally(() => setMoving(null));
    }
  };
  const zoom = (factor: number) => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds) setView(zoomAt(view, Math.max(0.3, Math.min(1.5, view.scale * factor)), { x: bounds.width / 2, y: bounds.height / 2 }));
  };
  const dropSection = sections.find((section) => section.key === dropKey);
  const dropHint = computerDropKey !== null ? t("canvas.assignComputer", { team: sections.find((section) => section.key === computerDropKey)?.name ?? computerDropKey })
    : dragged && dropSection ? (dragged.bot.section?.trim() ?? "") === dropSection.key
      ? t("canvas.arrangeBot", { name: dragged.bot.name, team: dropSection.name }) : t("canvas.moveBot", { name: dragged.bot.name, team: dropSection.name })
      : null;

  return <div ref={viewport} role="region" aria-label={t("canvas.region")} tabIndex={0} data-team-canvas data-virtual-root="both"
    className={cn("relative min-h-0 flex-1 touch-none select-none overflow-clip outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40",
      spacePan && !isPanning && "cursor-grab", isPanning && "cursor-grabbing")}
    style={{ backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-ink-secondary) 18%, transparent) 1px, transparent 1px)", backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    onPointerDown={start} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
    onDragStart={(event) => event.preventDefault()}
    onDragOver={(event) => {
      if (!canManage || !onComputerDrop || !event.dataTransfer.types.includes(COMPUTER_DRAG_TYPE)) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-team-key]");
      const key = target && event.currentTarget.contains(target) ? target.dataset.teamKey ?? null : null;
      setComputerDropKey(key);
      if (key !== null) { event.preventDefault(); event.dataTransfer.dropEffect = "link"; }
    }}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setComputerDropKey(null);
    }}
    onDrop={(event) => {
      setComputerDropKey(null);
      if (!canManage || !onComputerDrop || !event.dataTransfer.types.includes(COMPUTER_DRAG_TYPE)) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-team-key]");
      const key = target && event.currentTarget.contains(target) ? target.dataset.teamKey : undefined;
      const resourceId = event.dataTransfer.getData(COMPUTER_DRAG_TYPE);
      if (key === undefined || !sections.some((section) => section.key === key) || !resourceId) return;
      event.preventDefault();
      onComputerDrop(resourceId, key);
    }}
    onDragEnd={() => setComputerDropKey(null)}
    onPointerDownCapture={(event) => {
      keyboardFocus.current = false;
      if (!(event.target as HTMLElement).closest("details")) event.currentTarget.querySelectorAll("details[open]").forEach((element) => element.removeAttribute("open"));
    }}
    onKeyDownCapture={(event) => { if (event.key === "Tab") keyboardFocus.current = true; }}
    onPointerLeave={() => { if (gesture.current && !gesture.current.moved) finish(undefined, true); }}
    onLostPointerCapture={() => { if (gesture.current) finish(undefined, true); }}
    onFocusCapture={(event) => {
      if (!keyboardFocus.current || !(event.target instanceof HTMLElement) || !event.target.closest("[data-canvas-world]")) return;
      const bounds = event.currentTarget.getBoundingClientRect(), target = event.target.getBoundingClientRect();
      const dx = target.left < bounds.left + 16 ? bounds.left + 16 - target.left : target.right > bounds.right - 16 ? bounds.right - 16 - target.right : 0;
      const dy = target.top < bounds.top + 16 ? bounds.top + 16 - target.top : target.bottom > bounds.bottom - 70 ? bounds.bottom - 70 - target.bottom : 0;
      if (dx || dy) setView((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
    }}
    onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
    onBlur={() => { spaceHeld.current = false; setSpacePan(false); }}
    onKeyUp={(event) => {
      if (event.code !== "Space") return;
      spaceHeld.current = false;
      setSpacePan(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { finish(undefined, true); event.currentTarget.querySelectorAll("details[open]").forEach((element) => {
        element.querySelector("summary")?.focus({ preventScroll: true });
        element.removeAttribute("open");
      }); }
      if (event.target !== event.currentTarget) return;
      // Space+drag pans like design tools; only when the canvas shell is focused
      // so Space still activates a focused card button.
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat && !spaceHeld.current) {
          spaceHeld.current = true;
          setSpacePan(true);
        }
        return;
      }
      const directions: Record<string, Point> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } };
      const delta = directions[event.key];
      if (delta) { event.preventDefault(); setView({ ...view, x: view.x + delta.x, y: view.y + delta.y }); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
      if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
      if (event.key === "0") { event.preventDefault(); fit(); }
    }}>
    <div data-canvas-world className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <TeamSectionsLayer
        sections={sections}
        tiles={tiles}
        view={view}
        positions={positions}
        layoutLoaded={layoutLoaded}
        canManage={canManage}
        selectedId={state.selectedId}
        settingsOpen={state.settingsOpen}
        dragged={dragged}
        moving={moving}
        connectedBotIds={connectedBotIds}
        computerDropKey={computerDropKey}
        dropKey={dropKey}
        dropHint={dropHint}
        insertion={insertion}
        teamComputers={teamComputers}
        menuAbove={menuAbove}
        setMenuAbove={setMenuAbove}
        viewport={viewport}
        personalOrder={personalOrder}
        savePositions={savePositions}
        arrangeBot={layoutLoaded ? arrangeBot : undefined}
        onComputer={onComputer}
        onTeamComputer={onTeamComputer}
        onEditTeam={onEditTeam}
        onInstructions={onInstructions}
        onMemory={onMemory}
        onDeleteTeam={onDeleteTeam}
      />
    </div>
    <TeamCanvasOverlay dragged={dragged} dropHint={dropHint} announcement={announcement} view={view} zoom={zoom} fit={fit} />
  </div>;
}
