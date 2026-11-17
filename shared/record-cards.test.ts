// #4507: the record link, the tool result metadata, the bot's ready-made
// line, the end-of-turn linking of a plain number and the card contract.
// Every product, record and person here is invented.
import { describe, expect, it } from "vitest";

import {
  RECORDS_NOTE_MAX_BYTES, linkSeenRecords, looksLikeRecordLink, parseRecordCard, parseRecordCardAnswer, parseRecordLink,
  parseRecordsMeta, recordLink, recordMarkdown, recordsNote, unlinkUnknownRecords, type SeenRecord,
} from "./record-cards.ts";

const TICKET = { product: "nimbus_desk", kind: "ticket", id: "297048" };

describe("record link", () => {
  it("round-trips product, kind and id, each segment encoded", () => {
    expect(recordLink(TICKET)).toBe("sagax://record/nimbus_desk/ticket/297048");
    expect(parseRecordLink(recordLink(TICKET))).toEqual(TICKET);
    const odd = { product: "nimbus_desk", kind: "station", id: "ST:4.2-a_b" };
    expect(parseRecordLink(recordLink(odd))).toEqual(odd);
    expect(parseRecordLink("sagax://record/nimbus_desk/station/ST%3A4.2-a_b")).toEqual(odd);
    expect(recordMarkdown("#297048", TICKET)).toBe("[#297048](sagax://record/nimbus_desk/ticket/297048)");
    expect(recordMarkdown("Acme [main]\nsite", TICKET)).toBe("[Acme \\[main\\] site](sagax://record/nimbus_desk/ticket/297048)");
  });

  it("refuses every malformed link", () => {
    for (const href of [
      "sagax://record/nimbus_desk/ticket", "sagax://record/nimbus_desk/ticket/1/2", "sagax://record//ticket/1",
      "sagax://record/Nimbus/ticket/1", "sagax://record/n/ticket/1", "sagax://record/nimbus_desk/ticket/..",
      "sagax://record/nimbus_desk/ticket/%2E%2E", "sagax://record/nimbus_desk/ticket/a%2Fb", "sagax://record/nimbus_desk/ticket/a b",
      "sagax://record/nimbus_desk/ticket/1?x=1", "sagax://record/nimbus_desk/ticket/1#x", "sagax://record/nimbus_desk/ticket/%E0%A4%A",
      `sagax://record/nimbus_desk/ticket/${"9".repeat(97)}`, "sagax://record/nimbus_desk/tick-et/1", "sagax://permission/1",
      "https://desk.example/ticket/1", "javascript:alert(1)", "", 42, null,
    ]) expect(parseRecordLink(href), String(href)).toBeNull();
    expect(looksLikeRecordLink("SAGAX://RECORD/x")).toBe(true);
    expect(looksLikeRecordLink("sagax://thread/x")).toBe(false);
  });
});

describe("records metadata on a tool result", () => {
  const meta = (groups: unknown) => ({ content: [{ type: "text", text: "{}" }], _meta: { "pulsatrix/records": groups } });

  it("reads the console's groups and drops what does not validate", () => {
    expect(parseRecordsMeta(meta([
      { product: "nimbus_desk", kind: "ticket", records: [{ id: "297048", label: "#297048" }, { id: "../x", label: "bad" }, { id: "297048", label: "twice" }], more: 0 },
      { product: "Nimbus", kind: "ticket", records: [{ id: "1", label: "#1" }] },
      { product: "nimbus_desk", kind: "company", records: [{ id: "19301", label: "Acme\nFabrication" }], more: 3, extra: true },
      { product: "nimbus_desk", kind: "site", records: [] },
    ]))).toEqual([
      { product: "nimbus_desk", kind: "ticket", records: [{ id: "297048", label: "#297048" }], more: 0 },
      { product: "nimbus_desk", kind: "company", records: [{ id: "19301", label: "Acme Fabrication" }], more: 3 },
    ]);
    expect(parseRecordsMeta({ content: [] })).toEqual([]);
    expect(parseRecordsMeta(null)).toEqual([]);
    const sixty = Array.from({ length: 60 }, (_, i) => ({ id: String(300000 + i), label: `#${300000 + i}` }));
    const [group] = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: sixty, more: 0 }]));
    expect(group!.records).toHaveLength(50);
    expect(group!.more).toBe(10);
  });

  it("gives one record its ready-made link, and several the form once", () => {
    const one = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: [{ id: "297048", label: "#297048" }], more: 0 }]));
    expect(recordsNote(one)).toBe("Mention it as [#297048](sagax://record/nimbus_desk/ticket/297048).");
    const several = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: [{ id: "1", label: "#1" }, { id: "2", label: "#2" }], more: 5 }]));
    expect(recordsNote(several)).toBe("Mention one of these as [#<id>](sagax://record/nimbus_desk/ticket/<id>).");
    expect(recordsNote(several, () => false)).toBeNull();
    const named = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "company", records: [{ id: "1", label: "Acme" }, { id: "2", label: "Globex" }], more: 0 }]));
    expect(recordsNote(named)).toBe("Mention one of these as [<label>](sagax://record/nimbus_desk/company/<id>).");
    expect(recordsNote([])).toBeNull();
  });

  it("stays one bounded line", () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({ product: "nimbus_desk", kind: `kind_${i}`, records: [{ id: `${"7".repeat(90)}${i}`, label: "L".repeat(80) }], more: 0 }));
    const note = recordsNote(groups)!;
    expect(new TextEncoder().encode(note).length).toBeLessThanOrEqual(RECORDS_NOTE_MAX_BYTES);
    expect(note).not.toContain("\n");
  });
});

