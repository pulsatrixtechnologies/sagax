// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { collapseBotExchanges } from "@/lib/bot-exchange";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { BotExchangeChip } from "./BotExchangeChip";
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
    expect(sheet!.className).toContain("absolute inset-x-0 top-0");
    expect(sheet!.className).not.toContain("fixed");
    const close = host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-close]")!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(host.textContent).toContain("Which database?");
  });

  it("closes from the X of a page opened by Sagax, top left, and on Escape; no Close Chat pill (#2149)", async () => {
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo: () => false }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    const closes = sheet.querySelectorAll("button[data-testid=bot-exchange-close]");
    expect(closes).toHaveLength(1);
    const x = closes[0] as HTMLButtonElement;
    expect(x.hasAttribute("data-window-close")).toBe(true);
    expect(x.querySelector("svg.lucide-x")).not.toBeNull();
    expect(x.className).toContain("left-3 top-3");
    expect(sheet.textContent).not.toContain("Close Chat");
    // no footer row: the chat's own composer stays below the window
    expect(sheet.querySelector("[data-exchange-footer]")).toBeNull();
    await act(async () => x.click());
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();

    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();
  });

  it("leaves the chat's composer visible below it and closes once the person sends from it (#2149)", async () => {
    const onTogglePanel = vi.fn();
    const render = (sentKey?: string) => root.render(createElement(ChatWindowProvider, {
      value: { panelOpen: true, onTogglePanel, composerInset: 96, sentKey },
      children: createElement(BotExchangeChip, { run: run(), onGo: () => false }),
    }));
    await act(async () => render("u1"));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector<HTMLElement>("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.style.bottom).toBe("96px");
    // the header pill toggles the right panel, like the chat's own pill
    const pill = sheet.querySelector<HTMLButtonElement>("button[data-window-pill]")!;
    expect(pill).not.toBeNull();
    await act(async () => pill.click());
    expect(onTogglePanel).toHaveBeenCalledOnce();
    // same last message: still open; a new one sent from the chat: closed
    await act(async () => render("u1"));
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).not.toBeNull();
    await act(async () => render("u2"));
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();
  });

  it("floats the bot chat's bar and fades: the 40px pill centered, the transcript under it (the owner 2026-11-06)", async () => {
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo: () => false }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    const bar = sheet.querySelector<HTMLElement>("[data-chat-header-bar][data-exchange-header]")!;
    expect(bar.className).toMatch(/absolute inset-x-0 top-0/);
    expect(bar.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
    expect(bar.querySelector("[data-chat-header-center] [data-chat-pill]")?.className).toMatch(/h-10/);
    expect(bar.querySelector("[data-testid=bot-exchange-close]")).not.toBeNull();
    expect(sheet.querySelector("[data-testid=bot-exchange-scroll]")?.className).toMatch(/pt-\[52px\]/);
    expect(sheet.querySelector('[data-chat-bottom-edge] [data-chat-edge-fade="bottom"]')).not.toBeNull();
  });

  it("says Fermer in French", async () => {
    await loadLocale("fr");
    try {
      await act(async () => {
        root.render(createElement(BotExchangeChip, { run: run(), forceOpen: true }));
      });
      expect(host.querySelector("[data-testid=bot-exchange-close]")!.getAttribute("aria-label")).toBe("Fermer");
    } finally {
      setLocale("en");
    }
  });
});
