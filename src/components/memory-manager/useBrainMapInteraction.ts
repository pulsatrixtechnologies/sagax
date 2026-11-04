import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { brainBounds, type Brain, type View } from "@/lib/memory-brain";

const MAX_SCALE = 10;

export interface BrainMapInteractionInput {
  canvas: MutableRefObject<HTMLCanvasElement | null>;
  view: MutableRefObject<View & { dpr: number }>;
  target: MutableRefObject<{ s: number; tx: number; ty: number } | null>;
  velocity: MutableRefObject<{ x: number; y: number }>;
  dragging: MutableRefObject<boolean>;
  fitted: MutableRefObject<boolean>;
  hoverRef: MutableRefObject<number>;
  unfold: MutableRefObject<{ node: number; at: number }>;
  setHover: Dispatch<SetStateAction<number>>;
  kick: () => void;
  pick: (x: number, y: number, slack?: number) => number;
  animated: boolean;
  brain: Brain;
  onSelect: (node: Brain["nodes"][number]) => void;
  fit: (smooth: boolean) => void;
}

/** Pointer, wheel, keyboard and minimap controls for BrainMap. */
export function useBrainMapInteraction(input: BrainMapInteractionInput) {
  const {
    canvas, view, target, velocity, dragging, fitted, hoverRef, unfold, setHover,
    kick, pick, animated, brain, onSelect, fit,
  } = input;


const pointers = useRef(new Map<number, { x: number; y: number; t: number }>());
const gesture = useRef({ moved: 0, startDist: 0, startS: 1, node: -1, touch: false, samples: [] as { x: number; y: number; t: number }[] });

const local = (e: { clientX: number; clientY: number }) => {
  const r = canvas.current!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const setUnfold = useCallback(
  (i: number) => {
    if (hoverRef.current === i) return;
    hoverRef.current = i;
    unfold.current = { node: i, at: performance.now() };
    setHover(i);
    kick();
  },
  [kick],
);
const zoomAt = useCallback(
  (x: number, y: number, factor: number, smooth = true) => {
    const v = view.current;
    const base = target.current ?? { s: v.s, tx: v.tx, ty: v.ty };
    const s = Math.max(0.03, Math.min(MAX_SCALE, base.s * factor));
    const to = { s, tx: x - ((x - base.tx) * s) / base.s, ty: y - ((y - base.ty) * s) / base.s };
    if (smooth && animated) target.current = to;
    else {
      target.current = null;
      Object.assign(v, to);
    }
    fitted.current = false;
    kick();
  },
  [animated, kick],
);

const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
  e.currentTarget.setPointerCapture(e.pointerId);
  const at = local(e);
  pointers.current.set(e.pointerId, { ...at, t: performance.now() });
  const g = gesture.current;
  velocity.current = { x: 0, y: 0 };
  target.current = null;
  g.touch = e.pointerType !== "mouse";
  if (pointers.current.size === 2) {
    const [a, b] = [...pointers.current.values()];
    g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    g.startS = view.current.s;
    g.node = -1;
    return;
  }
  dragging.current = true;
  g.moved = 0;
  g.node = pick(at.x, at.y, g.touch ? 14 : 6);
  g.samples = [{ ...at, t: performance.now() }];
  kick();
};
const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
  const at = local(e);
  const prev = pointers.current.get(e.pointerId);
  const v = view.current;
  if (!prev) {
    if (e.pointerType === "mouse") {
      const n = pick(at.x, at.y);
      e.currentTarget.style.cursor = n >= 0 ? "pointer" : "grab";
      setUnfold(n);
    }
    return;
  }
  const now = performance.now();
  pointers.current.set(e.pointerId, { ...at, t: now });
  const g = gesture.current;
  const dx = at.x - prev.x;
  const dy = at.y - prev.y;
  g.moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.current.size === 2) {
    const [a, b] = [...pointers.current.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    zoomAt(mid.x, mid.y, (g.startS * (dist / g.startDist)) / v.s, false);
    v.tx += dx / 2;
    v.ty += dy / 2;
    return;
  }
  if (g.moved > 4) {
    v.tx += dx;
    v.ty += dy;
    fitted.current = false;
    g.samples.push({ ...at, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift();
    kick();
  }
};
const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
  const g = gesture.current;
  const had = pointers.current.size;
  pointers.current.delete(e.pointerId);
  if (pointers.current.size > 0) return;
  dragging.current = false;
  if (had === 1 && g.moved <= 5) {
    const n = g.node;
    if (n < 0) {
      if (g.touch) setUnfold(-1);
    } else if (g.touch && hoverRef.current !== n) setUnfold(n);
    else onSelect(brain.nodes[n]);
    return;
  }
  // Inertia: the last few samples of the drag carry on and slow down.
  if (animated && g.samples.length >= 2) {
    const a = g.samples[0];
    const b = g.samples[g.samples.length - 1];
    const dt = Math.max(1, b.t - a.t);
    if (performance.now() - b.t < 80) velocity.current = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
  kick();
};

const zoomRef = useRef(zoomAt);
zoomRef.current = zoomAt;
useEffect(() => {
  const c = canvas.current;
  if (!c) return;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const lines = e.deltaMode === 1 ? 16 : 1;
    // 2026-11-03 (JC): scrolling zooms in and out (mouse wheel and
    // trackpad alike); a pinch zooms too; drag moves the map. A mostly
    // sideways trackpad swipe still pans.
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
      const v = view.current;
      target.current = null;
      v.tx -= e.deltaX * lines;
      fitted.current = false;
      kick();
      return;
    }
    zoomRef.current(x, y, Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.003)));
  };
  c.addEventListener("wheel", onWheel, { passive: false });
  return () => c.removeEventListener("wheel", onWheel);
}, [kick]);

const onKeyDown = (e: React.KeyboardEvent) => {
  const v = view.current;
  const step = 60;
  if (e.key === "+" || e.key === "=") zoomAt(v.w / 2, v.h / 2, 1.3);
  else if (e.key === "-") zoomAt(v.w / 2, v.h / 2, 1 / 1.3);
  else if (e.key === "0") fit(true);
  else if (e.key === "ArrowLeft") v.tx += step;
  else if (e.key === "ArrowRight") v.tx -= step;
  else if (e.key === "ArrowUp") v.ty += step;
  else if (e.key === "ArrowDown") v.ty -= step;
  else return;
  e.preventDefault();
  kick();
};

// The minimap moves the view: press or drag in it to centre there.
const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
  if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
  else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
  const m = e.currentTarget.getBoundingClientRect();
  const bb = brainBounds(brain);
  const ms = Math.min(m.width / (bb.maxX - bb.minX), m.height / (bb.maxY - bb.minY));
  const wx = (e.clientX - m.left - m.width / 2) / ms;
  const wy = (e.clientY - m.top - m.height / 2) / ms;
  const v = view.current;
  const to = { s: v.s, tx: v.w / 2 - wx * v.s, ty: v.h / 2 - wy * v.s };
  if (animated && e.type === "pointerdown") target.current = to;
  else {
    target.current = null;
    Object.assign(v, to);
  }
  fitted.current = false;
  kick();
};


  return {
    pointers,
    setUnfold,
    zoomAt,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onMini,
  };
}
