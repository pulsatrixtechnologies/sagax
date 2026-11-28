// @vitest-environment happy-dom
// The three kinds the card drew before it learned to draw any kind (a ticket,
// a company, a project): their DOM is pinned here, taken on the code of
// #4532 before the generic renderer (#4572), so the generic renderer is proved
// to draw them exactly as they were. The hovered ones still are that DOM, to
// the byte. The opened ones were taken again with #5053, which redrew the
// opened card (a window over the chat: larger, resizable, a label on every
// fact) and left the hovered tooltip alone. M-20261119-084 took them again
// for three asked changes only: the action reads "Open on the web" (no
// product name, no arrow) on both, and the opened card takes its whole
// height (its bottom handles always there) and draws a record's text with
// the chat's Markdown renderer. M-20261127-101 took the opened ones again: the
// opened card is the record window (its frame moved by its head and resized
// by its edges, its size kept per type of window, each side scrolling on its
// own); the hovered ones did not change.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { companyCard, projectCard, ticketCard, TICKET_REF, COMPANY_REF, PROJECT_REF } from "@/lib/record-card-fixtures";
import { parseRecordCard, type RecordRef } from "../../shared/record-cards";
import { RecordCard } from "./RecordCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const product = { name: "Nimbus Desk", iconUrl: "https://desk.example/mark.svg" };
let host: HTMLDivElement;
let root: Root;

const CASES: Array<[string, (now: number, lang: "fr" | "en") => Record<string, unknown>, RecordRef, string, string]> = [
  ["ticket", ticketCard, TICKET_REF, "#481516", "Billet"],
  ["company", companyCard, COMPANY_REF, "Acme Fabrication", "Entreprise"],
  ["project", projectCard, PROJECT_REF, "Migration du serveur", "Projet"],
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the three kinds before the generic renderer", () => {
  for (const lang of ["fr", "en"] as const) {
    for (const pinned of [false, true]) {
      for (const [name, make, record, label, kindName] of CASES) {
        it(`${name} ${lang} ${pinned ? "pinned" : "hovered"} keeps its DOM`, () => {
          setLocale(lang);
          act(() => root.render(createElement(RecordCard, {
            record, label, kindName, product, now: NOW, pinned, onAsk: () => {}, onOpenRecord: () => {},
            read: { card: parseRecordCard(make(NOW, lang)), miss: null, loading: false, at: NOW - 120_000, refresh: vi.fn() },
          })));
          expect(host.innerHTML.replace(/\sid="[^"]*"/g, "").replace(" [background-color:var(--float-fill)] [box-shadow:var(--float-shadow)]", "").replaceAll("max-w-[9rem] break-words", "max-w-[9rem] truncate whitespace-nowrap")).toMatchSnapshot();
        });
      }
    }
  }
});
