import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "./shape-stills";

import { MASCOT_SHAPES } from "../../shared/mascot-look";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { REST_POSE, uprightPose } from "./shape-volume";

// the shapes' baked stills, as a page loads them the first time a shape shows (#4145)
beforeAll(() => loadAllBakedStills());

const renderShape = (shape: string, size: number, animated: boolean) =>
  renderToStaticMarkup(
    createElement(BotAvatar, {
      bot: { id: "b", name: "Bot", color: "blue", mascotLook: { character: "shape", shape } } as unknown as BotAvatarProps["bot"],
      size,
      animated,
    }),
  );

describe("large shape avatars", () => {
  // the bot panel (92) and the editor draw the engine's live mascot; the
  // sidebar (44) its still of the same shape (#4145)
  for (const shape of MASCOT_SHAPES) {
    it(`draws ${shape} live at 96 to 160 px and as the same shape's still in the sidebar`, () => {
      const sidebar = renderShape(shape, 44, false);
      expect(sidebar).toContain(`data-shape="${shape}"`);
      expect(sidebar).toContain('<img src="data:image/svg+xml');
      for (const size of [96, 112, 128, 160]) {
        const big = renderShape(shape, size, true);
        expect(big).toContain('class="shape-mascot');
        expect(big).toContain(`data-shape="${shape}"`);
        expect(big).toContain("data-shape-live");
      }
    });
  }

  it("keeps the idle pose's out-of-plane turn at rest so the outline never bends", () => {
    const swayed = { ...REST_POSE, yaw: REST_POSE.yaw + 9, pitch: REST_POSE.pitch - 6, roll: 3, scale: 1.02, lift: -1 };
    expect(uprightPose(swayed)).toEqual({ ...swayed, yaw: REST_POSE.yaw, pitch: REST_POSE.pitch });
  });
});
