// @vitest-environment happy-dom
// The screen side panel (#4452): a docked column beside the chat with the
// bot's live browser (not the Computer tab's preview square), closed by its
// X or Escape, and resizable from its left edge.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { isScreenPanelOpen, setScreenPanelOpen } from "@/lib/screen-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seen = vi.hoisted(() => ({ live: undefined as boolean | undefined, botId: "" }));
vi.mock("./BrowserPanel", () => ({
  BrowserPanel: ({ bot, live }: { bot: { id: string }; live?: boolean }) => {
    seen.live = live; seen.botId = bot.id;
    return null;
  },
}));
import { ScreenPanel } from "./ScreenPanel";

const bot = { id: "ada", name: "Ada" } as unknown as Bot;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  seen.live = undefined; seen.botId = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setScreenPanelOpen(true);
  act(() => root.render(createElement(ScreenPanel, { bot })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); setScreenPanelOpen(false); });

describe("ScreenPanel", () => {
  it("is a labelled column that hosts the bot's live browser", () => {
    const aside = host.querySelector("aside[data-screen-panel]")!;
    expect(aside.getAttribute("aria-label")).toBe("Ada’s screen");
    expect(host.textContent).toContain("Ada’s browser");
    expect(seen).toEqual({ live: true, botId: "ada" });
    expect(host.querySelector("[role=separator]")?.getAttribute("aria-label")).toBe("Resize the screen panel");
  });

  it("closes from its X button", () => {
    act(() => { (host.querySelector("[data-screen-panel-close]") as HTMLButtonElement).click(); });
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("closes on Escape, but not from inside a field", () => {
    const aside = host.querySelector("aside")!;
    const input = document.createElement("input");
    aside.append(input);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(true);
    act(() => { aside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(false);
  });
});
