/**
 * Blocking guard for every shape's look (2026-11-10, restored look). #2986
 * redrew the sprout and the say bubble to satisfy a slice check that assumed
 * every body is seen whole from the box's middle, and #3104 redrew them again
 * instead of bringing the approved art back. The approved art is the one the
 * app shipped from 2026-11-02 to 2026-11-08 (release 0.8.66): it is back in
 * shared/mascot-geometry.json, and this pins it.
 *
 * Each shape's resting look (its outline, its size in its box, its eyes) is
 * written to __snapshots__/shape-look.json. A shape's look changes only with
 * the owner's word: when he asks for one, update the file with
 * `vitest run src/components/shape-object-look.regression.test.ts -u` and
 * show him the before and after gallery (scripts/capture/shapes.mjs).
 * The picker's tile (bot profile, Appearance, Shape tab) is pinned too: the
 * size a shape is drawn at in its tile.
 */
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOTHING_LOCKED } from "../../shared/achievements";
import { botMascotLook, MASCOT_SHAPES } from "../../shared/mascot-look";
import { flattenPath } from "../../shared/shape-avatar-outline";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def";
import { resetAchievementsForTests } from "@/lib/achievements";
import MascotLookEditor from "./floating-bots/MascotLookEditor";
import { avatarDefForShape } from "./ShapeMascot";
import { stillFrame } from "./shape-engine";

const OWNER = "a shape's look changes only with the owner's word (see the head of this file)";
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A shape's resting look, as the app draws it: outline box, outline commands and a digest of the outline, eyes. */
function lookOf(shape: (typeof MASCOT_SHAPES)[number]) {
  const frame = stillFrame({ shape, expression: "neutral", color: "#000000", avatarDef: avatarDefForShape(shape) });
  const points = flattenPath(frame.body).flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r1);
  const rounded = frame.body.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) => String(Math.round(Number(n))));
  return {
    box,
    size: [r1(box[2] - box[0]), r1(box[3] - box[1])],
    commands: (frame.body.match(/[MLCQZA]/gi) ?? []).length,
    subpaths: frame.body.split("M").length - 1,
    outline: createHash("sha256").update(rounded).digest("hex").slice(0, 16),
    eyes: frame.eyeShapes.map((e) => [e.x, e.y, e.w, e.h].map(r1)),
  };
}

describe("every shape keeps its approved look", () => {
  it("outline, size in its box and eyes match the restored look", async () => {
    // one shape per line, so a change reads shape by shape in a diff
    const looks = MASCOT_SHAPES.map((shape) => ` ${JSON.stringify(shape)}: ${JSON.stringify(lookOf(shape))}`);
    await expect(`{\n${looks.join(",\n")}\n}\n`, OWNER).toMatchFileSnapshot("./__snapshots__/shape-look.json");
  });

  it("say and sprout carry the art shipped until 2026-11-08: the long tail, the two leaves on a stem", () => {
    const body = (shape: "say" | "sprout") => (OBJECT_SHAPE_BY_ID[shape].body.kind === "path" ? OBJECT_SHAPE_BY_ID[shape].body.d : "");
    expect(body("say"), OWNER).toBe("M20 14L72 14C86 14 94 24 94 36L94 52C94 66 84 76 70 76L44 76L22 96L34 76L28 76C14 76 6 66 6 52L6 36C6 24 10 14 20 14Z");
    expect(body("sprout"), OWNER).toBe("M50 46C40 40 22 34 14 26C6 18 10 6 24 6C38 6 46 22 50 36C54 22 62 6 76 6C90 6 94 18 86 26C78 34 60 40 50 46L68 50C78 52 84 64 82 76L78 94C76 98 62 100 50 100C38 100 24 98 22 94L18 76C16 64 22 52 32 50Z");
  });

  it("the picker draws every shape at 40 px in a 78 px tile", () => {
    resetAchievementsForTests({ unlocks: NOTHING_LOCKED });
    const html = renderToStaticMarkup(
      createElement(MascotLookEditor, {
        bot: { color: "blue" as never, mascotSkin: "none" as never, mascotLook: botMascotLook({ character: "shape", shape: "circle" }) },
        onPatch: () => undefined,
        initialTab: "shape",
      }),
    );
    expect(html, OWNER).toContain("minmax(76px,1fr)");
    for (const shape of MASCOT_SHAPES) {
      const at = html.indexOf(`data-character-shape="${shape}"`);
      expect(at, `${shape} tile`).toBeGreaterThan(0);
      const tile = html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
      expect(tile, `${shape} tile: ${OWNER}`).toContain("h-[78px]");
      expect(tile, `${shape} tile: ${OWNER}`).toMatch(new RegExp(`style="width:40px;height:40px" data-shape="${shape}"`));
    }
  });

  it("a saved copy of an object preset follows the current preset", () => {
    for (const shape of ["say", "sprout"] as const) {
      const stale: ShapeAvatarDef = { ...OBJECT_SHAPE_BY_ID[shape], body: { kind: "path", d: "M20 8L80 8L80 92L20 92Z" } };
      expect(avatarDefForShape(shape, stale)).toBe(OBJECT_SHAPE_BY_ID[shape]);
    }
    const custom: ShapeAvatarDef = { ...OBJECT_SHAPE_BY_ID.say, id: "custom-1" };
    expect(avatarDefForShape("say", custom)).toBe(custom);
  });
});
