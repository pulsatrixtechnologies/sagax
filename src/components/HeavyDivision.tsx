// The cell division of a Heavy run, drawn in the chat's row (owner
// 2026-11-26, M-20261126-116, M-20261126-119 to M-20261126-122): the bot's
// own mascot, at the row's small avatar size, divides in place into one cell
// per expert. Each cell is the bot's shape for the whole division (its
// open-bot-avatar body, the one every other avatar of the bot draws); only
// the colour changes, and the experts end as the row's tight pile, each cut
// out of its neighbour by a ring of the page's colour.
//
// One SVG per row, no canvas of its own: the bodies still in the bot's colour
// sit under a "goo" filter (a blur, then a threshold on its alpha), so the
// bot's own silhouette stretches, pinches and lets go as one membrane. A
// bot in a material (Fluffy, Glass) wears it in its cells: one still per
// colour, painted once by the engine on the context the material already
// shares across the page (shape-material-still.ts). Where the page cannot
// paint it, the cells are flat with the mock-up's simple volume. The motion
// is src/lib/heavy-division.ts; this file draws its cells and runs its
// clock, which stops when the row leaves the screen, when the page is hidden
// and once nothing moves any more. A run that is over, read back from
// history, or past its first round when the row first shows is drawn
// finished and never replayed; under reduced motion every step lands at once.
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { AvatarDefinition, AvatarMood, AvatarState, Matrix } from "open-bot-avatar";
import type { CanvasMaterial } from "open-bot-avatar/dom";

import { t } from "@/lib/i18n";
import { AGENT_COLORS } from "@/lib/heavy-team";
import { HeavyDivisionSim, type DivisionCell } from "@/lib/heavy-division";
import { mascotHex } from "@/lib/mascot";
import { botAvatarProfile } from "../../shared/bot-avatar";
import { completeMascotLook, engineLookOf, type MascotAvatarDef, type MascotShape, type ShapeMotion } from "../../shared/mascot-look";
import type { BotAvatarProps } from "./Avatar";
import { eyeMarkup, lookDefinition, moodFrame, runtimeStill, stateStill, type StillFrame } from "./shape-avatar";
import { shapeLook } from "./shape-look";
import { useShapeMaterial } from "./shape-material";
import { materialStill, type MaterialStill } from "./shape-material-still";
import { shapeSkinPaint, skinFace } from "./ShapeMascot";
import { useBakedStill } from "./shape-stills";
import { useReducedMotionPreference } from "./TabIndicator";

