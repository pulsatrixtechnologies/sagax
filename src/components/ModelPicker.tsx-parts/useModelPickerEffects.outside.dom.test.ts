// @vitest-environment happy-dom
// The model menu's outside press (#5338, M-20261125-035): a level of the mode
// menu's cascade floats on the page, outside the menu's own box; a press in
// it is a press in the menu and must not close it before the click lands.
import { describe, expect, it } from "vitest";

import { pressInsideModelMenu } from "./useModelPickerEffects";

describe("pressInsideModelMenu", () => {
  it("keeps the menu open for a press in the menu, in a level of its cascade and on a text node of one; closes it elsewhere", () => {
    document.body.innerHTML = `
      <div id="menu"><button id="row">All models</button></div>
      <div data-mode-level="models"><button id="model">grok-4</button></div>
      <button id="elsewhere">Send</button>`;
    const menu = document.getElementById("menu");
    const roots = [menu, null, undefined];
    expect(pressInsideModelMenu(document.getElementById("row"), roots)).toBe(true);
    expect(pressInsideModelMenu(document.getElementById("model"), roots)).toBe(true);
    expect(pressInsideModelMenu(document.getElementById("model")!.firstChild, roots)).toBe(true);
    expect(pressInsideModelMenu(document.getElementById("elsewhere"), roots)).toBe(false);
    expect(pressInsideModelMenu(null, roots)).toBe(false);
  });
});
