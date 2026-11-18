import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Monitor } from "lucide-react";

import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { fetchEnvironmentDescriptor } from "@/lib/environment-descriptor";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { readableError } from "@/lib/plain-error";
import { MAUS_COLORS } from "@/lib/mascot";
import type { TeamMapPair, TeamMapSection } from "@/lib/team-map";
import { botMatches, columnsFor, layoutOrgChart, CARD_H, type OrgBot, type OrgLayout, type OrgSection, type Rect } from "@/lib/team-map-layout";
import { lastHandoffOf, orgState, orgStateLabel, type OrgState } from "@/lib/team-map-format";
import { exportThemeOf, renderTeamMapPng } from "@/lib/team-map-export";
import { loadTeamCanvasLayout, parseBotOrders, reorderBot, teamCanvasKeys, wheelCanvasDelta, zoomAt, type Point, type TeamCanvasKeys, type View } from "@/lib/team-canvas";
import { OrgBotAvatar, OrgCard } from "./OrgCard";
import { POPOVER_W, TeamMapBotPopover } from "./TeamMapBotPopover";
import { TeamMapDetail, type TeamMapDetailScope } from "./TeamMapDetail";
import { TeamMapMiniMap } from "./TeamMapMiniMap";
import { TeamMapMobile } from "./TeamMapMobile";
import { TeamMapToolbar, useSearchShortcut, type StateFilter } from "./TeamMapToolbar";
import { TeamMenu } from "./TeamMenu";

const TOP_RESERVE = 56;
const MIN_FIT_SCALE = 0.75;
const DETAIL_KEY = "sagax.teamMapDetail";
const MINIMAP_KEY = "sagax.teamMapMinimap";
const LARGE = 30;

type Gesture = { id: number; start: Point; view: View; moved: boolean } & ({ kind: "pan" } | { kind: "bot"; bot: Bot });

function readFlag(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeFlag(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage refused: the choice lasts until the page closes */ }
}

export interface TeamMapOrgChartProps {
  sections: TeamMapSection<Bot>[];
  pairs: TeamMapPair[];
  canManage: boolean;
  leadId: string | null;
  onMove: (bot: Bot, destination: string) => Promise<boolean | void>;
  onInstructions: (key: string, label: string) => void;
  onMemory?: (key: string, label: string) => void;
  onEditTeam: (section: string, rename?: boolean) => void;
  onDeleteTeam: (section: string) => void;
  onComputer?: (bot: Bot) => void;
  onTeamComputer?: (sectionKey: string) => void;
  teamComputers?: Record<string, { name: string; state?: string }>;
}

const rectOf = <T extends OrgBot>(layout: OrgLayout<T>, id: string): Rect | null => {
  if (layout.lead?.bot.id === id) return layout.lead;
  for (const block of layout.blocks) { const found = block.bots.find((placed) => placed.bot.id === id); if (found) return found; }
  return layout.tray?.placed.find((placed) => placed.bot.id === id) ?? null;
};

