// The Routines trend's bars keep ONE height (owner, 2026-11-17: "same height, colour alone"), so for a colour-blind
// person the three result colours of every skin must stay apart on their own. Measured here for every skin, as the
// bar paints them: the skin's --trend-* step when it sets one, else the state's own token (never a hard-coded value).
// Simulated with the Machado protan, deutan and tritan matrices; the distance is CIE76 delta E.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error a plain script module
import { skinIds, skinTokens } from "../../scripts/check-skin-contrast.mjs";

// Every file that holds a skin's colours, as the contrast check reads them: the base skins, then the tints, the
// full-surface and duo-tone colours, the moods (sunset, nordic, cyberpunk) and the retro editions.
const root = process.cwd();
const editions = join(root, "src/styles/retro-editions");
const css = [
  readFileSync(join(root, "src/styles.css"), "utf8"),
  ...["depth", "duo", "ambiance", "texture"].map((name) => readFileSync(join(root, `src/styles/skin-${name}.css`), "utf8")),
  ...readdirSync(editions).filter((name) => name.endsWith(".css")).sort().map((name) => readFileSync(join(editions, name), "utf8")),
].join("\n");
const MATRIX = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const linear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const seen = (color: Rgb, kind: keyof typeof MATRIX): Rgb => {
  const l = color.map(linear);
  return MATRIX[kind].map((row) => Math.min(1, Math.max(0, row[0]! * l[0]! + row[1]! * l[1]! + row[2]! * l[2]!))) as Rgb;
};
const lab = ([r, g, b]: Rgb) => {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
};
const distance = (a: Rgb, b: Rgb, kind: keyof typeof MATRIX) => { const A = lab(seen(a, kind)), B = lab(seen(b, kind)); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const luminance = (c: Rgb) => { const l = c.map(linear); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
const contrast = (a: Rgb, b: Rgb) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** The smallest distance between two of the three colours, in any of the four visions. */
export const MIN_TREND_DISTANCE = 12;

describe("the trend bars' result colours, in every skin", () => {
  for (const id of skinIds(css) as string[]) {
    const tokens = skinTokens(css, id) as Record<string, string> | null;
    if (!tokens?.["--color-success"]) continue;
    const pick = (trend: string, state: string) => rgb(tokens[trend] ?? tokens[state]!);
    it(`${id}: success, with problems and failed stay apart and read on the row`, () => {
      const colors = { success: pick("--trend-success", "--color-success"), problems: pick("--trend-problems", "--color-warning"), failed: pick("--trend-failed", "--color-danger") };
      const pairs = [["success", "failed"], ["success", "problems"], ["problems", "failed"]] as const;
      for (const kind of Object.keys(MATRIX) as Array<keyof typeof MATRIX>) {
        for (const [a, b] of pairs) expect(distance(colors[a], colors[b], kind), `${a} vs ${b} (${kind})`).toBeGreaterThanOrEqual(MIN_TREND_DISTANCE);
      }
      for (const surface of ["--color-app", "--color-card"]) {
        if (!tokens[surface]) continue;
        for (const [name, color] of Object.entries(colors)) expect(contrast(color, rgb(tokens[surface]!)), `${name} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
