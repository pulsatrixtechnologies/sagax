// @vitest-environment happy-dom
// The approvals dot on the sidebar avatar opens the Approvals screen: a
// button of its own beside the account button (never inside it), shown
// while a conversation waits on the person, in the wide row and in the
// foot's pill and rail avatar. Opening it never opens the account menu.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const waiting = (count: number) => [{
  id: "b1",
  tasks: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, activity: "waiting-on-you" })),
}] as unknown as AppState["bots"];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.state = { config: { profile: { name: "Sample Person", email: "person@example.com" } } as AppState["config"], bots: waiting(2) };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Parameters<typeof SidebarProfileMenu>[0] = {}) => {
  act(() => root.render(createElement(SidebarProfileMenu, props)));
};
const dot = () => container.querySelector<HTMLButtonElement>("[data-avatar-approvals]");
const menuButton = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const opensApprovals = () => fixture.dispatch.mock.calls.filter(([action]) => action.type === "showApprovals").length;

describe("the avatar's approvals dot", () => {
  it("is shown only while something waits on the person", () => {
    fixture.state = { ...fixture.state, bots: waiting(0) };
    render();
    expect(dot()).toBeNull();
    fixture.state = { ...fixture.state, bots: waiting(3) };
    render();
    expect(dot()).not.toBeNull();
    expect(dot()!.getAttribute("data-avatar-approvals")).toBe("3");
  });

  for (const [variant, props] of [
    ["the wide row", {}],
    ["the foot's pill", { avatarOnly: true, withName: true }],
    ["the rail avatar", { avatarOnly: true }],
  ] as const) {
    it(`is a real button beside the account button, named for what it opens, in ${variant}`, () => {
      render(props);
      const button = dot()!;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-label")).toBe("Open approvals, 2 pending");
      expect(button.closest('button[aria-haspopup="menu"]')).toBeNull();
      expect(menuButton().contains(button)).toBe(false);
    });

    it(`opens Approvals on a click, not the account menu, in ${variant}`, () => {
      render(props);
      act(() => dot()!.click());
      expect(opensApprovals()).toBe(1);
      expect(menuButton().getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('[role="menu"]')).toBeNull();
    });
  }

  for (const key of ["Enter", " "]) {
    it(`opens Approvals once from the keyboard (${key === " " ? "Space" : key}), not the account menu`, () => {
      render();
      const button = dot()!;
      // a native <button type="button">: the browser turns Enter and Space into its click
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      act(() => {
        button.focus();
        button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        button.click();
        button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(button);
      expect(opensApprovals()).toBe(1);
      expect(menuButton().getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('[role="menu"]')).toBeNull();
    });
  }
});
