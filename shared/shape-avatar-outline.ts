/**
 * Outline math for path-based Shape bodies (v2.1): flatten validated SVG
 * paths, resample to a fixed point count for morphing, blend outlines, and
 * probe containment. Shared by desktop, server tests and iOS (ported).
 *
 * Path bodies keep concavities and appendages the 64-radii polar form cannot
 * express. Catalogue polar shapes stay on the radii pipeline.
 */
import {
  compileShapeAvatar,
  ellipsePath,
  primitivePath,
  type ShapeAvatarDef,
} from "./shape-avatar-def.ts";

export type OutlinePoint = [number, number];

export const OUTLINE_SAMPLE_COUNT = 64;

const round2 = (value: number) => Math.round(value * 100) / 100;

function tokenizeNumbers(s: string): number[] {
  const re = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) out.push(Number(match[0]));
  return out;
}

function tokenizeCommands(d: string): Array<{ command: string; args: number[] }> {
  const commands: Array<{ command: string; args: number[] }> = [];
  const re = /([MmLlCcQqZz])([^MmLlCcQqZz]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    commands.push({ command: match[1]!, args: tokenizeNumbers(match[2] ?? "") });
  }
  return commands;
}

function pointLineDistance(p: OutlinePoint, a: OutlinePoint, b: OutlinePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

function subdivideCubic(
  p0: OutlinePoint,
  p1: OutlinePoint,
  p2: OutlinePoint,
  p3: OutlinePoint,
  tolerance: number,
  out: OutlinePoint[],
  depth = 0,
): void {
  const d1 = pointLineDistance(p1, p0, p3);
  const d2 = pointLineDistance(p2, p0, p3);
  if (d1 + d2 < tolerance || depth > 24) {
    out.push(p3);
    return;
  }
  const p01: OutlinePoint = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const p12: OutlinePoint = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const p23: OutlinePoint = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const p012: OutlinePoint = [(p01[0] + p12[0]) / 2, (p01[1] + p12[1]) / 2];
  const p123: OutlinePoint = [(p12[0] + p23[0]) / 2, (p12[1] + p23[1]) / 2];
  const mid: OutlinePoint = [(p012[0] + p123[0]) / 2, (p012[1] + p123[1]) / 2];
  subdivideCubic(p0, p01, p012, mid, tolerance, out, depth + 1);
  subdivideCubic(mid, p123, p23, p3, tolerance, out, depth + 1);
}

function subdivideQuad(
  p0: OutlinePoint,
  p1: OutlinePoint,
  p2: OutlinePoint,
  tolerance: number,
  out: OutlinePoint[],
  depth = 0,
): void {
  const d = pointLineDistance(p1, p0, p2);
  if (d < tolerance || depth > 24) {
    out.push(p2);
    return;
  }
  const p01: OutlinePoint = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const p12: OutlinePoint = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const mid: OutlinePoint = [(p01[0] + p12[0]) / 2, (p01[1] + p12[1]) / 2];
  subdivideQuad(p0, p01, mid, tolerance, out, depth + 1);
  subdivideQuad(mid, p12, p2, tolerance, out, depth + 1);
}

/**
 * Flatten absolute/relative M/L/C/Q/Z path data into polylines (one per
 * subpath). Relative commands are resolved; H/V are not used by our schema.
 */
export function flattenPath(d: string, tolerance = 0.08): OutlinePoint[][] {
  const polylines: OutlinePoint[][] = [];
  let current: OutlinePoint[] = [];
  let at: OutlinePoint = [0, 0];
  let start: OutlinePoint = [0, 0];

  for (const { command, args } of tokenizeCommands(d)) {
    const abs = command === command.toUpperCase();
    const letter = command.toUpperCase();
    if (letter === "M") {
      if (current.length > 0) polylines.push(current);
      const x = abs ? args[0]! : at[0] + args[0]!;
      const y = abs ? args[1]! : at[1] + args[1]!;
      at = [x, y];
      start = [x, y];
      current = [at];
      for (let i = 2; i + 1 < args.length; i += 2) {
        const lx = abs ? args[i]! : at[0] + args[i]!;
        const ly = abs ? args[i + 1]! : at[1] + args[i + 1]!;
        at = [lx, ly];
        current.push(at);
      }
    } else if (letter === "L") {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const x = abs ? args[i]! : at[0] + args[i]!;
        const y = abs ? args[i + 1]! : at[1] + args[i + 1]!;
        at = [x, y];
        current.push(at);
      }
    } else if (letter === "C") {
      for (let i = 0; i + 5 < args.length; i += 6) {
        const p1: OutlinePoint = abs
          ? [args[i]!, args[i + 1]!]
          : [at[0] + args[i]!, at[1] + args[i + 1]!];
        const p2: OutlinePoint = abs
          ? [args[i + 2]!, args[i + 3]!]
          : [at[0] + args[i + 2]!, at[1] + args[i + 3]!];
        const p3: OutlinePoint = abs
          ? [args[i + 4]!, args[i + 5]!]
          : [at[0] + args[i + 4]!, at[1] + args[i + 5]!];
        subdivideCubic(at, p1, p2, p3, tolerance, current);
        at = p3;
      }
    } else if (letter === "Q") {
      for (let i = 0; i + 3 < args.length; i += 4) {
        const p1: OutlinePoint = abs
          ? [args[i]!, args[i + 1]!]
          : [at[0] + args[i]!, at[1] + args[i + 1]!];
        const p2: OutlinePoint = abs
          ? [args[i + 2]!, args[i + 3]!]
          : [at[0] + args[i + 2]!, at[1] + args[i + 3]!];
        subdivideQuad(at, p1, p2, tolerance, current);
        at = p2;
      }
    } else if (letter === "Z") {
      if (Math.abs(at[0] - start[0]) > 1e-9 || Math.abs(at[1] - start[1]) > 1e-9) {
        current.push(start);
        at = start;
      }
    }
  }
  if (current.length > 0) polylines.push(current);
  return polylines;
}

