// @vitest-environment happy-dom
// A teammate's work from the Teammates card is the bot-to-bot sheet (#3245,
// JC 2026-11-09): "Owner ⇄ Teammate" on an opaque header, the asks credited
// to the owner and the answers to the teammate, one Close Chat pill, no X,
// no "Message <bot>" composer.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import TeammateExchangeSheet from "./TeammateExchangeSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const lines = [
  { id: "a", role: "user", kind: "text", text: "Please reconcile the bank sheet", at: now },
  { id: "b", role: "bot", kind: "text", text: "Sheet balanced", at: now + 1000 },
] as Message[];
const transcript = { messages: lines, failed: false };
vi.mock("@/lib/use-side-transcript", () => ({
  useSideTranscript: () => ({ ...transcript, activeLeafId: null, loaded: true, hasMore: false, loadingOlder: false, loadOlder: () => {} }),
}));

const bot = (id: string, name: string, color: Bot["color"], title = ""): Bot => ({
  id, name, threadId: `${id}-main`, title, description: "", color, unread: false, notifications: true,
  messages: [], modelSelection: { instanceId: "fake", model: "test" }, tasks: [],
});

beforeAll(() => setLocale("en"));

describe("TeammateExchangeSheet", () => {
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

  it("opens the bot-to-bot sheet: both ends in the pill, the bot title stacked, Close Chat at the bottom", async () => {
    const onClose = vi.fn();
    const owner = bot("boss", "Boss", "blue", "Coordinator");
    const teammate = bot("orla", "Orla", "orange");
    await act(async () => {
      root.render(createElement(TeammateExchangeSheet, {
        owner, teammate: { id: "orla", name: "Orla", color: "orange" }, threadId: "orla-work",
        task: "Reconcile the bank sheet", bots: [owner, teammate], onClose,
      }));
    });
    const sheet = host.querySelector<HTMLElement>("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.getAttribute("data-exchange-chrome")).toBe("sheet");
    const header = sheet.querySelector("[data-exchange-header]")!;
    expect(header.querySelector("[data-chat-pill]")?.getAttribute("aria-label") ?? header.textContent).toContain("Boss");
    expect(header.textContent).toContain("Orla");
    // the title under the name, never "Boss · Coordinator"
    expect(header.querySelector("[data-exchange-party-title]")?.textContent).toBe("Coordinator");
    expect(header.textContent).not.toContain("·");
    expect(header.querySelector("[data-exchange-meta]")?.textContent).toBe("Reconcile the bank sheet");
    // the ask is the owner's line, the answer the teammate's
    expect(sheet.querySelector('[data-mid="a"]')?.getAttribute("data-side")).toBe("start");
    expect(sheet.querySelector('[data-mid="b"]')?.getAttribute("data-side")).toBe("end");
    expect(sheet.querySelector("[data-window-close]")).toBeNull();
    expect(sheet.querySelector("textarea")).toBeNull();
    expect(sheet.textContent).not.toMatch(/Message Orla/);
    const close = sheet.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-close]")!;
    expect(close.textContent).toBe("Close Chat");
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
