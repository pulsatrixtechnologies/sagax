// @vitest-environment happy-dom
// The tray beside a message, in the reference design's shapes (owner, 2026-10-15): the row
// (react, reply, …), the quick reaction pill, and the … menu that starts with
// the same reactions, then Reply, Copy, Copy request ID, then Sagax's own.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const copied: string[] = [];
vi.mock("@/lib/copy-text", () => ({
  copyText: async (text: string) => {
    copied.push(text);
    return "copied";
  },
}));

const { MessageHoverActions, MessageMenuItem } = await import("./MessageHoverActions");

let host: HTMLDivElement;
let root: Root;
// the popups are drawn in a portal on document.body
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const rowLabels = () => all("[data-hover-actions] > button").map((button) => button.getAttribute("aria-label"));
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });

async function render(side: "user" | "bot" = "bot", extra = vi.fn()) {
  const picks: string[] = [];
  const replies: number[] = [];
  await act(async () => {
    root.render(
      createElement(
        MessageHoverActions,
        {
          side,
          onReply: () => replies.push(1),
          copy: "Hi, I'm Rocket.",
          requestId: "msg_123",
          react: { mine: ["❤️"], onPick: (emoji: string) => picks.push(emoji) },
        },
        createElement(MessageMenuItem, { label: "Edit message", icon: null, onSelect: extra }),
        createElement(MessageMenuItem, { label: "Pin message", icon: null, onSelect: () => {}, hidden: true }),
      ),
    );
  });
  return { picks, replies, extra };
}