function polygonArea(points: readonly OutlinePoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

/** Closed polyline resampled to `count` points by arc length (winding preserved). */
export function resampleClosed(points: readonly OutlinePoint[], count = OUTLINE_SAMPLE_COUNT): OutlinePoint[] {
  if (points.length < 3 || count < 3) return Array.from({ length: count }, () => [50, 50] as OutlinePoint);
  const ring = points.slice();
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) ring.push(first);

  const seg: number[] = [0];
  let total = 0;
  for (let i = 1; i < ring.length; i += 1) {
    total += Math.hypot(ring[i]![0] - ring[i - 1]![0], ring[i]![1] - ring[i - 1]![1]);
    seg.push(total);
  }
  if (total < 1e-6) return Array.from({ length: count }, () => [first[0], first[1]] as OutlinePoint);

  const out: OutlinePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * total;
    let j = 1;
    while (j < seg.length && seg[j]! < target) j += 1;
    const a = ring[j - 1]!;
    const b = ring[j] ?? ring[0]!;
    const t0 = seg[j - 1]!;
    const t1 = seg[j] ?? total;
    const f = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** Smooth closed cubic path through box-unit points (same as shape-art). */
export function smoothClosedOutline(points: readonly OutlinePoint[], tension = 1): string {
  const n = points.length;
  if (n < 3) return "M50 50Z";
  let d = `M${round2(points[0]![0])} ${round2(points[0]![1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const c1: OutlinePoint = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: OutlinePoint = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${round2(c1[0])} ${round2(c1[1])} ${round2(c2[0])} ${round2(c2[1])} ${round2(p2[0])} ${round2(p2[1])}`;
  }
  return `${d}Z`;
}

export function blendOutlines(from: readonly OutlinePoint[], to: readonly OutlinePoint[], t: number): OutlinePoint[] {
  const n = Math.min(from.length, to.length);
  const out: OutlinePoint[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push([from[i]![0] + (to[i]![0] - from[i]![0]) * t, from[i]![1] + (to[i]![1] - from[i]![1]) * t]);
  }
  return out;
}

export function pointInsideOutline(poly: readonly OutlinePoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi) hit = !hit;
  }
  return hit;
}

