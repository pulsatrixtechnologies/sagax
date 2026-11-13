// @vitest-environment happy-dom
// #4156 follow-up: the click mark (data-pointer-focus) hides the focus ring
// of a control focused by a mouse press. A place to type is never marked: a
// text-like input, a textarea, a select and an editable region keep their
// ring on a click, as Chromium treats them, so clicking into a field shows
// where the keys go and an arrow key while typing does not make the ring
// come and go.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { isTextEntry, trackInputModality } from "./input-modality";

beforeAll(() => trackInputModality());
afterEach(() => { document.body.replaceChildren(); });

function clickFocus(element: HTMLElement): void {
  document.body.append(element);
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element.focus();
}

function input(type: string): HTMLInputElement {
  const field = document.createElement("input");
  field.type = type;
  return field;
}

function editable(): HTMLElement {
  const region = document.createElement("div");
  region.setAttribute("contenteditable", "true");
  region.tabIndex = 0;
  return region;
}

describe("the click mark and text entry", () => {
  it.each([
    ["a text input", () => input("text")],
    ["a search input", () => input("search")],
    ["a password input", () => input("password")],
    ["an email input", () => input("email")],
    ["a number input", () => input("number")],
    ["a textarea", () => document.createElement("textarea")],
    ["a select", () => document.createElement("select")],
    ["a contenteditable region", editable],
  ])("leaves %s unmarked after a click, so its ring shows", (_name, make) => {
    const field = make();
    clickFocus(field);
    expect(document.activeElement).toBe(field);
    expect(field.hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("still marks a button and a checkbox focused by a click", () => {
    const button = document.createElement("button");
    clickFocus(button);
    expect(button.hasAttribute("data-pointer-focus")).toBe(true);
    const box = input("checkbox");
    clickFocus(box);
    expect(box.hasAttribute("data-pointer-focus")).toBe(true);
  });

  it("tells text entry from controls", () => {
    expect(isTextEntry(input("text"))).toBe(true);
    expect(isTextEntry(input("range"))).toBe(false);
    expect(isTextEntry(document.createElement("button"))).toBe(false);
  });
});