beforeEach(() => {
  setLocale("en");
  copied.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("MessageHoverActions: the row", () => {
  it("holds react, reply and … in that order, 24px rounded buttons, nothing open", async () => {
    await render();
    expect(rowLabels()).toEqual(["Add reaction", "Reply to message", "Message actions"]);
    for (const button of all("[data-hover-actions] > button")) {
      expect(button.className).toContain("size-6");
      expect(button.className).toContain("rounded-[6px]");
    }
    expect(q("[data-hover-actions]")!.getAttribute("role")).toBe("toolbar");
    expect(q('[role="menu"]')).toBeNull();
  });

  it("mirrors on the person's side so the smiley stays nearest the bubble", async () => {
    await render("user");
    expect(q("[data-hover-actions]")!.className).toContain("flex-row-reverse");
  });

  it("moves between its buttons with the arrows", async () => {
    await render();
    const [smiley, reply] = all("[data-hover-actions] > button");
    smiley!.focus();
    await key(smiley!, "ArrowRight");
    expect(document.activeElement).toBe(reply);
  });
});

describe("MessageHoverActions: the quick reaction pill", () => {
  it("opens on the smiley with 👍 👎 ❤️ 😂 🎉 and More reactions, focused on the first", async () => {
    await render();
    await act(async () => q("[data-react-button]")!.click());
    const bar = q("[data-reaction-bar]")!;
    expect(bar.getAttribute("role")).toBe("menu");
    expect(bar.className).toContain("rounded-full");
    const cells = [...bar.querySelectorAll<HTMLElement>("[data-quick-reaction]")];
    expect(cells.map((cell) => cell.dataset.quickReaction)).toEqual(["👍", "👎", "❤️", "😂", "🎉"]);
    expect(cells.find((cell) => cell.dataset.quickReaction === "❤️")!.getAttribute("aria-checked")).toBe("true");
    expect(bar.querySelector("[data-more-reactions]")!.getAttribute("aria-label")).toBe("More reactions");
    expect(document.activeElement).toBe(cells[0]);
    expect(q("[data-react-button]")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("sends the reaction chosen and closes, focus back on the smiley", async () => {
    const { picks } = await render();
    await act(async () => q("[data-react-button]")!.click());
    await act(async () => q('[data-reaction-bar] [data-quick-reaction="😂"]')!.click());
    expect(picks).toEqual(["😂"]);
    expect(q("[data-react-button]")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(q("[data-react-button]"));
  });

  it("walks the pill with the arrows and closes on Escape", async () => {
    await render();
    await act(async () => q("[data-react-button]")!.click());
    const bar = q("[data-reaction-bar]")!;
    await key(document.activeElement!, "ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.quickReaction).toBe("👎");
    await key(document.activeElement!, "End");
    expect(document.activeElement).toBe(bar.querySelector("[data-more-reactions]"));
    await key(document.activeElement!, "Escape");
    expect(q("[data-react-button]")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(q("[data-react-button]"));
  });

  it("opens the full picker from More reactions", async () => {
    await render();
    await act(async () => q("[data-react-button]")!.click());
    await act(async () => q("[data-reaction-bar] [data-more-reactions]")!.click());
    expect(q("[data-reaction-picker]")).not.toBeNull();
  });
});

describe("MessageHoverActions: the … menu", () => {
  it("starts with the reactions, then Reply, Copy, Copy request ID, then Sagax's own", async () => {
    await render();
    await act(async () => q("[data-more-button]")!.click());
    const menu = q("[data-message-menu]")!;
    // the menu family's surface and width since #4183 (menu-look.tsx)
    expect(menu.className).toContain("menu-surface");
    expect(menu.className).toContain("rounded-2xl");
    expect(menu.className).toContain("min-w-[min(228px,calc(100vw-16px))]");
    expect([...menu.querySelectorAll("[data-quick-reaction]")].map((cell) => (cell as HTMLElement).dataset.quickReaction)).toEqual(["👍", "👎", "❤️", "😂", "🎉"]);
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-more-reactions])')].filter((row) => !row.classList.contains("hidden"));
    expect(rows.map((row) => row.textContent)).toEqual(["Reply", "Copy", "Copy request ID", "Edit message"]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(document.activeElement).toBe(menu.querySelector('[data-quick-reaction="👍"]'));
  });

  it("copies the request ID and closes", async () => {
    await render();
    await act(async () => q("[data-more-button]")!.click());
    const entry = all('[data-message-menu] [role="menuitem"]').find((row) => row.textContent === "Copy request ID")!;
    await act(async () => entry.click());
    expect(copied).toEqual(["msg_123"]);
    expect(q("[data-message-menu]")?.getAttribute("aria-hidden") ?? null).not.toBe("false");
    expect(q("[data-more-button]")!.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("Request ID copied");
  });

  it("copies the text, replies and reacts from the menu", async () => {
    const { picks, replies } = await render();
    await act(async () => q("[data-more-button]")!.click());
    await act(async () => all('[data-message-menu] [role="menuitem"]').find((row) => row.textContent === "Copy")!.click());
    expect(copied).toEqual(["Hi, I'm Rocket."]);
    await act(async () => q("[data-more-button]")!.click());
    await act(async () => all('[data-message-menu] [role="menuitem"]').find((row) => row.textContent === "Reply")!.click());
    expect(replies).toEqual([1]);
    await act(async () => q("[data-more-button]")!.click());
    await act(async () => q('[data-message-menu] [data-quick-reaction="👍"]')!.click());
    expect(picks).toEqual(["👍"]);
  });

  it("moves down the rows with the arrows, skips hidden ones and closes on Escape", async () => {
    const { extra } = await render();
    await act(async () => q("[data-more-button]")!.click());
    await key(document.activeElement!, "End");
    expect(document.activeElement!.textContent).toBe("Edit message");
    await key(document.activeElement!, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.quickReaction).toBe("👍");
    await key(document.activeElement!, "ArrowUp");
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(extra).toHaveBeenCalledTimes(1);
    await act(async () => q("[data-more-button]")!.click());
    await key(document.activeElement!, "Escape");
    expect(q("[data-more-button]")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(q("[data-more-button]"));
  });

  it("puts the view entries (read aloud, raw markdown) in a last section of their own", async () => {
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(MessageHoverActions, {
          side: "bot",
          copy: "x",
          view: createElement(MessageMenuItem, { label: "Show raw Markdown", icon: null, onSelect: noop }),
        }, createElement(MessageMenuItem, { label: "Regenerate", icon: null, onSelect: noop })),
      );
    });
    await act(async () => q("[data-more-button]")!.click());
    const menu = q("[data-message-menu]")!;
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent)).toEqual(["Copy", "Regenerate", "Show raw Markdown"]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(q("[data-menu-view]")!.textContent).toBe("Show raw Markdown");
  });

  it("drops the divider before Sagax's entries when every one is hidden", async () => {
    await act(async () => {
      root.render(
        createElement(MessageHoverActions, { side: "bot", copy: "x" }, createElement(MessageMenuItem, { label: "Pin message", icon: null, onSelect: () => {}, hidden: true })),
      );
    });
    await act(async () => q("[data-more-button]")!.click());
    expect(q("[data-menu-extra]")!.className).toContain("has-[>[role=menuitem]:not(.hidden)]:flex");
    expect(q("[data-react-button]")).toBeNull();
  });
});

describe("MessageHoverActions: placement (Owner, 2026-10-18)", () => {
  // A transcript row has content-visibility: auto, which paints nothing
  // outside the row: the popups live on document.body and are placed there.
  const atRow = (box: { left: number; top: number; width: number; height: number }) => {
    const row = q("[data-hover-actions]")!;
    row.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;
  };
  const sized = (width: number, height: number) => {
    const spies = [
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height),
    ];
    return () => spies.forEach((spy) => spy.mockRestore());
  };

  it("draws the pill outside the message, below a row with room", async () => {
    await render("bot");
    atRow({ left: 300, top: 200, width: 80, height: 24 });
    const restore = sized(225, 45);
    await act(async () => q("[data-react-button]")!.click());
    const bar = q("[data-reaction-bar]")!;
    expect(bar.parentElement).toBe(document.body);
    expect(host.contains(bar)).toBe(false);
    expect(bar.dataset.side).toBe("below");
    expect(bar.style.top).toBe("228px");
    expect(bar.style.left).toBe("300px");
    restore();
  });

  it("opens above the last message at the bottom, on the person's side", async () => {
    await render("user");
    atRow({ left: 600, top: window.innerHeight - 40, width: 80, height: 24 });
    const restore = sized(225, 45);
    await act(async () => q("[data-react-button]")!.click());
    const bar = q("[data-reaction-bar]")!;
    expect(bar.dataset.side).toBe("above");
    expect(bar.style.top).toBe(`${window.innerHeight - 40 - 4 - 45}px`);
    expect(bar.style.left).toBe(`${680 - 225}px`);
    restore();
  });

  it("opens the full picker below the first message at the top", async () => {
    await render("bot");
    atRow({ left: 300, top: 40, width: 80, height: 24 });
    const restore = sized(272, 309);
    await act(async () => q("[data-react-button]")!.click());
    await act(async () => q("[data-reaction-bar] [data-more-reactions]")!.click());
    const picker = q("[data-reaction-picker]")!;
    expect(picker.parentElement).toBe(document.body);
    expect(picker.dataset.side).toBe("below");
    expect(picker.style.top).toBe("68px");
    restore();
  });

  it("stays open when a press lands inside the portal popup", async () => {
    await render("bot");
    await act(async () => q("[data-more-button]")!.click());
    const menu = q("[data-message-menu]")!;
    await act(async () => {
      menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(q("[data-more-button]")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(q("[data-more-button]")!.getAttribute("aria-expanded")).toBe("false");
  });
});
