import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  boundsOf,
  fitBounds,
  nodeAtPoint,
  zoomAround,
  type GraphModel,
  type GraphView,
  type Simulation,
} from "@/lib/memory-graph";
import type { GraphSettings } from "@/lib/memory-graph-settings";

type Drag =
  | { kind: "node"; node: number; id: number; x: number; y: number; moved: boolean }
  | { kind: "pan"; id: number; x: number; y: number; moved: boolean }
  | null;

export interface MemoryGraphLive {
  model: GraphModel;
  visible: Uint8Array;
  lit: Uint8Array | null;
  colours: string[];
  radii: Float64Array;
  settings: GraphSettings;
  focus: number;
}

export interface MemoryGraphInteractionInput {
  canvas: MutableRefObject<HTMLCanvasElement | null>;
  wrap: MutableRefObject<HTMLDivElement | null>;
  sim: MutableRefObject<Simulation | null>;
  live: MutableRefObject<MemoryGraphLive>;
  view: MutableRefObject<GraphView>;
  hover: MutableRefObject<number>;
  drag: MutableRefObject<Drag>;
  pointers: MutableRefObject<Map<number, { x: number; y: number }>>;
  pinch: MutableRefObject<{ d: number } | null>;
  autoFit: MutableRefObject<boolean>;
  flyTo: MutableRefObject<GraphView | null>;
  size: MutableRefObject<{ w: number; h: number; dpr: number }>;
  kick: () => void;
  setSettled: Dispatch<SetStateAction<boolean>>;
  onPreview: (key: string) => void;
  onOpen: (key: string) => void;
}

/** Pointer, wheel, keyboard and minimap controls for MemoryGraph. */
export function useMemoryGraphInteraction(input: MemoryGraphInteractionInput) {
  const {
    canvas, wrap, sim, live, view, hover, drag, pointers, pinch,
    autoFit, flyTo, size, kick, setSettled, onPreview, onOpen,
  } = input;

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const hit = (x: number, y: number) => {
    const s = sim.current;
    if (!s) return -1;
    const { radii: rad, visible: vis } = live.current;
    return nodeAtPoint(s, (i) => Math.max(1.2 / view.current.s, rad[i]!), view.current, x, y, 4, (i) => vis[i] === 1);
  };
  const setHover = (i: number) => {
    if (hover.current === i) return;
    hover.current = i;
    if (canvas.current) canvas.current.style.cursor = i >= 0 ? "pointer" : drag.current?.kind === "pan" ? "grabbing" : "grab";
    wrap.current?.setAttribute("data-hover", i >= 0 ? live.current.model.nodes[i]!.id : "");
    kick();
  };
  const zoomBy = (x: number, y: number, factor: number) => {
    autoFit.current = false;
    flyTo.current = null;
    Object.assign(view.current, zoomAround(view.current, x, y, factor));
    kick();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      if (drag.current?.kind === "node") { sim.current?.release(drag.current.node); if (sim.current) sim.current.alphaTarget = 0; }
      drag.current = null;
      return;
    }
    const at = hit(p.x, p.y);
    if (at >= 0 && sim.current) {
      drag.current = { kind: "node", node: at, id: e.pointerId, x: p.x, y: p.y, moved: false };
      setHover(at);
    } else {
      drag.current = { kind: "pan", id: e.pointerId, x: p.x, y: p.y, moved: false };
      e.currentTarget.style.cursor = "grabbing";
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const last = pointers.current.get(e.pointerId);
    if (last) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch.current.d > 0) zoomBy((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / pinch.current.d);
      pinch.current.d = d;
      return;
    }
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > 3) d.moved = true;
      if (!d.moved) return;
      const s = sim.current;
      if (d.kind === "node" && s) {
        const v = view.current;
        s.pin(d.node, (p.x - v.tx) / v.s, (p.y - v.ty) / v.s);
        s.alphaTarget = 0.3;
        s.reheat(0.3);
        autoFit.current = false;
        setSettled(false);
        kick();
      } else if (d.kind === "pan" && last) {
        autoFit.current = false;
        flyTo.current = null;
        view.current.tx += p.x - last.x;
        view.current.ty += p.y - last.y;
        kick();
      }
      return;
    }
    if (e.pointerType === "mouse") setHover(hit(p.x, p.y));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const s = sim.current;
    if (d.kind === "node" && s) {
      s.release(d.node);
      s.alphaTarget = 0;
      kick();
      if (!d.moved && e.type === "pointerup") {
        const node = live.current.model.nodes[d.node];
        if (node?.kind === "note" && node.key) onPreview(node.key);
      }
    }
    e.currentTarget.style.cursor = hover.current >= 0 ? "pointer" : "grab";
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const at = hit(p.x, p.y);
    const node = at >= 0 ? live.current.model.nodes[at] : null;
    if (node?.kind === "note" && node.key) onOpen(node.key);
    else if (at < 0) zoomBy(p.x, p.y, 1.6);
  };

  // The wheel zooms (a trackpad pinch arrives as a wheel with ctrlKey).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      zoomBy(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  const fit = () => {
    autoFit.current = false;
    const s = sim.current;
    if (!s) return;
    const vis = live.current.visible;
    flyTo.current = fitBounds(boundsOf(s, (i) => vis[i] === 1), size.current.w, size.current.h, 56, 1.6);
    kick();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const { w, h } = size.current;
    if (e.key === "+" || e.key === "=") zoomBy(w / 2, h / 2, 1.25);
    else if (e.key === "-") zoomBy(w / 2, h / 2, 0.8);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  };
  const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture?.(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const s = sim.current;
    if (!s) return;
    const m = e.currentTarget.getBoundingClientRect();
    const vis = live.current.visible;
    const f = fitBounds(boundsOf(s, (i) => vis[i] === 1), m.width, m.height, 8, 100);
    const wx = (e.clientX - m.left - f.tx) / f.s;
    const wy = (e.clientY - m.top - f.ty) / f.s;
    const v = view.current;
    autoFit.current = false;
    flyTo.current = null;
    v.tx = size.current.w / 2 - wx * v.s;
    v.ty = size.current.h / 2 - wy * v.s;
    kick();
  };

  return { zoomBy, fit, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown, onMini, setHover };
}
