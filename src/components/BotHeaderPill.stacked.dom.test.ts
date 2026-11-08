// @vitest-environment happy-dom
// The bot's title sits UNDER its name, never "Name · Title" on one line (the owner
// rule 2026-11-06, every surface): the chat pill, the window pill, a person's
// shared bots and a template's suggested team, mounted in a real DOM.
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

describe("bot name and title, stacked (the owner 2026-11-06)", () => {
  for (const [label, render] of [
    ["chat header", () => createElement(BotChatHeader, { name: "Ara", label: "Admin", panelOpen: false, onToggle: () => {}, avatar })],
    ["window pill", () => createElement(BotHeaderPill, { name: "Ara", label: "Admin", panelOpen: false, onToggle: () => {}, avatar })],
  ] as const) {
    it(`${label}: the name and the title are two separate lines`, () => {
      const el = mount(render());
      const text = el.querySelector<HTMLElement>("[data-bot-header-text]")!;
      const name = text.querySelector<HTMLElement>("[data-bot-header-name]")!;
      const title = text.querySelector<HTMLElement>("[data-bot-header-label]")!;
      expect(text.className).toContain("flex-col");
      expect([...text.children]).toEqual([name, title]);
      expect(name.textContent).toBe("Ara");
      expect(title.textContent).toBe("Admin");
      expect(title.className).toContain("text-ink-secondary");
      expect(name.className).toContain("block");
      expect(title.className).toContain("block");
      expect(el.textContent).not.toContain("Ara · Admin");
      expect(el.textContent).not.toContain("·");
      expect(text.getAttribute("title")).toBe("Ara\nAdmin");
    });
  }

  it("no title: the name alone, no empty second line", () => {
    const el = mount(createElement(BotChatHeader, { name: "Ara", label: " ", panelOpen: false, onToggle: () => {}, avatar }));
    expect(el.querySelector("[data-bot-header-label]")).toBeNull();
    expect(el.querySelector("[data-bot-header-name]")?.textContent).toBe("Ara");
  });
});
