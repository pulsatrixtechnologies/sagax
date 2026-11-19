// @vitest-environment happy-dom
// #4470: the bot page's one modal shell, as the reference app's bot page
// setup dialog (measured on its installed bundle): its frame and header,
// Escape and the focus going back to its button, a modal opened from a
// modal stacked over it, the backdrop, and a popover inside it that keeps
// its own Escape.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { setLocale } from "@/lib/i18n";
import { BOT_PAGE_MODAL, BotPageModal } from "./BotPageModal";
import { repeatsModalTitle } from "./modal-title";
import { SUBPAGE_META, SUBPAGE_SIZE } from "./BotProfilePage.tsx-parts/subpages";

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
    second && createElement(BotPageModal, { id: "second", title: "Memory", size: "large", bare: true, onClose: () => setSecond(false), children: createElement("p", null, "notes") }),
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

describe("owner: no bot page modal is larger than the Settings window", () => {
  it("the large size is the Settings modal's own width, height and margins", () => {
    const settings = readFileSync(resolve(process.cwd(), "src/components/SettingsModal.tsx"), "utf8");
    for (const token of ["h-[min(700px,calc(100dvh-96px))]", "w-[min(900px,calc(100vw-40px))]"]) {
      expect(settings, token).toContain(token);
      expect(BOT_PAGE_MODAL.size.large, token).toContain(token);
    }
  });

  it("a section whose heading repeats the modal's title does not draw it again, in any case; other headings stay", () => {
    expect(repeatsModalTitle("Shared with", "Shared with")).toBe(true);
    expect(repeatsModalTitle("Shared with", " shared WITH ")).toBe(true);
    expect(repeatsModalTitle("Shared with", "People and groups")).toBe(false);
    expect(repeatsModalTitle(null, "Shared with")).toBe(false);
    expect(repeatsModalTitle("Rules", undefined)).toBe(false);
  });
});

describe("bot page modals are larger (owner: we barely see anything)", () => {
  it("the large size is most of the window, the medium one wider than 560px and sized to its content, on one shared grid", () => {
    expect(BOT_PAGE_MODAL.size.large).toContain("w-[min(900px,calc(100vw-40px))]");
    expect(BOT_PAGE_MODAL.size.large).toContain("h-[min(700px,calc(100dvh-96px))]");
    expect(BOT_PAGE_MODAL.size.large).toContain("--bot-modal-fill");
    expect(BOT_PAGE_MODAL.size.medium).toContain("w-[min(720px,calc(100vw-40px))]");
    expect(BOT_PAGE_MODAL.size.wide, "a short list is sized to its content").toContain("w-[min(900px,calc(100vw-40px))]");
    expect(BOT_PAGE_MODAL.size.wide).not.toMatch(/(^| )h-\[/);
    expect(BOT_PAGE_MODAL.size.large, "the editor leaves its counters and Save visible").toContain("--bot-modal-fill:min(256px,calc(100dvh-540px))");
    expect(BOT_PAGE_MODAL.bodyFade, "the body's bottom edge fades while more is below").toContain("mask-image");
    expect(BOT_PAGE_MODAL.size.medium, "content height, never a fixed tall box").not.toMatch(/(^| )h-\[/);
    // header, body and footer share the 24px side edge
    expect(BOT_PAGE_MODAL.header).toContain("px-6");
    expect(BOT_PAGE_MODAL.body).toContain("px-6");
    expect(BOT_PAGE_MODAL.footer).toContain("pl-6");
  });

  it("every sub-page of the bot page has a size: editors, lists and tables large, a few fields medium", () => {
    expect(Object.keys(SUBPAGE_SIZE).sort()).toEqual(Object.keys(SUBPAGE_META).sort());
    for (const page of ["rules", "personality", "versions", "actsAlone", "advanced"] as const) expect(SUBPAGE_SIZE[page], page).toBe("large");
    for (const page of ["beforeActing", "folder", "routines"] as const) expect(SUBPAGE_SIZE[page], page).toBe("wide");
    for (const page of ["model", "voice"] as const) expect(SUBPAGE_SIZE[page], page).toBe("medium");
  });
});

describe("regression #4470: the bot page's modal shell", () => {
  it("draws the reference's modal (medium: 720px wide, as tall as its content): 20px corners, a hairline, the centred title and its line, the close at the top right, pills at the bottom right", async () => {
    await click(host.querySelector("[data-open-first]"));
    const frame = modal("first")!;
    expect(frame, "portalled to the body, over the page").not.toBeNull();
    expect(host.contains(frame)).toBe(false);
    expect(frame.getAttribute("role")).toBe("dialog");
    expect(frame.getAttribute("aria-modal")).toBe("true");
    for (const cls of ["w-[min(720px,calc(100vw-40px))]", "max-h-[min(700px,calc(100dvh-96px))]", "rounded-[20px]", "border-[0.5px]", "bg-app"]) expect(frame.className).toContain(cls);
    // the scrim at half black, the window centred in it
    const layer = frame.parentElement!;
    expect(layer.hasAttribute("data-dialog-layer")).toBe(true);
    expect(layer.className).toContain("bg-black/50");
    expect(layer.className).toContain("items-center");
    // the header: 40px from the top and sides, centred; 22px over 28, medium
    const header = frame.querySelector<HTMLElement>("[data-bot-page-modal-header]")!;
    for (const cls of ["pt-10", "px-6", "pb-3", "text-center", "items-center"]) expect(header.className).toContain(cls);
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
    expect(second.className).toContain("w-[min(900px,calc(100vw-40px))]");
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
