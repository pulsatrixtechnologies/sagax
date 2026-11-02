// @vitest-environment happy-dom
// Escape on the pushed page goes back one level (PanelPage onKeyDown).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { instances: [] }, dispatch: vi.fn() }),
  api: () => new Promise(() => {}),
}));

import { CommandAllowlistDialog } from "./CommandAllowlistDialog";

describe("CommandAllowlistDialog Escape", () => {
  let root: Root | undefined;
  const added: HTMLElement[] = [];

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = undefined;
    for (const node of added) node.remove();
    added.length = 0;
  });

  function open(onClose: () => void) {
    const host = document.createElement("div");
    host.className = "relative";
    document.body.append(host);
    added.push(host);
    root = createRoot(host);
    flushSync(() => {
      root!.render(createElement(CommandAllowlistDialog, { botId: "bot-1", botName: "Scout", onClose }));
    });
    return host.querySelector<HTMLElement>("[data-panel-page]")!;
  }

  it("closes when Escape is pressed inside the page", () => {
    const onClose = vi.fn();
    const page = open(onClose);
    expect(page).not.toBeNull();
    page.focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    page.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Escape alone while composing", () => {
    const onClose = vi.fn();
    const page = open(onClose);
    page.focus();
    const composing = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, isComposing: true });
    page.dispatchEvent(composing);
    expect(onClose).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);
  });
});
