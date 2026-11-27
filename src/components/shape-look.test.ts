// shape-look.ts writes ShapeMascot's look rules once for the drawings that
// paint a bot's shape themselves (the Heavy row's division): the body's
// colour, the eyes' ink and the pose it holds must be ShapeMascot's own, for
// every skin and setting, or the two drift apart.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import type { EngineLook, ShapeSkin } from "../../shared/mascot-look";
import { ShapeMascot } from "./ShapeMascot";
import { lookDefinition, moodFrame, runtimeStill } from "./shape-avatar";
import { shapeLook } from "./shape-look";
import { bakedStill, loadAllBakedStills } from "./shape-stills";

beforeAll(async () => {
  await loadAllBakedStills();
});

const LOOKS: Array<{ skin: ShapeSkin; color: string; engineLook?: Partial<EngineLook> }> = [
  { skin: "plain", color: "amber" },
  { skin: "plain", color: "black" },
  { skin: "plain", color: "#123abc", engineLook: { eyeColor: "#ff00aa" } },
  { skin: "outline", color: "blue" },
  { skin: "gold", color: "green" },
  { skin: "neon", color: "pink" },
  { skin: "plain", color: "teal", engineLook: { depth: 3, mood: "happy" } },
  { skin: "plain", color: "not-a-colour" },
];

describe("a shape's look, as ShapeMascot paints it", () => {
  it.each(LOOKS)("paints the body and the eyes in ShapeMascot's colours ($skin, $color)", ({ skin, color, engineLook }) => {
    const look = shapeLook({ shape: "cat", skin, color, engineLook, material: false });
    const markup = renderToStaticMarkup(createElement(ShapeMascot, { shape: "cat", skin, color, size: 22, animated: false, engineLook }));
    // a flat skin is the shared still image: its SVG rides in the image's address
    const still = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(markup)?.[1];
    const html = markup + (still ? decodeURIComponent(still.replace(/&amp;/g, "&")) : "");
    expect(html).toContain(`fill="${look.body}"`);
    // a happy face's eyes are arcs: stroked in the ink, not filled
    expect(html).toMatch(new RegExp(`(fill|stroke)="${look.ink}"`));
    expect(html).toContain(`data-mood="${look.pose.motion ?? look.pose.mood}"`);
    expect(html).toContain(`data-shape-skin="${look.skin}"`);
  });

  it.each([
    { name: "the natural depth", skin: "plain" as ShapeSkin, engineLook: undefined },
    { name: "a chosen depth", skin: "plain" as ShapeSkin, engineLook: { depth: 3 } },
    { name: "the Outline skin, flat", skin: "outline" as ShapeSkin, engineLook: undefined },
  ])("draws the still ShapeMascot draws: $name (baked, or inferred at that depth)", ({ skin, engineLook }) => {
    const look = shapeLook({ shape: "cat", skin, color: "blue", engineLook, material: false });
    const still = look.bakedId ? bakedStill(look.bakedId)! : runtimeStill(lookDefinition("cat"), look.depth);
    const frame = moodFrame(still, look.pose.motion ?? "idle");
    const markup = renderToStaticMarkup(createElement(ShapeMascot, { shape: "cat", skin, color: "blue", size: 22, animated: false, engineLook }));
    const image = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(markup)?.[1];
    const html = markup + (image ? decodeURIComponent(image.replace(/&amp;/g, "&")) : "");
    expect(frame.paths.length).toBeGreaterThan(0);
    for (const [, d] of frame.paths) expect(html).toContain(d);
  });

  it("draws the Outline skin flat, and a material in the bot's own colour with its own eyes", () => {
    expect(shapeLook({ shape: "cat", skin: "outline", color: "blue", material: false }).depth).toBe(0);
    expect(shapeLook({ shape: "cat", skin: "outline", color: "blue", material: true }).depth).toBeUndefined();
    const glass = shapeLook({ shape: "cat", skin: "gold", color: "blue", material: true });
    expect(glass.body).toBe(glass.hex.toLowerCase());
    expect(glass.ink).toBe("#151515");
  });
});
