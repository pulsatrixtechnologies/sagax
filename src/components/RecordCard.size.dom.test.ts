// @vitest-environment happy-dom
// The card a record's chip opens (#5053, M-20261119-055 and -056): large by
// default, resized by its edges and corners, its size kept on the device for
// every record, readable, and nothing of it cut. The hovered tooltip is not
// touched. Synthetic records only (src/lib/record-card-fixtures.ts).
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { companyCard, invoiceCard, projectCard, ticketCard, COMPANY_REF, INVOICE_REF, PROJECT_REF, TICKET_REF } from "@/lib/record-card-fixtures";
import { RECORD_CARD_HEIGHT_KEY, RECORD_CARD_WIDTH_KEY } from "@/lib/record-card-size";
import { parseRecordCard, type RecordCardMiss, type RecordRef } from "../../shared/record-cards";
import { RecordCard, type RecordCardProps } from "./RecordCard";
import type { RecordRelatedTabsProps } from "./RecordRelatedTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const product = { name: "Nimbus Desk", iconUrl: "https://desk.example/mark.svg" };
let host: HTMLDivElement;
let root: Root;
let stored: Map<string, string>;
let restoreView: Array<() => void> = [];

/** The app's window, as the card reads it when it opens and while it is pulled. */
function view(width: number, height: number) {
  for (const [name, value] of [["innerWidth", width], ["innerHeight", height]] as const) {
    const before = Object.getOwnPropertyDescriptor(window, name);
    Object.defineProperty(window, name, { configurable: true, value });
    restoreView.push(() => (before ? Object.defineProperty(window, name, before) : delete (window as unknown as Record<string, unknown>)[name]));
  }
}

const related = (over: Partial<RecordRelatedTabsProps> = {}): RecordRelatedTabsProps => ({
  counts: { notes: 3, time: 0, configurations: 2, expenses: 0, activities: 1, attachments: 0 },
  schedule: [{ resource: "Noor Haddad", start: "2026-11-18 09:00", end: "2026-11-18 10:30", where: "Remote", done: false }],
  tab: "notes", onTab: () => {}, loading: false,
  page: { tab: "notes", lines: [
    { author: "Ada Lindqvist", date: "2026-11-18 08:45", timestamp: "", kind: "discussion", body: "The printer stops after the first page.\nThe replacement tray is ready at reception.\nWe print upstairs meanwhile.\nThe counter queue stays blocked." },
    { author: "Noor Haddad", date: "2026-11-17 16:20", timestamp: "", kind: "discussion", body: "A technician comes by tomorrow morning at 9." },
    { author: "Dispatch", date: "2026-11-17 14:30", timestamp: "", kind: "internal", body: "Ticket assigned to Noor." },
  ] },
  ...over,
});

function show(over: Partial<RecordCardProps> & { raw?: Record<string, unknown>; miss?: RecordCardMiss; record?: RecordRef } = {}) {
  const { raw, miss, record, ...rest } = over;
  act(() => root.render(createElement(RecordCard, {
    record: record ?? TICKET_REF, label: "#481516", kindName: "Billet", product, now: NOW, pinned: true, onClose: () => {}, onAsk: () => {},
    read: { card: raw ? parseRecordCard(raw) : null, miss: miss ?? null, loading: !raw && !miss, at: NOW - 120_000, refresh: () => {} },
    ...rest,
  })));
  return host.firstElementChild as HTMLElement;
}
const shell = () => host.querySelector<HTMLElement>("[data-record-card-body]")!;
const frame = () => shell().firstElementChild as HTMLElement;
const edge = (orientation: "vertical" | "horizontal") => host.querySelector<HTMLElement>(`.app-resize-handle[aria-orientation=${orientation}]:not([aria-hidden])`);
const leftEdge = () => host.querySelector<HTMLElement>(".app-resize-handle[aria-hidden]:not([data-resize-corner])");
const corner = (side: "se" | "sw") => host.querySelector<HTMLElement>(`.app-resize-handle[data-resize-corner=${side}]`);
const pointer = (target: Element, type: string, x: number, y: number) =>
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })); });
const drag = (target: Element, dx: number, dy = 0) => {
  pointer(target, "pointerdown", 600, 400);
  pointer(target, "pointermove", 600 + dx, 400 + dy);
  pointer(target, "pointerup", 600 + dx, 400 + dy);
};
const dblclick = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
/** The size the card asks for (its two CSS variables); its classes bound it by the window. */
const widthOf = () => shell().style.getPropertyValue("--record-card-w");
const heightOf = () => shell().style.getPropertyValue("--record-card-h");
const WIDTH_CLASS = "w-[min(var(--record-card-w),calc(100vw-32px))]";
const FULL_HEIGHT_CLASS = "h-[min(var(--record-card-h),var(--hover-card-room,calc(100vh-32px)))]";
const MOST_HEIGHT_CLASS = `max-${FULL_HEIGHT_CLASS}`;
const classes = (node: HTMLElement) => node.className.split(/\s+/);

