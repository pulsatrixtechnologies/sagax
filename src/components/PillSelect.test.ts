// @vitest-environment happy-dom
// Grok Bot's pill menu (Settings > General: Theme, Language): a listbox that
// opens under the pill, answers the keyboard like a native select, and gives
// the focus back to the pill when it closes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PillSelect } from "./SettingsPrimitives";

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const OPTIONS = [
  { value: "", label: "System" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onChange.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(PillSelect<string>, { value: "en", options: OPTIONS, onChange, ariaLabel: "App language" })); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const pill = () => host.querySelector<HTMLButtonElement>("[data-pill-select]")!;
const listbox = () => document.body.querySelector('[role="listbox"]');
const frame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });

describe("PillSelect", () => {
  it("shows the current value on a pill and opens a listbox with it selected", async () => {
    expect(pill().textContent).toBe("English");
    expect(pill().getAttribute("aria-haspopup")).toBe("listbox");
    expect(listbox()).toBeNull();
    await act(async () => pill().click());
    await frame();
    expect(pill().getAttribute("aria-expanded")).toBe("true");
    const options = [...document.body.querySelectorAll('[role="option"]')];
    expect(options.map((node) => node.textContent)).toEqual(["System", "English", "Français"]);
    expect(options.map((node) => node.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(document.activeElement?.textContent).toBe("English");
  });

  it("moves with the arrows and picks with Enter, then gives the focus back", async () => {
    await act(async () => pill().click());
    await frame();
    await act(async () => { listbox()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Français");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith("fr");
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(pill());
  });

  it("Escape closes the menu only (Settings stays open) without a change", async () => {
    await act(async () => pill().click());
    await frame();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { document.activeElement!.dispatchEvent(escape); });
    // handled: the Settings modal's window listener skips a handled Escape
    expect(escape.defaultPrevented).toBe(true);
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pill());
  });

  it("picking the current value changes nothing", async () => {
    await act(async () => pill().click());
    await frame();
    const english = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')][1]!;
    await act(async () => english.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
  });

  it("draws the menu in a portal on <body>, out of the clipping container, over dialogs", async () => {
    host.style.overflow = "hidden";
    await act(async () => pill().click());
    await frame();
    const list = listbox() as HTMLElement;
    expect(host.contains(list)).toBe(false);
    expect(list.parentElement).toBe(document.body);
    expect(list.className).toContain("fixed");
    expect(list.className).toContain("z-[70]");
  });

  it("is positioned against the pill with inline coordinates", async () => {
    pill().getBoundingClientRect = () => ({ left: 700, top: 100, right: 780, bottom: 128, width: 80, height: 28, x: 700, y: 100, toJSON() {} });
    await act(async () => pill().click());
    await frame();
    const list = listbox() as HTMLElement;
    expect(list.style.top).toBe("132px");
    expect(list.dataset.side).toBe("bottom");
    expect(list.style.left).not.toBe("");
  });

  it("a press inside the portalled menu is not an outside press, one outside closes it", async () => {
    await act(async () => pill().click());
    await frame();
    const option = document.body.querySelectorAll<HTMLElement>('[role="option"]')[0]!;
    await act(async () => { option.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(listbox()).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(listbox()).toBeNull();
  });
});
