// M-20261119-073, point 3 (image 51: a label in a fixed light grey on a pink
// to orange gradient could not be read): a label on a filled accent takes the
// accent's own ink, `text-accent-ink`, which every skin, colour, duo-tone,
// mood and custom colour computes for 4.5:1 (custom-colours.ts, accentInk).
// A fixed `text-white` on `bg-accent` reads on a deep accent only: on a light
// one, or on a duo-tone's bright end, it fell under 2:1.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "gallery" || name === "testing" ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** An icon with no words, white by a decision its own test keeps (an icon needs 3:1, not a label's 4.5:1). */
const ICON_ONLY = new Set(["components/PageSelectionAsk.tsx:data-page-selection-send"]);

describe("a label on a filled accent", () => {
  it("takes the accent's ink, never a fixed white", () => {
    const fills = /\bbg-accent\b(?![/-])/;
    const white = /!?\btext-white\b/;
    const found: string[] = [];
    for (const file of files(join(SRC, "components"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const rel = file.slice(SRC.length + 1).split(sep).join("/");
        // the send arrow of the page's selection: its marker sits a few lines above its class list
        const near = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
        if ([...ICON_ONLY].some((entry) => entry.startsWith(`${rel}:`) && near.includes(entry.split(":")[1]!))) return;
        // one class list (a string literal) holding both
        for (const literal of line.match(/"[^"]*"|`[^`]*`/g) ?? []) if (fills.test(literal) && white.test(literal)) found.push(`${rel}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });
});
