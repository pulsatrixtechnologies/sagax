// @vitest-environment happy-dom
// This Mac uses the same card grid as the neighbouring Installed sections (#2948, 2026-11-08).
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
    // the reference's two columns of rows, one when the list is under 560px (#4097)
    expect(list?.className).toContain("grid-cols-2");
    expect(list?.className).not.toContain("auto-fill");
    // a row's grey line wraps on whole words, never cut by an ellipsis mid-word (#4097)
    expect(PLUGINS.rowSub).not.toContain("truncate");
    expect(PLUGINS.rowSub).toContain("line-clamp-2");
    // each row keeps its chevron and fills its card
    expect(host.querySelector("[data-mac-app] svg.lucide-chevron-right, [data-mac-app] svg:last-child")).toBeTruthy();
    expect(host.querySelector("[data-mac-app]")?.className).toContain("w-[calc(100%+24px)]");
    expect(host.querySelectorAll("[data-mac-app]").length).toBe(6);
    await act(async () => root.unmount());
    host.remove();
  });
});