type DivisionBot = BotAvatarProps["bot"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const SVG = "http://www.w3.org/2000/svg";
/** The ring that cuts an expert out of its neighbour, in pixels: the pile's own (`ring-2`). */
const RING = 2;
/** The membrane's blur, per pixel of cell radius (the mock-up's 2.1 on its radius of 10). */
const GOO = 0.21;
/** While nothing divides the cells only breathe: redrawn at 30 frames a second, as the small live avatars are. */
const IDLE_FRAME_MS = 1000 / 30 - 4;
/** An expert that failed mid-run is dimmed, as the orbit dimmed it. */
const FAILED_OPACITY = 0.45;

const matrixAttr = (m: Matrix) => `matrix(${m.join(" ")})`;
const f2 = (n: number) => String(Math.round(n * 100) / 100);

/** What a division is drawn from: the bot's body and eyes at rest, its colour and its eyes' ink. */
export interface DivisionArt {
  shape: MascotShape;
  /** The body's still: the same object while the look does not change, so the drawing is built once per look. */
  frame: StillFrame;
  color: string;
  ink: string;
  /** The person's motion setting for this mascot (the picker's gear). */
  motion: ShapeMotion;
  /** The look's material when the page paints it: the cells wear its stills. */
  material: { definition: AvatarDefinition; finish: CanvasMaterial; depth: number | undefined; state: AvatarState; mood: AvatarMood } | null;
  /** The look asks for a material the page cannot paint (or has not yet): flat cells with a simple volume. */
  shaded: boolean;
}

/** The bot's shape when its mascot is one (a character, or a picture of its own, divides into nothing: the row keeps its pile of avatars). */
export function divisionShape(bot: DivisionBot | null | undefined): MascotShape | null {
  if (!bot) return null;
  const profile = botAvatarProfile(bot);
  if (profile.avatarUrl && profile.avatarCrop !== "mascot") return null;
  const look = completeMascotLook(bot.mascotLook);
  return look.character === "shape" ? look.shape : null;
}

/** A person's own drawing, read once per content: the look is parsed again on every draw of the row, the body must not be. */
const OWN_DEFINITIONS = new Map<string, AvatarDefinition>();
const OWN_DEFINITIONS_MAX = 64;
function definitionOf(shape: MascotShape, avatarDef: MascotAvatarDef | undefined): AvatarDefinition {
  if (!avatarDef) return lookDefinition(shape);
  const key = `${shape}|${JSON.stringify(avatarDef)}`;
  let definition = OWN_DEFINITIONS.get(key);
  if (!definition) {
    if (OWN_DEFINITIONS.size >= OWN_DEFINITIONS_MAX) OWN_DEFINITIONS.delete(OWN_DEFINITIONS.keys().next().value!);
    OWN_DEFINITIONS.set(key, (definition = lookDefinition(shape, avatarDef)));
  }
  return definition;
}

/**
 * The bot's mascot as the division draws it: undefined for a bot whose
 * mascot is no shape, null while a shape's still loads. The body, its
 * colour, its eyes and its material follow ShapeMascot's own rules
 * (shape-look.ts); a skin's layers are not carried into the cells.
 */
export function useDivisionArt(bot: DivisionBot | null | undefined): DivisionArt | null | undefined {
  const shape = divisionShape(bot);
  const full = completeMascotLook(bot?.mascotLook);
  const settings = engineLookOf(bot?.mascotLook);
  const finish = useShapeMaterial(settings.material);
  const look = shapeLook({ shape: shape ?? "circle", skin: full.skins.shape, color: settings.bodyColor ?? bot?.color ?? "green", engineLook: settings, avatarDef: full.avatarDef, material: finish !== null });
  const definition = shape ? definitionOf(look.shape, full.avatarDef) : null;
  const baked = useBakedStill(shape ? look.bakedId : null);
  const { depth, pose } = look;
  const frame = useMemo(() => {
    if (!definition) return null;
    const still = look.bakedId ? baked : runtimeStill(definition, depth);
    return pose.motion ? (still ? moodFrame(still, pose.motion) : null) : stateStill(definition, pose.state, pose.mood, depth);
  }, [definition, look.bakedId, baked, depth, pose.motion, pose.state, pose.mood]);
  const material = useMemo(
    () => (finish && definition ? { definition, finish, depth: look.chosenDepth, state: pose.state, mood: pose.mood } : null),
    [finish, definition, look.chosenDepth, pose.state, pose.mood],
  );
  const shaded = settings.material !== "flat";
  return useMemo(() => {
    if (!shape) return undefined;
    if (!frame) return null;
    return { shape: look.shape, frame, color: look.body, ink: look.ink, motion: settings.motion, material, shaded };
  }, [shape, look.shape, frame, look.body, look.ink, settings.motion, material, shaded]);
}

/** An expert's colour and the ink of its eyes: the pile's plumages, in the order of the experts. */
export function expertPaint(index: number): { color: string; ink: string } {
  const color = mascotHex(AGENT_COLORS[index % AGENT_COLORS.length]!).toLowerCase();
  const eyes = shapeSkinPaint("plain", color).eyes;
  return { color, ink: HEX.test(eyes) ? eyes.toLowerCase() : "#151515" };
}

/** The runs whose division this window already showed to its end: scrolling a row away and back never plays it again. */
const played = new Set<string>();

interface CellNodes {
  /** The cell in the bot's colour, under the membrane's filter: the bot's own body, which stretches and pinches with its sister. */
  body: SVGUseElement;
  /** The bot in its material, over its flat body while nothing divides. */
  own: SVGImageElement | null;
  group: SVGGElement;
  solid: SVGGElement;
  fill: SVGUseElement;
  /** The expert in its material. */
  picture: SVGImageElement | null;
  shade: SVGUseElement;
  eyes: SVGUseElement;
  /** What the cell was last painted as: its expert (-1 the bot), and the stills it wears. */
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

const placeImage = (image: SVGImageElement, still: MaterialStill) => {
  image.setAttribute("href", still.href);
  image.setAttribute("x", f2(still.x));
  image.setAttribute("y", f2(still.y));
  image.setAttribute("width", f2(still.size));
  image.setAttribute("height", f2(still.size));
};

export interface HeavyDivisionProps {
  art: DivisionArt;
  /** How many experts the run has now; none while the leader still picks its team. */
  count: number;
  /** The run is live: the cells divide, then breathe. Off draws the finished pile. */
  running: boolean;
  /** The run's own id (its message): a division plays once per run. */
  runId: string;
  /** The run was past its first round when the row first showed (a reload, a row scrolled to): it starts as the pile. */
  settled?: boolean;
  /** The experts that failed mid-run, by their place in the pile: their cells are dimmed. */
  failed?: readonly boolean[];
  size?: number;
}

interface Live {
  sim: HeavyDivisionSim;
  running: boolean;
  /** The body's measured box: the material's stills are painted at the size the cells draw it. */
  span: number;
  kick: () => void;
  /** Paint every cell again (a colour, a still or a failure changed), without starting the division over. */
  repaint: () => void;
}

export function HeavyDivision({ art, count, running, runId, settled = false, failed, size = 22 }: HeavyDivisionProps) {
  const uid = `division-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const goo = useRef<SVGGElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const ownLayer = useRef<SVGGElement>(null);
  const cellsLayer = useRef<SVGGElement>(null);
  const measureBody = useRef<SVGUseElement>(null);
  const measureEyes = useRef<SVGUseElement>(null);
  const live = useRef<Live | null>(null);
  // the reduced motion of the device and of the app's switch, followed while the run goes; the mascot's own setting wins
  const systemReduced = useReducedMotionPreference();
  const reduced = art.motion === "reduced" || (art.motion === "system" && systemReduced);
  // what the cells are painted with: read on every draw, so a change repaints them and never restarts the division
  const failedKey = (failed ?? []).map((value) => (value ? "1" : "0")).join("");
  const stills = useRef<{ own: MaterialStill | null; experts: Array<MaterialStill | null> } | null>(null);
  const paint = useRef({ art, failed: failedKey });
  paint.current = { art, failed: failedKey };

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

  // the drawing is built once per body (its shape, its own drawing, its depth and mood) and per run; the count, the
  // run's state, the colours, the stills and reduced motion are followed below without starting it over
  useLayoutEffect(() => {
    const root = svg.current;
    const gooLayer = goo.current;
    const pictures = ownLayer.current;
    const layer = cellsLayer.current;
    if (!root || !gooLayer || !pictures || !layer) return;
    // a run that is over, one this window already showed, one past its first round, or reduced motion: the finished pile at once
    const finished = !running || reduced || settled || played.has(runId);
    const sim = new HeavyDivisionSim({ size, reduced, rest: finished ? count : 0 });
    const body = boxOf(measureBody.current, { cx: 50, cy: 50, span: 84 });
    const eyes = boxOf(measureEyes.current, { cx: body.cx, cy: body.cy, span: 1 });
    const scale = size / body.span;
    const ring = f2((2 * RING) / scale);
    const nodes = new Map<number, CellNodes>();
    const state: Live = { sim, running, span: body.span, kick: () => {}, repaint: () => {} };
    live.current = state;
    const element = <K extends keyof SVGElementTagNameMap>(name: K, parent: Element): SVGElementTagNameMap[K] => {
      const node = document.createElementNS(SVG, name) as SVGElementTagNameMap[K];
      parent.append(node);
      return node;
    };
    const use = (href: string, parent: Element): SVGUseElement => {
      const node = element("use", parent);
      node.setAttribute("href", `#${uid}-${href}`);
      return node;
    };
    const nodesOf = (cell: DivisionCell): CellNodes => {
      let made = nodes.get(cell.id);
      if (!made) {
        const group = document.createElementNS(SVG, "g");
        group.setAttribute("data-heavy-cell", "");
        const solid = element("g", group);
        const edge = use("edge", solid);
        edge.setAttribute("fill", "var(--color-app)");
        edge.setAttribute("stroke", "var(--color-app)");
        edge.setAttribute("stroke-width", ring);
        edge.setAttribute("stroke-linejoin", "round");
        const fill = use("body", solid);
        const shade = use("edge", group);
        shade.setAttribute("fill", `url(#${uid}-shade)`);
        shade.setAttribute("data-heavy-shade", "");
        const face = use("eyes", group);
        face.setAttribute("data-heavy-eyes", "");
        // the membrane: the bot's own silhouette, blurred then cut at a threshold with its sisters
        const membrane = document.createElementNS(SVG, "use");
        membrane.setAttribute("href", `#${uid}-body`);
        membrane.setAttribute("data-heavy-membrane", "");
        made = { body: membrane, own: null, group, solid, fill, picture: null, shade, eyes: face, expert: -2 };
        nodes.set(cell.id, made);
      }
      return made;
    };
    let width = "";
    let order = "";
    let blurred = -1;
    let painted = "";
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
          made.own?.remove();
          made.group.remove();
          nodes.delete(id);
        }
        for (const cell of cells) {
          const made = nodesOf(cell);
          layer.append(made.group);
          gooLayer.append(made.body);
          if (made.own) pictures.append(made.own);
        }
        root.setAttribute("data-heavy-cells", String(cells.length));
      }
      const { art: look, failed: dim } = paint.current;
      const worn = stills.current;
      // a colour, a still or a failure changed: every cell is painted again
      const paintKey = `${look.color}|${look.ink}|${look.shaded}|${dim}|${worn ? worn.experts.length : -1}|${worn?.own ? 1 : 0}`;
      if (paintKey !== painted) {
        painted = paintKey;
        for (const made of nodes.values()) made.expert = -2;
      }
      for (const cell of cells) {
        const made = nodes.get(cell.id)!;
        const r = Math.max(0.5, cell.r + (alive ? Math.sin(seconds * 2 + cell.phase) * 0.25 * sim.geometry.unit : 0));
        const y = size / 2 + (alive ? Math.sin(seconds * 1.3 + cell.phase) * 0.35 * sim.geometry.unit : 0);
        const k = (scale * r) / sim.geometry.radius;
        const at = `translate(${f2(cell.x)} ${f2(y)}) scale(${Math.round(k * 10000) / 10000}) translate(${f2(-body.cx)} ${f2(-body.cy)})`;
        if (made.expert !== cell.expert) {
          made.expert = cell.expert;
          const colours = cell.expert >= 0 ? expertPaint(cell.expert) : { color: look.color, ink: look.ink };
          made.fill.setAttribute("fill", colours.color);
          made.eyes.style.color = colours.ink;
          if (cell.expert >= 0) made.group.setAttribute("data-heavy-expert", String(cell.expert + 1));
          else made.group.removeAttribute("data-heavy-expert");
          const gone = cell.expert >= 0 && dim[cell.expert] === "1";
          if (gone) made.group.setAttribute("data-heavy-failed", "");
          else made.group.removeAttribute("data-heavy-failed");
          made.fill.setAttribute("opacity", gone ? String(FAILED_OPACITY) : "1");
          // the material's stills: the expert's in its cell, the bot's over its own body while nothing divides
          const picture = cell.expert >= 0 ? worn?.experts[cell.expert % AGENT_COLORS.length] ?? null : null;
          if (picture) {
            made.picture ??= element("image", made.solid);
            placeImage(made.picture, picture);
            made.picture.setAttribute("opacity", gone ? String(FAILED_OPACITY) : "1");
            made.picture.removeAttribute("display");
            made.fill.setAttribute("display", "none");
          } else {
            made.picture?.setAttribute("display", "none");
            made.fill.removeAttribute("display");
          }
          if (worn?.own) {
            if (!made.own) {
              made.own = element("image", pictures);
              made.own.setAttribute("data-heavy-own", "");
            }
            placeImage(made.own, worn.own);
          } else {
            made.own?.remove();
            made.own = null;
          }
        }
        const lost = cell.expert >= 0 && dim[cell.expert] === "1" ? FAILED_OPACITY : 1;
        const pictured = made.picture !== null && made.picture.getAttribute("display") !== "none";
        // how much of the cell a material still covers: the expert's as it takes its colour, the bot's while nothing divides
        // (the bot's only on a cell that is still the bot: an expert crosses from the flat membrane straight to its own)
        const own = made.own && cell.expert < 0 ? (1 - sim.melt) * (1 - cell.tint) : 0;
        const cover = Math.min(1, (pictured ? cell.tint : 0) + own);
        made.body.setAttribute("transform", at);
        made.body.setAttribute("opacity", f2((1 - cell.tint) * (1 - own)));
        if (made.own) {
          made.own.setAttribute("transform", at);
          made.own.setAttribute("opacity", f2(own));
        }
        made.solid.setAttribute("transform", at);
        made.solid.setAttribute("opacity", f2(cell.tint));
        // the mock-up's volume on a flat cell that stands for a material: on while the cell has its eyes or its colour
        made.shade.setAttribute("transform", at);
        made.shade.setAttribute("opacity", f2(look.shaded ? Math.max(cell.tint, cell.face * 0.9) * (1 - cover) * lost : 0));
        // the eyes close toward their own middle as they go, and blink now and then while the cell lives; a still has its own
        const blink = alive && Math.sin(seconds * 0.9 + cell.phase * 3) > 0.985 ? 0.15 : 1;
        const open = Math.max(0, cell.face);
        made.eyes.setAttribute("transform", `${at} translate(${f2(eyes.cx)} ${f2(eyes.cy)}) scale(${f2(open)} ${f2(open * blink)}) translate(${f2(-eyes.cx)} ${f2(-eyes.cy)})`);
        made.eyes.setAttribute("opacity", f2(open * (1 - cover) * lost));
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
    state.repaint = () => draw(performance.now() / 1000);
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
        made.own?.remove();
        made.group.remove();
      }
      live.current = null;
    };
    // the count, the run's state and the look's colours are followed below, without starting the drawing over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.frame, runId, size, uid]);

  useEffect(() => {
    const state = live.current;
    if (!state) return;
    state.running = running;
    if (state.sim.reduced !== reduced) {
      state.sim.reduced = reduced;
      // turned on mid-run: whatever was moving lands where it was going
      if (reduced) state.sim.advance(0);
    }
    state.sim.setCount(count);
    state.kick();
  }, [count, running, runId, reduced]);

  useEffect(() => {
    live.current?.repaint();
  }, [art.color, art.ink, art.shaded, failedKey]);

  // the material's stills, the bot's and one per expert of the run, painted once per look and kept
  const material = art.material;
  const experts = Math.min(count, AGENT_COLORS.length);
  useEffect(() => {
    if (!material) {
      if (stills.current) {
        stills.current = null;
        live.current?.repaint();
      }
      return;
    }
    let alive = true;
    const px = Math.ceil((100 * size) / (live.current?.span ?? 84));
    const wanted = [{ color: art.color, ink: art.ink }, ...Array.from({ length: experts }, (_, index) => expertPaint(index))];
    void Promise.all(wanted.map((colours) => materialStill({ definition: material.definition, material: material.finish, color: colours.color, ink: colours.ink, depth: material.depth, state: material.state, mood: material.mood, px })))
      .then(([own, ...painted]) => {
        if (!alive) return;
        stills.current = { own: own ?? null, experts: painted };
        live.current?.repaint();
      });
    return () => {
      alive = false;
    };
  }, [material, art.color, art.ink, experts, size]);

  // the width and the view box follow the cells: the drawing writes them, so the text stays against the pile
  return (
    <svg ref={svg} data-heavy-division="rest" data-heavy-avatars="" data-shape={art.shape} data-heavy-material={material ? material.finish.id : undefined}
      role="img" aria-label={count > 0 ? t("heavy.avatars", { count }) : undefined} aria-hidden={count > 0 ? undefined : true}
      className="block shrink-0 overflow-visible" height={size}>
      <defs>
        {/* the membrane: a blur, then a threshold on its alpha, under the cells themselves */}
        <filter id={`${uid}-goo`} x="-30%" y="-60%" width="160%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={blur} in="SourceGraphic" stdDeviation={f2(GOO * (size / 2))} result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* the mock-up's volume, for a flat cell that stands for a material */}
        <radialGradient id={`${uid}-shade`} cx="34%" cy="26%" r="82%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <defs dangerouslySetInnerHTML={{ __html: defs }} />
      <use ref={measureBody} href={`#${uid}-body`} visibility="hidden" />
      <use ref={measureEyes} href={`#${uid}-eyes`} visibility="hidden" />
      <g ref={goo} fill={art.color} />
      <g ref={ownLayer} />
      <g ref={cellsLayer} />
    </svg>
  );
}
