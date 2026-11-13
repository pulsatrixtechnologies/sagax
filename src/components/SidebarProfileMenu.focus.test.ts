// @vitest-environment happy-dom
// #4156: the account button shows no outline while its menu is open nor
// after a mouse click, only the reference's soft fill; the focus ring is for
// keyboard focus. A click leaves the button focused, and a key pressed
// afterwards (Escape) would make that focus :focus-visible: the app's one
// rule (src/lib/input-modality.ts) marks a focus that follows a pointer
// press (data-pointer-focus) until the keyboard moves, and styles.css (the
// global ring and the redefined `focus-visible:` variant) skips the mark.
// The CSS is checked as text (happy-dom has no :focus-visible), the real
// thing by the gallery capture.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState>, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(() => new Promise(() => {})),
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});

import { SidebarProfileMenu } from "./SidebarProfileMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.state = { config: { profile: { name: "Sample Person", email: "person@example.com" } } as AppState["config"] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true })));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const css = readFileSync("src/styles.css", "utf8");

const pill = () => container.querySelector("[data-sidebar-account-pill]")!;
const press = () => act(() => {
  button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  button().focus();
});

describe("the account menu button's focus ring", () => {
  it("marks a focus that follows a mouse press, so no ring shows", () => {
    press();
    expect(button().hasAttribute("data-pointer-focus")).toBe(true);
    // Escape does not move the keyboard focus: still no ring
    act(() => { button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(true);
  });

  it("clears the mark on Tab and on blur, so keyboard focus shows the ring", () => {
    press();
    act(() => { button().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
    press();
    act(() => { button().blur(); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("never carries the mark when focused by keyboard alone", () => {
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    act(() => { button().focus(); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("shows the soft fill, never an outline, while the menu is open", () => {
    act(() => { button().click(); });
    expect(button().getAttribute("aria-expanded")).toBe("true");
    const open = pill().getAttribute("class")!.split(/\s+/);
    expect(open).toContain("bg-sidebar-hover");
    for (const ring of open) expect(ring).not.toMatch(/^ring-/);
  });

  it("draws the ring for keyboard focus only, in one shared rule", () => {
    expect(pill().getAttribute("class")).toContain("[button:focus-visible:not([data-pointer-focus])>&]:ring-2");
    // the global ring and every focus-visible: utility skip a click's focus
    expect(css).toMatch(/\n:focus-visible:not\(\[data-pointer-focus\]\) \{\s*outline: 2px solid var\(--color-focus\);/);
    expect(css).toMatch(/@custom-variant focus-visible \(&:focus-visible:not\(\[data-pointer-focus\]\)\);/);
    // no per-button patch left behind
    expect(css).not.toMatch(/\[data-sidebar-connect-apps\]\[data-pointer-focus\]/);
  });
});
