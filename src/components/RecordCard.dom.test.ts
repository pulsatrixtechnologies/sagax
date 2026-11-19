// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { agreementCard, companyCard, contactCard, departmentCard, emailCard, CONTACT_REF, DEPARTMENT_REF, EMAIL_REF, guidCard, GUID_REF, invoiceCard, projectCard, ticketCard, TICKET_REF, COMPANY_REF, PROJECT_REF, INVOICE_REF, AGREEMENT_REF } from "@/lib/record-card-fixtures";
import { parseRecordCard, type RecordCardMiss, type RecordRef } from "../../shared/record-cards";
import type { RelatedPage } from "./RecordRelatedTabs";
import { useRecordRelatedTabs } from "./useRecordRelatedTabs";
import { RecordCard, type RecordCardProps } from "./RecordCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const product = { name: "Nimbus Desk", iconUrl: "https://desk.example/mark.svg" };
let host: HTMLDivElement;
let root: Root;
const refresh = vi.fn();

function show(over: Partial<RecordCardProps> & { raw?: Record<string, unknown>; miss?: RecordCardMiss; loading?: boolean; record?: RecordRef }) {
  const { raw, miss, loading, record, ...rest } = over;
  const card = raw ? parseRecordCard(raw) : null;
  act(() => root.render(createElement(RecordCard, {
    record: record ?? TICKET_REF, label: "#481516", kindName: "Billet", product, now: NOW,
    read: { card, miss: miss ?? null, loading: Boolean(loading), at: NOW - 120_000, refresh },
    ...rest,
  })));
  return host.firstElementChild as HTMLElement;
}
const text = () => host.textContent ?? "";