/** Ray from center (default 50,50) at angle (0 up, clockwise), farthest inside hit in box units. */
export function rayRadiusOutline(
  poly: readonly OutlinePoint[],
  angle: number,
  center: OutlinePoint = [50, 50],
  reach = 55,
): number {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  let lo = 0;
  let hi = reach;
  if (!pointInsideOutline(poly, center[0] + dx * 0.5, center[1] + dy * 0.5)) return 0;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (pointInsideOutline(poly, center[0] + dx * mid, center[1] + dy * mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Align winding so sample 0 is near the top (smallest y), then clockwise.
 * Keeps morphs between unrelated silhouettes from twisting.
 */
export function normalizeOutlineWinding(points: readonly OutlinePoint[]): OutlinePoint[] {
  if (points.length < 3) return [...points];
  let top = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i]![1] < points[top]![1] - 1e-6) top = i;
    else if (Math.abs(points[i]![1] - points[top]![1]) < 1e-6 && points[i]![0] < points[top]![0]) top = i;
  }
  const rotated = points.slice(top).concat(points.slice(0, top));
  // Signed area: positive = counter-clockwise in y-down; we want clockwise.
  let area = 0;
  for (let i = 0; i < rotated.length; i += 1) {
    const a = rotated[i]!;
    const b = rotated[(i + 1) % rotated.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area > 0) {
    const rev = [rotated[0]!, ...rotated.slice(1).reverse()];
    return rev;
  }
  return rotated;
}

export interface LiveShapeOutline {
  /** Exact silhouette path (may include appendages); used when not morphing. */
  path: string;
  /** Extra filled body pieces under the same volume transform. */
  extras: string[];
  /** 64 points for morph / eye probes. */
  points: OutlinePoint[];
  /** Face anchor in box units. */
  face: OutlinePoint;
  eye: { w: number; h: number; gap: number };
  /** True when the body came from path/parts (not polar radii). */
  pathBody: boolean;
}

/** Primary silhouette path for a definition (union of parts into one path string). */
export function silhouettePathFromDef(def: ShapeAvatarDef): { path: string; extras: string[] } {
  if (def.body.kind === "path") return { path: def.body.d, extras: [] };
  if (def.body.kind === "parts") {
    const paths = def.body.parts.map(primitivePath);
    // First part is the main body; remaining parts are appendages drawn with it.
    return { path: paths[0]!, extras: paths.slice(1) };
  }
  return { path: "", extras: [] };
}

/**
 * Build the live outline for an avatarDef. Radii defs leave pathBody false
 * (caller keeps the polar pipeline). Path/parts produce a path body.
 */
export function liveOutlineFromDef(def: ShapeAvatarDef, sampleCount = OUTLINE_SAMPLE_COUNT): LiveShapeOutline {
  const compiled = compileShapeAvatar(def);
  if (def.body.kind === "radii") {
    return {
      path: "",
      extras: [],
      points: Array.from({ length: sampleCount }, () => [50, 50] as OutlinePoint),
      face: compiled.face,
      eye: { w: compiled.eye.w, h: compiled.eye.h, gap: compiled.eye.gap },
      pathBody: false,
    };
  }
  const { path, extras } = silhouettePathFromDef(def);
  // Prefer the largest-area subpath as the body probe (a handle ring can have
  // denser samples than the mug body).
  const polys = flattenPath(path);
  let best = polys[0] ?? [];
  let bestArea = polygonArea(best);
  for (const poly of polys) {
    const area = polygonArea(poly);
    if (area > bestArea) {
      best = poly;
      bestArea = area;
    }
  }
  for (const extra of extras) {
    for (const poly of flattenPath(extra)) {
      const area = polygonArea(poly);
      if (area > bestArea) {
        best = poly;
        bestArea = area;
      }
    }
  }
  const points = normalizeOutlineWinding(resampleClosed(best, sampleCount));
  return {
    path: path || smoothClosedOutline(points),
    extras,
    points,
    face: compiled.face,
    eye: { w: compiled.eye.w, h: compiled.eye.h, gap: compiled.eye.gap },
    pathBody: true,
  };
}

/** Sample any closed path string to N morph points (largest-area subpath). */
export function samplePathToOutline(d: string, count = OUTLINE_SAMPLE_COUNT): OutlinePoint[] {
  const polys = flattenPath(d);
  let best = polys[0] ?? [];
  let bestArea = polygonArea(best);
  for (const poly of polys) {
    const area = polygonArea(poly);
    if (area > bestArea) {
      best = poly;
      bestArea = area;
    }
  }
  return normalizeOutlineWinding(resampleClosed(best, count));
}

/**
 * Approximate polar radii (R units, BODY.unit = 40) from an outline in box
 * units, so the legacy gaze/move solvers can run beside a path body.
 */
export function radiiFromOutlinePoints(
  points: readonly OutlinePoint[],
  count = OUTLINE_SAMPLE_COUNT,
  center: OutlinePoint = [50, 50],
  unit = 40,
): number[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const box = rayRadiusOutline(points, angle, center);
    return Math.max(0.3, Math.min(1.4, box / unit));
  });
}

/** Ellipse helper re-export for preset authors. */
export { ellipsePath };