describe("a plain number linked at the end of a turn", () => {
  const seen: SeenRecord[] = [
    { product: "nimbus_desk", kind: "ticket", id: "297048", label: "#297048" },
    { product: "nimbus_desk", kind: "ticket", id: "4821", label: "#4821" },
    { product: "nimbus_desk", kind: "ticket", id: "555123" },
    { product: "nimbus_desk", kind: "project", id: "555123" },
  ];
  const names = (_product: string, kind: string) => kind === "ticket" ? ["Ticket", "Billet", "Tickets", "Billets"] : ["Project"];
  const link = (text: string) => linkSeenRecords(text, seen, names);

  it("links a seen number, with or without #, keeping what the bot wrote", () => {
    expect(link("J'ai fermé le billet 297048.")).toBe("J'ai fermé le billet [297048](sagax://record/nimbus_desk/ticket/297048).");
    expect(link("Voir #297048, merci")).toBe("Voir [#297048](sagax://record/nimbus_desk/ticket/297048), merci");
  });

  it("never links an unseen number, one seen for two kinds, or a pattern", () => {
    expect(link("Le billet 297049 est ouvert.")).toBe("Le billet 297049 est ouvert.");
    expect(link("Le numéro 555123 est ambigu.")).toBe("Le numéro 555123 est ambigu.");
    expect(link("3297048 et 2970481 et 297048x et 1297048")).toBe("3297048 et 2970481 et 297048x et 1297048");
    expect(link("Montant 297048.50 $, heure 297048:10")).toBe("Montant 297048.50 $, heure 297048:10");
  });

  it("links a short id only after # or the kind's name", () => {
    expect(link("Il reste 4821 éléments.")).toBe("Il reste 4821 éléments.");
    expect(link("Voir #4821.")).toBe("Voir [#4821](sagax://record/nimbus_desk/ticket/4821).");
    expect(link("Le billet 4821 est fermé.")).toBe("Le billet [4821](sagax://record/nimbus_desk/ticket/4821) est fermé.");
    expect(link("Ticket 4821 closed.")).toBe("Ticket [4821](sagax://record/nimbus_desk/ticket/4821) closed.");
  });

  it("leaves code, math, links, images and addresses alone, and a second pass changes nothing", () => {
    const text = [
      "Inline `297048` and $297048$ and [see 297048](https://desk.example/297048) and ![297048](https://desk.example/i.png)",
      "https://desk.example/t/297048 <https://desk.example/297048>",
      "```",
      "ticket 297048",
      "```",
      "$$",
      "297048",
      "$$",
      "    297048 indented code",
      "Already [#297048](sagax://record/nimbus_desk/ticket/297048).",
    ].join("\n");
    expect(link(text)).toBe(text);
    const once = link("Billet 297048, puis #4821.");
    expect(link(once)).toBe(once);
  });

  it("links inside list items and table cells", () => {
    expect(link("- billet 297048\n| 297048 | ouvert |")).toBe(
      "- billet [297048](sagax://record/nimbus_desk/ticket/297048)\n| [297048](sagax://record/nimbus_desk/ticket/297048) | ouvert |",
    );
  });

  it("does nothing without seen records", () => {
    expect(linkSeenRecords("Billet 297048", [])).toBe("Billet 297048");
  });
});

describe("a record link the person's product list does not know", () => {
  it("becomes its text; a known one stays", () => {
    const known = (ref: { product: string; kind: string }) => ref.product === "nimbus_desk" && ref.kind === "ticket";
    const text = "[#1](sagax://record/nimbus_desk/ticket/1) [#2](sagax://record/nimbus_desk/alert/2) [#3](sagax://record/other_desk/ticket/3) [x](sagax://record/nimbus_desk/ticket/..) [ok](https://desk.example) `[#4](sagax://record/other_desk/ticket/4)`";
    expect(unlinkUnknownRecords(text, known)).toBe("[#1](sagax://record/nimbus_desk/ticket/1) #2 #3 x [ok](https://desk.example) `[#4](sagax://record/other_desk/ticket/4)`");
    expect(unlinkUnknownRecords("no links", () => false)).toBe("no links");
  });
});

