// @vitest-environment happy-dom
// #3275: the Messaged line is neutral (the names in the app's ink, only the
// faces carry color), and "and N others" is a real toggle that folds back.
// The go-to line keeps each bot's ink: the neutral tone is the line's own.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import type { MessagedLineItem } from "@/lib/messaged-line";

vi.mock("./TeammateExchangeSheet", () => ({ default: () => null }));
const { MessagedLine } = await import("./MessagedLine");
const { QuietLineParty } = await import("./ConversationLink");

setLocale("en");
afterEach(() => setLocale("en"));

const NAMES = ["Osprey", "test", "Ledger", "Harbor", "Quill"];
const COLORS = ["purple", "blue", "orange", "green", "pink"] as const;
const bots = NAMES.map((name, i) => ({ id: `r${i}`, threadId: `r${i}-t`, name, color: COLORS[i] }) as unknown as Bot);
const groups = NAMES.map((_, i) => ({ id: `dm-r${i}`, threadId: `dm-r${i}-t` }));

function line(count: number): MessagedLineItem {
  const recipients = NAMES.slice(0, count).map((name, i) => {
    const message = {
      id: `c${i}`, role: "bot", kind: "activity", at: 1, tool: { name: `Messaged @${name}`, ok: true },
      comm: { groupId: `dm-r${i}`, withBotId: `r${i}`, withName: name, withColor: COLORS[i], direction: "sent", text: "Hello!" },
    } as Message;
    return { key: `r${i}`, comm: message.comm!, message };
  });
  return { kind: "messagedLine", id: "messaged:c0", recipients, messages: recipients.map((entry) => entry.message) };
}

function mount(count: number) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MessagedLine, { line: line(count), bots, groups })));
  return { container, unmount: () => { root.unmount(); container.remove(); } };
}

const nameSpans = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="messaged-line-recipient"]')].map((node) => node.querySelector("span.font-medium") as HTMLElement);

describe("Messaged line ink (#3275)", () => {
  it("draws every recipient name in the neutral ink, never its bot's color", () => {
    const { container, unmount } = mount(3);
    const spans = nameSpans(container);
    expect(spans).toHaveLength(3);
    for (const span of spans) {
      expect(span.className).toContain("text-ink");
      expect(span.getAttribute("style") ?? "").not.toContain("color");
    }
    unmount();
  });

  it("keeps the bot's ink on the go-to line's name (the shared default)", () => {
    const markup = renderToStaticMarkup(createElement(QuietLineParty, { bot: { name: "Osprey", color: "purple" }, name: "Osprey", color: "purple" }));
    expect(markup).toMatch(/style="color:/);
  });
});

describe("Messaged line 'and N others' (#3275)", () => {
  it("opens the whole list, says it is open, and folds back", () => {
    const { container, unmount } = mount(5);
    const more = () => container.querySelector('[data-testid="messaged-line-more"]') as HTMLButtonElement | null;
    expect(nameSpans(container)).toHaveLength(3);
    expect(more()?.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => more()!.click());
    expect(nameSpans(container)).toHaveLength(5);
    expect(more()?.getAttribute("aria-expanded")).toBe("true");
    expect(more()?.textContent).toBe("Show less");
    flushSync(() => more()!.click());
    expect(nameSpans(container)).toHaveLength(3);
    expect(more()?.getAttribute("aria-expanded")).toBe("false");
    unmount();
  });

  it("says the fold-back control in French", () => {
    setLocale("fr");
    const { container, unmount } = mount(5);
    const more = () => container.querySelector('[data-testid="messaged-line-more"]') as HTMLButtonElement;
    flushSync(() => more().click());
    expect(more().textContent).not.toBe("Show less");
    unmount();
  });
});
