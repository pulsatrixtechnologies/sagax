// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { collapseBotExchanges } from "@/lib/bot-exchange";
import { setLocale } from "@/lib/i18n";
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
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(host.textContent).not.toMatch(/Close Chat/i);
    expect(host.textContent).toContain("Which database?");
  });
});