beforeEach(() => {
  setLocale("fr");
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => { stored.set(name, value); },
    removeItem: (name: string) => { stored.delete(name); },
  });
  view(1440, 900);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreView.forEach((undo) => undo());
  restoreView = [];
  vi.unstubAllGlobals();
});

describe("the opened record card's size", () => {
  it("opens 1000 px wide and at 80% of the window's height, bounded by the window", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(widthOf()).toBe("1000px");
    expect(heightOf()).toBe("720px");
    // bounded by the window in CSS: 16 px from each side, and the room under its top
    expect(classes(shell())).toContain(WIDTH_CLASS);
    expect(classes(frame())).toContain(FULL_HEIGHT_CLASS);
    // the compact tooltip's frame is gone: no 40rem, no 20rem
    expect(shell().className).not.toContain("40rem");
    expect(frame().className).not.toContain("20rem");
  });

  it("takes a smaller share in a smaller window, and 840 px at most in a tall one", () => {
    view(760, 520);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(heightOf()).toBe("416px");
    act(() => root.unmount());
    root = createRoot(host);
    view(2560, 1440);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(heightOf()).toBe("840px");
  });

  it("a card with tabs takes the whole height; any other is as tall as its content, up to that height", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(classes(frame())).toContain(FULL_HEIGHT_CLASS);
    expect(classes(frame())).not.toContain(MOST_HEIGHT_CLASS);
    for (const [raw, record] of [[companyCard(NOW, "fr"), COMPANY_REF], [projectCard(NOW, "fr"), PROJECT_REF], [invoiceCard(NOW, "fr"), INVOICE_REF]] as const) {
      show({ raw, record });
      expect(classes(frame())).toContain(MOST_HEIGHT_CLASS);
      expect(classes(frame())).not.toContain(FULL_HEIGHT_CLASS);
      // the same width and the same height to go up to, for every record
      expect([widthOf(), heightOf()]).toEqual(["1000px", "720px"]);
      expect(classes(shell())).toContain(WIDTH_CLASS);
    }
    // a state and a loading card too
    show({ miss: { state: "no_access" } });
    expect(widthOf()).toBe("1000px");
    expect(classes(frame())).toContain(MOST_HEIGHT_CLASS);
    show({});
    expect(widthOf()).toBe("1000px");
    expect(classes(frame())).toContain(MOST_HEIGHT_CLASS);
  });

  it("is resized by its two sides, its bottom edge and its bottom corners", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    // the card stays centred: a side moves the width by twice the pointer's travel, so the edge follows the pointer
    drag(edge("vertical")!, 60);
    expect(widthOf()).toBe("1120px");
    drag(leftEdge()!, -40);
    expect(widthOf()).toBe("1200px");
    drag(edge("horizontal")!, 0, 40);
    expect(heightOf()).toContain("760px");
    drag(corner("se")!, -100, -60);
    expect(widthOf()).toContain("1000px");
    expect(heightOf()).toContain("700px");
    drag(corner("sw")!, -50, 20);
    expect(widthOf()).toContain("1100px");
    expect(heightOf()).toContain("720px");
  });

  it("never goes under its readable minimum nor past the window", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    drag(corner("se")!, -3000, -3000);
    expect(widthOf()).toContain("480px");
    expect(heightOf()).toContain("320px");
    drag(corner("se")!, 3000, 3000);
    // 1440 by 900: 16 px from each side, a top at 72 px and 16 px from the foot
    expect(widthOf()).toContain("1408px");
    expect(heightOf()).toContain("812px");
  });

  it("keeps the chosen size on the device and opens every record at it, after a restart too", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    drag(corner("se")!, 100, 60);
    expect(stored.get(RECORD_CARD_WIDTH_KEY)).toBe("1200");
    expect(stored.get(RECORD_CARD_HEIGHT_KEY)).toBe("780");
    // a restart of the app: the card is mounted again and reads what was kept
    act(() => root.unmount());
    root = createRoot(host);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(widthOf()).toBe("1200px");
    expect(heightOf()).toBe("780px");
    // another record, another kind: the same size
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect([widthOf(), heightOf()]).toEqual(["1200px", "780px"]);
  });

  it("is bounded by a smaller window without overwriting what is kept", () => {
    stored.set(RECORD_CARD_WIDTH_KEY, "1200");
    stored.set(RECORD_CARD_HEIGHT_KEY, "780");
    view(760, 520);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    // the kept size stays the card's; the window bounds it in CSS (100vw - 32px, the room under its top)
    expect(widthOf()).toBe("1200px");
    expect(heightOf()).toBe("780px");
    expect(classes(shell())).toContain(WIDTH_CLASS);
    expect(classes(frame())).toContain(FULL_HEIGHT_CLASS);
    // opening it, closing it, pressing a handle without pulling: nothing is written
    pointer(corner("se")!, "pointerdown", 600, 400);
    pointer(corner("se")!, "pointerup", 600, 400);
    expect([stored.get(RECORD_CARD_WIDTH_KEY), stored.get(RECORD_CARD_HEIGHT_KEY)]).toEqual(["1200", "780"]);
    // the window grows back: the kept size shows again
    act(() => root.unmount());
    root = createRoot(host);
    view(1440, 900);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(widthOf()).toContain("1200px");
    expect(heightOf()).toContain("780px");
  });

  it("pulled in a smaller window, starts from the size shown there", () => {
    stored.set(RECORD_CARD_WIDTH_KEY, "1200");
    view(760, 520);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    // 728 px shown (760 - 32): 20 px in from the right edge is 40 px less
    drag(edge("vertical")!, -20);
    expect(stored.get(RECORD_CARD_WIDTH_KEY)).toBe("688");
    expect(widthOf()).toBe("688px");
  });

  it("returns to the default size on a double-click on a handle", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    drag(corner("se")!, 100, 60);
    dblclick(corner("se")!);
    expect(widthOf()).toBe("1000px");
    expect(heightOf()).toBe("720px");
    expect(stored.has(RECORD_CARD_WIDTH_KEY)).toBe(false);
    expect(stored.has(RECORD_CARD_HEIGHT_KEY)).toBe(false);
    // from an edge too, and both sizes return
    drag(corner("se")!, 100, 60);
    dblclick(edge("vertical")!);
    expect(widthOf()).toContain("1000px");
    expect(heightOf()).toContain("720px");
  });

  it("follows a window that changes size while it is open: its default height moves, a double-click returns to this window's default", () => {
    view(760, 520);
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(heightOf()).toBe("416px");
    // the window grows with the card open: nothing is kept, so the default is this window's
    view(1440, 900);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(heightOf()).toBe("720px");
    drag(corner("se")!, 40, 30);
    expect(heightOf()).toBe("750px");
    dblclick(corner("se")!);
    expect(heightOf()).toBe("720px");
    expect(stored.has(RECORD_CARD_HEIGHT_KEY)).toBe(false);
  });

  it("keeps a kept height when the window changes size while it is open", () => {
    stored.set(RECORD_CARD_HEIGHT_KEY, "600");
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(heightOf()).toBe("600px");
    view(1440, 1200);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(heightOf()).toBe("600px");
    expect(stored.get(RECORD_CARD_HEIGHT_KEY)).toBe("600");
    // and its double-click goes to this window's default (840 px at most)
    dblclick(edge("horizontal")!);
    expect(heightOf()).toBe("840px");
  });

  it("answers the keyboard on its right and bottom edges, and says how to resize", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    const right = edge("vertical")!;
    expect(right.getAttribute("aria-label")).toBe("Redimensionner la largeur de la fiche");
    expect(edge("horizontal")!.getAttribute("aria-label")).toBe("Redimensionner la hauteur de la fiche");
    expect(right.getAttribute("title")).toBe("Glisse pour redimensionner. Double-clic pour la taille par défaut.");
    act(() => { right.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    expect(widthOf()).toContain("1024px");
    act(() => { edge("horizontal")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
    expect(heightOf()).toContain("696px");
  });

  it("offers its bottom edge and corners only when it takes the height it may", () => {
    // a card as tall as its content (no layout engine here: it never reaches its max-height): the sides only
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect(edge("vertical")).not.toBeNull();
    expect(leftEdge()).not.toBeNull();
    expect(edge("horizontal")).toBeNull();
    expect(corner("se")).toBeNull();
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(edge("horizontal")).not.toBeNull();
    expect(corner("se")).not.toBeNull();
    expect(corner("sw")).not.toBeNull();
  });

  it("leaves the hovered tooltip as it was: no size of the person's, no handle", () => {
    stored.set(RECORD_CARD_WIDTH_KEY, "1200");
    show({ raw: ticketCard(NOW, "fr"), pinned: false });
    expect(shell().className).toContain("w-[min(40rem,calc(100vw-1rem))]");
    expect(widthOf()).toBe("");
    expect(shell().getAttribute("style")).toBeNull();
    expect(frame().className).toContain("max-h-[min(20rem,");
    expect(host.querySelector(".app-resize-handle")).toBeNull();
    expect(host.querySelector("[data-record-scroll]")).toBeNull();
  });
});

describe("the opened record card reads", () => {
  it("writes its words at the chat's size, its title above them", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    expect(frame().className).toContain("text-[15px]");
    expect(frame().className).toContain("leading-[22px]");
    const title = host.querySelector("p[title]")!;
    expect(title.className).toContain("text-[20px]");
    // the whole title: never clamped
    expect(title.className).toContain("line-clamp-none");
    expect(host.querySelector("[data-record-facts]")!.className).toContain("text-[15px]");
  });

  it("labels every fact: the company and the people sit under their label like the dates and the fields", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    const labels = [...host.querySelectorAll("[data-record-facts] dt")].map((node) => node.textContent);
    expect(labels).toEqual(["Entreprise", "Contact", "Responsable", "Ouverture", "Mise à jour", "Échéance", "Tableau", "Type", "Heures"]);
    for (const label of host.querySelectorAll("[data-record-facts] dt")) expect(label.className).toContain("text-[13px]");
    const values = [...host.querySelectorAll("[data-record-facts] dd")].map((node) => node.textContent);
    expect(values[0]).toBe("Acme Fabrication");
    expect(values[1]).toContain("Ada Lindqvist");
    expect(values[1]).toContain("418 555-0142");
    expect(values[2]).toBe("Noor Haddad");
    // a label is written once: not also for a screen reader
    expect(host.querySelector("[data-record-facts] .sr-only")).toBeNull();
  });

  it("ends no name on an ellipsis: a long company, a long person and a long value go on a second line", () => {
    const raw = ticketCard(NOW, "fr");
    raw.company = { name: "Acme Fabrication et Distribution Internationale de Pièces Usinées de Précision", ref: COMPANY_REF };
    raw.people = [
      { role: "contact", label: "Contact", name: "Ada Lindqvist-Haddad de la Fontaine-Beaumont", detail: "418 555-0142 poste 1234", ref: { ...COMPANY_REF, kind: "contact", id: "2204" } },
      { role: "owner", label: "Responsable", name: "Noor Haddad-Lindqvist de Saint-Exupéry" },
    ];
    const edit = { load: async () => [], save: async () => {} };
    // chips (records the person may open), plain names and pickers alike
    for (const over of [{ onOpenRecord: () => {} }, {}, { edits: { owner: edit, contact: edit, board: edit } }]) {
      show({ raw, related: related(), ...over });
      const facts = host.querySelector<HTMLElement>("[data-record-facts]")!;
      expect(facts.textContent).toContain("Usinées de Précision");
      expect(facts.textContent).toContain("Fontaine-Beaumont");
      expect(facts.textContent).toContain("Saint-Exupéry");
      // (a picker's own label is undone below; a phone or an extension stays on its line, whole)
      const cut = [...facts.querySelectorAll<HTMLElement>(".truncate, .whitespace-nowrap, .line-clamp-1, .line-clamp-2")].filter((node) => !node.closest("[data-pill-select]") && node.getAttribute("dir") !== "ltr");
      expect(cut.map((node) => node.textContent)).toEqual([]);
      // a picker's own label wraps too (its truncation is undone by the card)
      for (const pill of facts.querySelectorAll<HTMLElement>("[data-pill-select]")) expect(pill.className).toContain("[&>span]:whitespace-normal");
    }
  });

  it("cuts nothing: the facts are whole in the card's one scroller, the tabs with them, and no box of their own clips", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    const scroller = host.querySelector<HTMLElement>("[data-record-scroll]")!;
    expect(scroller.className).toContain("overflow-y-auto");
    const panes = scroller.querySelector<HTMLElement>("[data-record-panes]")!;
    expect(scroller.querySelector('[role="tablist"]')).not.toBeNull();
    for (const node of [panes, ...panes.querySelectorAll<HTMLElement>("[data-record-pane]"), host.querySelector<HTMLElement>("[data-record-related]")!, host.querySelector<HTMLElement>('[role="tabpanel"]')!]) {
      expect(node.className).not.toMatch(/overflow-(y-auto|hidden)|max-h-|line-clamp/);
    }
    // the scroller is the only box of the body that scrolls
    expect(host.querySelectorAll("[data-record-card-body] .overflow-y-auto")).toHaveLength(1);
    // the head, the title and the actions stay out of it
    for (const selector of ["[data-record-head]", "p[title]", "[data-record-actions]"]) {
      expect(scroller.querySelector(selector)).toBeNull();
      expect(host.querySelector(selector)!.className).toContain("shrink-0");
    }
  });

  it("gives the tabs the height left: they grow with the card, their row stays in view and never cuts a tab", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    const tabs = host.querySelector<HTMLElement>("[data-record-related]")!;
    expect(tabs.className).toContain("grow");
    expect(tabs.className).toContain("shrink-0");
    expect(tabs.closest("[data-record-pane=right]")).not.toBeNull();
    expect(host.querySelector<HTMLElement>("[data-record-panes]")!.className).toContain("grow");
    for (const row of host.querySelectorAll<HTMLElement>('[role="tablist"]')) expect(row.className).not.toMatch(/flex-nowrap|overflow-x/);
    expect(host.querySelector<HTMLElement>('[role="tablist"]')!.className).toContain("sticky");
  });

  it("shows several notes at once, each with its whole text", () => {
    show({ raw: ticketCard(NOW, "fr"), related: related() });
    act(() => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Toutes"))!.click());
    const bodies = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"] li p[dir="auto"]')];
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body.className).not.toContain("line-clamp");
    expect(bodies[0]!.textContent).toContain("The counter queue stays blocked.");
  });

  it("shows a record's notes without a click when its panes stack: the opened card folds nothing by itself", () => {
    // a card narrower than 50rem (a small window, or a card the person made narrow): its panes stack
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).className.includes("@container") ? 700 : 0; } });
    try {
      show({ raw: ticketCard(NOW, "fr") });
      const fold = host.querySelector<HTMLButtonElement>("[data-record-notes] button[aria-expanded]")!;
      expect(fold.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelectorAll("[data-record-note]").length).toBeGreaterThan(1);
      // the person may still fold them, and open them again
      act(() => fold.click());
      expect(host.querySelectorAll("[data-record-note]")).toHaveLength(0);
      act(() => host.querySelector<HTMLButtonElement>("[data-record-notes] button[aria-expanded]")!.click());
      expect(host.querySelectorAll("[data-record-note]").length).toBeGreaterThan(1);
    } finally {
      if (before) Object.defineProperty(HTMLElement.prototype, "clientWidth", before); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it("offers \"Less\" on a note of more than eight lines, never on one of eight", () => {
    // 22 px a line and 2 px above the text: eight lines are 178 px, nine are 200 px
    const tall = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.textContent?.includes("stops after") ? 178 : this.textContent?.includes("tomorrow morning") ? 200 : 22; });
    try {
      show({ raw: ticketCard(NOW, "fr"), related: related() });
      const noteOf = (words: string) => [...host.querySelectorAll<HTMLElement>('[role="tabpanel"] li')].find((item) => item.textContent?.includes(words))!;
      expect(noteOf("stops after").querySelector("button[aria-expanded]")).toBeNull();
      expect(noteOf("tomorrow morning").querySelector("button[aria-expanded]")!.textContent).toBe("Moins");
    } finally {
      tall.mockRestore();
    }
  });

  it("folds a long note only when the person asks, and opens it again", () => {
    const tall = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.textContent?.includes("stops after") ? 400 : 22; });
    try {
      show({ raw: ticketCard(NOW, "fr"), related: related() });
      const note = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"] li')].find((item) => item.textContent?.includes("stops after"))!;
      const body = note.querySelector<HTMLElement>('p[dir="auto"]')!;
      const fold = note.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
      expect(fold.getAttribute("aria-expanded")).toBe("true");
      expect(fold.textContent).toBe("Moins");
      act(() => fold.click());
      expect(body.className).toContain("line-clamp-3");
      expect(note.querySelector("button[aria-expanded]")!.textContent).toBe("Plus");
      act(() => note.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
      expect(body.className).not.toContain("line-clamp");
      // a short note has nothing to fold
      const short = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"] li')].find((item) => item.textContent?.includes("tomorrow morning"))!;
      expect(short.querySelector("button[aria-expanded]")).toBeNull();
    } finally {
      tall.mockRestore();
    }
  });

  it("keeps every piece of information and every action", () => {
    const edit = { load: async () => [], save: async () => {} };
    show({ raw: ticketCard(NOW, "fr"), related: related(), edits: { status: edit, priority: edit, board: edit } });
    const text = host.textContent ?? "";
    for (const words of ["Billet", "#481516", "Imprimante de l'accueil hors ligne depuis lundi", "En cours", "Priorité 2 - Élevée", "Acme Fabrication", "Ada Lindqvist", "418 555-0142", "Noor Haddad", "L'imprimante du comptoir ne répond plus", "Ressources et rencontres", "À jour à"]) expect(text).toContain(words);
    // the status and the priority stay menus, in the head
    expect(host.querySelectorAll("[data-record-head] [data-pill-select]")).toHaveLength(2);
    // the six tabs with their counts, then the notes' four filters with theirs
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Notes3", "Temps0", "Configurations2", "Dépenses0", "Activités1", "Pièces jointes0", "Discussion2", "Interne1", "Résolution0", "Toutes3"]);
    // the product's link, Ask, copy and refresh, on one row
    const actions = host.querySelector("[data-record-actions]")!;
    expect(actions.querySelector("[data-record-open]")!.textContent).toBe("Ouvrir dans Nimbus Desk");
    expect(actions.querySelector("[data-record-ask]")!.textContent).toBe("Demander");
    expect(actions.querySelector("[data-record-copy]")).not.toBeNull();
    expect(actions.querySelector("[data-record-refresh]")).not.toBeNull();
    expect(host.querySelector("[aria-label=Fermer]")).not.toBeNull();
  });

  it("draws a record with little content with the same parts: its facts two a row, no pane left empty", () => {
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect(shell().dataset.layout).toBe("compact");
    expect(host.querySelector("[data-record-pane=right]")).toBeNull();
    expect(host.querySelector("[data-record-facts]")!.className).toContain("@min-[40rem]:grid-cols-");
    const labels = [...host.querySelectorAll("[data-record-facts] dt")].map((node) => node.textContent);
    expect(labels.slice(0, 4)).toEqual(["Contact principal", "Responsable", "Ouverture", "Mise à jour"]);
    expect(host.querySelector("[data-record-open]")).not.toBeNull();
    expect(host.querySelector("[data-record-refresh]")).not.toBeNull();
  });
});
