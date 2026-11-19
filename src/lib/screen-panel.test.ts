// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { isScreenPanelOpen, setScreenPanelOpen, toggleScreenPanel, useScreenPanelOpen } from "./screen-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => act(() => setScreenPanelOpen(false)));

describe("the screen panel's open state (#4452)", () => {
  it("starts closed and toggles", () => {
    expect(isScreenPanelOpen()).toBe(false);
    act(() => toggleScreenPanel());
    expect(isScreenPanelOpen()).toBe(true);
    act(() => toggleScreenPanel());
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("re-renders a hook reader when it changes", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const Probe = () => createElement("span", null, String(useScreenPanelOpen()));
    act(() => root.render(createElement(Probe)));
    expect(host.textContent).toBe("false");
    act(() => setScreenPanelOpen(true));
    expect(host.textContent).toBe("true");
    act(() => root.unmount());
  });
});
