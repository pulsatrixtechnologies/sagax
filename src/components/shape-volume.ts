// The shapes' pose and paint (2026-10-18): our own outlines (shape-art.ts),
// each drawn as a solid, softly rounded body in one flat colour, the bot's own
// (no gradient, no highlight, no filter, no raster: crisp at any size).
// - The body is a few slices of one outline, stacked in depth and turned with
//   the pose (yaw, pitch, a little roll), so it shows a side when it turns.
// - A turn out of the picture plane also bends the outline in a gentle
//   perspective (warpPath): the shape rounds into the turn and its top stays
//   on top, instead of rocking flat.
// - Two opaque eyes in a solid ink (dark, or light on a dark body), capsules
//   at rest, wide ovals while busy, full arches when pleased (styledEyes).
// - Every shape stands on the same ground (groundLift) at a size of its own
//   (SHAPE_FIT), so a list of bots rests on one line.
// ShapeMascot.tsx draws it and shape-motion.ts moves it.
import { mixHex } from "./shape-engine";
import { radiusAt, SHAPE_RADII } from "./shape-art";
import type { MascotShape } from "../../shared/mascot-look";

/**
 * The resting pose: `yaw` degrees to the right, `pitch` degrees up, `roll`
 * degrees in the picture plane, the scale in the box and a lift (box units,
 * up is negative) that sets the ground. Every slice of the body is a turned
 * copy of one outline, so the silhouette is a few <use> of one path.
 */
export const POSE = { yaw: 14, pitch: 10, roll: -6, scale: 0.83, lift: -4.6 } as const;

/** The body's half thickness (box units) and how its edge rounds: a slice at depth z is scaled by core + (1 - core) * sqrt(1 - (z / depth)^2). */
export const BODY_3D = { depth: 15, core: 0.86, slices: { tiny: 4, small: 6, full: 9 } } as const;

/** Below `small` px the hairline of a white or black body is drawn thicker. */
export const VOLUME_SIZES = { small: 20, full: 28 } as const;

export type VolumeDetail = "tiny" | "small" | "full";

export function volumeDetail(size: number): VolumeDetail {
  if (size < VOLUME_SIZES.small) return "tiny";
  if (size < VOLUME_SIZES.full) return "small";
  return "full";
}

const RAD = Math.PI / 180;
type M3 = [number, number, number, number, number, number, number, number, number];
const mul = (p: M3, q: M3): M3 => [
  p[0] * q[0] + p[1] * q[3] + p[2] * q[6], p[0] * q[1] + p[1] * q[4] + p[2] * q[7], p[0] * q[2] + p[1] * q[5] + p[2] * q[8],
  p[3] * q[0] + p[4] * q[3] + p[5] * q[6], p[3] * q[1] + p[4] * q[4] + p[5] * q[7], p[3] * q[2] + p[4] * q[5] + p[5] * q[8],
  p[6] * q[0] + p[7] * q[3] + p[8] * q[6], p[6] * q[1] + p[7] * q[4] + p[8] * q[7], p[6] * q[2] + p[7] * q[5] + p[8] * q[8],
];

/** A pose at one moment: the turn (degrees), the scale and a small lift (box units, up is negative). */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  lift: number;
}

/**
 * Every shape stands on the same ground: its lowest point sits where the
 * heart's does (the shape the rest pose was measured on), so a sidebar of bots
 * rests on one line instead of each floating at its own height. Box units.
 */
export function groundLift(shape: MascotShape): number {
  const down = (s: MascotShape) => radiusAt(SHAPE_RADII[s], Math.PI) * SHAPE_FIT[s];
  return POSE.scale * 40 * (down("bean") - down(shape));
}

/**
 * Each shape's size in the frame, set by eye (the heart sets
 * the pose's scale): rounder and squarer bodies fill more of the box than a
 * heart, so they are drawn a little smaller to look the same size.
 */
export const SHAPE_FIT: Readonly<Record<MascotShape, number>> = {
  circle: 0.9,
  bean: 1,
  squircle: 0.88,
  pill: 0.92,
  pick: 0.98,
  hexagon: 0.86,
  cloud: 0.94,
  drop: 1,
};

/** The resting pose. */
export const REST_POSE: Pose = { yaw: POSE.yaw, pitch: POSE.pitch, roll: POSE.roll, scale: POSE.scale, lift: POSE.lift };

