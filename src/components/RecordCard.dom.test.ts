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
const product = { name: "Nimbus Desk", domain: "desk.example" };
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
});
