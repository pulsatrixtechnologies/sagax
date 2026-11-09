// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { typingIntoField } from "./provisional-typing";

function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("typingIntoField", () => {
  const box = document.createElement("textarea");
  const button = document.createElement("button");

  it("lets plain letters into a text field while the drawing is up", () => {
    expect(typingIntoField(key(box, { key: "a" }))).toBe(true);
    expect(typingIntoField(key(box, { key: "Backspace" }))).toBe(true);
  });

  it("still stops Enter and shortcuts, which send or act", () => {
    expect(typingIntoField(key(box, { key: "Enter" }))).toBe(false);
    expect(typingIntoField(key(box, { key: "k", metaKey: true }))).toBe(false);
    expect(typingIntoField(key(box, { key: "v", ctrlKey: true }))).toBe(false);
  });

  it("stops keys outside a text field", () => {
    expect(typingIntoField(key(button, { key: "a" }))).toBe(false);
  });

  it("lets text input through but not a line break", () => {
    const text = new InputEvent("beforeinput", { inputType: "insertText", data: "a" });
    Object.defineProperty(text, "target", { value: box });
    const paragraph = new InputEvent("beforeinput", { inputType: "insertParagraph" });
    Object.defineProperty(paragraph, "target", { value: box });
    expect(typingIntoField(text)).toBe(true);
    expect(typingIntoField(paragraph)).toBe(false);
  });

  it("stops paste and drop even in a field", () => {
    const paste = new Event("paste");
    Object.defineProperty(paste, "target", { value: box });
    expect(typingIntoField(paste)).toBe(false);
  });
});