export function TeamMapOrgChart(props: TeamMapOrgChartProps) {
  const { sections, pairs, canManage, leadId, onMove, onInstructions, onMemory, onEditTeam, onDeleteTeam, onComputer, onTeamComputer, teamComputers = {} } = props;
  useSearchShortcut();
  const outer = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const touched = useRef(false);
  const storageKeys = useRef<TeamCanvasKeys | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: TOP_RESERVE, scale: 1 });
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  // One surface per bot: a click opens the popover; the column shows a bot only when it is asked for.
  const [detailBotId, setDetailBotId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [trayOpen, setTrayOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(() => readFlag(DETAIL_KEY) !== "0");
  const [minimapChoice, setMinimapChoice] = useState<"on" | "off" | null>(() => { const v = readFlag(MINIMAP_KEY); return v === "on" || v === "off" ? v : null; });
  const [botOrders, setBotOrders] = useState<Record<string, string[]>>({});
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [dragged, setDragged] = useState<{ bot: Bot; point: Point } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<{ botId: string; after: boolean } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [help, setHelp] = useState(false);

  // The person's own card order (drag to arrange) is presentation, kept where
  // it always was (team-canvas.ts); the team positions are no longer used.
  useEffect(() => {
    let active = true;
    const environment = fetchEnvironmentDescriptor({ signal: AbortSignal.timeout(5_000) }).then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));
    void Promise.all([environment, loadPerspicaxOrg()]).then(([environment, org]) => {
      if (!active || typeof environment.environmentId !== "string") return;
      try {
        const layout = loadTeamCanvasLayout(localStorage, environment.environmentId, org !== null);
        storageKeys.current = layout.keys;
        setBotOrders(layout.botOrders);
      } catch { storageKeys.current = teamCanvasKeys(environment.environmentId, org !== null); }
    }).catch(() => { /* an older companion arranges without keeping it */ }).finally(() => { if (active) setLayoutLoaded(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const keys = storageKeys.current;
      if (!keys) return;
      try { if (event.key === null || event.key === keys.botOrder) setBotOrders(parseBotOrders(localStorage.getItem(keys.botOrder))); } catch { /* storage refused */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const element = outer.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { const box = element.getBoundingClientRect(); setSize({ w: Math.round(box.width), h: Math.round(box.height) }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mobile = size.w > 0 && size.w < 640;
  // The canvas is the area minus the detail column (248 plus its 12 px gutter).
  const vs = { w: size.w - (!mobile && detailOpen ? 260 : 0), h: size.h };

  const allBots = useMemo(() => sections.flatMap((section) => [...section.chiefs, ...section.members]), [sections]);
  const botById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const nameOf = useCallback((id: string) => botById.get(id)?.name, [botById]);
  const lastOf = useCallback((id: string) => lastHandoffOf(id, pairs, nameOf), [pairs, nameOf]);
  const matchesState = useCallback((bot: Bot) => {
    if (stateFilter === "all") return true;
    const state = orgState(bot);
    return stateFilter === "working" ? state === "working" : state === "waiting";
  }, [stateFilter]);
  const counts = useMemo(() => ({
    all: allBots.length,
    working: allBots.filter((bot) => orgState(bot) === "working").length,
    waiting: allBots.filter((bot) => orgState(bot) === "waiting").length,
  }), [allBots]);

  // What the filters leave: the team filter hides other teams, the state filter hides other bots.
  const shownSections = useMemo<OrgSection<Bot>[]>(() => sections
    .filter((section) => teamFilter === null || section.key === teamFilter)
    .map((section) => ({
      ...section,
      chiefs: section.chiefs.filter((bot) => bot.id === leadId || matchesState(bot)),
      members: section.members.filter(matchesState),
    }))
    .filter((section) => stateFilter === "all" || section.chiefs.length + section.members.length > 0), [sections, teamFilter, stateFilter, leadId, matchesState]);
  const visiblePairs = useMemo(() => pairs, [pairs]);
  const columns = columnsFor(vs.w || 900);
  const personalOrder = useCallback((key: string) => (Object.hasOwn(botOrders, key) ? botOrders[key] : []), [botOrders]);
  const compute = useCallback((open: ReadonlySet<string>, tray: boolean) => layoutOrgChart(shownSections, {
    columns, leadId: leadId && shownSections.some((section) => [...section.chiefs, ...section.members].some((bot) => bot.id === leadId)) ? leadId : null,
    pairs: visiblePairs, personalOrder, expanded: open, trayOpen: tray,
  }), [shownSections, columns, leadId, visiblePairs, personalOrder]);
  const layout = useMemo(() => {
    const first = compute(expanded, trayOpen);
    if (!query.trim()) return first;
    // A search that matches a bot behind "+N" or in the tray opens it.
    const open = new Set(expanded);
    let tray = trayOpen;
    for (const block of first.blocks) if (block.ordered.slice(block.bots.length).some((bot) => botMatches(bot, query))) open.add(block.key);
    if (first.tray && first.tray.bots.some((bot) => botMatches(bot, query))) tray = true;
    return open.size === expanded.size && tray === trayOpen ? first : compute(open, tray);
  }, [compute, expanded, trayOpen, query]);

  const selectedBot = selectedBotId ? botById.get(selectedBotId) ?? null : null;
  const searching = query.trim().length > 0;
  const focusId = selectedBotId ?? detailBotId;
  const connectedIds = useMemo(() => new Set(focusId ? pairs.filter((pair) => pair.count > 0 || pair.live).flatMap((pair) => pair.sourceBotId === focusId ? [pair.targetBotId] : pair.targetBotId === focusId ? [pair.sourceBotId] : []) : []), [pairs, focusId]);
  const teamName = useCallback((key: string) => (key ? sections.find((section) => section.key === key)?.name ?? key : t("sidebar.section.general")), [sections]);
  const teamOfBot = useCallback((id: string) => sections.find((section) => [...section.chiefs, ...section.members].some((bot) => bot.id === id))?.key ?? "", [sections]);
  const minimapOn = minimapChoice ? minimapChoice === "on" : allBots.length > LARGE;

  // Fit: the whole chart, never smaller than 75% on open (a large map scrolls).
  const fit = useCallback((floor: number) => {
    if (!vs.w || !vs.h) return;
    // The toolbar floats over the top TOP_RESERVE px; the chart sits under it.
    const availableH = vs.h - TOP_RESERVE - 8;
    const scale = Math.max(floor, Math.min(1, vs.w / layout.width, availableH / layout.height));
    const contentH = layout.height * scale;
    setView({ scale, x: (vs.w - layout.width * scale) / 2, y: TOP_RESERVE + (contentH < availableH ? (availableH - contentH) / 2 : 0) });
  }, [vs.w, vs.h, layout.width, layout.height]);
  const sig = `${Math.round(layout.width)}x${Math.round(layout.height)}:${vs.w}x${vs.h}:${mobile}`;
  useEffect(() => { if (!touched.current) fit(MIN_FIT_SCALE); }, [fit, sig]);
  const fitButton = () => { touched.current = false; fit(0.3); };
  const zoom = (factor: number) => {
    touched.current = true;
    setView((previous) => zoomAt(previous, Math.max(0.3, Math.min(1.5, previous.scale * factor)), { x: vs.w / 2, y: vs.h / 2 }));
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element || mobile) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("[data-team-map-popover], [role=menu], [role=listbox], [data-team-map-toolbar], details[open]")) return;
      event.preventDefault();
      if (gesture.current) return;
      touched.current = true;
      const bounds = element.getBoundingClientRect();
      const delta = wheelCanvasDelta(event, bounds.height);
      setView((previous) => delta.kind === "zoom"
        ? zoomAt(previous, Math.min(1.5, Math.max(0.3, previous.scale * delta.factor)), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
        : { ...previous, x: previous.x - delta.dx, y: previous.y - delta.dy });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [mobile]);

  const saveBotOrder = (block: OrgLayout<Bot>["blocks"][number], bot: Bot, index: number) => {
    const next = { ...botOrders, [block.key]: reorderBot(block.ordered, bot.id, index) };
    setBotOrders(next);
    if (storageKeys.current) { try { localStorage.setItem(storageKeys.current.botOrder, JSON.stringify(next)); } catch { /* ordering stays usable without storage */ } }
    setAnnouncement(t("canvas.arrangedBot", { name: bot.name, team: block.key ? block.name : t("sidebar.section.general") }));
  };
  const arrangeBot = (bot: Bot, delta: number) => {
    const block = layout.blocks.find((item) => item.ordered.some((other) => other.id === bot.id));
    if (!block) return;
    saveBotOrder(block, bot, block.ordered.findIndex((other) => other.id === bot.id) + delta);
  };

  const select = (bot: Bot) => { if (suppressClick.current) return; setSelectedBotId((was) => (was === bot.id ? null : bot.id)); setSelectedTeam(null); setDetailBotId(null); };
  const closeSelection = () => { setSelectedBotId(null); setSelectedTeam(null); setDetailBotId(null); };

  // Pointer: a drag on a card arranges it or moves it to another team; a drag on empty space pans.
  const destinationAt = (x: number, y: number) => {
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-team-key]");
    return node && viewport.current?.contains(node) ? node.dataset.teamKey ?? null : null;
  };
  const insertionAt = (bot: Bot, y: number) => {
    const block = layout.blocks.find((item) => item.ordered.some((other) => other.id === bot.id));
    if (!block) return null;
    const remaining = block.bots.filter((placed) => placed.bot.id !== bot.id);
    const index = remaining.findIndex((placed) => {
      const node = viewport.current?.querySelector<HTMLElement>(`[data-bot-id="${placed.bot.id}"]`);
      const box = node?.getBoundingClientRect();
      return box ? y < box.top + box.height / 2 : false;
    });
    return { block, remaining, index: index < 0 ? remaining.length : index };
  };
  const startGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || gesture.current || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button:not([data-org-card]), a, input, [data-team-map-popover], [data-team-map-minimap], [data-team-map-toolbar]")) return;
    const card = target.closest<HTMLElement>("[data-org-card]");
    const bot = card?.dataset.botId ? botById.get(card.dataset.botId) : undefined;
    if (card && !bot) return;
    if (bot && (moving || !layoutLoaded || bot.id === layout.lead?.bot.id)) return;
    if (!bot) { event.preventDefault(); window.getSelection()?.removeAllRanges(); }
    gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, view, moved: false, ...(bot ? { kind: "bot" as const, bot } : { kind: "pan" as const }) } as Gesture;
    suppressClick.current = false;
  };
  const finish = (event?: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = gesture.current;
    if (!active || (event && active.id !== event.pointerId)) return;
    gesture.current = null;
    suppressClick.current = active.moved;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    setDragged(null); setDropKey(null); setInsertion(null);
    if (viewport.current?.hasPointerCapture(active.id)) viewport.current.releasePointerCapture(active.id);
    if (cancelled) { setView(active.view); return; }
    if (!active.moved) { if (active.kind === "pan") closeSelection(); return; }
    if (active.kind === "bot" && event) {
      const destination = destinationAt(event.clientX, event.clientY);
      if (destination === null) return;
      const home = teamOfBot(active.bot.id);
      if (destination === home) {
        const position = insertionAt(active.bot, event.clientY);
        if (position) saveBotOrder(position.block, active.bot, position.index);
        return;
      }
      if (!canManage) return;
      setMoving(active.bot.id);
      setAnnouncement(t("canvas.reviewMove", { name: active.bot.name, team: destination ? teamName(destination) : t("settings.section.general") }));
      void onMove(active.bot, destination).then((moved) => {
        setAnnouncement(moved === false ? t("canvas.moveCancelled") : t("canvas.moved", { name: active.bot.name, team: destination ? teamName(destination) : t("settings.section.general") }));
      }).catch((error: unknown) => setAnnouncement(readableError(error))).finally(() => setMoving(null));
    }
  };
  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    if (event.buttons === 0) { finish(event, true); return; }
    const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    if (!active.moved) { event.preventDefault(); window.getSelection()?.removeAllRanges(); }
    active.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (active.kind === "pan") { touched.current = true; setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy }); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    setDragged({ bot: active.bot, point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
    const destination = destinationAt(event.clientX, event.clientY);
    const same = destination === teamOfBot(active.bot.id);
    setDropKey(same || canManage ? destination : null);
    const position = same ? insertionAt(active.bot, event.clientY) : null;
    const anchor = position?.remaining[position.index] ?? position?.remaining.at(-1);
    setInsertion(position && anchor ? { botId: anchor.bot.id, after: position.index === position.remaining.length } : null);
  };

  // Keyboard: arrows walk the bots by where they are, Enter selects, Alt+arrows reorder.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      finish(undefined, true);
      const open = [...(viewport.current?.querySelectorAll("details[open]") ?? [])];
      if (open.length) { open.forEach((element) => { element.querySelector("summary")?.focus({ preventScroll: true }); element.removeAttribute("open"); }); return; }
      closeSelection(); setHelp(false); return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, [role=menu], [role=listbox]")) return;
    const card = target.closest<HTMLElement>("[data-org-card]");
    if (event.altKey && card && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const bot = card.dataset.botId ? botById.get(card.dataset.botId) : undefined;
      if (bot && layoutLoaded) { event.preventDefault(); arrangeBot(bot, event.key === "ArrowUp" ? -1 : 1); }
      return;
    }
    const keys: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const dir = keys[event.key];
    if (dir && card) {
      event.preventDefault();
      const here = card.getBoundingClientRect();
      const cards = [...((viewport.current ?? outer.current)?.querySelectorAll<HTMLElement>("[data-org-card]") ?? [])].filter((node) => node !== card);
      let best: { node: HTMLElement; score: number } | null = null;
      for (const node of cards) {
        const box = node.getBoundingClientRect();
        const dx = box.left + box.width / 2 - (here.left + here.width / 2), dy = box.top + box.height / 2 - (here.top + here.height / 2);
        const along = dir.x * dx + dir.y * dy, across = Math.abs(dir.x * dy - dir.y * dx);
        if (along <= 4) continue;
        const score = along + across * 2.5;
        if (!best || score < best.score) best = { node, score };
      }
      if (best) {
        best.node.focus({ preventScroll: mobile ? false : true });
        if (mobile || !viewport.current) return;
        const box = best.node.getBoundingClientRect(), bounds = viewport.current.getBoundingClientRect();
        const dx = box.left < bounds.left + 16 ? bounds.left + 16 - box.left : box.right > bounds.right - 16 ? bounds.right - 16 - box.right : 0;
        const dy = box.top < bounds.top + TOP_RESERVE + 8 ? bounds.top + TOP_RESERVE + 8 - box.top : box.bottom > bounds.bottom - 16 ? bounds.bottom - 16 - box.bottom : 0;
        if (dx || dy) { touched.current = true; setView((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy })); }
      }
      return;
    }
    if (target !== event.currentTarget && !card) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
    else if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
    else if (event.key === "0") { event.preventDefault(); fitButton(); }
    else if (dir && !card) { event.preventDefault(); touched.current = true; setView((previous) => ({ ...previous, x: previous.x - dir.x * 60, y: previous.y - dir.y * 60 })); }
  };

  const exportImage = async () => {
    try {
      const element = viewport.current;
      if (!element) return;
      const blob = await renderTeamMapPng(layout, {
        theme: exportThemeOf(element), teamName, role: (bot) => bot.title || (bot.chiefOfStaff ? t("chat.chiefOfStaff") : t("canvas.bot")),
        state: (bot) => orgState(bot), color: (bot) => (MAUS_COLORS as Record<string, string>)[bot.color] ?? "#777777",
        fontFamily: getComputedStyle(element).fontFamily,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${t("teamMap.org.exportName")}.png`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch { setAnnouncement(t("teamMap.org.exportFailed")); }
  };

  const toggleExpanded = (key: string) => setExpanded((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const openDetail = () => { setDetailOpen(true); writeFlag(DETAIL_KEY, "1"); };
  const toggleDetail = () => {
    if (detailOpen) { setDetailOpen(false); writeFlag(DETAIL_KEY, "0"); setDetailBotId(null); return; }
    openDetail();
    // Opened from the toolbar with a bot selected: the column takes the bot and the popover closes.
    if (selectedBotId) { setDetailBotId(selectedBotId); setSelectedBotId(null); }
  };
  const showHandoffs = (id: string) => { setDetailBotId(id); setSelectedBotId(null); setSelectedTeam(null); openDetail(); };
  const toggleMinimap = () => { const next = minimapOn ? "off" : "on"; setMinimapChoice(next); writeFlag(MINIMAP_KEY, next); };
  const panTo = (worldX: number, worldY: number) => { touched.current = true; setView((previous) => ({ ...previous, x: vs.w / 2 - worldX * previous.scale, y: (vs.h + TOP_RESERVE) / 2 - worldY * previous.scale })); };

  const detailBot = detailBotId ? botById.get(detailBotId) ?? null : null;
  const scope: TeamMapDetailScope = detailBot ? { kind: "bot", bot: detailBot }
    : selectedTeam !== null ? { kind: "team", key: selectedTeam, name: teamName(selectedTeam), botIds: (layout.blocks.find((block) => block.key === selectedTeam)?.ordered ?? sections.find((section) => section.key === selectedTeam)?.members ?? []).map((bot) => bot.id) }
    : { kind: "busiest" };
  const toolbar = (
    <TeamMapToolbar query={query} onQuery={setQuery}
      teams={sections.map((section) => ({ key: section.key, name: section.key ? section.name : t("sidebar.section.general"), count: section.chiefs.length + section.members.length })).filter((team) => team.key !== "")}
      teamFilter={teamFilter} onTeamFilter={setTeamFilter} stateFilter={stateFilter} onStateFilter={setStateFilter} counts={counts}
      scale={view.scale} onFit={fitButton} onZoom={zoom} detailOpen={detailOpen} onToggleDetail={toggleDetail}
      minimap={minimapOn} onMinimap={toggleMinimap} onExport={() => void exportImage()} onKeyboard={() => setHelp((was) => !was)} compact={mobile} />
  );

  const stateOf = (bot: Bot): OrgState => orgState(bot);
  const dimmed = (bot: Bot) => (searching && !botMatches(bot, query)) || (!searching && focusId !== null && bot.id !== focusId && !connectedIds.has(bot.id));
  const linkDim = (link: OrgLayout<Bot>["links"][number]) => {
    if (!focusId) return false;
    if (link.kind === "bot") return link.fromBot !== focusId && link.toBot !== focusId;
    const home = teamOfBot(focusId);
    return !(home === link.fromKey || home === link.toKey || (link.kind === "lead" && layout.lead?.bot.id === focusId));
  };

  const rect = selectedBotId ? rectOf(layout, selectedBotId) : null;
  const popover = (() => {
    if (!selectedBot || !rect || mobile) return null;
    const POP_H = 200;
    const home = layout.blocks.find((block) => block.ordered.some((bot) => bot.id === selectedBot.id));
    const cardRight = view.x + (rect.x + rect.w) * view.scale, cardLeft = view.x + rect.x * view.scale;
    const mid = view.y + (rect.y + rect.h / 2) * view.scale;
    const top = Math.max(TOP_RESERVE + 4, Math.min(mid - 40, vs.h - POP_H - 12));
    // What the popover would cover: the other teams, the lead and the tray, in screen px.
    const others: Rect[] = [...layout.blocks.filter((block) => block !== home), ...(layout.lead ? [layout.lead] : []), ...(layout.tray ? [layout.tray] : [])]
      .map((item) => ({ x: view.x + item.x * view.scale, y: view.y + item.y * view.scale, w: item.w * view.scale, h: item.h * view.scale }));
    const covered = (left: number) => others.reduce((sum, item) => {
      const w = Math.min(left + POPOVER_W, item.x + item.w) - Math.max(left, item.x), h = Math.min(top + POP_H, item.y + item.h) - Math.max(top, item.y);
      return sum + (w > 0 && h > 0 ? w * h : 0);
    }, 0);
    const rightLeft = Math.min(cardRight + 12, vs.w - 8 - POPOVER_W), leftLeft = Math.max(8, cardLeft - 12 - POPOVER_W);
    // The side with room: the one that covers less of another team, the right on a tie.
    const side: "left" | "right" = covered(leftLeft) < covered(rightLeft) ? "left" : "right";
    return { side, left: side === "right" ? rightLeft : leftLeft, top, arrowTop: Math.max(12, mid - top - 6) };
  })();

  if (mobile) {
    return (
      <div ref={outer} role="region" aria-label={t("canvas.region")} data-team-canvas data-team-map-mobile="" className="relative flex min-h-0 flex-1 flex-col overflow-y-auto" onKeyDown={onKeyDown}>
        {toolbar}
        <TeamMapMobile layout={layout} pairs={pairs} bots={allBots} query={query} selectedBotId={selectedBotId} onSelect={select} stateOf={stateOf} lastOf={lastOf}
          teamName={teamName} dim={dimmed} onComputer={onComputer} onClose={closeSelection} onToggleExpanded={toggleExpanded} onToggleTray={() => setTrayOpen((was) => !was)} />
        {help && <p role="status" className="mx-4 mb-4 rounded-lg bg-panel px-3 py-2 text-[12px] text-ink-secondary">{t("teamMap.org.keyboardHelp")}</p>}
      </div>
    );
  }

  return (
    <div ref={outer} className="flex min-h-0 flex-1">
      <div ref={viewport} role="region" aria-label={t("canvas.region")} tabIndex={0} data-team-canvas data-virtual-root="both"
        className={cn("relative min-h-0 min-w-0 flex-1 touch-none select-none overflow-clip outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40", gesture.current?.moved && gesture.current.kind === "pan" && "cursor-grabbing")}
        style={{ backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-ink-secondary) 18%, transparent) 1px, transparent 1px)", backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
        onDragStart={(event) => event.preventDefault()} onKeyDown={onKeyDown}
        onPointerDownCapture={(event) => { if (!(event.target as HTMLElement).closest("details")) event.currentTarget.querySelectorAll("details[open]").forEach((element) => element.removeAttribute("open")); }}
        onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
        onLostPointerCapture={() => { if (gesture.current) finish(undefined, true); }}>
        <div className="absolute inset-x-4 top-3 z-40">{toolbar}</div>
        <div data-canvas-world className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg width={layout.width} height={layout.height} className="pointer-events-none absolute left-0 top-0 z-10" aria-hidden="true" data-team-map-links="">
            {layout.links.map((link) => {
              const color = link.state === "running" ? "var(--color-success)" : link.state === "queued" ? "var(--color-warning)" : "color-mix(in srgb, var(--color-ink) 42%, transparent)";
              return (
                <g key={link.id} data-link={link.id} data-link-kind={link.kind} data-link-state={link.state} opacity={linkDim(link) ? 0.3 : 1}>
                  <path d={link.path} fill="none" stroke={color} strokeWidth={link.state === "running" ? 2 : 1.5} strokeDasharray={link.reviews ? "5 4" : undefined} strokeLinecap="round" />
                  {link.reviews
                    ? <circle cx={link.end.x} cy={link.end.y} r={3.5} fill="var(--color-app)" stroke={color} strokeWidth={1.5} />
                    : <polygon points="0,0 -8,-4 -8,4" fill={color} transform={`translate(${link.end.x} ${link.end.y}) rotate(${link.end.angle})`} />}
                </g>
              );
            })}
          </svg>
          {layout.links.filter((link) => link.badge).map((link) => (
            <span key={`b:${link.id}`} data-link-badge={link.id} title={t("teamMap.org.linkAria", { from: link.kind === "bot" ? botById.get(link.fromBot!)?.name ?? "" : teamName(link.fromKey), to: link.kind === "bot" ? botById.get(link.toBot!)?.name ?? "" : teamName(link.toKey), count: link.count })}
              className={cn("pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-app px-1.5 text-center text-[11px] font-medium leading-4 tabular-nums",
                link.state === "running" ? "border-success text-success" : "border-hairline text-ink-secondary", linkDim(link) && "opacity-30")}
              style={{ left: link.badge!.x, top: link.badge!.y }}>{link.badge!.text}</span>
          ))}
          {layout.lead && (
            <div className="absolute z-20" style={{ left: layout.lead.x, top: layout.lead.y, width: layout.lead.w, height: layout.lead.h }}>
              <OrgCard bot={layout.lead.bot} lead state={stateOf(layout.lead.bot)} selected={selectedBotId === layout.lead.bot.id} dim={dimmed(layout.lead.bot) && selectedBotId !== layout.lead.bot.id}
                match={searching && botMatches(layout.lead.bot, query)} last={lastOf(layout.lead.bot.id)} onSelect={select} className="h-full w-full" />
            </div>
          )}
          {layout.blocks.map((block) => {
            const section = sections.find((item) => item.key === block.key);
            const label = block.key ? block.name : t("sidebar.section.general");
            const dropping = dragged !== null && dropKey === block.key && teamOfBot(dragged.bot.id) !== block.key;
            const computer = Object.hasOwn(teamComputers, block.key) ? teamComputers[block.key] : undefined;
            const members = block.ordered;
            const summary = { working: members.filter((bot) => orgState(bot) === "working").length, waiting: members.filter((bot) => orgState(bot) === "waiting").length };
            return (
              <section key={block.key} data-team-key={block.key} data-team-depth={section?.depth ?? 0} aria-label={t("canvas.teamRegion", { name: label })}
                className={cn("absolute rounded-2xl border bg-panel", dropping ? "border-accent ring-2 ring-accent/25" : "border-hairline/40", selectedTeam === block.key && "ring-1 ring-accent/40", section?.parent && "border-l-[3px] border-l-accent/40")}
                style={{ left: block.x, top: block.y, width: block.w, height: block.h }}>
                <header className="flex h-11 items-center gap-1.5 px-3">
                  <button type="button" data-team-select={block.key} aria-label={t("teamMap.org.teamHandoffs", { name: label })} onClick={() => { setSelectedTeam(block.key); setSelectedBotId(null); setDetailBotId(null); openDetail(); }}
                    className="flex min-w-0 flex-1 flex-col rounded-md py-0.5 text-left leading-[16px] focus-visible:outline-2 focus-visible:outline-accent">
                    <span className="truncate text-[13px] font-medium text-ink">{label}</span>
                    {section?.parent && <span data-sub-team-of={section.parent} className="truncate text-[11px] text-ink-secondary">{t("team.subTeamOf", { name: section.parent })}</span>}
                  </button>
                  {computer && <button type="button" aria-label={t("canvas.teamComputer", { team: label, name: computer.name })} title={`${computer.name}${computer.state ? ` · ${computer.state}` : ""}`} disabled={!onTeamComputer} onClick={() => onTeamComputer?.(block.key)}
                    className="flex min-w-0 max-w-[70px] shrink items-center gap-1 rounded-md px-1 py-1 text-[11px] text-ink-secondary hover:bg-control hover:text-ink disabled:pointer-events-none"><Monitor size={12} className="shrink-0" /><span className="truncate">{computer.name}</span></button>}
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-secondary" data-team-count={block.total}>
                    {summary.working > 0 && <span className="flex items-center gap-1" title={t("teamMap.org.state.working")}><span className="size-1.5 rounded-full bg-success" />{summary.working}</span>}
                    {summary.waiting > 0 && <span className="flex items-center gap-1" title={t("teamMap.org.state.waiting")}><span className="size-1.5 rounded-full bg-warning" />{summary.waiting}</span>}
                    <span className="tabular-nums text-ink-tertiary">{block.total}</span>
                  </span>
                  {canManage && <TeamMenu sectionKey={block.key} label={label} onEditTeam={onEditTeam} onInstructions={onInstructions} onMemory={onMemory} onDeleteTeam={onDeleteTeam} />}
                </header>
                {dropping && <div className="pointer-events-none absolute -top-7 left-2 z-30 max-w-[calc(100%-16px)] truncate rounded-md bg-accent px-2 py-1 text-[10px] text-accent-ink shadow-sm">{t("canvas.moveBot", { name: dragged!.bot.name, team: label })}</div>}
                {block.total === 0 && <p className="absolute flex items-center justify-center rounded-xl border border-dashed border-hairline/70 px-4 text-center text-[12px] leading-4 text-ink-secondary" style={{ left: 12, top: 44, width: block.w - 24, height: CARD_H }}>{t("canvas.dropHere")}</p>}
                {block.bots.map((placed) => (
                  <div key={placed.bot.id} className="absolute z-[15]" style={{ left: placed.x - block.x, top: placed.y - block.y, width: placed.w, height: placed.h }}>
                    {insertion?.botId === placed.bot.id && <div className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent", insertion.after ? "-bottom-[9px]" : "-top-[9px]")} />}
                    <OrgCard bot={placed.bot} arrangeable state={stateOf(placed.bot)} selected={selectedBotId === placed.bot.id} dim={dimmed(placed.bot)} match={searching && botMatches(placed.bot, query)}
                      connected={connectedIds.has(placed.bot.id)} moving={dragged?.bot.id === placed.bot.id || moving === placed.bot.id} last={lastOf(placed.bot.id)} onSelect={select} className="h-full w-full" />
                  </div>
                ))}
                {block.total > 4 && (
                  <button type="button" data-team-more={block.key} aria-expanded={block.expanded} onClick={() => toggleExpanded(block.key)}
                    className="absolute flex items-center justify-center gap-1 rounded-lg text-[12px] text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                    style={{ left: 12, width: block.w - 24, bottom: 12, height: 24 }}>
                    {block.expanded ? <><ChevronUp size={13} />{t("teamMap.org.showLess")}</> : <>{block.hidden === 1 ? t("teamMap.org.moreBotsOne") : t("teamMap.org.moreBots", { count: block.hidden })}<ChevronDown size={13} /></>}
                  </button>
                )}
              </section>
            );
          })}
          {layout.tray && (
            <section data-team-key="" aria-label={t("teamMap.org.unassignedAria")}
              className={cn("absolute rounded-2xl border border-dashed bg-panel/50", dragged !== null && dropKey === "" && teamOfBot(dragged.bot.id) !== "" ? "border-accent ring-2 ring-accent/25" : "border-hairline")}
              style={{ left: layout.tray.x, top: layout.tray.y, width: layout.tray.w, height: layout.tray.h }}>
              <div className={cn("flex items-center gap-3 px-4 text-[13px]", layout.tray.open ? "h-11" : "h-full")}>
                <button type="button" data-team-tray="" aria-expanded={layout.tray.open} onClick={() => setTrayOpen((was) => !was)} className="flex items-center gap-2 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="font-medium text-ink">{t("sidebar.section.general")}</span><span className="text-[11px] text-ink-tertiary">{layout.tray.bots.length}</span>
                  {layout.tray.open ? <ChevronUp size={14} className="text-ink-tertiary" /> : <ChevronDown size={14} className="text-ink-tertiary" />}
                </button>
                {!layout.tray.open && <div className="flex items-center gap-2">{layout.tray.bots.slice(0, 12).map((bot) => (
                  <button key={bot.id} type="button" data-bot-id={bot.id} data-org-card="" title={`${bot.name} · ${orgStateLabel(stateOf(bot))}`} aria-label={t("canvas.editBot", { name: bot.name })}
                    onClick={() => select(bot)}
                    className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60", searching && botMatches(bot, query) && "ring-2 ring-accent/50", selectedBotId === bot.id && "ring-2 ring-accent")}>
                    <OrgBotAvatar bot={bot} size={28} state={stateOf(bot)} ring="var(--color-panel)" /></button>
                ))}{layout.tray.bots.length > 12 && <span className="text-[11px] text-ink-tertiary">+{layout.tray.bots.length - 12}</span>}</div>}
                {canManage && <span className="ml-auto"><TeamMenu sectionKey="" label={t("sidebar.section.general")} onEditTeam={onEditTeam} onInstructions={onInstructions} onMemory={onMemory} onDeleteTeam={onDeleteTeam} /></span>}
              </div>
              {layout.tray.placed.map((placed) => (
                <div key={placed.bot.id} className="absolute z-[15]" style={{ left: placed.x - layout.tray!.x, top: placed.y - layout.tray!.y, width: placed.w, height: placed.h }}>
                  <OrgCard bot={placed.bot} arrangeable state={stateOf(placed.bot)} selected={selectedBotId === placed.bot.id} dim={dimmed(placed.bot)} match={searching && botMatches(placed.bot, query)}
                    moving={dragged?.bot.id === placed.bot.id || moving === placed.bot.id} last={lastOf(placed.bot.id)} onSelect={select} className="h-full w-full" />
                </div>
              ))}
            </section>
          )}
        </div>
        {selectedBot && popover && (
          <TeamMapBotPopover bot={selectedBot} state={stateOf(selectedBot)} last={lastOf(selectedBot.id)} teamName={teamName(teamOfBot(selectedBot.id))}
            side={popover.side} left={popover.left} top={popover.top} arrowTop={popover.arrowTop} onClose={closeSelection} onComputer={onComputer} onShowHandoffs={() => showHandoffs(selectedBot.id)} />
        )}
        {minimapOn && <TeamMapMiniMap layout={layout} view={view} size={{ w: vs.w, h: vs.h }} onPan={panTo} />}
        {dragged && <div className="pointer-events-none absolute z-50 rounded-xl border border-accent/40 bg-card px-3 py-2 text-[13px] shadow-lg" style={{ left: dragged.point.x + 16, top: dragged.point.y + 16 }}>
          <span className="flex items-center gap-2"><OrgBotAvatar bot={dragged.bot} size={22} state={stateOf(dragged.bot)} />{dragged.bot.name}</span>
          {dropKey !== null && <p className="mt-1 text-[10px] text-ink-secondary">{dropKey === teamOfBot(dragged.bot.id) ? t("canvas.arrangeBot", { name: dragged.bot.name, team: teamName(dropKey) }) : t("canvas.moveBot", { name: dragged.bot.name, team: teamName(dropKey) })}</p>}</div>}
        {help && <p role="status" data-team-map-keys="" className="absolute bottom-4 right-4 z-40 max-w-[320px] rounded-xl border border-hairline/60 bg-panel px-3 py-2 text-[12px] leading-4 text-ink-secondary shadow-sm">{t("teamMap.org.keyboardHelp")}</p>}
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {announcement && <p aria-hidden="true" className="pointer-events-none absolute bottom-4 left-1/2 z-40 max-w-[440px] -translate-x-1/2 rounded-lg bg-app/90 px-2 py-1.5 text-[11px] text-ink-secondary">{announcement}</p>}
        {searching && !layout.blocks.some((block) => block.ordered.some((bot) => botMatches(bot, query))) && !layout.tray?.bots.some((bot) => botMatches(bot, query)) && !(layout.lead && botMatches(layout.lead.bot, query))
          && <p className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-lg bg-panel px-3 py-2 text-[12px] text-ink-secondary">{t("teamMap.org.noBotMatches")}</p>}
      </div>
      {detailOpen && (
        <div className="shrink-0 py-3 pr-3">
          <TeamMapDetail scope={scope} pairs={pairs} bots={allBots} onSelect={(bot) => showHandoffs(bot.id)} onClose={toggleDetail} />
        </div>
      )}
    </div>
  );
}
