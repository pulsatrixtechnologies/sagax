// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const artifact = {
  id: "a1",
  botId: "b1",
  title: "Sales dashboard",
  favorite: false,
  popped: false,
  createdAt: 1,
  updatedAt: 2,
  rev: 1,
  refresh: { state: "idle" as const, failures: 0 },
  html: "<body><p>Orders: 128</p></body>",
};

const dispatch = vi.fn();
const openArtifactInOwnWindow = vi.fn(async (_artifact?: unknown) => true);
const openArtifactFullscreen = vi.fn((_next?: unknown) => undefined);

vi.mock("@/lib/artifacts", () => ({
  useArtifact: () => ({ artifact, error: null }),
  useArtifactWatch: () => {},
  refreshArtifact: async () => {},
}));

vi.mock("@/state/store", () => ({
  useStore: () => ({ dispatch }),
}));

vi.mock("./artifact-windows", () => ({
  canOpenArtifactInOwnWindow: () => true,
  openArtifactInOwnWindow: (...args: unknown[]) => openArtifactInOwnWindow(...args),
}));

vi.mock("./ArtifactFrame", () => ({
  ArtifactFrame: () => createElement("div", { "data-artifact-frame": "a1" }),
  openArtifactFullscreen: (...args: unknown[]) => openArtifactFullscreen(...args),
}));

import { ArtifactSidePanel } from "./ArtifactSidePanel";
import { CIRCLE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";
import { SCREEN_PANEL_TITLE } from "../ScreenPanelChrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ArtifactSidePanel", () => {
  let root: Root | null = null;

  beforeEach(() => {
    dispatch.mockClear();
    openArtifactInOwnWindow.mockClear();
    openArtifactFullscreen.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(ArtifactSidePanel, { botId: "b1", artifactId: "a1", title: "Sales dashboard" }));
    });
  }

  it("offers Detach, Agrandir and Close", async () => {
    await mount();
    expect(document.querySelector("[data-artifact-side-panel=a1]")).not.toBeNull();
    expect(document.querySelector("[data-artifact-detach]")).not.toBeNull();
    expect(document.querySelector("[data-artifact-enlarge]")).not.toBeNull();
    expect(document.querySelector("[data-artifact-side-panel-close]")).not.toBeNull();
  });

  it("draws the chat header's round controls and glyphs, and a docked panel's title (M-20261127-179)", async () => {
    await mount();
    const header = document.querySelector("[data-artifact-side-panel-header]")!;
    const buttons = [...header.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) {
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(CIRCLE_BUTTON.split(/\s+/)));
      const svg = button.querySelector("svg")!;
      expect({ size: Number(svg.getAttribute("width")), strokeWidth: Number(svg.getAttribute("stroke-width")) }).toEqual(CIRCLE_ICON);
    }
    expect(header.querySelector("span")!.className).toBe(SCREEN_PANEL_TITLE);
  });

  it("carries .content-topbar / .content-card-body like every docked panel (#5486)", async () => {
    await mount();
    const header = document.querySelector("[data-artifact-side-panel-header]")!;
    expect(header.className.split(/\s+/)).toContain("content-topbar");
    expect(document.querySelector("[data-artifact-side-panel] .content-card-body")).not.toBeNull();
  });

  it("Close clears the store panel", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-artifact-side-panel-close]")!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "openArtifactPanel", panel: null });
  });

  it("Detach opens a window then closes the panel", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-artifact-detach]")!.click();
    });
    expect(openArtifactInOwnWindow).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", botId: "b1" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "openArtifactPanel", panel: null });
  });

  it("Agrandir opens the existing fullscreen layer", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-artifact-enlarge]")!.click();
    });
    expect(openArtifactFullscreen).toHaveBeenCalledWith(artifact);
  });
});
