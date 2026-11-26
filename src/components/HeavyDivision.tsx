// The cell division of a Heavy run, drawn in the chat's row (owner
// 2026-11-26, M-20261126-116, M-20261126-119 to M-20261126-122): the bot's
// own mascot, at the row's small avatar size, divides in place into one cell
// per expert. Each cell keeps the bot's shape (its open-bot-avatar body, the
// one every other avatar of the bot draws); only the colour changes, and the
// experts end as the row's tight pile, each cut out of its neighbour by a
// ring of the page's colour.
//
// One SVG per row, no canvas: the bodies still in the bot's colour sit under
// a "goo" filter (a blur, then a threshold on its alpha), so two daughters
// are one membrane until they let go. The motion is src/lib/heavy-division.ts;
// this file draws its cells and runs its clock, which stops when the row
// leaves the screen, when the page is hidden and once nothing moves any more.
// A run that is over, or read back from history, is drawn finished and never
// replayed; under reduced motion every step lands at once.
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { Matrix } from "open-bot-avatar";

import { t } from "@/lib/i18n";
import { AGENT_COLORS } from "@/lib/heavy-team";
import { HeavyDivisionSim, type DivisionCell } from "@/lib/heavy-division";
import { MAUS_COLORS } from "@/lib/mascot";
import { prefersReducedMotion } from "@/lib/motion";
import { botAvatarProfile } from "../../shared/bot-avatar";
import { completeMascotLook, engineLookOf, SHAPE_DEPTH, type MascotShape, type ShapeMotion } from "../../shared/mascot-look";
import type { BotAvatarProps } from "./Avatar";
import { bakedShapeFor, enginePose, eyeMarkup, lookDefinition, moodFrame, runtimeStill, stateStill, type StillFrame } from "./shape-avatar";
import { shapeSkinPaint, skinFace } from "./ShapeMascot";
import { useBakedStill } from "./shape-stills";

type DivisionBot = BotAvatarProps["bot"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const SVG = "http://www.w3.org/2000/svg";
/** The ring that cuts an expert out of its neighbour, in pixels: the pile's own (`ring-2`). */
const RING = 2;
/** The membrane's blur, per pixel of cell radius (the mock-up's 2.1 on its radius of 10). */
const GOO = 0.21;
/** While nothing divides the cells only breathe: redrawn at 30 frames a second, as the small live avatars are. */
const IDLE_FRAME_MS = 1000 / 30 - 4;

const hexOf = (color: string) => ((MAUS_COLORS as Record<string, string>)[color] ?? (HEX.test(color) ? color : MAUS_COLORS.green)).toLowerCase();
const matrixAttr = (m: Matrix) => `matrix(${m.join(" ")})`;
const f2 = (n: number) => String(Math.round(n * 100) / 100);

/** What a division is drawn from: the bot's body and eyes at rest, its colour and its eyes' ink. */
export interface DivisionArt {
  shape: MascotShape;
  frame: StillFrame;
  color: string;
  ink: string;
  /** The person's motion setting for this mascot (the picker's gear). */
  motion: ShapeMotion;
}

/** The bot's shape when its mascot is one (a character, or a picture of its own, divides into nothing: the row keeps its pile of avatars). */
export function divisionShape(bot: DivisionBot | null | undefined): MascotShape | null {
  if (!bot) return null;
  const profile = botAvatarProfile(bot);
  if (profile.avatarUrl && profile.avatarCrop !== "mascot") return null;
  const look = completeMascotLook(bot.mascotLook);
  return look.character === "shape" ? look.shape : null;
}

/**
 * The bot's mascot as the division draws it: undefined for a bot whose
 * mascot is no shape, null while a shape's still loads. The body, its
 * colour and its eyes are read exactly where ShapeMascot reads them (the
 * shape's baked still, the skin's paint, the look's settings); a skin's
 * layers and a material's finish are not carried into the cells.
 */
export function useDivisionArt(bot: DivisionBot | null | undefined): DivisionArt | null | undefined {
  const shape = divisionShape(bot);
  const look = completeMascotLook(bot?.mascotLook);
  const settings = engineLookOf(bot?.mascotLook);
  const skin = look.skins.shape;
  const definition = shape ? lookDefinition(shape, look.avatarDef) : null;
  const chosenDepth = settings.depth === null || settings.depth === SHAPE_DEPTH.natural ? undefined : Math.min(SHAPE_DEPTH.max, Math.max(SHAPE_DEPTH.min, settings.depth));
  const depth = skin === "outline" && settings.material === "flat" ? 0 : chosenDepth;
  const bakedId = shape && depth === undefined ? bakedShapeFor(shape, look.avatarDef) : null;
  const baked = useBakedStill(bakedId);
  const color = hexOf(settings.bodyColor ?? bot?.color ?? "green");
  return useMemo(() => {
    if (!shape || !definition) return undefined;
    const still = bakedId ? baked : runtimeStill(definition, depth);
    const pose = enginePose("idle", "idle", settings.mood);
    const frame = pose.motion ? (still ? moodFrame(still, pose.motion) : null) : stateStill(definition, pose.state, pose.mood, depth);
    if (!frame) return null;
    const paint = shapeSkinPaint(skin, color);
    const flat = settings.material === "flat";
    return {
      shape,
      frame,
      color: (flat && HEX.test(paint.fill) ? paint.fill : color).toLowerCase(),
      ink: (settings.eyeColor && HEX.test(settings.eyeColor) ? settings.eyeColor : flat && HEX.test(paint.eyes) ? paint.eyes : "#151515").toLowerCase(),
      motion: settings.motion,
    };
  }, [shape, definition, bakedId, baked, depth, settings.mood, settings.material, settings.eyeColor, settings.motion, skin, color]);
}

/** An expert's colour and the ink of its eyes: the pile's plumages, in the order of the experts. */
export function expertPaint(index: number): { color: string; ink: string } {
  const color = hexOf(AGENT_COLORS[index % AGENT_COLORS.length]!);
  const eyes = shapeSkinPaint("plain", color).eyes;
  return { color, ink: HEX.test(eyes) ? eyes.toLowerCase() : "#151515" };
}

/** The runs whose division this window already showed to its end: scrolling a row away and back never plays it again. */
const played = new Set<string>();

interface CellNodes {
  /** The cell in the bot's colour, under the membrane's filter: its body, and the round cell it swells into while it divides. */
  body: SVGGElement;
  shape: SVGUseElement;
  round: SVGCircleElement;
  group: SVGGElement;
  solid: SVGGElement;
  fill: SVGUseElement;
  eyes: SVGUseElement;
  expert: number;
}

interface Box { cx: number; cy: number; span: number }

/** Where a drawing sits in the still's 0..100 box, measured on the page; the engine's safe area when the page cannot say. */
function boxOf(node: SVGGraphicsElement | null, fallback: Box): Box {
  try {
    const box = node?.getBBox?.();
    if (box && box.width > 0 && box.height > 0) return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, span: Math.max(box.width, box.height) };
  } catch {
    /* not laid out: the fallback */
  }
  return fallback;
}

