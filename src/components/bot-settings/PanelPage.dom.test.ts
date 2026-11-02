// @vitest-environment happy-dom
// Push and back navigation for the shared bot-panel page (lot 3).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));

import { setLocale } from "@/lib/i18n";
import { PanelPage } from "./PanelPage";

describe("PanelPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    host = document.createElement("div");
    host.className = "relative";
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("draws the round back and close controls and calls onBack on Escape", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(createElement(PanelPage, { name: "Instructions", onBack, onClose, children: "body" }));
    });
    const page = host.querySelector<HTMLElement>("[data-panel-page]");
    expect(page).not.toBeNull();
    expect(page?.getAttribute("aria-label")).toBe("Instructions");
    expect(page?.getAttribute("aria-modal")).toBe("false");
    expect(host.querySelector('[data-panel-page-header] button[aria-label="Back"]')).not.toBeNull();
    expect(host.querySelector('[data-panel-page-header] button[aria-label="Close"]')).not.toBeNull();
    expect(host.querySelector("[data-panel-page-body]")?.textContent).toBe("body");

    await act(async () => {
      (host.querySelector('[aria-label="Back"]') as HTMLButtonElement).click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      (host.querySelector('[aria-label="Close"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onBack.mockClear();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { page!.dispatchEvent(event); });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
