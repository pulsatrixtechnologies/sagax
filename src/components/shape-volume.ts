// The shapes' pose and paint (2026-10-18, one drawing since 2026-10-28):
// our own outlines (shape-art.ts), each drawn as a solid, softly rounded
// body in one flat colour, the bot's own (no gradient, no highlight, no
// filter, no raster: crisp at any size).
// - The body is a few slices of one outline, stacked in depth and turned
//   with the pose (a little roll; the yaw and pitch are the resting turn,
//   always), so it shows a side.
// - The resting turn bends the outline in a gentle perspective (warpPath):
//   the shape rounds into it and its top stays on top. A sway or a move
//   never bends it further: the body keeps its proportions.
// - Two opaque eyes in a solid ink (dark, or light on a dark body), capsules
//   at rest, wide ovals while busy, full arches when pleased (styledEyes),
//   drawn in the face's own group: they go through the very same transforms
//   as the outline, so nothing can ever put them beside it.
// - Every shape stands on the same ground (groundLift) at a size of its own
//   (SHAPE_FIT), so a list of bots rests on one line.
// drawShape turns a frame and a pose into one drawing (writeShape puts it on
// an SVG); shape-motion.ts moves the pose. Since #4145 the app draws the
// shapes with the open-bot-avatar engine (shape-avatar.ts): this drawing is
// the reference the phone's ShapeVolume.swift follows.
import { eyeOutline, mixHex, type ShapeFrame } from "./shape-engine";
import { radiusAt, SHAPE_RADII, smoothClosed } from "./shape-art";
import { BODY_SHAPES, type BodyShape } from "../../shared/mascot-look";

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
 * pebble's does (stored id bean, the shape the rest pose was measured on), so a sidebar of bots
 * rests on one line instead of each floating at its own height. Box units.
 */
export function groundLift(shape: BodyShape): number {
  const down = (s: BodyShape) => radiusAt(SHAPE_RADII[s], Math.PI) * SHAPE_FIT[s];
  return POSE.scale * 40 * (down("bean") - down(shape));
}

/** The size every shape is drawn at, as if it were a circle of this many R. */
export const FIT = { circle: 0.9, min: 0.78, max: 1.04, reach: 1.08 } as const;

/**
 * Each shape's size in the frame (2026-10-28, measured, no longer set by eye
 * per shape): a body is drawn at the size of a circle of the same area, so a
 * narrow tube and a wide cloud look alike in a list, never reaching past
 * FIT.reach R from the middle.
 */
export function shapeFit(shape: BodyShape): number {
  const radii = SHAPE_RADII[shape];
  const area = radii.reduce((sum, r) => sum + r * r, 0) * (Math.PI / radii.length);
  const reach = radii.reduce((most, r) => Math.max(most, r), 0);
  const fit = FIT.circle * Math.sqrt(Math.PI / area);
  return Math.round(Math.min(FIT.max, FIT.reach / reach, Math.max(FIT.min, fit)) * 1000) / 1000;
}

export const SHAPE_FIT: Readonly<Record<BodyShape, number>> = Object.fromEntries(BODY_SHAPES.map((shape) => [shape, shapeFit(shape)])) as Record<BodyShape, number>;

/** The resting pose. */
export const REST_POSE: Pose = { yaw: POSE.yaw, pitch: POSE.pitch, roll: POSE.roll, scale: POSE.scale, lift: POSE.lift };

/** A pose standing on the shared ground, at the shape's own size. */
export const grounded = (pose: Pose, shape: BodyShape): Pose => ({ ...pose, scale: pose.scale * SHAPE_FIT[shape], lift: pose.lift + groundLift(shape) });

/**
 * The pose the body is drawn in: the resting turn out of the picture plane,
 * whatever the sway or the move asks (2026-10-28). A yaw or a pitch of its
 * own keystoned the outline (a square drawn as a trapezoid) and spread the
 * slices beside the face; now a lean only moves the gaze (ShapeEngine.lean).
 * The roll, the scale and the lift are the pose's own.
 */
export function uprightPose(pose: Pose): Pose {
  return { ...pose, yaw: REST_POSE.yaw, pitch: REST_POSE.pitch };
}

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

/** An SVG matrix as its six numbers (a b c d e f). */
export type Affine = [number, number, number, number, number, number];

