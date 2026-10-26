// @vitest-environment happy-dom
// The bar beside a 1:1 message: react, reply and … in a row (the tray of
// MessageHoverActions, Grok Bot's shapes), the time under them. Copy, Copy
// request ID and every other control are labelled entries of the … menu.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MessageBar, MessageMenuItem } from "./MessageBar";

let host: HTMLDivElement;
let root: Root;
const bar = () => host.querySelector<HTMLElement>("[data-message-bar]")!;
const handle = () => bar().querySelector<HTMLButtonElement>("[data-more-button]")!;
const items = () =>
  [...document.querySelectorAll<HTMLElement>('[data-message-menu]:not([aria-hidden="true"]) [role="menuitem"]:not([data-more-reactions])')]
    .filter((item) => !item.classList.contains("hidden"))
    .map((item) => item.textContent);

async function render(side: "bot" | "user" = "bot", onSelect = vi.fn(), react = false) {
  const onPick = vi.fn();
  await act(async () => {
    root.render(
      createElement(MessageBar, {
        side,
        time: "1:54 PM",
        copy: "an answer",
        onReply: () => {},
        requestId: "m1",
        react: react ? { mine: ["👍"], onPick } : undefined,
        children: [
          createElement(MessageMenuItem, { key: "raw", label: "Show raw markdown", icon: null, onSelect }),
          createElement(MessageMenuItem, { key: "regen", label: "Regenerate response", icon: null, onSelect: () => {} }),
        ],
      }),
    );
  });
  return { onSelect, onPick };
}

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("MessageBar", () => {
  it("shows react, reply, … and the time under them, with no menu open", async () => {
    await render("bot", vi.fn(), true);
    const buttons = [...bar().querySelectorAll("[data-hover-actions] > button")].map((button) => button.getAttribute("aria-label"));
    expect(buttons).toEqual(["Add reaction", "Reply to message", "Message actions"]);
    expect(bar().querySelector("[data-message-time]")!.textContent).toBe("1:54 PM");
    expect(bar().className).toContain("flex-col");
    expect(items()).toEqual([]);
    expect(handle().getAttribute("aria-haspopup")).toBe("menu");
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("holds Reply, Copy, Copy request ID, then the message's own entries in the … menu", async () => {
    await render();
    await act(async () => handle().click());
    expect(handle().getAttribute("aria-expanded")).toBe("true");
    expect(items()).toEqual(["Reply", "Copy", "Copy request ID", "Show raw markdown", "Regenerate response"]);
    expect(bar().dataset.open).toBe("true");
    expect(bar().className).toContain("opacity-100");
  });

  it("runs an entry and closes the menu", async () => {
    const { onSelect } = await render();
    await act(async () => handle().click());
    const raw = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Show raw markdown")!;
    await act(async () => raw.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape", async () => {
    await render();
    await act(async () => handle().click());
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens under the row, in a portal out of the transcript's rows", async () => {
    for (const side of ["bot", "user"] as const) {
      await render(side);
      await act(async () => handle().click());
      const menu = document.querySelector<HTMLElement>('[data-message-menu]:not([aria-hidden="true"])')!;
      // a row with content-visibility: auto paints only inside itself
      expect(menu.parentElement).toBe(document.body);
      expect(host.contains(menu)).toBe(false);
      expect(menu.className).toContain("fixed");
      expect(menu.dataset.side).toBe("below");
      await act(async () => handle().click());
    }
  });

  it("sends a quick reaction from the smiley's pill", async () => {
    const { onPick } = await render("bot", vi.fn(), true);
    await act(async () => bar().querySelector<HTMLButtonElement>("[data-react-button]")!.click());
    expect(bar().className).toContain("opacity-100");
    await act(async () => document.querySelector<HTMLButtonElement>('[data-reaction-bar] [data-quick-reaction="🎉"]')!.click());
    expect(onPick).toHaveBeenCalledWith("🎉");
  });

  // Dragging right to left across one's own message reaches the bar that
  // sits before its text in the DOM: the hidden time must not be copied.
  it("keeps the time out of a text selection", async () => {
    await render("user");
    const time = bar().querySelector<HTMLElement>("[data-message-time]")!;
    expect(time.textContent).toBe("1:54 PM");
    expect(bar().className).toContain("select-none");
    expect(time.className).toContain("select-none");
  });
});
