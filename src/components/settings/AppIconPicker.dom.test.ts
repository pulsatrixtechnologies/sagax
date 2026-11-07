// @vitest-environment happy-dom
// Settings > App icon: the nine character pictures follow the Primary Bot and
// come before Upload image; choosing one hands its rendered icon to the desktop bridge.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTER_APP_ICON_IDS } from "@/lib/app-icon-choices";

vi.mock("@/lib/app-icon-render", () => ({
  loadImage: async () => ({}),
  elementToArt: async () => ({ image: {}, width: 1, height: 1 }),
  fileToArt: async () => ({ image: {}, width: 1, height: 1 }),
  renderAppIcon: () => ({ toDataURL: () => "data:image/png;base64,AA==" }),
}));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { bots: [{ id: "p1", name: "Melody", color: "orange", chiefOfStaff: true }], config: null } }),
}));

import { AppIconPicker } from "./AppIconPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const set = vi.fn(async (input: { id: string }) => ({ id: input.id, platform: "darwin" }));

beforeEach(() => {
  vi.stubGlobal("ogb", { platform: "darwin", appIcon: { get: async () => ({ id: null, platform: "darwin" }), set, reset: async () => ({ id: null }) } });
  Object.assign(window, { ogb: (globalThis as { ogb?: unknown }).ogb });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  set.mockClear();
});

describe("AppIconPicker character pictures", () => {
  it("lists the nine after Primary Bot, then Upload image, and applies a chosen one", async () => {
    await act(async () => {
      root.render(createElement(AppIconPicker));
    });
    // the tiles draw after a frame, one character at a time (nine more since
    // #2380): wait until the chosen tile is drawn rather than a fixed delay
    const sprout = () => host.querySelector<HTMLButtonElement>('[data-app-icon="character:sprout"]');
    for (let tries = 0; tries < 200 && (!sprout() || sprout()!.disabled); tries++) {
      await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    }
    expect(sprout()?.disabled).toBe(false);
    const ids = [...host.querySelectorAll("[data-app-icon]")].map((node) => node.getAttribute("data-app-icon"));
    const at = ids.indexOf("primary");
    expect(at).toBeGreaterThan(0);
    expect(ids.slice(at + 1)).toEqual(CHARACTER_APP_ICON_IDS.map((name) => `character:${name}`));
    expect(host.querySelector("[data-app-icon-upload]")).not.toBeNull();
    await act(async () => {
      sprout()!.click();
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].id).toBe("character:sprout");
  });
});
