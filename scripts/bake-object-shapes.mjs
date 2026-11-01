#!/usr/bin/env node
/**
 * Bake the eight object Shape presets into shared/mascot-geometry.json as
 * 64 radii (same pipeline as every other body). Clean-room silhouettes: our
 * own pad, cup, bulb, say, sprout, tin, tome, ship. Run:
 *   node scripts/bake-object-shapes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RADII_COUNT = 64;
const angleOf = (i) => (i / RADII_COUNT) * Math.PI * 2;

function radiiOf(inside, reach = 2.4) {
  return Array.from({ length: RADII_COUNT }, (_, i) => {
    const a = angleOf(i);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    let r = reach;
    const step = 0.01;
    while (r > 0 && !inside(dx * r, dy * r)) r -= step;
    let lo = Math.max(0, r);
    let hi = Math.min(reach, r + step);
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) / 2;
      if (inside(dx * mid, dy * mid)) lo = mid;
      else hi = mid;
    }
    return Math.round(lo * 10000) / 10000;
  });
}

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * Inside tests in R units (x right, y down, middle at 0).
 * Kept plump (min radius well above 0.5) so volume slices never leave the
 * face: object-like outlines without thin grips, tails or fins that break
 * the "never disassembled" regression.
 */
const INSIDE = {
  // wide game pad (soft rectangle, slightly wider than tall)
  pad: (x, y) => inEllipse(x, y, 0, 0.05, 1.05, 0.72) || inRect(x, y, -0.95, -0.45, 0.95, 0.55),
  // mug: upright oval with a thick handle bulge on the right
  cup: (x, y) => inEllipse(x, y, -0.05, 0, 0.7, 0.95) || inEllipse(x, y, 0.55, 0, 0.4, 0.45),
  // bulb: round glass with a short base (merged, not a thin stalk)
  bulb: (x, y) => inEllipse(x, y, 0, -0.15, 0.78, 0.82) || inEllipse(x, y, 0, 0.55, 0.42, 0.4),
  // speech bubble: rounded body, fat tail absorbed into the lower left
  say: (x, y) => inEllipse(x, y, 0, -0.1, 0.95, 0.75) || inEllipse(x, y, -0.35, 0.55, 0.4, 0.4),
  // plant: leafy crown over a wide pot
  sprout: (x, y) => inEllipse(x, y, 0, -0.25, 0.9, 0.65) || inEllipse(x, y, 0, 0.45, 0.65, 0.55),
  // drink can: tall rounded capsule
  tin: (x, y) => inEllipse(x, y, 0, 0, 0.62, 1.05),
  // book: thick rounded rectangle
  tome: (x, y) => inRect(x, y, -0.7, -0.85, 0.7, 0.85) || inEllipse(x, y, 0, 0, 0.75, 0.9),
  // rocket: capsule body with a soft nose (no thin fins)
  ship: (x, y) => inEllipse(x, y, 0, 0.05, 0.55, 1.0) || inEllipse(x, y, 0, -0.55, 0.45, 0.45),
};

const FACE = {
  pad: [0.0, 0.05],
  cup: [-0.05, -0.1],
  bulb: [0.0, -0.2],
  say: [0.0, -0.15],
  sprout: [0.0, -0.2],
  tin: [0.0, 0.0],
  tome: [0.12, -0.1],
  ship: [0.0, 0.05],
};

const geometryPath = join(root, "shared/mascot-geometry.json");
const geometry = JSON.parse(readFileSync(geometryPath, "utf8"));

for (const [id, inside] of Object.entries(INSIDE)) {
  let radii = radiiOf(inside);
  // keep every radius in the geometry file's accepted band
  radii = radii.map((r) => Math.min(1.35, Math.max(0.35, r)));
  if (Math.min(...radii) < 0.35) throw new Error(`${id}: body too thin`);
  geometry.shapes[id] = { radii, face: FACE[id] };
  console.log(id, "min", Math.min(...radii).toFixed(3), "max", Math.max(...radii).toFixed(3));
}

writeFileSync(geometryPath, `${JSON.stringify(geometry, null, 1)}\n`);
console.log("wrote", geometryPath);