/** The pose's rotation (x right, y down, z toward the viewer): pitch, then yaw, then roll. */
export function poseRotation(pose: Pose = REST_POSE): M3 {
  const p = pose.pitch * RAD;
  const y = pose.yaw * RAD;
  const r = pose.roll * RAD;
  const rx: M3 = [1, 0, 0, 0, Math.cos(p), -Math.sin(p), 0, Math.sin(p), Math.cos(p)];
  const ry: M3 = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const rz: M3 = [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0, 0, 0, 1];
  return mul(rz, mul(ry, rx));
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** How much a turn narrows the body (a fraction of 1 - cos(angle)): kept light so a shape never looks squashed. */
export const TURN_SQUASH = 0;

/**
 * The slice of the body at depth z (box units), scaled by s, as an SVG matrix
 * around the box's middle. A soft 3D: the outline is never sheared, only
 * turned in the picture plane (roll), narrowed a little along its own axes by
 * the yaw and the pitch, and moved along the depth's direction, so every
 * slice is the same clean shape and the silhouette stays the shape itself.
 */
function sliceMatrix(z: number, s: number, pose: Pose, _R?: M3): string {
  const k = pose.scale;
  const yaw = pose.yaw * RAD;
  const pitch = pose.pitch * RAD;
  const roll = pose.roll * RAD;
  const sx = s * k * (1 - TURN_SQUASH * (1 - Math.cos(yaw)));
  const sy = s * k * (1 - TURN_SQUASH * (1 - Math.cos(pitch)));
  // the depth shows toward the turn: the face moves up and right, the back down and left
  const dx = z * Math.sin(yaw) * k;
  const dy = -z * Math.sin(pitch) * k;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const a = cr * sx;
  const b = sr * sx;
  const c = -sr * sy;
  const d = cr * sy;
  const tx = cr * dx - sr * dy;
  const ty = sr * dx + cr * dy;
  const e = 50 + tx - (a * 50 + c * 50);
  const f = 50 + pose.lift + ty - (b * 50 + d * 50);
  return `matrix(${round4(a)} ${round4(b)} ${round4(c)} ${round4(d)} ${round4(e)} ${round4(f)})`;
}

const sliceScale = (z: number) => BODY_3D.core + (1 - BODY_3D.core) * Math.sqrt(Math.max(0, 1 - (z / BODY_3D.depth) ** 2));
const FRONT = BODY_3D.depth * 0.82;

/** The eyes sit on the face's dome, in front of the flat face: they move further up and right as the body turns. */
export const EYE_DOME = 1.25;

/** Every matrix of one pose: the slices behind the face (back to front), the face, and the eyes on its dome. */
export interface PoseMatrices {
  slices: string[];
  face: string;
  eyes: string;
  /** Where the face's outline sits seen from the eyes' own space (they are clipped to it, so a turn never lifts them off the body). */
  eyesClip: string;
}

export function poseMatrices(detail: VolumeDetail, pose: Pose = REST_POSE): PoseMatrices {
  const R = poseRotation(pose);
  const n = BODY_3D.slices[detail];
  const slices = Array.from({ length: n - 1 }, (_, i) => {
    const z = -BODY_3D.depth + ((FRONT + BODY_3D.depth) * i) / (n - 1);
    return sliceMatrix(z, sliceScale(z), pose, R);
  });
  // the eyes and the face share their linear part and differ by a shift along the
  // depth's direction; seen from the eyes' space the face's outline is that shift undone
  const dz = FRONT * (1 - EYE_DOME);
  const lx = (dz * Math.sin(pose.yaw * RAD)) / (sliceScale(FRONT) * (1 - TURN_SQUASH * (1 - Math.cos(pose.yaw * RAD))));
  const ly = (-dz * Math.sin(pose.pitch * RAD)) / (sliceScale(FRONT) * (1 - TURN_SQUASH * (1 - Math.cos(pose.pitch * RAD))));
  return {
    slices,
    face: sliceMatrix(FRONT, sliceScale(FRONT), pose, R),
    eyes: sliceMatrix(FRONT * EYE_DOME, sliceScale(FRONT), pose, R),
    eyesClip: `translate(${round4(lx)} ${round4(ly)})`,
  };
}

/** The resting face's matrix (skins, the badge and a move's extras sit on it). */
export const viewTransform = (pose: Pose = REST_POSE): string => poseMatrices("small", pose).face;

/**
 * The turn out of the picture plane, as a gentle perspective
 * on the outline itself: a shape turned to its right narrows a little and its
 * near side grows taller than its far side; tilted up, its top widens. The
 * top stays on top (a heart's lobes never tip over) and the shape rounds into
 * the turn like a solid, instead of rocking flat.
 */
export const OUT_OF_PLANE = { perspective: 0.34, narrow: 0.3 } as const;

/** One point of the outline (box units) under the pose's out-of-plane turn. */
function warpPoint(x: number, y: number, sy: number, cy: number, sp: number, cp: number): [number, number] {
  const u = (x - 50) / 40;
  const v = (y - 50) / 40;
  const across = 1 - OUT_OF_PLANE.narrow * (1 - cy);
  const down = 1 - OUT_OF_PLANE.narrow * (1 - cp);
  const tall = 1 + OUT_OF_PLANE.perspective * u * sy;
  const wide = 1 - OUT_OF_PLANE.perspective * v * sp;
  return [50 + 40 * u * across * wide, 50 + 40 * v * down * tall];
}

/** A path (absolute M/C/L/Q/Z with number pairs, as the engine writes them) under the pose's out-of-plane turn. */
export function warpPath(d: string, pose: Pose): string {
  if (!d) return d;
  const sy = Math.sin(pose.yaw * RAD);
  const cy = Math.cos(pose.yaw * RAD);
  const sp = Math.sin(pose.pitch * RAD);
  const cp = Math.cos(pose.pitch * RAD);
  // the engine writes absolute commands with number pairs (x y): bend each pair
  const out: string[] = [];
  const re = /([A-Za-z])|(-?\d*\.?\d+(?:e-?\d+)?)/g;
  let x: number | null = null;
  for (const m of d.matchAll(re)) {
    if (m[1]) {
      out.push(m[1]);
      continue;
    }
    const v = Number(m[2]);
    if (x === null) {
      x = v;
      continue;
    }
    const [wx, wy] = warpPoint(x, v, sy, cy, sp, cp);
    const last = out[out.length - 1];
    // a space between two pairs that follow one another (C x y x y x y)
    out.push(`${last && !/[A-Za-z]$/.test(last) ? " " : ""}${round2(wx)} ${round2(wy)}`);
    x = null;
  }
  return out.join("");
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** How a mood draws the eyes: the capsules, wide ovals (busy), or arcs (pleased, ^ ^). */
export type EyeStyle = "capsule" | "oval" | "arc";

export function eyeStyleFor(mood: string): EyeStyle {
  if (mood === "working" || mood === "streaming") return "oval";
  if (mood === "happy" || mood === "done") return "arc";
  return "capsule";
}

/** Each eye's box from the eyes' path (one closed subpath per eye). */
function eyeBoxes(eyes: string): { cx: number; cy: number; w: number; h: number }[] {
  return eyes
    .split("M")
    .filter(Boolean)
    .map((sub) => {
      const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i + 1 < n.length; i += 2) {
        x0 = Math.min(x0, n[i]);
        x1 = Math.max(x1, n[i]);
        y0 = Math.min(y0, n[i + 1]);
        y1 = Math.max(y1, n[i + 1]);
      }
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    })
    .filter((b) => Number.isFinite(b.w));
}

/** The eyes drawn in a style. Capsules are the engine's own; ovals and arcs are built on each eye's box, so they follow it (pose, gaze, blink). */
export function styledEyes(eyes: string, style: EyeStyle): string {
  if (style === "capsule" || !eyes) return eyes;
  const boxes = eyeBoxes(eyes);
  // two eyes never touch: an oval or an arch stays within its share of the gap between them
  const gap = boxes.length > 1 ? Math.abs(boxes[1].cx - boxes[0].cx) : Infinity;
  return boxes
    .map(({ cx, cy, w, h }) => {
      // the eye's width holds through a blink (its height closes), so the size follows the width
      const size = Math.max(w * 2.2, 0.01);
      // a blink still closes them: the box's height follows the lid
      const open = Math.min(1, h / Math.max(w * 1.6, 0.01));
      if (style === "oval") {
        const rx = Math.min(size * 0.46, gap * 0.44);
        const ry = Math.max(0.4, size * 0.33 * open);
        return `M${round2(cx - rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx + rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx - rx)} ${round2(cy)}Z`;
      }
      // pleased (∩ ∩): a full, thick half-moon arch, low in the face and centred on the eye
      const hw = Math.min(Math.max(w * 1.35, h * 0.44), gap * 0.42);
      const hh = hw * 0.9 * Math.max(0.25, open);
      const t = Math.max(1.2, hw * 0.72);
      const y = cy + size * 0.36;
      const ix = Math.max(0.2, hw - t);
      const iy = Math.max(0.15, hh - t);
      return `M${round2(cx - hw)} ${round2(y)}A${round2(hw)} ${round2(hh)} 0 0 1 ${round2(cx + hw)} ${round2(y)}L${round2(cx + ix)} ${round2(y)}A${round2(ix)} ${round2(iy)} 0 0 0 ${round2(cx - ix)} ${round2(y)}Z`;
    })
    .join("");
}

/** What writePose last wrote on each drawing (it skips unchanged outlines and eyes). */
const written = new WeakMap<object, { key: string; body: string; eyesKey: string; eyes: string }>();

/** Write a pose onto a drawing of ShapeFrameSvg: the turned outline, the eyes, and the slices, the face and the eyes' matrices. */
export function writePose(svg: Pick<SVGSVGElement, "querySelectorAll">, detail: VolumeDetail, pose: Pose, frame?: { body: string; eyes: string }, style: EyeStyle = "capsule", bend = true): void {
  if (frame) {
    // at rest the turn holds still: the bent outline is kept and only rewritten when it changes
    const memo = written.get(svg) ?? { key: "", body: "", eyesKey: "", eyes: "" };
    const key = bend ? `${pose.yaw.toFixed(2)}|${pose.pitch.toFixed(2)}|` : "";
    if (memo.key !== key + frame.body) {
      memo.key = key + frame.body;
      memo.body = bend ? warpPath(frame.body, pose) : frame.body;
      svg.querySelectorAll("[data-shape-outline]").forEach((node) => node.setAttribute("d", memo.body));
    }
    const eyesKey = key + style + frame.eyes;
    if (memo.eyesKey !== eyesKey) {
      memo.eyesKey = eyesKey;
      memo.eyes = styledEyes(bend ? warpPath(frame.eyes, pose) : frame.eyes, style);
      svg.querySelectorAll("[data-shape-eyes]").forEach((node) => node.setAttribute("d", memo.eyes));
    }
    written.set(svg, memo);
  }
  const m = poseMatrices(detail, pose);
  svg.querySelectorAll("[data-pose-slice]").forEach((node) => {
    const i = Number(node.getAttribute("data-pose-slice"));
    const t = i < 0 ? m.face : m.slices[i];
    if (t) node.setAttribute("transform", t);
  });
  svg.querySelectorAll("[data-pose-face]").forEach((node) => node.setAttribute("transform", m.face));
  svg.querySelectorAll("[data-pose-eyes]").forEach((node) => node.setAttribute("transform", m.eyes));
  svg.querySelectorAll("[data-pose-eyes-clip]").forEach((node) => node.setAttribute("transform", m.eyesClip));
}

const relativeLuminance = (hex: string): number => {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

/** The eyes' two inks, both opaque. */
export const EYE_INK = "#16181d";
export const EYE_INK_ON_DARK = "#f4f1ea";

/** One body colour's paints: the flat fill, a hairline for a near-white or near-black body (null otherwise) and the eyes' ink. */
export interface InkPaint {
  fill: string;
  edge: string | null;
  eyes: string;
}

export function inkPaint(hex: string): InkPaint {
  const lum = relativeLuminance(hex);
  return {
    fill: mixHex(hex, hex, 0),
    // a near-white body would vanish on a light ground, a near-black one on a dark ground:
    // a faint hairline of the other ink keeps its silhouette
    edge: lum > 0.7 ? "#000000" : lum < 0.03 ? "#ffffff" : null,
    eyes: lum < 0.05 ? EYE_INK_ON_DARK : EYE_INK,
  };
}