/**
 * The slice of the body at depth z (box units), scaled by s, as an SVG matrix
 * around the box's middle. A soft 3D: the outline is never sheared, only
 * turned in the picture plane (roll), narrowed a little along its own axes by
 * the yaw and the pitch, and moved along the depth's direction, so every
 * slice is the same clean shape and the silhouette stays the shape itself.
 */
function sliceMatrix(z: number, s: number, pose: Pose): string {
  const [a, b, c, d, e, f] = sliceNumbers(z, s, pose);
  return `matrix(${round4(a)} ${round4(b)} ${round4(c)} ${round4(d)} ${round4(e)} ${round4(f)})`;
}

export function sliceNumbers(z: number, s: number, pose: Pose): Affine {
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
  return [a, b, c, d, e, f];
}

const sliceScale = (z: number) => BODY_3D.core + (1 - BODY_3D.core) * Math.sqrt(Math.max(0, 1 - (z / BODY_3D.depth) ** 2));
const FRONT = BODY_3D.depth * 0.82;

/** Every matrix of one pose: the slices behind the face (back to front) and the face. */
export interface PoseMatrices {
  slices: string[];
  face: string;
}

/**
 * `depth` is the body's thickness now (ShapeFrame.depth, 0..1): a thin body
 * (a tube, a teardrop's tip) is that much thinner, so its slices stay inside
 * its own outline instead of standing beside it. The pose's yaw and pitch
 * are always the resting turn (uprightPose).
 */
export function poseMatrices(detail: VolumeDetail, pose: Pose = REST_POSE, depth = 1): PoseMatrices {
  const p = uprightPose(pose);
  const n = BODY_3D.slices[detail];
  const k = Math.min(1, Math.max(0, Number.isFinite(depth) ? depth : 1));
  const slices = Array.from({ length: n - 1 }, (_, i) => {
    const z = -BODY_3D.depth + ((FRONT + BODY_3D.depth) * i) / (n - 1);
    return sliceMatrix(z * k, sliceScale(z), p);
  });
  return { slices, face: sliceMatrix(FRONT * k, sliceScale(FRONT), p) };
}

