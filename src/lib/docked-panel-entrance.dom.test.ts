// @vitest-environment happy-dom
// #5228: the bot panel is remounted per bot (its key), so switching bot with
// the panel open replayed the opening slide. The slide belongs to the panel
// opening only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useDockedPanelEntrance } from "./docked-panel-entrance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Panel({ bot }: { bot: string }) {
  const entrance = useDockedPanelEntrance("bot-panel");
  return createElement("aside", { "data-bot": bot, className: entrance ? "animate-panel-in" : "" });
}
const shell = (bot: string | null) => createElement("div", null, bot ? createElement(Panel, { key: `panel:${bot}`, bot }) : null);

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
const draw = (bot: string | null) => {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root!.render(shell(bot)));
  return host!.querySelector("aside");
};

describe("docked panel entrance (#5228)", () => {
  it("slides in when the panel opens, and not when its bot changes while it is open", () => {
    expect(draw("atlas")?.className).toBe("animate-panel-in");
    // the same panel, another bot: remounted by its key, no opening slide
    const next = draw("iris");
    expect(next?.getAttribute("data-bot")).toBe("iris");
    expect(next?.className).toBe("");
    expect(draw("milo")?.className).toBe("");
    // a re-render never starts or cuts the slide
    expect(draw("milo")?.className).toBe("");
  });

  it("slides in again after the panel was closed", () => {
    expect(draw("atlas")?.className).toBe("animate-panel-in");
    expect(draw("atlas")?.className).toBe("animate-panel-in");
    expect(draw(null)).toBeNull();
    expect(draw("iris")?.className).toBe("animate-panel-in");
  });

  it("the bot panel takes its opening slide from the hook", () => {
    const panel = readFileSync(resolve(process.cwd(), "src/components/BotSettingsDialog.tsx"), "utf8");
    expect(panel).toContain('useDockedPanelEntrance("bot-panel")');
    expect(panel).toMatch(/entrance && "animate-panel-in"/);
    expect(panel).not.toMatch(/"app-docked-panel animate-panel-in /);
  });
});
