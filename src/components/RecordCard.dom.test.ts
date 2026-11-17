// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { companyCard, guidCard, GUID_REF, projectCard, ticketCard, TICKET_REF, COMPANY_REF, PROJECT_REF } from "@/lib/record-card-fixtures";
import { parseRecordCard, type RecordCardMiss, type RecordRef } from "../../shared/record-cards";
import { RecordCard, type RecordCardProps } from "./RecordCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const product = { name: "Nimbus Desk", iconUrl: "https://desk.example/mark.svg" };
let host: HTMLDivElement;
let root: Root;
const refresh = vi.fn();
const confirm = vi.fn();

function show(over: Partial<RecordCardProps> & { raw?: Record<string, unknown>; miss?: RecordCardMiss; loading?: boolean; record?: RecordRef }) {
  const { raw, miss, loading, record, ...rest } = over;
  const card = raw ? parseRecordCard(raw) : null;
  act(() => root.render(createElement(RecordCard, {
    record: record ?? TICKET_REF, label: "#481516", kindName: "Billet", product, now: NOW,
    read: { card, miss: miss ?? null, loading: Boolean(loading), at: NOW - 120_000, refresh, confirm },
    ...rest,
  })));
  return host.firstElementChild as HTMLElement;
}
const text = () => host.textContent ?? "";

