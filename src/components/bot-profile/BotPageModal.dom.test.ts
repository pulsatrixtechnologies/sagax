// @vitest-environment happy-dom
// #4470: the bot page's one modal shell, as the reference app's bot page
// setup dialog (measured on its installed bundle): its frame and header,
// Escape and the focus going back to its button, a modal opened from a
// modal stacked over it, the backdrop, and a popover inside it that keeps
// its own Escape.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { BotPageModal } from "./BotPageModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** A page with a button that opens a modal, whose button opens a second one. */
function Page() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const [menu, setMenu] = useState(false);
  return createElement("div", null,
    createElement("button", { type: "button", "data-open-first": "", onClick: () => setFirst(true) }, "Personality"),
    first && createElement(BotPageModal, {
      id: "first",
      title: "Personality",
      description: "How it talks and what it knows.",
      onClose: () => setFirst(false),
      footer: createElement("button", { type: "button", "data-footer-done": "" }, "Done"),
      children: createElement("div", null,
        createElement("button", { type: "button", "data-open-second": "", onClick: () => setSecond(true) }, "Memory"),
        createElement("button", { type: "button", "data-menu": "", "aria-haspopup": "listbox", "aria-expanded": menu ? "true" : "false", onClick: () => setMenu(true) }, "Pick"),
      ),
    }),
    second && createElement(BotPageModal, { id: "second", title: "Memory", size: "page", bare: true, onClose: () => setSecond(false), children: createElement("p", null, "notes") }),
  );
}

const modal = (id: string) => document.querySelector<HTMLElement>(`[data-bot-page-modal="${id}"]`);
const press = async (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
};
const click = async (node: HTMLElement | null) => {
  if (!node) throw new Error("nothing to click");
  node.focus();
  await act(async () => { node.click(); });
};

beforeEach(async () => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Page)); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("regression #4470: the bot page's modal shell", () => {
  it("draws the reference's modal: 560px by 700px, 20px corners, a hairline, the centred title and its line, the close at the top right, pills at the bottom right", async () => {
    await click(host.querySelector("[data-open-first]"));
    const frame = modal("first")!;
    expect(frame, "portalled to the body, over the page").not.toBeNull();
    expect(host.contains(frame)).toBe(false);
    expect(frame.getAttribute("role")).toBe("dialog");
    expect(frame.getAttribute("aria-modal")).toBe("true");
    for (const cls of ["w-[min(560px,calc(100vw-32px))]", "h-[min(700px,calc(100dvh-96px))]", "rounded-[20px]", "border-[0.5px]", "bg-app"]) expect(frame.className).toContain(cls);
    // the scrim at half black, the window centred in it
    const layer = frame.parentElement!;
    expect(layer.hasAttribute("data-dialog-layer")).toBe(true);
    expect(layer.className).toContain("bg-black/50");
    expect(layer.className).toContain("items-center");
    // the header: 40px from the top and sides, centred; 22px over 28, medium
    const header = frame.querySelector<HTMLElement>("[data-bot-page-modal-header]")!;
    for (const cls of ["pt-10", "px-10", "pb-3", "text-center", "items-center"]) expect(header.className).toContain(cls);
    const title = header.querySelector("h2")!;
    expect(title.textContent).toBe("Personality");
    for (const cls of ["text-[22px]", "leading-7", "font-medium", "tracking-[-0.012em]"]) expect(title.className).toContain(cls);
    expect(frame.getAttribute("aria-labelledby")).toBe(title.id);
    const line = header.querySelector("p")!;
    expect(line.textContent).toBe("How it talks and what it knows.");
    for (const cls of ["text-[14px]", "leading-5", "text-ink-secondary"]) expect(line.className).toContain(cls);
    expect(frame.getAttribute("aria-describedby")).toBe(line.id);
    // the close: the round button 10px from the top right, first in the frame
    const close = frame.querySelector<HTMLElement>(":scope > [data-dialog-close]")!;
    for (const cls of ["absolute", "right-2.5", "top-2.5", "rounded-full"]) expect(close.className).toContain(cls);
    expect(close.getAttribute("aria-label")).toBe("Close");
    // the body 24px in, scrolling; the pills at the bottom right
    const body = frame.querySelector<HTMLElement>("[data-bot-page-modal-body]")!;
    for (const cls of ["px-6", "overflow-y-auto", "flex-1"]) expect(body.className).toContain(cls);
    const footer = frame.querySelector<HTMLElement>("[data-bot-page-modal-footer]")!;
    for (const cls of ["justify-end", "gap-2", "pl-6", "pr-4", "pb-4", "pt-3"]) expect(footer.className).toContain(cls);
  });

  it("takes the focus, keeps Tab inside, and Escape closes it with the focus back on its button", async () => {
    const opener = host.querySelector<HTMLElement>("[data-open-first]")!;
    await click(opener);
    const frame = modal("first")!;
    expect(frame.contains(document.activeElement)).toBe(true);
    // Shift+Tab from the frame wraps to its last control (the footer's pill)
    frame.focus();
    await press(frame, "Tab", { shiftKey: true });
    expect(document.activeElement?.hasAttribute("data-footer-done")).toBe(true);
    const escape = await press(document.activeElement!, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(modal("first")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("a modal opened from a modal stacks over it with its own scrim; Escape closes the top one only, then the first", async () => {
    await click(host.querySelector("[data-open-first]"));
    const inner = modal("first")!.querySelector<HTMLElement>("[data-open-second]")!;
    await click(inner);
    const layers = Array.from(document.querySelectorAll("[data-dialog-layer]"));
    expect(layers.map((layer) => layer.querySelector("[data-bot-page-modal]")?.getAttribute("data-bot-page-modal")), "the second is later in the body: on top").toEqual(["first", "second"]);
    for (const layer of layers) expect(layer.className).toContain("bg-black/50");
    // a page drawn in a modal: the Settings window's size, no title row, no
    // second close over the page's own header, named for readers
    const second = modal("second")!;
    expect(second.className).toContain("w-[min(900px,calc(100vw-32px))]");
    expect(second.querySelector("[data-bot-page-modal-header]")).toBeNull();
    expect(second.getAttribute("aria-label")).toBe("Memory");
    expect(second.querySelector("[data-dialog-close]")).toBeNull();
    await press(document.activeElement!, "Escape");
    expect(modal("second")).toBeNull();
    expect(modal("first")).not.toBeNull();
    expect(document.activeElement).toBe(inner);
    await press(document.activeElement!, "Escape");
    expect(modal("first")).toBeNull();
  });

  it("an open popover inside it keeps its own Escape, and a press on the scrim closes it", async () => {
    await click(host.querySelector("[data-open-first]"));
    await click(modal("first")!.querySelector<HTMLElement>("[data-menu]"));
    const escape = await press(document.activeElement!, "Escape");
    expect(escape.defaultPrevented, "left to the popover").toBe(false);
    expect(modal("first"), "the modal stays").not.toBeNull();
    const layer = modal("first")!.parentElement!;
    await act(async () => { layer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(modal("first")).toBeNull();
  });
});
