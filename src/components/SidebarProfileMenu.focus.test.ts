// @vitest-environment happy-dom
// A mouse click on the account menu button leaves it focused; the next key
// (an arrow, Escape) would make that focus :focus-visible and draw a white
// ring round the footer tile. A pointer mark (data-pointer-focus) keeps the
// ring off until blur or Tab; keyboard focus never carries the mark, so the
// ring stays for it. The CSS is checked as text (happy-dom has no
// :focus-visible), the real thing by the gallery capture.
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

describe("the account menu button's focus ring", () => {
  it("is marked as pointer focus on a mouse press, so no ring shows", () => {
    act(() => { button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(true);
  });

  it("clears the mark on Tab and on blur, so keyboard focus shows the ring", () => {
    act(() => { button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    act(() => { button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(true);
    act(() => { button().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
    act(() => { button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    act(() => { button().focus(); button().blur(); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("never carries the mark when focused by keyboard alone", () => {
    act(() => { button().focus(); });
    expect(button().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("draws the pill ring only without the mark, and keeps a focus-visible style", () => {
    expect(container.querySelector("[data-sidebar-account-pill]")!.getAttribute("class")).toContain("[button:focus-visible:not([data-pointer-focus])>&]:ring-2");
    expect(css).toMatch(/\[data-pointer-focus\]:focus-visible,[^{]*\{\s*outline: none;/);
    expect(css).toMatch(/\[data-sidebar-connect-apps\]\[data-pointer-focus\]:focus-visible \{\s*box-shadow: none;/);
    // the global ring for keyboard focus is still there
    expect(css).toMatch(/\n:focus-visible \{\s*outline: 2px solid var\(--color-focus\);/);
  });
});
