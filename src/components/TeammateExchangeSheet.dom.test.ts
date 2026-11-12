// @vitest-environment happy-dom
// A teammate's work from the Teammates card is the bot-to-bot sheet (#3245,
// 2026-11-09): "Owner ⇄ Teammate" on an opaque header, the asks credited
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
const transcript: { messages: Message[]; failed: boolean } = { messages: lines, failed: false };
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

  // #4043: a page-long subject used to fill the sheet and hide the lines.
  describe("the subject under the header pill", () => {
    const owner = bot("boss", "Boss", "blue");
    const teammate = bot("orla", "Orla", "orange");
    const page = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}: check the ledger rows for the month and note each gap.`).join(" ");
    const open = async (task: string, messages: Message[] = lines) => {
      transcript.messages = messages;
      await act(async () => {
        root.render(createElement(TeammateExchangeSheet, {
          owner, teammate: { id: "orla", name: "Orla", color: "orange" }, threadId: "orla-work",
          task, bots: [owner, teammate], onClose: () => {},
        }));
      });
      return host.querySelector<HTMLElement>("[data-testid=bot-exchange-sheet]")!;
    };
    afterEach(() => {
      transcript.messages = lines;
    });

    it("folds a long subject to two lines with Show more, unfolds it into the transcript, Show less folds it back", async () => {
      const sheet = await open(page);
      const header = sheet.querySelector("[data-exchange-header]")!;
      const folded = header.querySelector<HTMLElement>("[data-testid=bot-exchange-subject]")!;
      expect(folded.getAttribute("data-expandable")).toBe("folded");
      expect(folded.firstElementChild!.className).toContain("line-clamp-2");
      const more = folded.querySelector<HTMLButtonElement>("[data-expandable-toggle]")!;
      expect(more.textContent).toBe("Show more");
      await act(async () => more.click());
      // open: no longer fixed under the pill, it scrolls with the lines
      expect(header.querySelector("[data-testid=bot-exchange-subject]")).toBeNull();
      const scroll = sheet.querySelector("[data-testid=bot-exchange-scroll]")!;
      const opened = scroll.querySelector<HTMLElement>("[data-testid=bot-exchange-subject]")!;
      expect(opened.getAttribute("data-expandable")).toBe("open");
      expect(opened.firstElementChild!.className).not.toContain("line-clamp");
      expect(opened.textContent).toContain("Step 30");
      const less = opened.querySelector<HTMLButtonElement>("[data-expandable-toggle]")!;
      expect(less.textContent).toBe("Show less");
      await act(async () => less.click());
      expect(scroll.querySelector("[data-testid=bot-exchange-subject]")).toBeNull();
      expect(header.querySelector("[data-testid=bot-exchange-subject]")?.getAttribute("data-expandable")).toBe("folded");
    });

    it("shows no control under a short subject", async () => {
      const sheet = await open("Reconcile the bank sheet");
      const subject = sheet.querySelector("[data-exchange-header] [data-testid=bot-exchange-subject]")!;
      expect(subject.querySelector("[data-expandable-toggle]")).toBeNull();
      expect(subject.textContent).toBe("Reconcile the bank sheet");
    });

    it("keeps only the first sentence when the subject is the first line's own text", async () => {
      const ask = `Please reconcile the bank sheet. ${page}`;
      const sheet = await open(ask, [{ ...lines[0]!, text: ask }, lines[1]!]);
      const subject = sheet.querySelector("[data-exchange-header] [data-testid=bot-exchange-subject]")!;
      expect(subject.textContent).toBe("Please reconcile the bank sheet.");
      // the line below holds the whole text, told once
      expect(sheet.querySelector('[data-mid="a"]')?.textContent).toContain("Step 30");
    });
  });
});
