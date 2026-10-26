// Grok Bot's sidebar portrait fills its box: a shape mascot, whose body uses
// about 62% of its frame, is drawn larger there; photos and the other
// characters, which already reach the box's edges, are left as they are.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { avatarFillScale, BotAvatar, SHAPE_FILL_SCALE } from "./Avatar";

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
    expect(html).toContain(`scale(${SHAPE_FILL_SCALE})`);
    expect(html).toContain('data-testid="primary-bot-badge"');
    const plain = renderToStaticMarkup(createElement(BotAvatar, { bot: { ...bot, mascotLook: { character: "shape" } } as never, size: 36 }));
    expect(plain).not.toContain("data-avatar-fill");
  });
});
