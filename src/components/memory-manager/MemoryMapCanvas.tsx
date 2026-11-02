// Memory map canvas: same zoom/pan language as Team map (team-canvas helpers).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, FileText, Folder, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  MEMORY_NODE_HEIGHT,
  MEMORY_NODE_WIDTH,
  memoryEdgeEndpoints,
  type MemoryMapEdge,
  type MemoryMapGraph,
  type MemoryMapNode,
} from "@/lib/memory-map";
import { wheelCanvasDelta, zoomAt, type Point, type View } from "@/lib/team-canvas";

const NODE_W = MEMORY_NODE_WIDTH;
const NODE_H = MEMORY_NODE_HEIGHT;

function nodeIcon(kind: MemoryMapNode["kind"]) {
  if (kind === "source") return <Brain size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  if (kind === "folder") return <Folder size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  return <FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
}

function edgeStroke(kind: MemoryMapEdge["kind"], active: boolean, dimmed: boolean): string {
  if (dimmed) return "stroke-hairline/25";
  if (kind === "link") return active ? "stroke-accent" : "stroke-accent/50";
  if (kind === "tag") return active ? "stroke-ink-secondary/70" : "stroke-ink-secondary/35";
  if (kind === "folder") return active ? "stroke-ink-secondary/55" : "stroke-ink-secondary/25";
  return active ? "stroke-ink-secondary/70" : "stroke-hairline";
}

export function MemoryMapCanvas({
  graph,
  selectedNoteId,
  onOpenNote,
}: {
  graph: MemoryMapGraph;
  selectedNoteId?: string | null;
  onOpenNote: (noteId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, scale: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const panRef = useRef<{ id: number; start: Point; view: View; moved: boolean } | null>(null);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const noteCount = useMemo(() => graph.nodes.filter((node) => node.kind === "note").length, [graph.nodes]);
  const linkedIds = useMemo(() => {
    if (!hoveredId) return null;
    const ids = new Set<string>([hoveredId]);
    for (const edge of graph.edges) {
      if (edge.from === hoveredId || edge.to === hoveredId) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }, [graph.edges, hoveredId]);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || graph.nodes.length === 0) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_W);
      maxY = Math.max(maxY, node.y + NODE_H);
    }
    const pad = 48;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const scale = Math.min(1.2, Math.max(0.35, Math.min((width - pad * 2) / contentWidth, (height - pad * 2) / contentHeight)));
    setView({
      x: (width - (minX + maxX) * scale) / 2,
      y: (height - (minY + maxY) * scale) / 2,
      scale,
    });
  }, [graph.nodes]);

  useEffect(() => { fit(); }, [fit]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const delta = wheelCanvasDelta(event, rect.height);
      setView((current) => {
        if (delta.kind === "zoom") {
          const next = Math.min(2.4, Math.max(0.35, current.scale * delta.factor));
          return zoomAt(current, next, point);
        }
        return { ...current, x: current.x - delta.dx, y: current.y - delta.dy };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = viewportRef.current;
    const point = el
      ? { x: el.clientWidth / 2, y: el.clientHeight / 2 }
      : { x: 200, y: 200 };
    setView((current) => {
      const next = Math.min(2.4, Math.max(0.35, current.scale * factor));
      return zoomAt(current, next, point);
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-memory-map-node]")) return;
    panRef.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      view,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.id !== event.pointerId) return;
    const dx = event.clientX - pan.start.x;
    const dy = event.clientY - pan.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    setView({ ...pan.view, x: pan.view.x + dx, y: pan.view.y + dy });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.id === event.pointerId) panRef.current = null;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-memory-map="">
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-panel/40 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {noteCount === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-8" data-memory-map-empty="">
            <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-secondary">
              {t("memoryManager.mapEmpty")}
            </p>
          </div>
        ) : (
          <div
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            data-memory-map-world=""
          >
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={1}
              height={1}
              aria-hidden="true"
            >
              {graph.edges.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;
                const active = Boolean(linkedIds && (edge.from === hoveredId || edge.to === hoveredId));
                const dimmed = Boolean(linkedIds && !active);
                const { x1, y1, x2, y2 } = memoryEdgeEndpoints(from, to);
                return (
                  <line
                    key={edge.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className={cn("stroke-[1.5] transition-opacity", edgeStroke(edge.kind, active, dimmed), active && "stroke-[2]")}
                    data-memory-map-edge={edge.kind}
                    data-memory-map-edge-active={active ? "1" : undefined}
                  />
                );
              })}
            </svg>
            {graph.nodes.map((node) => {
              const selected = node.kind === "note" && node.noteId === selectedNoteId;
              const linked = linkedIds ? linkedIds.has(node.id) : true;
              return (
                <button
                  key={node.id}
                  type="button"
                  data-memory-map-node={node.kind}
                  data-memory-map-node-id={node.id}
                  data-memory-map-note-id={node.noteId}
                  disabled={node.kind !== "note"}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onClick={() => {
                    if (node.kind === "note" && node.noteId) onOpenNote(node.noteId);
                  }}
                  style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                  className={cn(
                    "absolute flex items-center gap-2 rounded-xl border px-3 text-left shadow-sm transition",
                    !linked && "opacity-40",
                    node.kind === "note"
                      ? selected
                        ? "border-accent/60 bg-card ring-1 ring-accent/20"
                        : "border-hairline/50 bg-card hover:border-ink-secondary/40"
                      : "cursor-default border-hairline/40 bg-raised/80",
                  )}
                >
                  {nodeIcon(node.kind)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{node.label}</span>
                    {node.detail && <span className="block truncate text-[10.5px] text-ink-secondary">{node.detail}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-end gap-3">
        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-xl border border-hairline/60 bg-panel p-1 shadow-sm">
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
            aria-label={t("memoryManager.mapZoomOut")}
            onClick={() => zoomBy(1 / 1.2)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="min-w-12 rounded-md px-1 py-2 text-[11px] tabular-nums text-ink-secondary hover:bg-control"
            aria-label={t("memoryManager.mapFit")}
            title={t("memoryManager.mapFit")}
            onClick={fit}
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
            aria-label={t("memoryManager.mapZoomIn")}
            onClick={() => zoomBy(1.2)}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