beforeEach(() => {
  setLocale("fr");
  refresh.mockClear();
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
    expect(host.querySelectorAll("[data-record-notes] [data-record-note]")).toHaveLength(3);
    expect(text()).toContain("4 autres notes");
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
  ] as const)("says %s in one sentence with its action", (state, sentence, action) => {
    show({ miss: { state }, onConnect: () => {}, onSignIn: () => {} });
    expect(host.querySelector("[role=status]")!.textContent).toBe(sentence);
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    if (action) expect(buttons).toContain(action);
    expect(buttons).toContain("Copier le numéro");
    expect(host.querySelectorAll("[data-record-head] .animate-pulse")).toHaveLength(0);
  });

  it("retries on 'Réessayer' and has no 'Lire la fiche' button in any state (#4566)", () => {
    for (const state of ["no_access", "unknown", "not_connected", "busy", "down", "org_refused", "sign_in", "unavailable"] as const) {
      show({ miss: { state }, onConnect: () => {}, onSignIn: () => {} });
      expect([...host.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Lire la fiche");
    }
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
    for (const state of ["no_access", "unknown", "not_connected", "busy", "down"] as const) {
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

  it("pinned, ends on a row boundary too, and scrolls through every row only when the person asks", () => {
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
    const card = show({ raw: ticketCard(NOW, "fr"), pinned: true });
    const left = card.querySelector("[data-record-pane=left]")!;
    // pinned (clicked): nothing is left out, there is no "N more", the pane scrolls
    expect(left.querySelectorAll("[data-fit-hidden]")).toHaveLength(0);
    expect(left.querySelector("[data-fit-more]")).toBeNull();
  });

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
    // pinned: every row shows, no "N more"
    const pinned = show({ raw: ticketCard(NOW, "fr"), pinned: true, onClose: () => {} });
    expect(pinned.querySelector("[data-fit-hidden]")).toBeNull();
    expect(pinned.querySelector("[data-fit-more]")).toBeNull();
  });

  it("hovered, keeps its notes behind one 'Notes (7)' row when it is not wider than tall; opened, shows them under that row, which folds them", () => {
    define(HTMLElement.prototype, "clientWidth", { get() { return (this as HTMLElement).className.includes("@container") ? 374 : 0; } });
    const card = show({ raw: ticketCard(NOW, "fr") });
    expect(card.querySelectorAll("[data-record-note]")).toHaveLength(0);
    expect(card.textContent).toContain("Notes (7)");
    expect(card.querySelector("[data-record-notes] button")).toBeNull();
    // the opened card has the room and one scroll (#5053): nothing of it is folded until the person folds it
    const pinned = show({ raw: ticketCard(NOW, "fr"), pinned: true, onClose: () => {} });
    const row = pinned.querySelector<HTMLButtonElement>("[data-record-notes] button")!;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(pinned.querySelectorAll("[data-record-note]")).toHaveLength(3);
    act(() => { row.click(); });
    expect(pinned.querySelectorAll("[data-record-note]")).toHaveLength(0);
    act(() => { pinned.querySelector<HTMLButtonElement>("[data-record-notes] button")!.click(); });
    expect(pinned.querySelectorAll("[data-record-note]")).toHaveLength(3);
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

  it("never cuts the priority name in the head: the chip does not shrink and the head wraps instead", () => {
    define(HTMLElement.prototype, "clientWidth", { get() { return (this as HTMLElement).className.includes("@container") ? 374 : 0; } });
    const card = show({ raw: ticketCard(NOW, "fr") });
    const chip = card.querySelector<HTMLElement>("[data-record-head] [role=img]")!;
    expect(chip.getAttribute("aria-label")).toBe("Priorité 2 - Élevée");
    expect(chip.className).toContain("shrink-0");
    expect(chip.querySelector("span")!.className).not.toMatch(/max-w-\[/);
    expect(card.querySelector("[data-record-head]")!.className).toContain("flex-wrap");
    // said once: the body does not repeat it
    expect(card.querySelector("[data-record-facts]")!.textContent).not.toContain("Priorité 2");
  });

  it("shows the last three notes with who, when and whether each is internal or external, then 'Tout voir' to the product", async () => {
    const card = show({ raw: ticketCard(NOW, "fr") });
    const notes = [...card.querySelectorAll("[data-record-note]")];
    expect(notes).toHaveLength(3);
    expect(notes[0]!.querySelector("[data-record-note-scope=internal]")).not.toBeNull();
    expect(notes[1]!.querySelector("[data-record-note-scope=external]")!.textContent).toBe("Externe");
    expect(notes[1]!.querySelector("[data-record-note-tag]")!.textContent).toBe("Email");
    expect(notes[0]!.textContent).toContain("Noor Haddad");
    const seeAll = card.querySelector("[data-record-notes] [data-record-see-all]")!;
    expect(seeAll.textContent).toBe("Tout voir");
    // the last time entry, folded to one line beside the notes
    expect(card.querySelectorAll("[data-record-line]")).toHaveLength(1);
    expect(card.querySelector("[data-record-lines]")!.textContent).toContain("Diagnostic du port réseau");
  });

  it("folds a list to three lines hovered, all of it pinned, with 'Tout voir' for the rest", () => {
    const hovered = show({ raw: departmentCard(NOW, "fr"), record: DEPARTMENT_REF, label: "Soutien technique" });
    expect(hovered.querySelectorAll("[data-record-line]")).toHaveLength(3);
    expect(hovered.querySelector("[data-record-lines]")!.textContent).toContain("3 autres lignes");
    expect(hovered.querySelector("[data-record-lines] [data-record-see-all]")).not.toBeNull();
  });

  it.each([
    ["company", companyCard, COMPANY_REF, "Billets ouverts"],
    ["contact", contactCard, CONTACT_REF, "Courriel"],
    ["department", departmentCard, DEPARTMENT_REF, "Membres"],
    ["email", emailCard, EMAIL_REF, "Pièces jointes"],
  ] as const)("draws a %s from the fields the product sends, with no code of its own", (_kind, make, ref, field) => {
    const card = show({ raw: make(NOW, "fr"), record: ref, label: "x" });
    expect(card.textContent).toContain(field);
    expect(card.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("measures again when a text changes, not only when a row comes or goes", async () => {
    let reads = 0;
    define(HTMLElement.prototype, "clientHeight", { get() { return (this as HTMLElement).dataset.recordPane === "left" ? (reads += 1, 400) : 0; } });
    const card = show({ raw: ticketCard(NOW, "fr") });
    const before = reads;
    const text = card.querySelector("[data-record-pane=left] [data-fit-row] time, [data-record-pane=left] [data-fit-row]")!.firstChild as Text | null;
    const node = (function find(root: Node): Text | null {
      for (const child of root.childNodes) {
        if (child.nodeType === 3 && (child.textContent ?? "").trim()) return child as Text;
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    })(card.querySelector("[data-record-pane=left]")!);
    expect(node ?? text).not.toBeNull();
    await act(async () => { (node ?? text)!.data = `${(node ?? text)!.data} (a longer text)`; await Promise.resolve(); });
    expect(reads).toBeGreaterThan(before);
  });
});

// A kind the product declares (#4572): the same renderer, drawn by field type.
describe("RecordCard draws any kind by field type", () => {
  const invoice = (over: Partial<RecordCardProps> & { raw?: Record<string, unknown> } = {}) => show({ raw: invoiceCard(NOW, "fr"), record: INVOICE_REF, label: "INV-1042", kindName: "Facture", onOpenRecord: () => {}, ...over });

  it("lays an invoice out as the landscape card with its chip beside its state, its kind from the data", () => {
    const raw = invoiceCard(NOW, "fr");
    raw.description = { text: "Un long texte. ".repeat(20), more: false };
    const card = invoice({ raw });
    expect(card.dataset.layout).toBe("split");
    const head = host.querySelector("[data-record-head]")!.textContent!;
    expect(head).toContain("Facture");
    expect(head).toContain("INV-1042");
    expect(head).toContain("Envoyée");
    expect(head).toContain("Entente");
  });

  it("shows money exactly as sent, left in the value column like every value, never computed", () => {
    invoice();
    const money = [...host.querySelectorAll("[data-record-money]")];
    expect(money.map((node) => node.textContent)).toEqual(["1 234,50 $", "1 234,50 $", "160,49 $"]);
    expect(money.every((node) => node.className.includes("tabular-nums") && !node.className.includes("text-end"))).toBe(true);
    // no total, difference or tax of its own
    expect(text()).not.toContain("1 074");
  });

  it("writes a calendar day as that day and reads the due day as late only once it is over", () => {
    invoice();
    const flat = text().replace(/\s/g, " ");
    expect(flat).toContain("mar. 6 oct. 2026");
    // due 2026-11-05, today 2026-11-17: twelve days late
    expect(flat).toContain("5 nov.");
    expect(flat).toMatch(/en retard de 12\s+jours/);
  });

  it("opens a ref in place for a product the person holds, and says plain words for one they do not", () => {
    const open = vi.fn();
    invoice({ onOpenRecord: open, canOpenRecord: (ref) => ref.product === "nimbus_desk" });
    const chips = [...host.querySelectorAll<HTMLElement>("[data-record-ref-link]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["Example Org", "Managed services", "Imprimante de l'accueil hors ligne"]);
    act(() => { chips[1]!.click(); });
    expect(open).toHaveBeenCalledWith(AGREEMENT_REF, "Managed services");
    invoice({ onOpenRecord: open, canOpenRecord: () => false });
    expect(host.querySelectorAll("[data-record-ref-link]")).toHaveLength(0);
    expect(text()).toContain("Managed services");
  });

  it("draws an agreement's company slot, contact, dates and amount with the same renderer", () => {
    show({ raw: agreementCard(NOW, "fr"), record: AGREEMENT_REF, label: "Managed services", kindName: "Entente", onOpenRecord: () => {} });
    expect(host.querySelector("[data-record-company-link]")).not.toBeNull();
    expect(host.querySelector("[data-record-person=contact]")).not.toBeNull();
    expect(text().replace(/\s/g, " ")).toContain("jeu. 31 déc. 2026");
    expect(host.querySelector("[data-record-money]")!.textContent).toBe("1 050,00 $");
  });

  it("keeps a late note on one line, and sizes the field pane from its rows when the text is long", () => {
    const raw = invoiceCard(NOW, "fr");
    raw.description = { text: "Un long texte. ".repeat(20), more: false };
    const card = show({ raw, record: INVOICE_REF, label: "INV-1042" });
    expect(card.dataset.layout).toBe("split");
    expect(host.querySelector("[data-record-facts]")!.innerHTML).toContain("whitespace-nowrap font-medium");
    expect(card.querySelector("[data-record-pane=left]")!.className).toContain("flex-[0_1_auto]");
  });

  it("puts a one-line text above the fields of the single-pane card, not in a nearly empty pane", () => {
    const card = show({ raw: invoiceCard(NOW, "fr"), record: INVOICE_REF, label: "INV-1042" });
    expect(card.dataset.layout).toBe("compact");
    expect(card.querySelector("[data-record-pane=right]")).toBeNull();
    expect(card.querySelector("[data-record-pane=left] [data-record-description]")!.textContent).toBe("Merci de votre confiance.");
  });

  it("is the narrower single-pane card when the kind has no text, list or activity", () => {
    const raw = invoiceCard(NOW, "fr");
    delete raw.description;
    const card = show({ raw, record: INVOICE_REF, label: "INV-1042" });
    expect(card.dataset.layout).toBe("compact");
    expect(card.className).toContain("w-[min(22rem,calc(100vw-1rem))]");
  });

  it("is two panes when the kind has only a list, and shows the list's whole rows", () => {
    const raw = invoiceCard(NOW, "fr");
    delete raw.description;
    raw.lines = { state: "ok", title: "Lignes", items: [{ label: "Poste géré", detail: "42", value: "1 050,00 $" }, { label: "Sauvegarde", detail: "3", value: "184,50 $" }], total: 3, more: true };
    const card = show({ raw, record: INVOICE_REF, label: "INV-1042" });
    expect(card.dataset.layout).toBe("split");
    expect(host.querySelectorAll("[data-record-line]")).toHaveLength(2);
    expect(text()).toContain("1 autre ligne");
  });

  it("draws a percent from its share, a duration, a person, a state and an ago by their type", () => {
    const raw = invoiceCard(NOW, "fr");
    raw.fields = [
      { label: "Marge", type: "percent", share: 40, value: "40 %" },
      { label: "Durée", type: "duration", value: "3,5 h" },
      { label: "Responsable", type: "person", role: "owner", value: "Noor Haddad" },
      { label: "Statut", type: "state", tone: "alert", value: "En retard" },
      { label: "Vu", type: "ago", at: new Date(NOW - 3_600_000).toISOString(), value: "x" },
      { label: "Inconnu", type: "hologram", value: "tel quel" },
    ];
    show({ raw, record: INVOICE_REF, label: "INV-1042" });
    expect(host.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("40");
    expect(text()).toContain("3,5 h");
    expect(host.querySelector("[data-record-person=owner]")!.textContent).toContain("Noor Haddad");
    expect(text()).toContain("En retard");
    expect(text().replace(/\s/g, " ")).toMatch(/il y a 1 h/);
    expect(text()).toContain("tel quel");
  });

  it("gives a second chip way in a narrow head and says its words in the body", () => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).className.includes("@container") ? 352 : 0; } });
    const raw = agreementCard(NOW, "fr");
    raw.chips = [{ label: "Managed IT", tone: "open" }, { label: "Renouvelable", tone: "waiting" }];
    show({ raw, record: AGREEMENT_REF, label: "Managed services" });
    expect(host.querySelector("[data-record-head]")!.textContent).toContain("Managed IT");
    expect(host.querySelector("[data-record-head]")!.textContent).not.toContain("Renouvelable");
    expect(host.querySelector("[data-record-facts]")!.textContent).toContain("Renouvelable");
    if (before) Object.defineProperty(HTMLElement.prototype, "clientWidth", before); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it("never puts a GUID on screen for a kind it does not know", () => {
    const raw = invoiceCard(NOW, "fr");
    raw.number = GUID_REF.id;
    show({ raw, record: INVOICE_REF, label: GUID_REF.id });
    expect(text()).not.toContain(GUID_REF.id);
  });
});

it("shows every time entry, expands its note and keeps the ticket actions", () => {
  const note = "The full note on the final entry";
  const select = vi.fn();
  show({ pinned: true, raw: ticketCard(NOW, "fr"), related: {
    counts: { time: 12, configurations: 0, expenses: 1, activities: 3, attachments: 1 },
    tab: "time", onTab: select, loading: false, page: {
      tab: "time", totalHours: "12 h", lines: Array.from({ length: 12 }, (_, i) => ({
        member: "Support", hours: "1 h", date: "18 nov.", note: i === 11 ? note : "Test",
      })),
    },
  } });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(6);
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("Temps12");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(12);
  const last = host.querySelector<HTMLButtonElement>("tbody tr:last-child button")!;
  act(() => last.click());
  expect(last.getAttribute("aria-expanded")).toBe("true");
  expect(last.textContent).toBe(note);
  expect(text()).toContain("Total : 12 h");
  act(() => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[5]!.click());
  expect(select).toHaveBeenCalledWith("attachments");
  expect(host.querySelector("[data-record-refresh]")).not.toBeNull();
});

describe("ticket field choices", () => {
  it("loads on open, shows the selected value during the write and restores the saved value on refusal", async () => {
    let refuse!: () => void;
    const save = vi.fn(() => new Promise<void>((_, reject) => { refuse = reject; }));
    const load = vi.fn(async () => [{ value: "4", label: "En cours" }, { value: "6", label: "En attente" }]);
    show({ pinned: true, raw: ticketCard(NOW, "fr"), edits: { status: { selected: "4", load, save } } });
    const pill = host.querySelector<HTMLButtonElement>("[data-pill-select]")!;
    expect(load).not.toHaveBeenCalled();
    await act(async () => pill.click());
    const options = document.body.querySelectorAll<HTMLElement>('[role="option"]');
    await act(async () => options[1]!.click());
    expect(save).toHaveBeenCalledWith("6");
    expect(pill.textContent).toBe("En attente");
    await act(async () => refuse());
    expect(pill.textContent).toBe("En cours");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Impossible d’enregistrer la modification.");
    await act(async () => pill.click());
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("related record reads", () => {
  it("loads counts once, reads each opened tab on demand and refreshes the active tab", async () => {
    const source = {
      counts: vi.fn(async (_fresh: boolean) => ({ time: 2, expenses: 1 })),
      page: vi.fn(async (tab: RelatedPage["tab"], fresh: boolean): Promise<RelatedPage> => {
        if (tab === "time") return { tab, lines: [], totalHours: fresh ? "3" : "2" };
        if (tab === "notes" || tab === "schedule" || tab === "expenses") return { tab, lines: [] };
        throw Error("unexpected tab");
      }),
    };
    let view!: ReturnType<typeof useRecordRelatedTabs>;
    function Probe() { view = useRecordRelatedTabs(source); return null; }
    await act(async () => root.render(createElement(Probe)));
    expect(source.page.mock.calls).toEqual([["notes", false], ["schedule", false]]);
    await act(async () => view.related!.onTab("expenses"));
    await act(async () => view.related!.onTab("time"));
    expect(source.page.mock.calls).toEqual([["notes", false], ["schedule", false], ["expenses", false], ["time", false]]);
    expect(source.counts.mock.calls).toHaveLength(1);
    await act(async () => view.refresh());
    expect(source.counts).toHaveBeenLastCalledWith(true);
    expect(source.page.mock.calls).toEqual([["notes", false], ["schedule", false], ["expenses", false], ["time", false], ["time", true], ["schedule", true]]);
    expect(view.related!.page?.totalHours).toBe("3");
  });
});
