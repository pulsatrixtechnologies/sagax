import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MASCOT_SHAPES } from "../../shared/mascot-look";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { uprightPose } from "./ShapeMascot";
import { REST_POSE } from "./shape-volume";

const renderShape = (shape: string, size: number, animated: boolean) =>
  renderToStaticMarkup(
    createElement(BotAvatar, {
      bot: { id: "b", name: "Bot", color: "blue", mascotLook: { character: "shape", shape } } as unknown as BotAvatarProps["bot"],
      size,
      animated,
    }),
  );

const outline = (markup: string) => markup.match(/<path id="[^"]*-outline" d="([^"]+)"/)?.[1] ?? null;

describe("large shape avatars", () => {
  // the bot panel (112) and the editor draw the same shape as the sidebar
  // (44, still), scaled by the viewBox: no other drawing from some size up
  for (const shape of MASCOT_SHAPES) {
    it(`draws ${shape} at 96 to 160 px with the sidebar's renderer and outline`, () => {
      const sidebar = renderShape(shape, 44, false);
      expect(sidebar).toContain('data-volume="full"');
      expect(outline(sidebar)).toBeTruthy();
      for (const size of [96, 112, 128, 160]) {
        const big = renderShape(shape, size, true);
        expect(big).toContain('class="shape-mascot');
        expect(big).toContain('data-volume="full"');
        expect(big).toContain('viewBox="0 0 100 100"');
        expect(outline(big)).toBe(outline(sidebar));
      }
    });
  }

  it("keeps the idle pose's out-of-plane turn at rest so the outline never bends", () => {
    const swayed = { ...REST_POSE, yaw: REST_POSE.yaw + 9, pitch: REST_POSE.pitch - 6, roll: 3, scale: 1.02, lift: -1 };
    expect(uprightPose(swayed)).toEqual({ ...swayed, yaw: REST_POSE.yaw, pitch: REST_POSE.pitch });
  });
});