describe("record card contract", () => {
  const card = {
    product: { id: "nimbus_desk", name: "Nimbus Desk", icon: { url: "https://console.example/icons/nimbus.svg?v=1" }, secret: "x" },
    kind: { id: "ticket", name: "Billet" },
    id: "297048", number: "#297048",
    title: "Imprimante de l'accueil hors ligne depuis lundi",
    state: { label: "En cours", tone: "open" },
    priority: { label: "Priorité 2", level: "high" },
    company: { name: "Acme Fabrication", ref: { product: "nimbus_desk", kind: "company", id: "19301" } },
    people: [
      { role: "contact", label: "Contact", name: "Ada", detail: "418 555-0142", internal_id: 7 },
      { role: "owner", label: "Responsable", name: "Marc" },
      { role: "x", label: "X", name: "C" }, { role: "y", label: "Y", name: "D" }, { role: "z", label: "Z", name: "E" },
    ],
    dates: { opened: "2026-11-13T09:12:00-05:00", updated: "2026-11-16T14:03:00-05:00", due: "not a date" },
    fields: [{ label: "Tableau", value: "Soutien" }, { label: "Heures", value: "3,5 / 8" }, { label: "Empty" }],
    description: { text: "Mot ".repeat(400), more: false },
    notes: {
      state: "ok",
      items: [
        { author: "Marc", at: "2026-11-16T14:03:00-05:00", internal: true, text: "Pilote réinstallé.", more: false },
        { author: "Ada", at: "2026-11-16T10:41:00-05:00", internal: false, text: "Toujours rien.", more: false },
        { text: "Third" }, { text: "Fourth" },
      ],
      total: 7, more: true,
    },
    open_url: "https://desk.example/open?id=297048",
    tz: "America/Toronto", as_of: "2026-11-16T14:32:10-05:00", cached: false,
    vendor_raw: { anything: true },
  };

  it("reads the console's card and drops what it does not know", () => {
    const parsed = parseRecordCard(card)!;
    expect(parsed).toMatchObject({
      product: { id: "nimbus_desk", name: "Nimbus Desk", icon: { url: "https://console.example/icons/nimbus.svg?v=1" } },
      kind: { id: "ticket", name: "Billet" }, id: "297048", number: "#297048",
      state: { label: "En cours", tone: "open" }, priority: { label: "Priorité 2", level: "high" },
      company: { name: "Acme Fabrication", ref: { product: "nimbus_desk", kind: "company", id: "19301" } },
      dates: { opened: "2026-11-13T09:12:00-05:00", updated: "2026-11-16T14:03:00-05:00" },
      fields: [{ label: "Tableau", value: "Soutien" }, { label: "Heures", value: "3,5 / 8" }],
      openUrl: "https://desk.example/open?id=297048", tz: "America/Toronto", asOf: "2026-11-16T14:32:10-05:00", cached: false,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/vendor_raw|secret|internal_id/);
    expect(parsed.people).toHaveLength(4);
    expect(parsed.people![0]).toEqual({ role: "contact", label: "Contact", name: "Ada", detail: "418 555-0142" });
    expect(parsed.dates!.due).toBeUndefined();
  });

  it("enforces the caps again", () => {
    const parsed = parseRecordCard({ ...card, title: "T".repeat(300) })!;
    expect(parsed.title.length).toBeLessThanOrEqual(200);
    expect(parsed.title.endsWith("…")).toBe(true);
    expect(parsed.description!.text.length).toBeLessThanOrEqual(600);
    expect(parsed.description!.more).toBe(true);
    expect(parsed.notes.items).toHaveLength(3);
    expect(parsed.notes.more).toBe(true);
    expect(parsed.notes.total).toBe(7);
  });

  it("refuses a card without its required parts, and an address that is not https", () => {
    expect(parseRecordCard({ ...card, title: "" })).toBeNull();
    expect(parseRecordCard({ ...card, id: "../1" })).toBeNull();
    expect(parseRecordCard({ ...card, kind: { id: "ticket" } })).toBeNull();
    expect(parseRecordCard(null)).toBeNull();
    expect(parseRecordCard({ ...card, open_url: "javascript:alert(1)" })!.openUrl).toBeUndefined();
    expect(parseRecordCard({ ...card, open_url: "http://desk.example/x" })!.openUrl).toBeUndefined();
    expect(parseRecordCard({ ...card, notes: undefined })!.notes).toEqual({ state: "none", items: [], more: false });
    expect(parseRecordCard({ ...card, state: { label: "Odd", tone: "purple" } })!.state).toEqual({ label: "Odd", tone: "open" });
  });

  it("reads the route's answer as a card or a state", () => {
    expect(parseRecordCardAnswer({ card })).toMatchObject({ card: { id: "297048" } });
    expect(parseRecordCardAnswer({ card: { id: "x" } })).toEqual({ state: "unavailable" });
    expect(parseRecordCardAnswer({ state: "busy", code: "vendor_busy", retryAfter: 12.2 })).toEqual({ state: "busy", code: "vendor_busy", retryAfter: 13 });
    expect(parseRecordCardAnswer({ state: "org_ask", rule: { id: "r1", text: "Demander avant de lire Nimbus Desk" } })).toEqual({ state: "org_ask", rule: { id: "r1", text: "Demander avant de lire Nimbus Desk" } });
    expect(parseRecordCardAnswer({ state: "weird" })).toEqual({ state: "unavailable" });
  });
});
