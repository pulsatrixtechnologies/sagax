// #4507: the record link, the tool result metadata, the bot's ready-made
// line, the end-of-turn linking of a plain number and the card contract.
// Every product, record and person here is invented.
import { describe, expect, it } from "vitest";

import {
  RECORDS_NOTE_MAX_BYTES, linkSeenRecords, looksLikeRecordLink, parseRecordCard, parseRecordCardAnswer, parseRecordLink,
  parseRecordsMeta, recordLink, recordMarkdown, recordTextOf, recordsNote, splitRecordText, unlinkUnknownRecords, withoutRecordLinks, withoutRecordLinksIn, type SeenRecord,
} from "./record-cards.ts";

const TICKET = { product: "nimbus_desk", kind: "ticket", id: "481516" };

describe("record link", () => {
  it("round-trips product, kind and id, each segment encoded", () => {
    expect(recordLink(TICKET)).toBe("sagax://record/nimbus_desk/ticket/481516");
    expect(parseRecordLink(recordLink(TICKET))).toEqual(TICKET);
    const odd = { product: "nimbus_desk", kind: "station", id: "ST:4.2-a_b" };
    expect(parseRecordLink(recordLink(odd))).toEqual(odd);
    expect(parseRecordLink("sagax://record/nimbus_desk/station/ST%3A4.2-a_b")).toEqual(odd);
    expect(recordMarkdown("#481516", TICKET)).toBe("[#481516](sagax://record/nimbus_desk/ticket/481516)");
    expect(recordMarkdown("Acme [main]\nsite", TICKET)).toBe("[Acme \\[main\\] site](sagax://record/nimbus_desk/ticket/481516)");
  });

  it("refuses every malformed link", () => {
    for (const href of [
      "sagax://record/nimbus_desk/ticket", "sagax://record/nimbus_desk/ticket/1/2", "sagax://record//ticket/1",
      "sagax://record/Nimbus/ticket/1", "sagax://record/n/ticket/1", "sagax://record/nimbus_desk/ticket/..",
      "sagax://record/nimbus_desk/ticket/%2E%2E", "sagax://record/nimbus_desk/ticket/a%2Fb", "sagax://record/nimbus_desk/ticket/a b",
      "sagax://record/nimbus_desk/ticket/1?x=1", "sagax://record/nimbus_desk/ticket/1#x", "sagax://record/nimbus_desk/ticket/%E0%A4%A",
      `sagax://record/nimbus_desk/ticket/${"9".repeat(129)}`, "sagax://record/nimbus_desk/tick-et/1", "sagax://permission/1",
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
      { product: "nimbus_desk", kind: "ticket", records: [{ id: "481516", label: "#481516" }, { id: "../x", label: "bad" }, { id: "481516", label: "twice" }], more: 0 },
      { product: "Nimbus", kind: "ticket", records: [{ id: "1", label: "#1" }] },
      { product: "nimbus_desk", kind: "company", records: [{ id: "7310", label: "Acme\nFabrication" }], more: 3, extra: true },
      { product: "nimbus_desk", kind: "site", records: [] },
    ]))).toEqual([
      { product: "nimbus_desk", kind: "ticket", records: [{ id: "481516", label: "#481516" }], more: 0 },
      { product: "nimbus_desk", kind: "company", records: [{ id: "7310", label: "Acme Fabrication" }], more: 3 },
    ]);
    expect(parseRecordsMeta({ content: [] })).toEqual([]);
    expect(parseRecordsMeta(null)).toEqual([]);
    const sixty = Array.from({ length: 60 }, (_, i) => ({ id: String(600000 + i), label: `#${600000 + i}` }));
    const [group] = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: sixty, more: 0 }]));
    expect(group!.records).toHaveLength(50);
    expect(group!.more).toBe(10);
  });

  it("gives one record its ready-made link, and several the form once", () => {
    const one = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: [{ id: "481516", label: "#481516" }], more: 0 }]));
    expect(recordsNote(one)).toBe("In your chat reply only (never in a text, mail or message you send), mention it as [#481516](sagax://record/nimbus_desk/ticket/481516).");
    const several = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "ticket", records: [{ id: "1", label: "#1" }, { id: "2", label: "#2" }], more: 5 }]));
    expect(recordsNote(several)).toBe("In your chat reply only (never in a text, mail or message you send), mention one of these as [#<id>](sagax://record/nimbus_desk/ticket/<id>).");
    expect(recordsNote(several, () => false)).toBeNull();
    const named = parseRecordsMeta(meta([{ product: "nimbus_desk", kind: "company", records: [{ id: "1", label: "Acme" }, { id: "2", label: "Globex" }], more: 0 }]));
    expect(recordsNote(named)).toBe("In your chat reply only (never in a text, mail or message you send), mention one of these as [<label>](sagax://record/nimbus_desk/company/<id>).");
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
    { product: "nimbus_desk", kind: "ticket", id: "481516", label: "#481516" },
    { product: "nimbus_desk", kind: "ticket", id: "4821", label: "#4821" },
    { product: "nimbus_desk", kind: "ticket", id: "555123" },
    { product: "nimbus_desk", kind: "project", id: "555123" },
  ];
  const names = (_product: string, kind: string) => kind === "ticket" ? ["Ticket", "Billet", "Tickets", "Billets"] : ["Project"];
  const link = (text: string) => linkSeenRecords(text, seen, names);

  it("links a seen number, with or without #, keeping what the bot wrote", () => {
    expect(link("J'ai fermé le billet 481516.")).toBe("J'ai fermé le billet [481516](sagax://record/nimbus_desk/ticket/481516).");
    expect(link("Voir #481516, merci")).toBe("Voir [#481516](sagax://record/nimbus_desk/ticket/481516), merci");
  });

  it("never links an unseen number, one seen for two kinds, or a pattern", () => {
    expect(link("Le billet 481517 est ouvert.")).toBe("Le billet 481517 est ouvert.");
    expect(link("Le numéro 555123 est ambigu.")).toBe("Le numéro 555123 est ambigu.");
    expect(link("3481516 et 4815161 et 481516x et 1481516")).toBe("3481516 et 4815161 et 481516x et 1481516");
    expect(link("Montant 481516.50 $, heure 481516:10")).toBe("Montant 481516.50 $, heure 481516:10");
  });

  it("links a short id only after # or the kind's name", () => {
    expect(link("Il reste 4821 éléments.")).toBe("Il reste 4821 éléments.");
    expect(link("Voir #4821.")).toBe("Voir [#4821](sagax://record/nimbus_desk/ticket/4821).");
    expect(link("Le billet 4821 est fermé.")).toBe("Le billet [4821](sagax://record/nimbus_desk/ticket/4821) est fermé.");
    expect(link("Ticket 4821 closed.")).toBe("Ticket [4821](sagax://record/nimbus_desk/ticket/4821) closed.");
  });

  it("leaves code, math, links, images and addresses alone, and a second pass changes nothing", () => {
    const text = [
      "Inline `481516` and $481516$ and [see 481516](https://desk.example/481516) and ![481516](https://desk.example/i.png)",
      "https://desk.example/t/481516 <https://desk.example/481516>",
      "```",
      "ticket 481516",
      "```",
      "$$",
      "481516",
      "$$",
      "    481516 indented code",
      "Already [#481516](sagax://record/nimbus_desk/ticket/481516).",
    ].join("\n");
    expect(link(text)).toBe(text);
    const once = link("Billet 481516, puis #4821.");
    expect(link(once)).toBe(once);
  });

  it("never links a number inside a link that has a title, or one followed by -digits", () => {
    const titled = `See [the ticket](https://desk.example/t "ticket 481516") and ![x](https://desk.example/i.png 'n 481516')`;
    expect(link(titled)).toBe(titled);
    expect(link("Lot 481516-1 et 481516-22")).toBe("Lot 481516-1 et 481516-22");
    expect(link("Billet 481516 - fermé")).toBe("Billet [481516](sagax://record/nimbus_desk/ticket/481516) - fermé");
  });

  it("links inside list items and table cells", () => {
    expect(link("- billet 481516\n| 481516 | ouvert |")).toBe(
      "- billet [481516](sagax://record/nimbus_desk/ticket/481516)\n| [481516](sagax://record/nimbus_desk/ticket/481516) | ouvert |",
    );
  });

  it("does nothing without seen records", () => {
    expect(linkSeenRecords("Billet 481516", [])).toBe("Billet 481516");
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

describe("nothing outside the chat carries a record address", () => {
  const linked = "Billet [#481516](sagax://record/nimbus_desk/ticket/481516), voir <sagax://record/nimbus_desk/ticket/2> et sagax://record/nimbus_desk/ticket/3 ou [doc](https://desk.example/a \"t\").";

  it("reduces every record link to its label and drops a bare record address", () => {
    const out = withoutRecordLinks(linked);
    expect(out).toBe("Billet #481516, voir  et  ou [doc](https://desk.example/a \"t\").");
    expect(out).not.toMatch(/sagax:/i);
    expect(withoutRecordLinks("`[#4](sagax://record/nimbus_desk/ticket/4)`")).not.toMatch(/sagax:/i);
    expect(withoutRecordLinks("Rien")).toBe("Rien");
    expect(withoutRecordLinksIn({ to: ["+15550100"], body: linked, n: 2, nested: [{ text: linked }] })).toEqual({
      to: ["+15550100"], body: withoutRecordLinks(linked), n: 2, nested: [{ text: withoutRecordLinks(linked) }],
    });
  });

  it("hands back the same arguments, uncopied, when no record address is in them", () => {
    const args = { to: ["+15550100"], body: "Bonjour", nested: [{ text: "https://desk.example/a" }], n: 3 };
    expect(withoutRecordLinksIn(args)).toBe(args);
    const mixed = { keep: { text: "Bonjour" }, change: "Voir [#1](sagax://record/nimbus_desk/ticket/1)" };
    const out = withoutRecordLinksIn(mixed);
    expect(out).not.toBe(mixed);
    expect(out.keep).toBe(mixed.keep);
    expect(out.change).toBe("Voir #1");
  });

  it("stores a bot's words as plain text with the links beside them, for a client that draws them", () => {
    const stored = splitRecordText({ role: "bot", kind: "text", text: linked });
    expect(stored.text).toBe(withoutRecordLinks(linked));
    expect(stored.recordText).toBe(linked);
    // a client that does not know record links reads text: no address
    expect(stored.text).not.toMatch(/sagax:/i);
    // a client that draws them reads the linked words
    expect(recordTextOf(stored)).toBe(linked);
    // words changed since: the linked copy no longer applies
    expect(recordTextOf({ ...stored, text: "Autre chose" })).toBe("Autre chose");
    // the person's own words and a message without a link stay as they are
    const typed = { role: "user", text: linked };
    expect(splitRecordText(typed)).toBe(typed);
    const plain = { role: "bot", text: "Billet 481516" };
    expect(splitRecordText(plain)).toBe(plain);
  });
});

describe("record card contract", () => {
  const card = {
    product: { id: "nimbus_desk", name: "Nimbus Desk", icon: { url: "https://console.example/icons/nimbus.svg?v=1" }, secret: "x" },
    kind: { id: "ticket", name: "Billet" },
    id: "481516", number: "#481516",
    title: "Imprimante de l'accueil hors ligne depuis lundi",
    state: { label: "En cours", tone: "open" },
    priority: { label: "Priorité 2", level: "high" },
    company: { name: "Acme Fabrication", ref: { product: "nimbus_desk", kind: "company", id: "7310" } },
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
    open_url: "https://desk.example/open?id=481516",
    tz: "America/Toronto", as_of: "2026-11-16T14:32:10-05:00", cached: false,
    vendor_raw: { anything: true },
  };

  it("reads the console's card and drops what it does not know", () => {
    const parsed = parseRecordCard(card)!;
    expect(parsed).toMatchObject({
      product: { id: "nimbus_desk", name: "Nimbus Desk", icon: { url: "https://console.example/icons/nimbus.svg?v=1" } },
      kind: { id: "ticket", name: "Billet" }, id: "481516", number: "#481516",
      state: { label: "En cours", tone: "open" }, priority: { label: "Priorité 2", level: "high" },
      company: { name: "Acme Fabrication", ref: { product: "nimbus_desk", kind: "company", id: "7310" } },
      dates: { opened: "2026-11-13T09:12:00-05:00", updated: "2026-11-16T14:03:00-05:00" },
      fields: [{ label: "Tableau", value: "Soutien" }, { label: "Heures", value: "3,5 / 8" }],
      openUrl: "https://desk.example/open?id=481516", tz: "America/Toronto", asOf: "2026-11-16T14:32:10-05:00", cached: false,
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
    expect(parseRecordCardAnswer({ card })).toMatchObject({ card: { id: "481516" } });
    expect(parseRecordCardAnswer({ card: { id: "x" } })).toEqual({ state: "unavailable" });
    expect(parseRecordCardAnswer({ state: "busy", code: "vendor_busy", retryAfter: 12.2 })).toEqual({ state: "busy", code: "vendor_busy", retryAfter: 13 });
    expect(parseRecordCardAnswer({ state: "org_refused", rule: { id: "r1", text: "Ne pas lire Nimbus Desk" } })).toEqual({ state: "org_refused", rule: { id: "r1", text: "Ne pas lire Nimbus Desk" } });
    // there is no "ask" state any more: an answer that names one reads as unavailable
    expect(parseRecordCardAnswer({ state: "org_ask" })).toEqual({ state: "unavailable" });
    expect(parseRecordCardAnswer({ state: "weird" })).toEqual({ state: "unavailable" });
  });
});

describe("a card of any kind (#4572)", () => {
  const base = { product: { id: "nimbus_desk", name: "Nimbus Desk" }, kind: { id: "invoice", name: "Facture" }, id: "5150", number: "INV-1042", title: "Example Org" };
  const parse = (extra: Record<string, unknown>) => parseRecordCard({ ...base, ...extra })!;
  const REF = { product: "nimbus_desk", kind: "agreement", id: "412" };

  it("keeps the typed parts of a field, and its ready value", () => {
    const card = parse({ fields: [
      { label: "Total", value: "1 234,50 $", type: "money", amount: "1234.5", currency: "CAD" },
      { label: "Date", value: "2026-10-06", type: "date", at: "2026-10-06", day: true },
      { label: "Vu", value: "x", type: "ago", at: "2026-11-17T14:00:00-05:00" },
      { label: "Marge", value: "40 %", type: "percent", share: 40 },
      { label: "Entente", value: "Managed services", type: "ref", ref: REF },
      { label: "Qui", value: "Ada", type: "person", role: "owner", detail: "poste 4", ref: REF },
      { label: "Statut", value: "En retard", type: "state", tone: "alert" },
      { label: "Durée", value: "3,5 h", type: "duration" },
    ] });
    expect(card.fields).toEqual([
      { label: "Total", value: "1 234,50 $", type: "money", amount: "1234.5", currency: "CAD" },
      { label: "Date", value: "2026-10-06", type: "date", at: "2026-10-06", day: true },
      { label: "Vu", value: "x", type: "ago", at: "2026-11-17T14:00:00-05:00" },
      { label: "Marge", value: "40 %", type: "percent", share: 40 },
      { label: "Entente", value: "Managed services", type: "ref", ref: REF },
      { label: "Qui", value: "Ada", type: "person", detail: "poste 4", role: "owner", ref: REF },
      { label: "Statut", value: "En retard", type: "state", tone: "alert" },
      { label: "Durée", value: "3,5 h", type: "duration" },
    ]);
  });

  it("reads an unknown type as text, and a bad typed part as a flat row that stays", () => {
    const card = parse({ fields: [
      { label: "A", value: "tel quel", type: "hologram", extra: 1 },
      { label: "B", value: "12 $", type: "money", amount: "12 dollars" },
      { label: "C", value: "x", type: "date", at: "someday" },
      { label: "D", value: "50", type: "percent", share: 140 },
      { label: "E", value: "Managed services", type: "ref", ref: { kind: "agreement", id: "412" } },
      { label: "F", value: "2026-10-06T10:00:00Z", type: "date", at: "2026-10-06T10:00:00Z", day: true },
    ] });
    expect(card.fields).toEqual([
      { label: "A", value: "tel quel" }, { label: "B", value: "12 $" }, { label: "C", value: "x" }, { label: "D", value: "50" },
      { label: "E", value: "Managed services" }, { label: "F", value: "2026-10-06T10:00:00Z", type: "date", at: "2026-10-06T10:00:00Z" },
    ]);
  });

  it("caps at ten fields, two chips, six lines, with the activity's title", () => {
    const card = parse({
      fields: Array.from({ length: 14 }, (_, index) => ({ label: `F${index}`, value: `V${index}` })),
      chips: [{ label: "a" }, { label: "b", tone: "waiting" }, { label: "c" }],
      lines: { state: "ok", title: "Lignes", total: 9, items: Array.from({ length: 8 }, (_, index) => ({ label: `L${index}`, value: "1 $", ref: REF })) },
      notes: { state: "none", title: "Chronologie", items: [] },
    });
    expect(card.fields).toHaveLength(10);
    expect(card.chips).toEqual([{ label: "a", tone: "open" }, { label: "b", tone: "waiting" }]);
    expect(card.lines).toMatchObject({ state: "ok", title: "Lignes", total: 9, more: true });
    expect(card.lines!.items).toHaveLength(6);
    expect(card.notes.title).toBe("Chronologie");
  });

  it("reads a person's ref, and a record id of up to 128 characters", () => {
    expect(parse({ people: [{ role: "contact", label: "Contact", name: "Sam", ref: REF }] }).people![0]!.ref).toEqual(REF);
    expect(parseRecordLink(`sagax://record/nimbus_desk/invoice/${"9".repeat(128)}`)).not.toBeNull();
    expect(parseRecordLink(`sagax://record/nimbus_desk/invoice/${"9".repeat(129)}`)).toBeNull();
  });
});