/** The face's matrix as numbers (the slice the eyes sit on). */
export function faceNumbers(pose: Pose, depth = 1): Affine {
  const k = Math.min(1, Math.max(0, Number.isFinite(depth) ? depth : 1));
  return sliceNumbers(FRONT * k, sliceScale(FRONT), uprightPose(pose));
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
export function warpPoint(x: number, y: number, sy: number, cy: number, sp: number, cp: number): [number, number] {
  const u = (x - 50) / 40;
  const v = (y - 50) / 40;
  const across = 1 - OUT_OF_PLANE.narrow * (1 - cy);
  const down = 1 - OUT_OF_PLANE.narrow * (1 - cp);
  const tall = 1 + OUT_OF_PLANE.perspective * u * sy;
  const wide = 1 - OUT_OF_PLANE.perspective * v * sp;
  return [50 + 40 * u * across * wide, 50 + 40 * v * down * tall];
}

/** The bend's sines and cosines for a pose (its resting turn). */
function bendOf(pose: Pose): [number, number, number, number] {
  const p = uprightPose(pose);
  return [Math.sin(p.yaw * RAD), Math.cos(p.yaw * RAD), Math.sin(p.pitch * RAD), Math.cos(p.pitch * RAD)];
}

/** A path (absolute M/C/L/Q/Z with number pairs, as the engine writes them) under the pose's out-of-plane turn. */
export function warpPath(d: string, pose: Pose): string {
  if (!d) return d;
  const [sy, cy, sp, cp] = bendOf(pose);
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

/** The body's motion (ShapeFrame.motion: shift, turn about the middle, scale about the middle) as numbers. */
export function motionNumbers(motion: { x: number; y: number; rot: number; sx: number; sy: number }): Affine {
  const r = motion.rot * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // translate(x y) rotate(rot 50 50) translate(50 50) scale(sx sy) translate(-50 -50)
  const a = cos * motion.sx;
  const b = sin * motion.sx;
  const c = -sin * motion.sy;
  const d = cos * motion.sy;
  // the middle (50, 50) stays put under the scale and the turn, then the shift
  const e = motion.x + 50 - (a * 50 + c * 50);
  const f = motion.y + 50 - (b * 50 + d * 50);
  return [a, b, c, d, e, f];
}

/** A point under an affine matrix. */
export const applyAffine = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Two affine matrices composed: p after q. */
export const composeAffine = (p: Affine, q: Affine): Affine => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];

/** The face's matrix in the drawing's own space: the body's motion, then the face. */
export function faceInDrawing(motion: { x: number; y: number; rot: number; sx: number; sy: number }, pose: Pose, depth = 1): Affine {
  return composeAffine(motionNumbers(motion), faceNumbers(pose, depth));
}

/** How a mood draws the eyes: the capsules, wide ovals (busy), or arcs (pleased, ^ ^). */
export type EyeStyle = "capsule" | "oval" | "arc";

export function eyeStyleFor(mood: string): EyeStyle {
  if (mood === "working" || mood === "streaming") return "oval";
  if (mood === "happy" || mood === "done") return "arc";
  return "capsule";
}

type Point = [number, number];

/** The on-curve points of a path the engine wrote (M, then each C's end point), first subpath. */
export function outlinePoints(d: string): Point[] {
  if (!d) return [];
  const n = d.split("M")[1]?.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (n.length < 2) return [];
  const pts: Point[] = [[n[0], n[1]]];
  for (let i = 2; i + 5 < n.length; i += 6) pts.push([n[i + 4], n[i + 5]]);
  return pts;
}

function insidePolygon(poly: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** One eye as the drawing shows it: a capsule (the engine's own), a wide oval (busy) or an arch (pleased), about its middle. */
export type StyledEye =
  | { kind: "capsule"; cx: number; cy: number; w: number; h: number; tilt: number }
  | { kind: "oval"; cx: number; cy: number; rx: number; ry: number }
  /** The pleased arch: a half ellipse hw x hh over its baseline y, `t` thick (ix, iy the inner half ellipse); cy is the eye's own middle, which a shrink is measured from. */
  | { kind: "arc"; cx: number; cy: number; y: number; hw: number; hh: number; ix: number; iy: number };

/** The eye scaled by `k` about its middle (an arch about the middle of its baseline). */
function scaledEye(eye: StyledEye, k: number): StyledEye {
  switch (eye.kind) {
    case "capsule":
      return { ...eye, w: eye.w * k, h: eye.h * k };
    case "oval":
      return { ...eye, rx: eye.rx * k, ry: eye.ry * k };
    default:
      return { ...eye, y: eye.cy + (eye.y - eye.cy) * k, hw: eye.hw * k, hh: eye.hh * k, ix: eye.ix * k, iy: eye.iy * k };
  }
}

/** Points along the eye's edge, to test it against the outline. */
export function eyePoints(eye: StyledEye): Point[] {
  if (eye.kind === "capsule") return eyeOutline(eye.cx, eye.cy, eye.w, eye.h, eye.tilt);
  const pts: Point[] = [];
  if (eye.kind === "oval") {
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([eye.cx + eye.rx * Math.cos(a), eye.cy + eye.ry * Math.sin(a)]);
    }
    return pts;
  }
  for (let i = 0; i <= 24; i += 1) {
    const a = Math.PI + (i / 24) * Math.PI;
    pts.push([eye.cx + eye.hw * Math.cos(a), eye.y + eye.hh * Math.sin(a)]);
  }
  return pts;
}

/** The eye as a closed path (box units). */
export function eyePath(eye: StyledEye): string {
  if (eye.kind === "capsule") return smoothClosed(eyeOutline(eye.cx, eye.cy, eye.w, eye.h, eye.tilt));
  if (eye.kind === "oval") {
    const { cx, cy, rx, ry } = eye;
    return `M${round2(cx - rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx + rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx - rx)} ${round2(cy)}Z`;
  }
  const { cx, y, hw, hh, ix, iy } = eye;
  return `M${round2(cx - hw)} ${round2(y)}A${round2(hw)} ${round2(hh)} 0 0 1 ${round2(cx + hw)} ${round2(y)}L${round2(cx + ix)} ${round2(y)}A${round2(ix)} ${round2(iy)} 0 0 0 ${round2(cx - ix)} ${round2(y)}Z`;
}

/** The pleased arch and the busy oval, built on an eye's box (its width holds through a blink; its height follows the lid). */
function styledEye(box: { cx: number; cy: number; w: number; h: number }, style: EyeStyle, gap: number): StyledEye | null {
  const { cx, cy, w, h } = box;
  const size = Math.max(w * 2.2, 0.01);
  const open = Math.min(1, h / Math.max(w * 1.6, 0.01));
  if (style === "oval") {
    const rx = Math.min(size * 0.46, gap * 0.44);
    const ry = Math.max(0.4, size * 0.33 * open);
    return { kind: "oval", cx, cy, rx, ry };
  }
  if (style === "arc") {
    // (∩ ∩): a full, thick half-moon arch, low in the face and centred on the eye
    const hw = Math.min(Math.max(w * 1.35, h * 0.44), gap * 0.42);
    const hh = hw * 0.9 * Math.max(0.25, open);
    const t = Math.max(1.2, hw * 0.72);
    return { kind: "arc", cx, cy, y: cy + size * 0.36, hw, hh, ix: Math.max(0.2, hw - t), iy: Math.max(0.15, hh - t) };
  }
  return null;
}

/**
 * The eyes on the face, in the face's own space (box units, before the
 * face's and the motion's matrices, which the drawing applies to the outline
 * and the eyes alike): each capsule's middle bent with the outline, the
 * capsule itself upright on screen (the pose's roll undone), the two eyes
 * one level pair of the same size, in the mood's style; then both shrunk
 * alike, about their middles, until every point of them sits inside the
 * outline the drawing shows (an oval or an arch is wider than the capsule
 * the engine fitted).
 */
export function faceEyes(frame: Pick<ShapeFrame, "eyeShapes">, pose: Pose, bend: boolean, style: EyeStyle = "capsule", outline: readonly Point[] = []): StyledEye[] {
  if (!frame.eyeShapes.length) return [];
  const [sy, cy, sp, cp] = bendOf(pose);
  const tilt = bend ? -pose.roll : 0;
  const centers = frame.eyeShapes.map((eye) => (bend ? warpPoint(eye.x, eye.y, sy, cy, sp, cp) : ([eye.x, eye.y] as Point)));
  const level = centers.length === 2 ? (centers[0][1] + centers[1][1]) / 2 : null;
  const capsules: StyledEye[] = frame.eyeShapes.map((eye, i) => ({ kind: "capsule", cx: centers[i][0], cy: level ?? centers[i][1], w: eye.w, h: eye.h, tilt: eye.tilt + tilt }));
  const gap = capsules.length > 1 ? Math.abs(capsules[1].cx - capsules[0].cx) : Infinity;
  let eyes: StyledEye[] = capsules.map((eye) => {
    if (eye.kind !== "capsule" || style === "capsule") return eye;
    const pts = eyeOutline(eye.cx, eye.cy, eye.w, eye.h, eye.tilt);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    return styledEye({ cx: eye.cx, cy: eye.cy, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, style, gap) ?? eye;
  });
  if (outline.length > 2) {
    const fits = (k: number) => eyes.every((eye) => eyePoints(scaledEye(eye, k)).every(([x, y]) => insidePolygon(outline, x, y)));
    if (!fits(1)) {
      // the largest share of the size that fits, by bisection (an eye point moves out monotonically as it grows)
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 8; i += 1) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      // a hair under the largest share found, so a point between two samples stays inside too
      eyes = eyes.map((eye) => scaledEye(eye, lo * 0.98));
    }
  }
  return eyes;
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

/** The eyes of a path drawn in a style (the flat skins, the phone's fixtures): capsules are the path's own; ovals and arcs are built on each eye's box. */
export function styledEyes(eyes: string, style: EyeStyle): string {
  if (style === "capsule" || !eyes) return eyes;
  const boxes = eyeBoxes(eyes);
  // two eyes never touch: an oval or an arch stays within its share of the gap between them
  const gap = boxes.length > 1 ? Math.abs(boxes[1].cx - boxes[0].cx) : Infinity;
  return boxes
    .map((box) => styledEye(box, style, gap))
    .filter((eye): eye is StyledEye => eye !== null)
    .map(eyePath)
    .join("");
}

/**
 * One drawing of a shape: everything the SVG shows, in the face's own space
 * (box units) plus the matrices that place it. The same drawing comes out of
 * React and of the live loop, so the two can never disagree.
 */
export interface ShapeDrawing {
  /** The outline, bent with the resting turn (a plain body) or flat (a skin's own art). */
  outline: string;
  /** The eyes on the outline, in the face's space, in the mood's style. */
  eyes: string;
  /** The pumpkin's stem in the face's space, or null. */
  stem: { d: string; opacity: number } | null;
  /** A flat skin's body with the eyes cut through it (fill-rule evenodd). */
  cut: string;
  /** The body's motion (drift, breath, a move's turn and size). */
  motion: string;
  /** The slices behind the face (back to front) and the face, as SVG matrices. */
  slices: string[];
  face: string;
  /** The clay light's place (flat skins). */
  light: { x: number; y: number; r: number };
}

/**
 * The one drawing of a frame in a pose. `bend` is true for a plain body (its
 * outline takes the resting turn's perspective; a skin's own art is drawn on
 * the outline at rest).
 */
export function drawShape(frame: ShapeFrame, pose: Pose, detail: VolumeDetail, style: EyeStyle = "capsule", bend = true): ShapeDrawing {
  const m = poseMatrices(detail, pose, frame.depth);
  const outline = bend ? warpPath(frame.body, pose) : frame.body;
  return {
    outline,
    eyes: faceEyes(frame, pose, bend, style, outlinePoints(outline)).map(eyePath).join(""),
    stem: frame.stem ? { d: bend ? warpPath(frame.stem.d, pose) : frame.stem.d, opacity: frame.stem.opacity } : null,
    cut: frame.body + frame.eyes,
    motion: frame.transform,
    slices: m.slices,
    face: m.face,
    light: frame.light,
  };
}

/**
 * Write a drawing onto the SVG ShapeFrameSvg rendered: every part, every
 * time (no memo of what was written before: React may have drawn its own
 * since, and a memo that trusted it left the outline and the eyes of two
 * frames on screen). The only live writer.
 */
export function writeShape(svg: Pick<SVGSVGElement, "querySelectorAll">, drawing: ShapeDrawing): void {
  svg.querySelectorAll("[data-shape-outline]").forEach((node) => node.setAttribute("d", drawing.outline));
  svg.querySelectorAll("[data-shape-face]").forEach((node) => node.setAttribute("d", drawing.outline));
  svg.querySelectorAll("[data-shape-eyes]").forEach((node) => node.setAttribute("d", drawing.eyes));
  svg.querySelectorAll("[data-shape-stem]").forEach((node) => {
    node.setAttribute("d", drawing.stem?.d ?? "");
    node.setAttribute("opacity", String(drawing.stem?.opacity ?? 0));
  });
  svg.querySelectorAll("[data-shape-cut]").forEach((node) => node.setAttribute("d", drawing.cut));
  svg.querySelectorAll("[data-shape-motion]").forEach((node) => node.setAttribute("transform", drawing.motion));
  svg.querySelectorAll("[data-pose-slice]").forEach((node) => {
    const i = Number(node.getAttribute("data-pose-slice"));
    const t = i < 0 ? drawing.face : drawing.slices[i];
    if (t) node.setAttribute("transform", t);
  });
  svg.querySelectorAll("[data-pose-face]").forEach((node) => node.setAttribute("transform", drawing.face));
  svg.querySelectorAll("[data-shape-light]").forEach((light) => {
    light.setAttribute("cx", String(drawing.light.x));
    light.setAttribute("cy", String(drawing.light.y));
    light.setAttribute("r", String(drawing.light.r));
  });
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

/** How far a near-white or near-black body's side is tinted toward the other ink (its slices), so the side reads without a hairline on each slice. */
export const SIDE_TINT = 0.09;

/** One body colour's paints: the flat fill, the side's fill (the slices), a hairline for a near-white or near-black face (null otherwise) and the eyes' ink. */
export interface InkPaint {
  fill: string;
  side: string;
  edge: string | null;
  eyes: string;
}

export function inkPaint(hex: string): InkPaint {
  const lum = relativeLuminance(hex);
  // a near-white body would vanish on a light ground, a near-black one on a dark ground:
  // a faint hairline around the face keeps its silhouette, and its side is tinted a
  // little toward the other ink (2026-10-28: a hairline on every slice drew grey rings
  // peeking out under a white body)
  const edge = lum > 0.7 ? "#000000" : lum < 0.03 ? "#ffffff" : null;
  return {
    fill: mixHex(hex, hex, 0),
    side: edge ? mixHex(hex, edge, SIDE_TINT) : mixHex(hex, hex, 0),
    edge,
    eyes: lum < 0.05 ? EYE_INK_ON_DARK : EYE_INK,
  };
}
