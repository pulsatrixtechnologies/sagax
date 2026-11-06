// @vitest-environment happy-dom
// #2080 (L0): a provider with no mark of its own (a personal OpenAI-compatible
// server such as Skye, an Azure Foundry) drew its initial in a size-full span
// that stretched over its chip and squashed the label to nothing. It now draws
// its type's generic glyph at the size asked, and the label beside it stays.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderMark } from "./ProviderIcons";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const chip = (driverKind: string, size = 14) => act(() => root.render(
  createElement("button", { type: "button", className: "flex w-full" },
    createElement(ProviderMark, { driverKind, size }),
    createElement("span", { className: "min-w-0 flex-1 truncate" }, "Qwen 3.8 27B")),
));

describe("ProviderMark fallback", () => {
  it.each(["openai-compat", "azureFoundry", "ollama"])("draws a server glyph at the asked size for %s, never a letter", (driverKind) => {
    chip(driverKind);
    const glyph = host.querySelector("svg")!;
    expect(glyph.getAttribute("data-provider-generic")).toBe("server");
    expect(glyph.getAttribute("width")).toBe("14");
    expect(glyph.getAttribute("class")).toContain("shrink-0");
    expect(host.innerHTML).not.toContain("size-full");
    expect(host.querySelector("button")!.textContent).toBe("Qwen 3.8 27B");
  });

  it("draws a key glyph for another unknown driver, 16 px by default", () => {
    act(() => root.render(createElement(ProviderMark, { driverKind: "someNewAgent" })));
    const glyph = host.querySelector("svg")!;
    expect(glyph.getAttribute("data-provider-generic")).toBe("key");
    expect(glyph.getAttribute("width")).toBe("16");
    expect(host.textContent).toBe("");
  });

  it("keeps the brand marks", () => {
    act(() => root.render(createElement(ProviderMark, { driverKind: "claudeAgent", size: 14 })));
    expect(host.querySelector("[data-provider-generic]")).toBeNull();
    expect(host.querySelector("svg")).not.toBeNull();
  });
});
