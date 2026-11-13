// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { collapseBotExchanges } from "@/lib/bot-exchange";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { BotExchangeChip, ExchangeSheet } from "./BotExchangeChip";
import { ChatWindowProvider } from "./BotHeaderPill";

// These lines exist only with threads on; the unified chat (the default)
// draws none of them (unified-chat.guard.test.ts).
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
}));

const NOTE = "[Message from @Quasar, another bot in this Sagax workspace. Reply to them.]\n\nWhich database?";

beforeAll(() => setLocale("en"));

function run() {
  const now = Date.now();
  const messages = [
    { id: "p", role: "user", kind: "text", text: NOTE, at: now, peerAsk: { botId: "cry", name: "Quasar" } },
    { id: "r", role: "bot", kind: "text", text: "on it", at: now + 1000, requestMessageId: "p" },
  ] as Message[];
  const items = collapseBotExchanges(messages, {
    selfBotId: "un",
    self: { id: "un", name: "unRAID", color: "orange" },
  });
  const exchange = items.find((item) => item.kind === "exchange");
  if (!exchange || exchange.kind !== "exchange") throw new Error("expected a run");
  return exchange.run;
}

describe("BotExchangeChip sheet", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("opens the in-column sheet when onGo returns false", async () => {
    const onGo = vi.fn(() => false);
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo }));
    });
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click();
    });
    expect(onGo).toHaveBeenCalledOnce();
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]");
    expect(sheet).not.toBeNull();
    expect(sheet!.className).toContain("absolute");
    expect(sheet!.className).toContain("inset-0");
    expect(sheet!.className).not.toContain("fixed");
    const close = host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-close]")!;
    expect(close.textContent).toBe("Close Chat");
    expect(host.textContent).toContain("Which database?");
  });

  it("closes from one centered Close Chat pill and on Escape; no X, no composer (#3245)", async () => {
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo: () => false }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.getAttribute("data-exchange-chrome")).toBe("sheet");
    const closes = sheet.querySelectorAll("button[data-testid=bot-exchange-close]");
    expect(closes).toHaveLength(1);
    const pill = closes[0] as HTMLButtonElement;
    expect(pill.textContent).toBe("Close Chat");
    expect(pill.hasAttribute("data-window-close")).toBe(false);
    expect(sheet.querySelector("[data-window-close]")).toBeNull();
    expect(sheet.querySelector("svg.lucide-x")).toBeNull();
    // the pill sits in the bottom row, centered, in place of the composer
    expect(pill.parentElement!.className).toContain("justify-center");
    expect(sheet.lastElementChild!.contains(pill)).toBe(true);
    expect(sheet.querySelector("textarea")).toBeNull();
    await act(async () => pill.click());
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();

    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();
  });

  it("covers the whole column and stays open when the chat sends (#3245)", async () => {
    const render = (sentKey?: string) => root.render(createElement(ChatWindowProvider, {
      value: { panelOpen: true, onTogglePanel: () => {}, composerInset: 96, sentKey },
      children: createElement(BotExchangeChip, { run: run(), onGo: () => false }),
    }));
    await act(async () => render("u1"));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector<HTMLElement>("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.style.bottom).toBe("");
    await act(async () => render("u2"));
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).not.toBeNull();
  });

  it("keeps the header pill on an opaque band: no line scrolls under it (#3245)", async () => {
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo: () => false }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    const header = sheet.querySelector<HTMLElement>("[data-exchange-header]")!;
    expect(header.hasAttribute("data-chat-header-bar")).toBe(false);
    expect(header.className).toContain("shrink-0");
    expect(header.className).toContain("bg-app");
    expect(header.className).not.toMatch(/absolute/);
    expect(header.querySelector("[data-chat-pill]")?.className).toMatch(/\bh-10\b/);
    // the transcript starts below the header, not 52px under a floating bar
    const scroll = sheet.querySelector<HTMLElement>("[data-testid=bot-exchange-scroll]")!;
    expect(scroll.className).not.toMatch(/pt-\[52px\]/);
    expect(header.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a routine run's window keeps the X, the composer below, and closes on send (#2149)", async () => {
    const onTogglePanel = vi.fn();
    const onClose = vi.fn();
    const render = (sentKey?: string) => root.render(createElement(ChatWindowProvider, {
      value: { panelOpen: true, onTogglePanel, composerInset: 96, sentKey },
      children: createElement(ExchangeSheet, { run: run(), showToolCalls: false, onClose, chrome: "window" }),
    }));
    await act(async () => render("u1"));
    const sheet = host.querySelector<HTMLElement>("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.className).toContain("inset-x-0 top-0");
    expect(sheet.style.bottom).toBe("96px");
    const x = sheet.querySelector<HTMLButtonElement>("button[data-testid=bot-exchange-close]")!;
    expect(x.hasAttribute("data-window-close")).toBe(true);
    expect(x.className).toContain("left-3 top-3");
    expect(sheet.textContent).not.toContain("Close Chat");
    expect(sheet.querySelector("[data-exchange-footer]")).toBeNull();
    const bar = sheet.querySelector<HTMLElement>("[data-chat-header-bar][data-exchange-header]")!;
    expect(bar.className).toMatch(/absolute inset-x-0 top-0/);
    expect(bar.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
    expect(sheet.querySelector("[data-testid=bot-exchange-scroll]")?.className).toMatch(/pt-\[52px\]/);
    expect(sheet.querySelector('[data-chat-bottom-edge] [data-chat-edge-fade="bottom"]')).not.toBeNull();
    // the header pill toggles the right panel, like the chat's own pill
    await act(async () => sheet.querySelector<HTMLButtonElement>("button[data-window-pill]")!.click());
    expect(onTogglePanel).toHaveBeenCalledOnce();
    await act(async () => render("u1"));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => render("u2"));
    expect(onClose).toHaveBeenCalled();
  });

  it("says Fermer la conversation in French", async () => {
    await loadLocale("fr");
    try {
      await act(async () => {
        root.render(createElement(BotExchangeChip, { run: run(), forceOpen: true }));
      });
      expect(host.querySelector("[data-testid=bot-exchange-close]")!.textContent).toBe("Fermer la conversation");
    } finally {
      setLocale("en");
    }
  });
});
