// The shared right detail panel (2026-11-01, no modals): in place outside the
// app, in App's right-edge slot inside it; non-modal (no trap), Escape inside
// closes unless something closer used it, focus goes back to the opener, and
// opening it closes the bot and person panels (one right panel at a time).
// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
  useStoreOptional: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));

const { setLocale, t } = await import("@/lib/i18n");
const { DetailPanel } = await import("./DetailPanel");
const { PanelSlotProvider } = await import("./panel-slot");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockReset();
  fixture.state = { settingsOpen: false, computerOpen: false, personPanelId: null };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  document.body.innerHTML = "";
});

const panel = (props: Partial<Parameters<typeof DetailPanel>[0]> = {}) =>
  createElement(DetailPanel, { label: "Event details", title: "Weekly sync", onClose: vi.fn(), ...props, children: createElement("input", { "aria-label": "Field" }) });

describe("DetailPanel", () => {
  it("renders in place without the app's slot, as a labelled non-modal region with a named close", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(panel({ onClose, closeLabel: "Close details" })));
    const region = host.querySelector<HTMLElement>("[data-detail-panel]")!;
    expect(region).not.toBeNull();
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("Event details");
    expect(region.hasAttribute("aria-modal")).toBe(false);
    expect(region.dataset.detailPanelPlacement).toBe("inline");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
    expect(region.querySelector("h2")!.textContent).toBe("Weekly sync");
    expect(region.querySelector('[role="separator"]')!.getAttribute("aria-label")).toBe(t("computer.resizeAria"));
    const close = region.querySelector<HTMLButtonElement>("[data-detail-panel-close]")!;
    expect(close.getAttribute("aria-label")).toBe("Close details");
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("portals into App's right-edge slot when there is one", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    flushSync(() => root.render(createElement(PanelSlotProvider, { slot, children: panel() })));
    expect(host.querySelector("[data-detail-panel]")).toBeNull();
    expect(slot.querySelector<HTMLElement>("[data-detail-panel]")!.dataset.detailPanelPlacement).toBe("slot");
  });

  it("closes on Escape inside it, but not on an Escape something closer already used", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(panel({ onClose })));
    const field = host.querySelector("input")!;
    const used = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    used.preventDefault();
    field.dispatchEvent(used);
    expect(onClose).not.toHaveBeenCalled();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not trap Tab: focus may leave for the page beside it", () => {
    flushSync(() => root.render(panel()));
    const field = host.querySelector("input")!;
    field.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    field.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("takes focus when it opens and gives it back to the opener when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    flushSync(() => root.render(panel()));
    expect(host.querySelector("[data-detail-panel]")!.contains(document.activeElement)).toBe(true);
    flushSync(() => root.render(createElement("div")));
    expect(document.activeElement).toBe(opener);
  });

  it("closes the bot and person panels when it opens (one right panel)", () => {
    fixture.state = { settingsOpen: true, computerOpen: true, personPanelId: "pr_someone" };
    flushSync(() => root.render(panel()));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: false });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: false });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonPanel", personId: null });
  });

  it("leaves other panels alone when not exclusive, and draws no header when bare", () => {
    fixture.state = { settingsOpen: true, computerOpen: false, personPanelId: null };
    flushSync(() => root.render(panel({ exclusive: false, bare: true })));
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(host.querySelector("[data-detail-panel-header]")).toBeNull();
    expect(host.querySelector("[data-detail-panel-body] input")).not.toBeNull();
  });
});