beforeEach(() => {
  setLocale("fr");
  refresh.mockClear();
  confirm.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("RecordCard", () => {
  it("lays a ticket out in two panes with the head, the title and one row of actions", () => {
    const card = show({ raw: ticketCard(NOW, "fr"), onAsk: () => {} });
    expect(card.dataset.layout).toBe("split");
    expect(card.className).toContain("w-[min(40rem,calc(100vw-1rem))]");
    expect(card.querySelector("[data-record-pane=left]")).not.toBeNull();
    expect(card.querySelector("[data-record-pane=right]")).not.toBeNull();
    expect(text()).toContain("Imprimante de l'accueil hors ligne depuis lundi");
    expect(text()).toContain("En cours");
    expect(text()).toContain("Priorité 2 - Élevée");
    expect(text()).toContain("Acme Fabrication");
    expect(text()).toContain("Ouvrir dans Nimbus Desk");
    expect(text()).toContain("Demander");
    expect(host.querySelectorAll("[data-record-notes] [data-record-note]")).toHaveLength(2);
    expect(text()).toContain("5 autres notes");
  });

  it("formats the times in the card's zone, whatever the device's", () => {
    show({ raw: ticketCard(NOW, "fr") });
    const flat = text().replace(/\s/g, " ");
    // 19:05Z is 14 h 05 in Toronto (the card's tz)
    expect(flat).toContain("aujourd’hui 14 h 05");
    expect(flat).toContain("À jour à 14 h 32");
  });

  it("keeps the left pane only, about 22 rem wide, when there is nothing to say", () => {
    const card = show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect(card.dataset.layout).toBe("compact");
    expect(card.className).toContain("w-[min(22rem,calc(100vw-1rem))]");
    expect(card.querySelector("[data-record-pane=right]")).toBeNull();
  });

  it("says a name once: a company's name is the title, not also the number", () => {
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    const head = host.querySelector("[data-record-head]")!.textContent!;
    expect(head).toContain("Entreprise");
    expect(head).not.toContain("Acme Fabrication");
  });

  it("draws a percent field as a bar and shows the project's note", () => {
    show({ raw: projectCard(NOW, "fr"), record: PROJECT_REF });
    const bar = host.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("52");
    expect(host.querySelectorAll("[data-record-note]")).toHaveLength(1);
  });

  it("shows a note that repeats the description once", () => {
    const raw = ticketCard(NOW, "fr");
    const description = (raw.description as { text: string }).text;
    (raw.notes as { items: Array<{ text: string }> }).items[1]!.text = description;
    show({ raw });
    expect(text().split("L'imprimante du comptoir ne répond plus").length - 1).toBe(1);
  });

  it("never puts a GUID on screen, and copies the id only on request", () => {
    show({ raw: guidCard(NOW, "fr"), record: GUID_REF, label: GUID_REF.id });
    expect(text()).not.toContain(GUID_REF.id);
    show({ miss: { state: "no_access" }, record: GUID_REF, label: GUID_REF.id });
    expect(text()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("shows the head at once with a skeleton in each pane while loading", () => {
    const card = show({ loading: true });
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(text()).toContain("Billet");
    expect(text()).toContain("#481516");
    expect(text()).toContain("Chargement de la fiche");
    expect(card.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  it.each([
    ["no_access", "Tu n'as pas accès à cette fiche.", null],
    ["unknown", "Cette fiche est introuvable ou hors de ton accès.", null],
    ["not_connected", "Nimbus Desk n'est pas connecté pour toi.", "Connecter"],
    ["sign_in", "Reconnecte-toi pour lire cette fiche.", "Te reconnecter"],
    ["busy", "Nimbus Desk est occupé. Nouvel essai dans un instant.", null],
    ["down", "Nimbus Desk ne répond pas en ce moment.", "Réessayer"],
    ["org_refused", "Ton organisation bloque cette lecture.", null],
    ["org_ask", "Ton organisation te demande de confirmer avant de lire.", "Lire la fiche"],
  ] as const)("says %s in one sentence with its action", (state, sentence, action) => {
    show({ miss: { state }, onConnect: () => {}, onSignIn: () => {} });
    expect(host.querySelector("[role=status]")!.textContent).toBe(sentence);
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    if (action) expect(buttons).toContain(action);
    expect(buttons).toContain("Copier le numéro");
    expect(host.querySelectorAll("[data-record-head] .animate-pulse")).toHaveLength(0);
  });

  it("reads the record on 'Lire la fiche' and retries on 'Réessayer'", () => {
    show({ miss: { state: "org_ask" } });
    act(() => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Lire la fiche")!.click(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    show({ miss: { state: "down" } });
    act(() => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Réessayer")!.click(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("has a close button only when pinned, and no dash anywhere in its words", () => {
    show({ raw: ticketCard(NOW, "fr") });
    expect(host.querySelector("[aria-label=Fermer]")).toBeNull();
    show({ raw: ticketCard(NOW, "fr"), pinned: true, onClose: () => {} });
    expect(host.querySelector("[aria-label=Fermer]")).not.toBeNull();
    expect(text()).not.toMatch(/[–—]/);
  });

  it("keeps the footer on one row: no wrap, labels shortened to icons with tooltips where narrow", () => {
    const split = show({ raw: ticketCard(NOW, "fr"), onAsk: () => {} });
    const actions = split.querySelector("[data-record-actions]")!;
    expect(actions.className).toContain("flex-nowrap");
    expect(actions.className).not.toContain("flex-wrap");
    expect(actions.querySelector("[data-record-ask]")!.getAttribute("title")).toBe("Demander au bot à propos de cette fiche");
    const refresh = actions.querySelector("[data-record-refresh]")!;
    expect(refresh.getAttribute("title")).toContain("À jour à");
    const compact = show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication", onAsk: () => {} });
    expect(compact.querySelector("[data-record-ask] span")!.className).toContain("hidden");
    expect(compact.querySelector("[data-record-actions] time")!.className).toContain("hidden");
    // the open button keeps its label
    expect(compact.querySelector("[data-record-open]")!.textContent).toBe("Ouvrir dans Nimbus Desk");
  });

  it("puts the state chip first, then the priority, in the head", () => {
    show({ raw: ticketCard(NOW, "fr") });
    const chips = [...host.querySelectorAll("[data-record-head] [title]")].map((node) => node.getAttribute("title"));
    expect(chips.indexOf("En cours")).toBeGreaterThan(-1);
    expect(chips.indexOf("En cours")).toBeLessThan(chips.indexOf("Priorité 2 - Élevée"));
  });

  it("draws a company with a ref as a chip that opens its card, and a company without as text", () => {
    const open = vi.fn();
    show({ raw: ticketCard(NOW, "fr"), onOpenRecord: open });
    const link = host.querySelector<HTMLElement>("[data-record-company-link]")!;
    act(() => { link.click(); });
    expect(open).toHaveBeenCalledWith({ product: "nimbus_desk", kind: "company", id: "7310" }, "Acme Fabrication");
    const raw = ticketCard(NOW, "fr");
    (raw.company as Record<string, unknown>).ref = undefined;
    show({ raw, onOpenRecord: open });
    expect(host.querySelector("[data-record-company-link]")).toBeNull();
  });

  it("shows a back arrow only when it replaced another card", () => {
    const back = vi.fn();
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, onBack: back });
    act(() => { host.querySelector<HTMLElement>("[aria-label=Retour]")!.click(); });
    expect(back).toHaveBeenCalled();
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF });
    expect(host.querySelector("[aria-label=Retour]")).toBeNull();
  });

  it("says nothing twice in a state card: one sentence, one action row, no skeleton", () => {
    for (const state of ["no_access", "unknown", "not_connected", "busy", "down", "org_ask"] as const) {
      show({ miss: { state }, onConnect: () => {} });
      const sentences = [...host.querySelectorAll("p")].map((p) => p.textContent);
      expect(sentences).toHaveLength(1);
      expect(host.querySelectorAll(".animate-pulse")).toHaveLength(0);
    }
  });

  it("holds no control in the tab order until pinned", () => {
    show({ raw: ticketCard(NOW, "fr"), onAsk: () => {}, onOpenRecord: () => {} });
    const order = (box: ParentNode) => [...box.querySelectorAll<HTMLElement>("button")].filter((button) => button.tabIndex >= 0);
    expect(order(host)).toHaveLength(0);
    show({ raw: ticketCard(NOW, "fr"), onAsk: () => {}, onOpenRecord: () => {}, pinned: true, onClose: () => {} });
    expect(order(host).length).toBeGreaterThan(3);
  });

  it("wears the accent on the primary action and the ink on the others", () => {
    show({ raw: ticketCard(NOW, "fr"), onAsk: () => {} });
    const open = host.querySelector("[data-record-open]")!.className;
    const ask = host.querySelector("[data-record-ask]")!.className;
    expect(open).toContain("text-popover-accent");
    expect(open).not.toContain("text-popover-ink");
    expect(ask).toContain("text-popover-ink");
    expect(ask).not.toContain("text-popover-accent");
  });

  it("asks the space the card has (a container query), not the window", () => {
    const card = show({ raw: ticketCard(NOW, "fr") });
    expect(card.className).toContain("@container");
    expect(card.innerHTML).toContain("@max-[34rem]");
    expect(card.innerHTML).not.toContain("max-[35rem]");
    expect(card.innerHTML).not.toContain("min-[35rem]");
  });

  it("keeps the head and the title out of the squeeze", () => {
    show({ raw: ticketCard(NOW, "fr") });
    expect(host.querySelector("[data-record-head]")!.className).toContain("shrink-0");
    expect(host.querySelector("p[title]")!.className).toContain("shrink-0");
    expect(host.querySelector("[data-record-actions]")!.className).toContain("shrink-0");
  });

  it("paints a chip's words in the popover ink, the tone only as a dot or a glyph", () => {
    show({ raw: ticketCard(NOW, "fr") });
    const chips = [...host.querySelectorAll<HTMLElement>("[data-record-head] .rounded-full[title]")];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) expect(chip.className).toContain("text-popover-ink");
    expect(host.querySelectorAll("span[class*='text-warning'], span[class*='text-danger'], span[class*='text-success']")).toHaveLength(0);
  });
});

describe("RecordCard without a layout engine's help", () => {
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() { return {}; } }) as DOMRect;
  let restore: Array<() => void> = [];
  const define = (proto: object, name: string, value: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...value });
    restore.push(() => (before ? Object.defineProperty(proto, name, before) : delete (proto as Record<string, unknown>)[name]));
  };
  afterEach(() => { restore.forEach((undo) => undo()); restore = []; });

  it("drops the rows that do not fit, whole, and says how many and of what at the pane's foot", () => {
    // a pane 110px tall; rows 30px apart, 28px tall: the third row would end at 88 > 110 - 20
    define(HTMLElement.prototype, "clientHeight", { get() { return (this as HTMLElement).dataset.recordPane === "left" ? 110 : 0; } });
    define(Element.prototype, "getBoundingClientRect", {
      value(this: HTMLElement) {
        const key = this.dataset?.fitRow;
        if (this.dataset?.recordPane === "left") return rect(0, 110);
        if (!key) return rect(0, 0);
        const keys = [...new Set([...document.querySelectorAll<HTMLElement>("[data-record-pane=left] [data-fit-row]")].map((node) => node.dataset.fitRow))];
        const at = keys.indexOf(key);
        return rect(at * 30, at * 30 + 28);
      },
    });
    const card = show({ raw: ticketCard(NOW, "fr") });
    const left = card.querySelector("[data-record-pane=left]")!;
    const keys = [...new Set([...left.querySelectorAll<HTMLElement>("[data-fit-row]")].map((node) => node.dataset.fitRow))];
    const hidden = [...left.querySelectorAll<HTMLElement>("[data-fit-hidden]")].map((node) => node.dataset.fitRow);
    // rows 0..2 end at 28, 58, 88; the limit 110 - 24 (the line and its gap) = 86 keeps the first two whole
    expect(keys.length).toBeGreaterThan(4);
    expect(new Set(hidden).size).toBe(keys.length - 2);
    expect(hidden).not.toContain(keys[0]);
    expect(hidden).toContain(keys[2]);
    // the count is of ROWS (a date row is two nodes), it says what it counts, and the
    // line sits inside the pane's box, at its foot
    const more = left.querySelector<HTMLElement>("[data-fit-more]")!;
    expect(more.parentElement).toBe(left);
    // in flow, after the last row the pane keeps: it can never sit on a row
    expect(more.className).not.toMatch(/\babsolute\b/);
    expect(left.lastElementChild).toBe(more);
    const dropped = keys.length - 2;
    expect(more.textContent).toMatch(new RegExp(`^${dropped} (champs|lignes) de plus$`));
    expect(hidden.length).toBeGreaterThan(dropped - 1);
    // pinned: nothing dropped, the pane scrolls
    const pinned = show({ raw: ticketCard(NOW, "fr"), pinned: true, onClose: () => {} });
    expect(pinned.querySelector("[data-fit-hidden]")).toBeNull();
    expect(pinned.querySelector("[data-fit-more]")).toBeNull();
  });

  it("keeps its notes behind one 'Notes (7)' row when it is not wider than tall, and opens them in place when pinned", () => {
    define(HTMLElement.prototype, "clientWidth", { get() { return (this as HTMLElement).className.includes("@container") ? 374 : 0; } });
    const card = show({ raw: ticketCard(NOW, "fr") });
    expect(card.querySelectorAll("[data-record-note]")).toHaveLength(0);
    expect(card.textContent).toContain("Notes (7)");
    expect(card.querySelector("[data-record-notes] button")).toBeNull();
    const pinned = show({ raw: ticketCard(NOW, "fr"), pinned: true, onClose: () => {} });
    const row = pinned.querySelector<HTMLButtonElement>("[data-record-notes] button")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    act(() => { row.click(); });
    expect(pinned.querySelectorAll("[data-record-note]")).toHaveLength(2);
    // the identity rows and the description come first
    expect(pinned.textContent!.indexOf("Acme Fabrication")).toBeLessThan(pinned.textContent!.indexOf("L'imprimante du comptoir"));
    expect(pinned.textContent!.indexOf("L'imprimante du comptoir")).toBeLessThan(pinned.textContent!.indexOf("Notes (7)"));
  });

  it("says fields when only key fields were left out, and a plain row count otherwise", () => {
    define(HTMLElement.prototype, "clientHeight", { get() { return (this as HTMLElement).dataset.recordPane === "left" ? 400 : 0; } });
    define(Element.prototype, "getBoundingClientRect", {
      value(this: HTMLElement) {
        const key = this.dataset?.fitRow;
        if (this.dataset?.recordPane === "left") return rect(0, 400);
        if (!key) return rect(0, 0);
        const keys = [...new Set([...document.querySelectorAll<HTMLElement>("[data-record-pane=left] [data-fit-row]")].map((node) => node.dataset.fitRow))];
        const at = keys.indexOf(key);
        return rect(at * 30, at * 30 + 28);
      },
    });
    const raw = ticketCard(NOW, "fr");
    raw.fields = Array.from({ length: 8 }, (_, index) => ({ label: `Champ ${index}`, value: `Valeur ${index}` }));
    // 3 people + 3 dates = 6 rows end by 178; fields follow at 28px each; room for 400 - 22 = 378
    const card = show({ raw });
    const left = card.querySelector("[data-record-pane=left]")!;
    const more = left.querySelector<HTMLElement>("[data-fit-more]");
    expect(more?.textContent).toMatch(/^\d+ champs de plus$/);
    const hiddenKeys = new Set([...left.querySelectorAll<HTMLElement>("[data-fit-hidden]")].map((node) => node.dataset.fitRow));
    expect([...hiddenKeys].every((key) => key!.startsWith("f-field-"))).toBe(true);
    expect(Number(more!.textContent!.split(" ")[0])).toBe(hiddenKeys.size);
  });

  it("measures when the size changes, not on every render", () => {
    let reads = 0;
    define(HTMLElement.prototype, "clientHeight", { get() { return (this as HTMLElement).dataset.recordPane === "left" ? (reads += 1, 400) : 0; } });
    show({ raw: ticketCard(NOW, "fr") });
    const first = reads;
    for (let again = 0; again < 5; again += 1) show({ raw: ticketCard(NOW, "fr") });
    expect(reads).toBe(first);
  });

  it.each([[110, "a short pane (the 1280 card with a two-line title)"], [150, "a taller pane (the 600 card)"], [64, "a very short pane"]])(
    "never lets a shown row touch the line that counts the rest: %s px, %s",
    (height) => {
      // the stack of rows is laid out like the browser would: each row 28px tall, 2px apart;
      // the line, in flow, starts 8px under the last row that shows
      const boxes = new Map<Element, { top: number; bottom: number }>();
      define(HTMLElement.prototype, "clientHeight", { get() { return (this as HTMLElement).dataset.recordPane === "left" ? height : 0; } });
      define(Element.prototype, "getBoundingClientRect", {
        value(this: HTMLElement) {
          if (this.dataset?.recordPane === "left") return rect(0, height);
          const left = document.querySelector("[data-record-pane=left]");
          if (!left) return rect(0, 0);
          const keys = [...new Set([...left.querySelectorAll<HTMLElement>("[data-fit-row]")].map((node) => node.dataset.fitRow))];
          if (this.dataset?.fitMore !== undefined) {
            const shownKeys = keys.filter((key) => !left.querySelector(`[data-fit-row="${key}"][data-fit-hidden]`));
            const top = shownKeys.length ? shownKeys.length * 30 - 2 + 8 : 8;
            return rect(top, top + 16);
          }
          const key = this.dataset?.fitRow;
          if (!key) return rect(0, 0);
          const at = keys.indexOf(key);
          const box = rect(at * 30, at * 30 + 28);
          boxes.set(this, { top: box.top, bottom: box.bottom });
          return box;
        },
      });
      const card = show({ raw: ticketCard(NOW, "fr") });
      const left = card.querySelector("[data-record-pane=left]")!;
      const more = left.querySelector<HTMLElement>("[data-fit-more]");
      const keys = [...new Set([...left.querySelectorAll<HTMLElement>("[data-fit-row]")].map((node) => node.dataset.fitRow))];
      const shown = keys.filter((key) => !left.querySelector(`[data-fit-row="${key}"][data-fit-hidden]`));
      expect(more).not.toBeNull();
      const line = more!.getBoundingClientRect();
      for (const key of shown) {
        const row = left.querySelector<HTMLElement>(`[data-fit-row="${key}"]`)!.getBoundingClientRect();
        expect(row.bottom <= line.top || row.top >= line.bottom).toBe(true);
      }
      // and the line is inside the pane
      expect(line.bottom).toBeLessThanOrEqual(height);
    },
  );

  it("keeps the full priority name readable in the body of a narrow card, and names the glyph chip", () => {
    define(HTMLElement.prototype, "clientWidth", { get() { return (this as HTMLElement).className.includes("@container") ? 374 : 0; } });
    const card = show({ raw: ticketCard(NOW, "fr") });
    expect(card.querySelector("[data-record-head] [role=img]")!.getAttribute("aria-label")).toBe("Priorité 2 - Élevée");
    const facts = card.querySelector("[data-record-facts]")!;
    expect(facts.textContent).toContain("Priorité");
    expect(facts.textContent).toContain("Priorité 2 - Élevée");
    // wide: the chip says it, the body does not repeat it
    restore.forEach((undo) => undo()); restore = [];
    act(() => root.unmount());
    root = createRoot(host);
    const wide = show({ raw: ticketCard(NOW, "fr") });
    expect(wide.querySelector("[data-record-facts]")!.textContent).not.toContain("Priorité 2");
  });
});
