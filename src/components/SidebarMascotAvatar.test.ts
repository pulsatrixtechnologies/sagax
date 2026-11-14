import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarMascotAvatar } from "./SidebarMascotAvatar";
import { isShapeMove } from "./shape-moves";

vi.mock("./Avatar", () => ({
  BotAvatar: ({ sidebarAlive }: { sidebarAlive?: boolean }) =>
    createElement("span", { "data-mock-avatar": "", "data-sidebar-alive": sidebarAlive ? "1" : "0" }),
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

  it("keeps a shape out of the pointer loop: a row's shape is the engine's still (#4145)", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green", mascotLook: { character: "shape", shape: "cup" } },
        size: 36,
        animated: false,
      }),
    );
    expect(html).toContain('data-sidebar-alive="0"');
  });

  it("plays a Shapes move on a shape in a row when it is tapped (#4145 regression: no reaction lost)", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SidebarMascotAvatar.tsx"), "utf8");
    const table = /const SHAPE_REACT[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    const moves = Object.fromEntries([...table.matchAll(/(\w+): "(\w+)"/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(moves).sort()).toEqual(["blink", "hop", "squish", "wiggle", "wink"]);
    for (const move of Object.values(moves)) expect(isShapeMove(move), move).toBe(true);
    expect(source).toMatch(/look\.character === "shape"\) \{\s*setTapMove\(\{ clip: SHAPE_REACT\[kind\]/);
    expect(source).toContain("characterMove={tapMove ?? avatarProps.characterMove}");
  });
});
