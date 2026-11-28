// @vitest-environment happy-dom
// A record link in a bot's message is a chip with a card (#4507): the
// markdown wiring, the 80 ms prefetch, the 300 ms open, pinning, Escape,
// focus and the screen reader names. Nothing leaves the test: fetch is a
// stand-in console.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { agreementCard, answer, companyCard, invoiceCard, nimbusProduct, ticketCard } from "@/lib/record-card-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import { openExternalLink } from "@/lib/app-links";
import * as drafts from "@/lib/drafts";
import { HOVER_EXIT_MS, HOVER_OPEN_DELAY_MS, HOVER_INTENT_MS } from "./LinkHoverCard";
import { RECORD_CARD_WIDTH_KEY, RECORD_WINDOWS_KEY } from "@/lib/record-window-layout";
import { ChatMarkdown } from "./ChatMarkdown";
import { RecordLink } from "./RecordLink";
import { BotEditorStore, type useStore } from "@/state/store";

vi.mock("@/lib/app-links", async (original) => ({ ...(await original<typeof import("@/lib/app-links")>()), openExternalLink: vi.fn(async () => {}) }));
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

  it("stays a chip on a surface whose store has no bots read yet", async () => {
    // Schedule me and Dispatch the ticket fall back to the person's Primary Bot:
    // a store with no bots read yet has none, and the chip is still drawn (#5563)
    const store = { state: {}, dispatch: vi.fn() } as unknown as ReturnType<typeof useStore>;
    const chip = createElement(RecordLink, { record: { product: "nimbus_desk", kind: "ticket", id: "481516" } }, "#481516");
    await act(async () => root.render(createElement(BotEditorStore, { value: store, children: chip })));
    expect(chips()[0]?.textContent).toBe("#481516");
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
  it("prefetches after the rest and not on a crossing, but never opens on hover", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    expect(chip.getAttribute("title")).toBe("Ouvrir la fiche");
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
    await advance(HOVER_OPEN_DELAY_MS + 1000);
    expect(card()).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on click, Enter and Space, toggles on a second click, and closes on Escape", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(card()!.textContent).toContain("Imprimante de l'accueil hors ligne depuis lundi");
    await act(async () => { chip.click(); });
    await advance(200);
    expect(card()).toBeNull();
    // a real button turns Enter and Space into a click: the same handler
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(200);
    expect(card()).toBeNull();
  });

  it("does not open on keyboard focus alone", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    chip.focus();
    await advance(HOVER_OPEN_DELAY_MS + 500);
    expect(card()).toBeNull();
  });

  it("Cmd or Ctrl click opens the product, never the card", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    await act(async () => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })); });
    await advance(100);
    expect(card()).toBeNull();
    expect(openExternalLink).toHaveBeenCalledWith(expect.stringContaining("desk.example"));
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
    // Tab from the last control (the card's resize edge, #5053) wraps to the first
    const items = [...card()!.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].filter((item) => item.tabIndex >= 0);
    expect(items.at(-1)!.getAttribute("role")).toBe("separator");
    expect(items[0]!.tagName).toBe("BUTTON");
    items.at(-1)!.focus();
    act(() => { card()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(card()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await advance(200);
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("closes on a click outside", async () => {
    await render(`[#481516](${LINK})`);
    const chip = chips()[0]!;
    await act(async () => { chip.click(); });
    await advance(50);
    expect(card()?.getAttribute("role")).toBe("dialog");
    fire(document.body, "pointerdown");
    await advance(200);
    expect(card()).toBeNull();
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

  // M-20261127-101: the opened card is the record window; it places itself in the app's window, never against its chip
  describe("the record window's place and size (M-20261127-101, M-20261127-147)", () => {
    const frame = () => card()!.querySelector<HTMLElement>("[data-record-window]")!;
    const box = () => { const style = frame().style; return { left: style.left, top: style.top, width: style.width, height: style.height }; };
    let stored: Map<string, string>;
    let restoreView: Array<() => void> = [];
    beforeEach(() => {
      stored = new Map();
      vi.stubGlobal("localStorage", {
        getItem: (name: string) => stored.get(name) ?? null,
        setItem: (name: string, value: string) => { stored.set(name, value); },
        removeItem: (name: string) => { stored.delete(name); },
      });
      // a laptop's window: 1440 by 900
      for (const [name, value] of [["innerWidth", 1440], ["innerHeight", 900]] as const) {
        const before = Object.getOwnPropertyDescriptor(window, name);
        Object.defineProperty(window, name, { configurable: true, value });
        restoreView.push(() => (before ? Object.defineProperty(window, name, before) : delete (window as unknown as Record<string, unknown>)[name]));
      }
    });
    afterEach(() => {
      restoreView.forEach((undo) => undo());
      restoreView = [];
    });

    it("sits in the app's window at the mockup's size, centred, wherever its chip is, and a scroll moves nothing", async () => {
      await render(`[#481516](${LINK})`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      // HoverCard holds it at the app window's top left; the window places itself
      expect(card()!.style.left).toBe("0px");
      expect(card()!.style.top).toBe("0px");
      expect(box()).toEqual({ left: "100px", top: "32px", width: "1240px", height: "852px" });
      act(() => { window.dispatchEvent(new Event("scroll")); });
      expect(box()).toEqual({ left: "100px", top: "32px", width: "1240px", height: "852px" });
    });

    it("keeps its size and place per type of window: the ticket's again for a ticket, the company's own for a company", async () => {
      vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input).includes("/company/") ? json(answer(companyCard(Date.now(), "fr"))) : reply()));
      await render(`[#481516](${LINK}) et [Acme Fabrication](sagax://record/nimbus_desk/company/7310)`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      // the person pulls the right edge 50 px out, then drags the head 40 px to the left
      const edge = frame().querySelector<HTMLElement>('[data-record-window-edge="e"]')!;
      fire(edge, "pointerdown", { pointerId: 1, clientX: 1340, clientY: 300 });
      fire(edge, "pointermove", { pointerId: 1, clientX: 1390, clientY: 300 });
      fire(edge, "pointerup", { pointerId: 1, clientX: 1390, clientY: 300 });
      expect(box().width).toBe("1290px");
      const head = frame().querySelector<HTMLElement>("[data-record-window-head]")!;
      fire(head, "pointerdown", { pointerId: 2, clientX: 600, clientY: 50 });
      fire(head, "pointermove", { pointerId: 2, clientX: 560, clientY: 50 });
      fire(head, "pointerup", { pointerId: 2, clientX: 560, clientY: 50 });
      expect(box()).toEqual({ left: "60px", top: "32px", width: "1290px", height: "852px" });
      expect(JSON.parse(stored.get(RECORD_WINDOWS_KEY)!)).toEqual({ "nimbus_desk/ticket": { w: 1290, h: 852, x: 60, y: 32 } });
      // pulling a handle or the head is not a click outside: the window is still open
      expect(card()?.getAttribute("role")).toBe("dialog");
      act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      await advance(200);
      expect(card()).toBeNull();
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      expect(box()).toEqual({ left: "60px", top: "32px", width: "1290px", height: "852px" });
      await act(async () => { chips()[1]!.click(); });
      await advance(50);
      expect(card()!.textContent).toContain("Entreprise");
      expect(box()).toEqual({ left: "100px", top: "32px", width: "1240px", height: "852px" });
    });

    it("opens a type never sized at the size the person gave the opened card before", async () => {
      stored.set(RECORD_CARD_WIDTH_KEY, "1100");
      await render(`[#481516](${LINK})`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      expect(box().width).toBe("1100px");
    });

    it("never goes past the app's window: a smaller window bounds it and leaves what is kept alone", async () => {
      stored.set(RECORD_WINDOWS_KEY, JSON.stringify({ "nimbus_desk/ticket": { w: 1400, h: 880, x: 900, y: 500 } }));
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
      await render(`[#481516](${LINK})`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      expect(box()).toEqual({ left: "16px", top: "16px", width: "768px", height: "568px" });
      expect(JSON.parse(stored.get(RECORD_WINDOWS_KEY)!)["nimbus_desk/ticket"]).toEqual({ w: 1400, h: 880, x: 900, y: 500 });
    });

    it("keeps its place from a ticket to its company and back in the same window", async () => {
      vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input).includes("/company/") ? json(answer(companyCard(Date.now(), "fr"))) : reply()));
      await render(`[#481516](${LINK})`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      const first = box();
      await act(async () => { card()!.querySelector<HTMLElement>("[data-record-company-link]")!.click(); });
      await advance(50);
      expect(card()!.textContent).toContain("Entreprise");
      expect(box()).toEqual(first);
      await act(async () => { card()!.querySelector<HTMLElement>("[aria-label=Retour]")!.click(); });
      await advance(50);
      expect(box()).toEqual(first);
    });

    it("stays the window while it fades out, never the tooltip's layout", async () => {
      delete document.documentElement.dataset.reducedMotion;
      await render(`[#481516](${LINK})`);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      await advance(HOVER_EXIT_MS - 40);
      expect(card()).not.toBeNull();
      expect(box().width).toBe("1240px");
      await advance(200);
      expect(card()).toBeNull();
    });
  });

  it("draws the chip of any kind the product declares with the product's mark, and reads its card at once, no button", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/api/me/records/")) reads.push(url);
      return json(answer(invoiceCard(Date.now(), "fr")));
    }));
    await render("[INV-1042](sagax://record/nimbus_desk/invoice/5150)");
    const [chip] = chips();
    expect(chip!.dataset.recordLink).toBe("invoice");
    expect(chip!.getAttribute("aria-label")).toBe("Facture INV-1042, Nimbus Desk, appuie sur Entrée pour les détails");
    expect(chip!.querySelector("img, div")).not.toBeNull();
    await act(async () => { chip!.click(); });
    await advance(50);
    expect(reads).toHaveLength(1);
    expect(reads[0]).not.toContain("confirm");
    expect(card()!.textContent).toContain("Facture");
    expect([...card()!.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Lire la fiche");
  });

  it("opens an invoice's agreement in the same card, then its company, and Back returns one step at a time", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/api/me/records/")) reads.push(url);
      if (url.includes("/agreement/")) return json(answer(agreementCard(Date.now(), "fr")));
      if (url.includes("/company/")) return json(answer(companyCard(Date.now(), "fr")));
      return json(answer(invoiceCard(Date.now(), "fr")));
    }));
    await render("[INV-1042](sagax://record/nimbus_desk/invoice/5150)");
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    const refs = [...card()!.querySelectorAll<HTMLElement>("[data-record-ref-link]")];
    await act(async () => { refs.find((node) => node.textContent === "Managed services")!.click(); });
    await advance(50);
    expect(document.querySelectorAll("[data-record-card]")).toHaveLength(1);
    expect(card()!.textContent).toContain("Entente");
    await act(async () => { card()!.querySelector<HTMLElement>("[data-record-company-link]")!.click(); });
    await advance(50);
    expect(card()!.textContent).toContain("Entreprise");
    await act(async () => { card()!.querySelector<HTMLElement>("[aria-label=Retour]")!.click(); });
    await advance(50);
    expect(card()!.textContent).toContain("Entente");
    await act(async () => { card()!.querySelector<HTMLElement>("[aria-label=Retour]")!.click(); });
    await advance(50);
    expect(card()!.textContent).toContain("Facture");
    expect(card()!.querySelector("[aria-label=Retour]")).toBeNull();
  });

  describe("the way back through records", () => {
    // every card names the next agreement; the agreement 412 names the invoice 5150 again
    const chain = (extra?: (card: Record<string, unknown>, id: string) => void) => vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (!url.includes("/api/me/records/")) return json({});
      reads.push(url);
      const id = decodeURIComponent(url.split("?")[0]!.split("/").at(-1)!);
      const card = invoiceCard(Date.now(), "fr");
      card.id = id;
      card.number = `INV-${id}`;
      card.title = `Invoice ${id}`;
      const n = Number(id);
      const fields = card.fields as Array<Record<string, unknown>>;
      const agreement = fields.find((field) => field.type === "ref" && (field.ref as { kind: string }).kind === "agreement")!;
      agreement.value = `Next ${n + 1}`;
      agreement.ref = { product: "nimbus_desk", kind: "invoice", id: String(n + 1) };
      extra?.(card, id);
      return json(answer(card));
    }));
    const root = "[INV-5150](sagax://record/nimbus_desk/invoice/5150)";
    const next = () => [...card()!.querySelectorAll<HTMLElement>("[data-record-ref-link]")].find((node) => node.textContent!.startsWith("Next"))!;
    const back = () => card()!.querySelector<HTMLElement>("[aria-label=Retour]");

    it("keeps at most eight steps to go back through", async () => {
      chain();
      await render(root);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      for (let step = 0; step < 11; step += 1) { await act(async () => { next().click(); }); await advance(50); }
      let backs = 0;
      while (back()) { await act(async () => { back()!.click(); }); await advance(50); backs += 1; if (backs > 20) break; }
      expect(backs).toBe(8);
      expect(card()!.textContent).toContain("INV-5150");
    });

    it("goes back to a record already on the way instead of pushing it again", async () => {
      chain((card, id) => { if (id === "5151") (card.fields as Array<Record<string, unknown>>).find((field) => field.type === "ref" && String(field.value).startsWith("Next"))!.ref = { product: "nimbus_desk", kind: "invoice", id: "5150" }; });
      await render(root);
      await act(async () => { chips()[0]!.click(); });
      await advance(50);
      await act(async () => { next().click(); });
      await advance(50);
      expect(card()!.textContent).toContain("INV-5151");
      await act(async () => { next().click(); });
      await advance(50);
      // the root again: no arrow left, the way is not a loop
      expect(card()!.textContent).toContain("INV-5150");
      expect(back()).toBeNull();
    });
  });

  it("leaves a ref to a kind the product does not declare as plain words", async () => {
    const raw = invoiceCard(Date.now(), "fr");
    for (const field of raw.fields as Array<{ ref?: { kind: string } }>) if (field.ref?.kind === "agreement") field.ref.kind = "widget";
    vi.stubGlobal("fetch", vi.fn(async () => json(answer(raw))));
    await render("[INV-1042](sagax://record/nimbus_desk/invoice/5150)");
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    const refs = [...card()!.querySelectorAll("[data-record-ref-link]")].map((node) => node.textContent);
    expect(refs).not.toContain("Managed services");
    expect(card()!.textContent).toContain("Managed services");
  });

  it("never replaces the card when the pointer rests on a nested ref: only a click does (once)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/api/me/records/")) reads.push(url);
      return json(answer(url.includes("/agreement/") ? agreementCard(Date.now(), "fr") : invoiceCard(Date.now(), "fr")));
    }));
    await render("[INV-1042](sagax://record/nimbus_desk/invoice/5150)");
    await act(async () => { chips()[0]!.click(); });
    await advance(400);
    expect(reads).toHaveLength(1);
    expect(card()!.textContent).toContain("Facture");
    const chip = [...card()!.querySelectorAll<HTMLElement>("[data-record-ref-link]")].find((node) => node.textContent === "Managed services")!;
    fire(chip, "pointerover");
    await advance(2_000);
    fire(chip, "pointerout");
    await advance(500);
    // resting on it for two seconds changed nothing and read nothing
    expect(reads).toHaveLength(1);
    expect(card()!.querySelector("[aria-label=Retour]")).toBeNull();
    expect(card()!.textContent).toContain("Facture");
    await act(async () => { chip.click(); });
    await advance(300);
    expect(reads).toHaveLength(2);
    expect(reads[1]).toContain("/agreement/412");
    expect(card()!.querySelector("[aria-label=Retour]")).not.toBeNull();
  });

  it("leaves a ref to a product the person does not hold as plain words", async () => {
    const raw = invoiceCard(Date.now(), "fr");
    for (const field of raw.fields as Array<{ ref?: { product: string } }>) if (field.ref) field.ref.product = "ledger_other";
    vi.stubGlobal("fetch", vi.fn(async () => json(answer(raw))));
    await render("[INV-1042](sagax://record/nimbus_desk/invoice/5150)");
    await act(async () => { chips()[0]!.click(); });
    await advance(50);
    expect(card()!.querySelectorAll("[data-record-ref-link]")).toHaveLength(0);
    expect(card()!.textContent).toContain("Managed services");
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
