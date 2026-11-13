// @vitest-environment happy-dom
// The chat header's pill writes "Name · Title" on one line, as the reference app
// (#4093, the owner's side by side of 2026-11-12, replacing the stacked lines
// of 2026-11-06 for this pill): the chat pill and the window pill, mounted in
// a real DOM.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BotChatHeader, BotHeaderPill } from "./BotHeaderPill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: ReturnType<typeof createElement>): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const avatar = createElement("span", { "data-test-avatar": "" });

describe("bot name and title on one line in the header pill (#4093)", () => {
  for (const [label, render] of [
    ["chat header", () => createElement(BotChatHeader, { name: "Ara", label: "Admin", panelOpen: false, onToggle: () => {}, avatar })],
    ["window pill", () => createElement(BotHeaderPill, { name: "Ara", label: "Admin", panelOpen: false, onToggle: () => {}, avatar })],
  ] as const) {
    it(`${label}: the name, a dot and the title on one line`, () => {
      const el = mount(render());
      const text = el.querySelector<HTMLElement>("[data-bot-header-text]")!;
      const name = text.querySelector<HTMLElement>("[data-bot-header-name]")!;
      const title = text.querySelector<HTMLElement>("[data-bot-header-label]")!;
      expect(text.className).not.toContain("flex-col");
      expect(text.className).toContain("whitespace-nowrap");
      expect(text.children).toHaveLength(3);
      expect(text.children[0]).toBe(name);
      expect(text.children[2]).toBe(title);
      expect(text.children[1]!.textContent).toBe("·");
      expect(text.children[1]!.getAttribute("aria-hidden")).toBe("true");
      expect(name.textContent).toBe("Ara");
      expect(title.textContent).toBe("Admin");
      // one ink for the name and the title (#4163, the owner 2026-11-13)
      expect(title.className).not.toContain("text-ink-secondary");
      expect(text.className).toContain("text-ink");
      expect(text.textContent).toBe("Ara·Admin");
      expect(text.getAttribute("title")).toBe("Ara\nAdmin");
    });
  }

  it("no title: the name alone, no empty second line", () => {
    const el = mount(createElement(BotChatHeader, { name: "Ara", label: " ", panelOpen: false, onToggle: () => {}, avatar }));
    expect(el.querySelector("[data-bot-header-label]")).toBeNull();
    expect(el.querySelector("[data-bot-header-name]")?.textContent).toBe("Ara");
  });
});
