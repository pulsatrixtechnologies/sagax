// @vitest-environment happy-dom
// This Mac uses the same two-column grid as the neighbouring Installed sections (2026-11-06).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));

import { MacAppsInstalledSection } from "./MacAppsView";
import { PLUGINS } from "./plugins-style";

describe("MacAppsInstalledSection", () => {
  it("renders its rows in the shared PLUGINS.grid", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MacAppsInstalledSection, { status: null, onOpen: () => {} }));
    });
    const list = host.querySelector("[data-plugins-mac] ul");
    expect(list?.className.split(" ")).toEqual(expect.arrayContaining(PLUGINS.grid.split(" ")));
    expect(list?.className).toContain("md:grid-cols-2");
    expect(host.querySelectorAll("[data-mac-app]").length).toBe(6);
    await act(async () => root.unmount());
    host.remove();
  });
});
