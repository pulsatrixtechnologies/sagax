// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { collapseBotExchanges } from "@/lib/bot-exchange";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { BotExchangeChip } from "./BotExchangeChip";

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
    expect(sheet!.className).toContain("absolute inset-0");
    expect(sheet!.className).not.toContain("fixed");
    const close = host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-close]")!;
    expect(close.textContent).toBe("Close Chat");
    expect(host.textContent).toContain("Which database?");
  });

  it("closes from one centered Close Chat pill at the bottom, in place of the composer, and on Escape", async () => {
    await act(async () => {
      root.render(createElement(BotExchangeChip, { run: run(), onGo: () => false }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    // One close only: the bottom pill, no header X.
    const closes = sheet.querySelectorAll("button[data-testid=bot-exchange-close]");
    expect(closes).toHaveLength(1);
    expect(sheet.querySelector("svg.lucide-x")).toBeNull();
    const pill = closes[0] as HTMLButtonElement;
    expect(pill.textContent).toBe("Close Chat");
    expect(pill.className).toContain("ui-button");
    expect(pill.className).toContain("font-medium");
    expect(pill.parentElement!.className).toContain("items-center");
    // Last element of the sheet, after the scroll: where the composer sits.
    expect(sheet.lastElementChild).toBe(pill.parentElement);
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
