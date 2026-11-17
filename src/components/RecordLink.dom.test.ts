// @vitest-environment happy-dom
// A record link in a bot's message is a chip with a card (#4507): the
// markdown wiring, the 80 ms prefetch, the 300 ms open, pinning, Escape,
// focus and the screen reader names. Nothing leaves the test: fetch is a
// stand-in console.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { answer, companyCard, nimbusProduct, ticketCard } from "@/lib/record-card-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import * as drafts from "@/lib/drafts";
import { HOVER_CLOSE_GRACE_MS, HOVER_OPEN_DELAY_MS, HOVER_INTENT_MS } from "./LinkHoverCard";
import { ChatMarkdown } from "./ChatMarkdown";

vi.mock("@/lib/drafts", async (original) => ({ ...(await original<typeof import("@/lib/drafts")>()), appendComposerDraft: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = "sagax://record/nimbus_desk/ticket/481516";
let host: HTMLDivElement;
let root: Root;
let reads: string[];
let reply: () => Response;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

async function render(text: string, props: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(ChatMarkdown, { text, botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" }, ...props })));
}
const chips = () => [...host.querySelectorAll<HTMLElement>("[data-record-link]")];
const card = () => document.querySelector<HTMLElement>("[data-record-card]");
const fire = (target: EventTarget, type: string, init: PointerEventInit = {}) =>
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", ...init })); });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  setLocale("fr");
  // reduced motion: a closed card leaves at once (its exit is not what is tested)
  document.documentElement.dataset.reducedMotion = "true";
  resetRecordCards();
  resetPersonProducts();
  seedPersonProducts([nimbusProduct()]);
  reads = [];
  reply = () => json(answer(ticketCard(Date.now(), "fr")));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (String(input).includes("/api/me/records/")) reads.push(String(input));
    return reply();
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the chip", () => {
  it("draws a record link as the reference pill, never an external anchor", async () => {
    await render(`Voir [#481516](${LINK}) svp`);
    const [chip] = chips();
    expect(chip!.textContent).toBe("#481516");
    expect(chip!.className).toContain("rounded-full");
    // a button with no address: nothing to show in a status bar, copy or middle-click
    expect(chip!.tagName).toBe("BUTTON");
    expect(chip!.getAttribute("href")).toBeNull();
    expect(host.innerHTML).not.toContain("sagax://record");
    expect(host.querySelector("a")).toBeNull();
    expect(chip!.getAttribute("aria-label")).toBe("Billet #481516, Nimbus Desk, appuie sur Entrée pour les détails");
    expect(chip!.querySelector("img, div")).not.toBeNull();
  });

  it("draws a link to an unknown product as a chip with a generic mark", async () => {
    await render("[#9](sagax://record/other_desk/ticket/9)");
    expect(chips()).toHaveLength(1);
    expect(chips()[0]!.querySelector("svg")).not.toBeNull();
  });

  it("keeps a malformed link as its text, and an inert surface too", async () => {
    await render("a [oups](sagax://record/Bad/ticket/1) b");
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toContain("oups");
    expect(host.querySelector("a")).toBeNull();
    await render(`a [#481516](${LINK}) b`, { inert: true });
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toContain("#481516");
  });

  it("never shows a GUID label: the kind's name stands in", async () => {
    await render("[6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34](sagax://record/nimbus_desk/ticket/6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34)");
    expect(chips()[0]!.textContent).toBe("Billet");
  });
});

describe("the card", () => {
  it("prefetches after the rest and not on a crossing, opens at 300 ms", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    fire(chip, "pointerover");
    await advance(HOVER_INTENT_MS - 20);
    fire(chip, "pointerout");
    fire(chip, "pointerout");
    await advance(500);
    expect(reads).toHaveLength(0);
    expect(card()).toBeNull();
    fire(chip, "pointerover");
    await advance(HOVER_INTENT_MS + 1);
    expect(reads).toHaveLength(1);
    await advance(HOVER_OPEN_DELAY_MS);
    expect(card()?.getAttribute("role")).toBe("tooltip");
    expect(card()!.textContent).toContain("Imprimante de l'accueil hors ligne depuis lundi");
    expect(reads).toHaveLength(1);
  });

  it("makes one read for two chips of the same record", async () => {
    await render(`[#481516](${LINK}) et [le billet](${LINK})`);
    const [first, second] = chips();
    fire(first!, "pointerover");
    await advance(HOVER_INTENT_MS + 1);
    fire(first!, "pointerout");
    fire(second!, "pointerover");
    await advance(HOVER_INTENT_MS + 1);
    expect(reads).toHaveLength(1);
  });

  it("closes after the grace period and opens quicker when another card just closed", async () => {
    await render(`[#481516](${LINK}) et [le billet](${LINK})`);
    const [first, second] = chips();
    fire(first!, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 5);
    expect(card()).not.toBeNull();
    fire(first!, "pointerout");
    await advance(HOVER_CLOSE_GRACE_MS + 10);
    // the exit finishes
    await advance(200);
    expect(card()).toBeNull();
    fire(second!, "pointerover");
    await advance(100);
    expect(card()).not.toBeNull();
  });

  it("pins on click, becomes a dialog, holds Tab, and Escape closes and returns focus", async () => {
    await render(`[#481516](${LINK})`, { message: { threadId: "t-1", messageId: "m-1" } });
    const chip = chips()[0]!;
    chip.focus();
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(card()?.getAttribute("aria-label")).toBe("Billet #481516");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    // focus went to the first action
    expect(document.activeElement?.hasAttribute("data-hover-card-first")).toBe(true);
    // Tab from the last control wraps to the first
    const items = [...card()!.querySelectorAll<HTMLElement>("button")];
    items.at(-1)!.focus();
    act(() => { card()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(card()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(200);
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("unpins on a click outside and stays closed after Escape while the pointer rests", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()?.getAttribute("role")).toBe("dialog");
    fire(document.body, "pointerdown");
    await advance(200);
    expect(card()).toBeNull();
    fire(chip, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 5);
    expect(card()).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(300);
    expect(card()).toBeNull();
    fire(chip, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 50);
    expect(card()).toBeNull();
    fire(chip, "pointerout");
    fire(chip, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 5);
    expect(card()).not.toBeNull();
  });

  it("is a plain label once the console cannot serve cards", async () => {
    reply = () => json({ state: "unavailable" });
    await render(`[#481516](${LINK})`);
    fire(chips()[0]!, "pointerover");
    await advance(HOVER_INTENT_MS + 1);
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toContain("#481516");
  });

  it("offers Demander when a conversation is open", async () => {
    await render(`[#481516](${LINK})`);
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    const ask = card()!.querySelector<HTMLButtonElement>("[data-record-ask]");
    expect(ask).not.toBeNull();
    expect(ask!.textContent).toBe("Demander");
  });

  it("offers no Demander without a conversation, and keeps Ouvrir", async () => {
    await render(`[#481516](${LINK})`, { draftId: undefined });
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    expect(card()!.querySelector("[data-record-ask]")).toBeNull();
    expect(card()!.querySelector("[data-record-open]")).not.toBeNull();
  });

  it("opens the company's card in the same card, with a back arrow, never two cards", async () => {
    reply = () => json(answer(ticketCard(Date.now(), "fr")));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/company/")) { reads.push(url); return json(answer(companyCard(Date.now(), "fr"))); }
      if (url.includes("/api/me/records/")) reads.push(url);
      return reply();
    }));
    await render(`[#481516](${LINK})`);
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    const link = card()!.querySelector<HTMLElement>("[data-record-company-link]")!;
    await act(async () => { link.click(); });
    await advance(50);
    expect(document.querySelectorAll("[data-record-card]")).toHaveLength(1);
    expect(card()!.getAttribute("role")).toBe("dialog");
    expect(card()!.textContent).toContain("Entreprise");
    expect(reads.some((url) => url.includes("/company/7310"))).toBe(true);
    await act(async () => { card()!.querySelector<HTMLElement>("[aria-label=Retour]")!.click(); });
    await advance(50);
    expect(card()!.textContent).toContain("Imprimante de l'accueil");
  });

  it("moves focus to the first action when a card pinned while loading arrives, not onto Close", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (String(input).includes("/api/me/records/")) await new Promise<void>((done) => { release = done; });
      return json(answer(ticketCard(Date.now(), "fr")));
    }));
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    chip.focus();
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()!.getAttribute("aria-busy") ?? card()!.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe("Fermer");
    await act(async () => { release?.(); await Promise.resolve(); });
    await advance(50);
    expect(document.activeElement?.hasAttribute("data-hover-card-first")).toBe(true);
  });

  it.each([["a bot's chat", "bot:bot-1:t-1"], ["a room", "group:room-1:t-9"]])("writes Demander into the composer of %s, the surface's own draft", async (_name, draftId) => {
    vi.mocked(drafts.appendComposerDraft).mockClear();
    await render(`[#481516](${LINK})`, { draftId });
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    await act(async () => { card()!.querySelector<HTMLButtonElement>("[data-record-ask]")!.click(); });
    expect(drafts.appendComposerDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(drafts.appendComposerDraft).mock.calls[0]![0]).toBe(draftId);
    expect(vi.mocked(drafts.appendComposerDraft).mock.calls[0]![1]).toContain("sagax://record/nimbus_desk/ticket/481516");
  });

  it("returns focus to the chip when a pinned card is closed with its X, without reopening it", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    chip.focus();
    await act(async () => { chip.click(); });
    await advance(50);
    await act(async () => { card()!.querySelector<HTMLButtonElement>("[aria-label=Fermer]")!.click(); });
    await advance(200);
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("does not ignore the next visit after an Escape pressed with the pointer elsewhere", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    chip.focus();
    await act(async () => { chip.click(); });
    await advance(50);
    // keyboard Escape, the pointer never was on the chip
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(200);
    expect(card()).toBeNull();
    chip.blur();
    fire(chip, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 5);
    expect(card()).not.toBeNull();
  });

  it("keeps an open card and the focus when the console turns out unable to serve cards", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (String(input).includes("/api/me/records/")) await new Promise<void>((done) => { release = done; });
      return json({ state: "unavailable" });
    }));
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    chip.focus();
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()?.getAttribute("role")).toBe("dialog");
    await act(async () => { release?.(); await Promise.resolve(); });
    await advance(50);
    // the chip reads as plain words: the same element, still focused, the card still there
    expect(host.querySelector("[data-record-plain]")).toBe(chip);
    // focus is where it was (in the pinned card), not dropped on the page
    expect(card()!.contains(document.activeElement)).toBe(true);
    expect(card()).not.toBeNull();
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    // and it asks for no new card
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(200);
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(chip);
    chip.blur();
    fire(chip, "pointerover");
    await advance(HOVER_OPEN_DELAY_MS + 5);
    expect(card()).toBeNull();
  });

  it("reads the app's one list of products: a product connected elsewhere shows on a chip at once", async () => {
    await render("[#9](sagax://record/other_desk/ticket/9)");
    expect(chips()[0]!.getAttribute("aria-label")).not.toContain("Nimbus Desk");
    await act(async () => {
      seedPersonProducts([nimbusProduct(), { ...nimbusProduct(), id: "other_desk", name: "Other Desk" }]);
    });
    expect(chips()[0]!.getAttribute("aria-label")).toContain("Other Desk");
  });
});
