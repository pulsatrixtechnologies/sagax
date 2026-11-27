import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarMascotAvatar } from "./SidebarMascotAvatar";

vi.mock("./Avatar", () => ({
  BotAvatar: ({ sidebarAlive, shapeAlive }: { sidebarAlive?: boolean; shapeAlive?: boolean }) =>
    createElement("span", { "data-mock-avatar": "", "data-sidebar-alive": sidebarAlive ? "1" : "0", "data-shape-alive": shapeAlive ? "1" : "0" }),
  InitialsAvatar: () => createElement("span"),
}));

describe("SidebarMascotAvatar", () => {
  it("marks the avatar alive when the row mascot is idle", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green" },
        size: 36,
        animated: false,
      }),
    );
    expect(html).toContain("data-sidebar-mascot");
    expect(html).toContain('data-sidebar-alive="1"');
  });

  it("does not enable sidebar gaze while the row is fully animated", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green" },
        size: 36,
        animated: true,
      }),
    );
    expect(html).toContain('data-sidebar-alive="0"');
  });

  it("keeps a shape out of the sidebar's pointer loop, and asks it alive on the engine's own (#4145, #5404)", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green", mascotLook: { character: "shape", shape: "cup" } },
        size: 36,
        animated: false,
      }),
    );
    expect(html).toContain('data-sidebar-alive="0"');
    expect(html).toContain('data-shape-alive="1"');
  });

  it("does not poke, wink or morph on a click that opens the bot (M-20261127-080)", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SidebarMascotAvatar.tsx"), "utf8");
    expect(source).not.toMatch(/onClick=\{react\}/);
    expect(source).not.toMatch(/SHAPE_REACT/);
    expect(source).not.toMatch(/setTapMove/);
    expect(source).not.toMatch(/pickSidebarReaction/);
    // gaze and lean stay; only the open-click reaction is gone
    expect(source).toContain("registerSidebarMascot");
    expect(source).toContain("data-sidebar-mascot");
  });
});
