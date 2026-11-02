// Memory map canvas: same zoom/pan language as Team map (team-canvas helpers).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, FileText, Folder, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MemoryMapEdge, MemoryMapGraph, MemoryMapNode } from "@/lib/memory-map";
import { wheelCanvasDelta, zoomAt, type Point, type View } from "@/lib/team-canvas";

const NODE_W = 168;
const NODE_H = 56;

function nodeIcon(kind: MemoryMapNode["kind"]) {
  if (kind === "source") return <Brain size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  if (kind === "folder") return <Folder size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  return <FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
}

function edgeStroke(kind: MemoryMapEdge["kind"]): string {
  if (kind === "link") return "stroke-accent/50";
  if (kind === "tag") return "stroke-ink-secondary/35";
  if (kind === "folder") return "stroke-ink-secondary/25";
  return "stroke-hairline";
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
  const panRef = useRef<{ id: number; start: Point; view: View; moved: boolean } | null>(null);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

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
    const scale = Math.min(1.2, Math.max(0.45, Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY))));
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
        <div
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
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
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y + NODE_H / 2;
              return (
                <line
                  key={edge.id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className={cn("stroke-[1.5]", edgeStroke(edge.kind))}
                  data-memory-map-edge={edge.kind}
                />
              );
            })}
          </svg>
          {graph.nodes.map((node) => {
            const selected = node.kind === "note" && node.noteId === selectedNoteId;
            return (
              <button
                key={node.id}
                type="button"
                data-memory-map-node={node.kind}
                data-memory-map-node-id={node.id}
                data-memory-map-note-id={node.noteId}
                disabled={node.kind !== "note"}
                onClick={() => {
                  if (node.kind === "note" && node.noteId) onOpenNote(node.noteId);
                }}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                className={cn(
                  "absolute flex items-center gap-2 rounded-xl border px-3 text-left shadow-sm transition",
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
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-hairline/50 bg-elevated p-1 shadow-sm">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label={t("memoryManager.mapZoomOut")}
          onClick={() => setView((current) => zoomAt(current, Math.max(0.35, current.scale * 0.85), { x: 200, y: 200 }))}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label={t("memoryManager.mapZoomIn")}
          onClick={() => setView((current) => zoomAt(current, Math.min(2.4, current.scale * 1.15), { x: 200, y: 200 }))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-[11px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
          onClick={fit}
        >
          {t("memoryManager.mapFit")}
        </button>
      </div>
    </div>
  );
}
