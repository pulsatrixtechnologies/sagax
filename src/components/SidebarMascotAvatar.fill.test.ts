// The reference design's sidebar portrait fills its box: a shape mascot, whose body uses
// about 62% of its frame, is drawn larger there; photos and the other
// characters, which already reach the box's edges, are left as they are.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { avatarFillBox, avatarFillScale, BotAvatar, SHAPE_FILL_SCALE } from "./Avatar";

const bot = { name: "Iris", color: "orange" as const };

describe("sidebar avatar fill", () => {
  it("scales a shape mascot to its box and nothing else", () => {
    expect(avatarFillScale({ ...bot, mascotLook: { character: "shape" } } as never)).toBe(SHAPE_FILL_SCALE);
    expect(avatarFillScale({ ...bot, mascotLook: { character: "owl" } } as never)).toBe(1);
    expect(avatarFillScale(bot)).toBe(1);
    expect(avatarFillScale({ ...bot, mascotLook: { character: "shape" }, avatarUrl: "/api/attachments/p.png", avatarCrop: "circle" } as never)).toBe(1);
  });

  it("keeps the box and the Primary Bot star at the portrait size", () => {
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { ...bot, mascotLook: { character: "shape" } } as never, size: 36, primary: true, fillBox: true }));
    expect(html).toContain("width:36px;height:36px");
    expect(html).toContain("data-avatar-fill");
    expect(html).toContain('data-testid="primary-bot-badge"');
    const plain = renderToStaticMarkup(createElement(BotAvatar, { bot: { ...bot, mascotLook: { character: "shape" } } as never, size: 36 }));
    expect(plain).not.toContain("data-avatar-fill");
  });

  // #5404: the fill was a CSS transform, scale(1.6). A body in a material is a
  // canvas the engine paints at its laid-out size times the device pixel
  // ratio, so the transform stretched a 104-pixel bitmap over 166 pixels of a
  // Retina screen. The mascot is laid out at the size it is shown at instead.
  it("lays the mascot out at the size it is shown at, with no transform to enlarge it", () => {
    for (const size of [28, 36, 60, 64]) {
      const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { ...bot, mascotLook: { character: "shape", material: "fluffy" } } as never, size, fillBox: true }));
      expect(html, String(size)).not.toContain("transform");
      expect(html, String(size)).not.toContain("scale(");
      const drawn = size * SHAPE_FILL_SCALE;
      // the mascot itself is that large: what the engine measures to size its canvas
      expect(html, String(size)).toMatch(new RegExp(`class="shape-mascot[^"]*" style="width:${drawn}px;height:${drawn}px"`));
      // the box around it keeps the portrait's size
      expect(html, String(size)).toContain(`style="width:${size}px;height:${size}px"`);
    }
  });

  it("grows about the same point as before: the bodies' centre stays in the box's centre", () => {
    // the transform grew the mascot about 50% 38% of its box
    expect(avatarFillBox(60, SHAPE_FILL_SCALE)).toEqual({ size: 96, left: 60 * 0.5 * (1 - 1.6), top: 60 * 0.38 * (1 - 1.6) });
    const box = avatarFillBox(36, SHAPE_FILL_SCALE);
    // the point at 50% 38% of the portrait is the point at 50% 38% of the mascot
    expect(box.left + 0.5 * box.size).toBeCloseTo(18, 6);
    expect(box.top + 0.38 * box.size).toBeCloseTo(0.38 * 36, 6);
    expect(avatarFillBox(36, 1)).toEqual({ size: 36, left: 0, top: 0 });
  });
});