export interface HeavyDivisionProps {
  art: DivisionArt;
  /** How many experts the run has now; none while the leader still picks its team. */
  count: number;
  /** The run is live: the cells divide, then breathe. Off draws the finished pile. */
  running: boolean;
  /** The run's own id (its message): a division plays once per run. */
  runId: string;
  size?: number;
}

export function HeavyDivision({ art, count, running, runId, size = 22 }: HeavyDivisionProps) {
  const uid = `division-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const goo = useRef<SVGGElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const cellsLayer = useRef<SVGGElement>(null);
  const measureBody = useRef<SVGUseElement>(null);
  const measureEyes = useRef<SVGUseElement>(null);
  const live = useRef<{ sim: HeavyDivisionSim; nodes: Map<number, CellNodes>; kick: () => void; running: boolean } | null>(null);

  // the bot's body and its eyes, each once in the defs: every cell is a <use> of them
  const defs = useMemo(() => {
    // each cross-section is written straight into the body, not as a <use> of its outline: a cell is then one level of
    // <use>, and a body of a hundred cross-sections (the cat) is not cloned a hundred times per cell
    const outlines = new Map(art.frame.paths.map((path) => [path[0], path]));
    const slices = art.frame.shapes.map((shape) => {
      const path = shape.kind === "slice" ? outlines.get(shape.path) : undefined;
      return path ? `<path d="${path[1]}"${path[2] ? ' fill-rule="evenodd"' : ""} transform="${matrixAttr(shape.matrix)}"/>` : "";
    }).join("");
    const eyes = art.frame.shapes.filter((shape) => shape.kind === "eye");
    // the ring is cut around the body's front outline alone (the face a skin paints): one path to stroke, not every cross-section
    const face = skinFace(art.frame);
    return (
      (face ? `<path id="${uid}-edge" d="${face.union}" transform="${face.transform}"/>` : `<use id="${uid}-edge" href="#${uid}-body"/>`)
      + `<g id="${uid}-body" transform="${matrixAttr(art.frame.root)}">${slices}</g>`
      + `<g id="${uid}-eyes" transform="${matrixAttr(art.frame.root)}">${eyes.map((eye) => (eye.kind === "eye" ? `<g transform="${matrixAttr(eye.matrix)}">${eyeMarkup(eye.mark, "currentColor")}</g>` : "")).join("")}</g>`
    );
  }, [art.frame, uid]);

  useLayoutEffect(() => {
    const root = svg.current;
    const gooLayer = goo.current;
    const layer = cellsLayer.current;
    if (!root || !gooLayer || !layer) return;
    const reduced = art.motion === "reduced" || (art.motion === "system" && prefersReducedMotion());
    // a run that is over, one this window already showed, or reduced motion: the finished pile at once
    const finished = !running || reduced || played.has(runId);
    const sim = new HeavyDivisionSim({ size, reduced, rest: finished ? count : 0 });
    const body = boxOf(measureBody.current, { cx: 50, cy: 50, span: 84 });
    const eyes = boxOf(measureEyes.current, { cx: body.cx, cy: body.cy, span: 1 });
    const scale = size / body.span;
    const ring = f2((2 * RING) / scale);
    const nodes = new Map<number, CellNodes>();
    const state = { sim, nodes, kick: () => {}, running };
    live.current = state;
    const use = (href: string, parent: Element): SVGUseElement => {
      const node = document.createElementNS(SVG, "use");
      node.setAttribute("href", `#${uid}-${href}`);
      parent.append(node);
      return node;
    };
    const nodesOf = (cell: DivisionCell): CellNodes => {
      let made = nodes.get(cell.id);
      if (!made) {
        const group = document.createElementNS(SVG, "g");
        group.setAttribute("data-heavy-cell", "");
        const solid = document.createElementNS(SVG, "g");
        group.append(solid);
        const edge = use("edge", solid);
        edge.setAttribute("fill", "var(--color-app)");
        edge.setAttribute("stroke", "var(--color-app)");
        edge.setAttribute("stroke-width", ring);
        edge.setAttribute("stroke-linejoin", "round");
        const fill = use("body", solid);
        const face = use("eyes", group);
        const membrane = document.createElementNS(SVG, "g");
        membrane.setAttribute("data-heavy-membrane", "");
        gooLayer.append(membrane);
        const round = document.createElementNS(SVG, "circle");
        membrane.append(round);
        made = { body: membrane, shape: use("body", membrane), round, group, solid, fill, eyes: face, expert: -2 };
        nodes.set(cell.id, made);
      }
      return made;
    };
    let width = "";
    let order = "";
    let blurred = -1;
    const draw = (seconds: number) => {
      const alive = state.running && !sim.reduced;
      const cells = sim.ordered();
      const ids = cells.map((cell) => cell.id).join(",");
      if (ids !== order) {
        // left to right is back to front: each expert overlaps the one before it
        order = ids;
        for (const [id, made] of nodes) {
          if (cells.some((cell) => cell.id === id)) continue;
          made.body.remove();
          made.group.remove();
          nodes.delete(id);
        }
        for (const cell of cells) {
          const made = nodesOf(cell);
          layer.append(made.group);
          gooLayer.append(made.body);
        }
        root.setAttribute("data-heavy-cells", String(cells.length));
      }
      for (const cell of cells) {
        const made = nodes.get(cell.id)!;
        const r = Math.max(0.5, cell.r + (alive ? Math.sin(seconds * 2 + cell.phase) * 0.25 * sim.geometry.unit : 0));
        const y = size / 2 + (alive ? Math.sin(seconds * 1.3 + cell.phase) * 0.35 * sim.geometry.unit : 0);
        const k = (scale * r) / sim.geometry.radius;
        const at = `translate(${f2(cell.x)} ${f2(y)}) scale(${Math.round(k * 10000) / 10000}) translate(${f2(-body.cx)} ${f2(-body.cy)})`;
        made.shape.setAttribute("transform", at);
        made.body.setAttribute("opacity", f2(1 - cell.tint));
        // a dividing cell is a round one that keeps the bot's features (its ears, its points): two of them pinch as one membrane
        made.round.setAttribute("cx", f2(cell.x));
        made.round.setAttribute("cy", f2(y));
        made.round.setAttribute("r", f2(r * sim.melt));
        made.solid.setAttribute("transform", at);
        made.solid.setAttribute("opacity", f2(cell.tint));
        if (made.expert !== cell.expert) {
          made.expert = cell.expert;
          const paint = cell.expert >= 0 ? expertPaint(cell.expert) : { color: art.color, ink: art.ink };
          made.fill.setAttribute("fill", paint.color);
          made.eyes.style.color = paint.ink;
          if (cell.expert >= 0) made.group.setAttribute("data-heavy-expert", String(cell.expert + 1));
          else made.group.removeAttribute("data-heavy-expert");
        }
        // the eyes close toward their own middle as they go, and blink now and then while the cell lives
        const blink = alive && Math.sin(seconds * 0.9 + cell.phase * 3) > 0.985 ? 0.15 : 1;
        const open = Math.max(0, cell.face);
        made.eyes.setAttribute("transform", `${at} translate(${f2(eyes.cx)} ${f2(eyes.cy)}) scale(${f2(open)} ${f2(open * blink)}) translate(${f2(-eyes.cx)} ${f2(-eyes.cy)})`);
        made.eyes.setAttribute("opacity", f2(open));
      }
      if (sim.untinted) gooLayer.removeAttribute("display");
      else gooLayer.setAttribute("display", "none");
      // the membrane only while the cells divide: at rest the bot's own outline, sharp and with no filter to paint
      const sigma = sim.melt < 0.004 ? 0 : Math.round(sim.melt * GOO * (size / 2) * 100) / 100;
      if (sigma !== blurred) {
        blurred = sigma;
        if (sigma > 0) {
          blur.current?.setAttribute("stdDeviation", String(sigma));
          gooLayer.setAttribute("filter", `url(#${uid}-goo)`);
        } else gooLayer.removeAttribute("filter");
      }
      const next = f2(sim.width());
      if (next !== width) {
        width = next;
        root.setAttribute("viewBox", `0 0 ${next} ${size}`);
        root.setAttribute("width", next);
      }
      root.setAttribute("data-heavy-division", sim.busy ? "dividing" : alive ? "live" : "rest");
      // shown to its end: this run's division is not played a second time
      if (state.running && !sim.busy && cells.some((cell) => cell.expert >= 0)) played.add(runId);
    };

    let frame = 0;
    let last = 0;
    let drawn = 0;
    let onScreen = true;
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now: number) => {
      frame = 0;
      const moving = sim.busy;
      // a breathing pile is redrawn half as often as a dividing one
      if (moving || now - drawn >= IDLE_FRAME_MS) {
        sim.advance(Math.min(0.25, last ? (now - last) / 1000 : 0));
        last = now;
        drawn = now;
        draw(now / 1000);
      }
      kick();
    };
    // the clock runs only while something moves and someone can see it
    const kick = () => {
      if (frame) return;
      const wanted = sim.busy || (state.running && !sim.reduced);
      if (!wanted || !onScreen || document.hidden) {
        last = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    state.kick = () => {
      // a change that lands at once (reduced motion, a run that just ended) is drawn now, with or without a clock
      if (sim.reduced || !sim.busy) draw(performance.now() / 1000);
      kick();
    };
    if (!finished) sim.setCount(count);
    draw(performance.now() / 1000);
    kick();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) kick();
      else stop();
    });
    observer?.observe(root);
    const seen = () => {
      if (document.hidden) stop();
      else kick();
    };
    document.addEventListener("visibilitychange", seen);
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", seen);
      for (const made of nodes.values()) {
        made.body.remove();
        made.group.remove();
      }
      live.current = null;
    };
    // the count and the run's state are followed below, without starting the drawing over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, runId, size, uid]);

  useEffect(() => {
    const state = live.current;
    if (!state) return;
    state.running = running;
    state.sim.setCount(count);
    state.kick();
  }, [count, running, runId]);

  // the width and the view box follow the cells: the drawing writes them, so the text stays against the pile
  return (
    <svg ref={svg} data-heavy-division="rest" data-heavy-avatars="" data-shape={art.shape} role="img" aria-label={count > 0 ? t("heavy.avatars", { count }) : undefined} aria-hidden={count > 0 ? undefined : true}
      className="block shrink-0 overflow-visible" height={size}>
      <defs>
        {/* the membrane: a blur, then a threshold on its alpha, under the cells themselves */}
        <filter id={`${uid}-goo`} x="-30%" y="-60%" width="160%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={blur} in="SourceGraphic" stdDeviation={f2(GOO * (size / 2))} result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <defs dangerouslySetInnerHTML={{ __html: defs }} />
      <use ref={measureBody} href={`#${uid}-body`} visibility="hidden" />
      <use ref={measureEyes} href={`#${uid}-eyes`} visibility="hidden" />
      <g ref={goo} fill={art.color} />
      <g ref={cellsLayer} />
    </svg>
  );
}
