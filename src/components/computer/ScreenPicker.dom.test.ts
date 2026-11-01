// @vitest-environment happy-dom
// The Computer tab's screen chooser is one drop-down (#518 menus, the owner
// 2026-10-15): a button that names the screen shown and opens the list of
// the same choices as before (Cloud, each computer, the bot's browser), by
// pointer, keyboard and screen reader alike.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Globe, Laptop, Server } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ScreenPicker, type ScreenPickerItem } from "./OrgComputerTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: ScreenPickerItem[] = [
  { key: "server", label: "Cloud", icon: Server, here: true },
  { key: "desktop:d1", label: "Alexs-MBP", icon: Laptop },
  { key: "browser", label: "Browser", icon: Globe },
];

let host: HTMLDivElement;
let root: Root;
let onPick: ReturnType<typeof vi.fn<(key: string) => void>>;

function mount(chosen: string | null = "server") {
  act(() => root.render(createElement(ScreenPicker, { items: ITEMS, chosen, onPick })));
}
const trigger = () => host.querySelector<HTMLButtonElement>("[data-computer-picker-button]")!;
const list = () => host.querySelector<HTMLElement>('[role="listbox"]')!;
const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const key = (target: Element, name: string) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onPick = vi.fn<(key: string) => void>();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("the screen picker drop-down", () => {
  it("is one button naming the current screen, its list closed, with no row of chips", () => {
    mount();
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(host.querySelector('[role="radio"]')).toBeNull();
    const button = trigger();
    expect(button.textContent).toContain("Cloud");
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Screen shown: Cloud: this bot works here");
    expect(button.getAttribute("aria-controls")).toBe(list().id);
    expect(list().hidden).toBe(true);
    // the same three choices as the chips, in the same order
    expect(options().map((option) => option.dataset.computerChoice)).toEqual(["server", "desktop:d1", "browser"]);
    expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("opens on click and picks a computer with the pointer", () => {
    mount();
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(list().hidden).toBe(false);
    act(() => options()[2]!.click());
    expect(onPick).toHaveBeenCalledWith("browser");
    expect(list().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it("works from the keyboard: arrows open and move, Enter picks, Escape closes back on the button", () => {
    mount("desktop:d1");
    trigger().focus();
    key(trigger(), "ArrowDown");
    expect(list().hidden).toBe(false);
    expect(document.activeElement).toBe(list());
    // starts on the screen shown
    expect(list().getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
    key(list(), "ArrowDown");
    expect(list().getAttribute("aria-activedescendant")).toBe(options()[2]!.id);
    key(list(), "ArrowDown"); // stays on the last
    expect(list().getAttribute("aria-activedescendant")).toBe(options()[2]!.id);
    key(list(), "Home");
    expect(list().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    key(list(), "Enter");
    expect(onPick).toHaveBeenCalledWith("server");
    expect(document.activeElement).toBe(trigger());

    act(() => trigger().click());
    key(list(), "End");
    key(list(), "Escape");
    expect(list().hidden).toBe(true);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside without picking", () => {
    mount();
    act(() => trigger().click());
    act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(list().hidden).toBe(true);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("speaks French", () => {
    setLocale("fr");
    mount();
    expect(trigger().getAttribute("aria-label")).toBe("Écran affiché : Cloud : ce bot travaille ici");
    expect(list().getAttribute("aria-label")).toBe("Afficher l’écran de");
  });
});

describe("place rename in the screen picker", () => {
  let onRename: ReturnType<typeof vi.fn<(key: string, label: string | null) => void>>;

  function mountRename(chosen: string | null = "desktop:d1") {
    act(() => root.render(createElement(ScreenPicker, {
      items: [
        { key: "server", label: "Cloud", technical: "Cloud", icon: Server, here: true },
        { key: "desktop:d1", label: "JeanChrophesMBP.localdomain", technical: "JeanChrophesMBP.localdomain", icon: Laptop },
        { key: "browser", label: "Browser", technical: "Browser", icon: Globe },
      ],
      chosen,
      onPick,
      onRename,
    })));
  }

  beforeEach(() => {
    onRename = vi.fn<(key: string, label: string | null) => void>();
  });

  function typeInto(input: HTMLInputElement, value: string) {
    act(() => {
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      native.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("renames in place from … and Enter saves", () => {
    mountRename();
    act(() => trigger().click());
    const row = options()[1]!;
    act(() => row.querySelector<HTMLButtonElement>("[data-computer-rename]")!.click());
    const input = host.querySelector<HTMLInputElement>("[data-computer-rename-input]")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("JeanChrophesMBP.localdomain");
    typeInto(input, "MacBook de JC");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onRename).toHaveBeenCalledWith("desktop:d1", "MacBook de JC");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("starts rename with F2 and cancels with Escape without saving", () => {
    mountRename();
    act(() => trigger().click());
    // Chosen is desktop:d1 → active already on that row.
    key(list(), "F2");
    const input = host.querySelector<HTMLInputElement>("[data-computer-rename-input]")!;
    expect(input).not.toBeNull();
    typeInto(input, "Nope");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onRename).not.toHaveBeenCalled();
    expect(host.querySelector("[data-computer-rename-input]")).toBeNull();
  });

  it("right-click starts rename and empty Enter clears the label", () => {
    mountRename("server");
    act(() => trigger().click());
    const row = options()[1]!;
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const input = host.querySelector<HTMLInputElement>("[data-computer-rename-input]")!;
    expect(input).not.toBeNull();
    typeInto(input, "   ");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onRename).toHaveBeenCalledWith("desktop:d1", null);
  });
});
