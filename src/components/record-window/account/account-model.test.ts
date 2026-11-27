// A company's and a contact's window model (M-20261127-101, M-20261127-143):
// the tabs before and after the console's counts, the Profile from the sheet
// or from the card alone, the links its round buttons open, and the sections
// the console sends read tolerantly (src/lib/record-detail.ts).
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { accountCompanyCard, accountConsole, accountContactCard } from "@/lib/record-account-fixtures";
import { parseDetailPage, detailKindMissing, sheetOf } from "@/lib/record-detail";
import { ApiError } from "@/state/store";
import type { RecordDetail } from "@/components/useRecordDetail";
import { parseRecordCard } from "../../../../shared/record-cards";
import { accountTabs, cardTicketRows, mailAddress, phoneAddress, profileView, sinceWords, webAddress } from "./account-model";

const NOW = Date.parse("2026-11-27T13:50:00-05:00");
setLocale("en");
const company = parseRecordCard(accountCompanyCard(NOW, "en"))!;
const contact = parseRecordCard(accountContactCard(NOW, "en"))!;
const detail = (counts: RecordDetail["counts"], actions: string[] | null = null, known = true) => ({
  counts, known, countError: "", can: (action: string) => actions === null || actions.includes(action),
  section: () => ({ loading: true, error: "" }), want: () => {}, write: async () => {}, choices: async () => [],
}) as unknown as RecordDetail;
const shown = (tabs: ReturnType<typeof accountTabs>) => tabs.map((tab) => `${tab.id}${tab.count ?? ""}${tab.canAdd ? "+" : ""}`);

describe("the tabs", () => {
  it("are the Profile and the card's open tickets until the console's counts came, or when it has none for the kind", () => {
    expect(shown(accountTabs("company", company, undefined))).toEqual(["sheet", "tickets3"]);
    expect(shown(accountTabs("company", company, detail({}, null, false)))).toEqual(["sheet", "tickets3"]);
    expect(shown(accountTabs("contact", contact, undefined))).toEqual(["sheet", "tickets2"]);
  });

  it("carry the console's counts and a + only where the console takes it; Finance and Data hold no number", () => {
    const tabs = accountTabs("company", company, detail({ notes: 0, contacts: 5, projects: 0, finance: 0 }, ["note.add", "contact.add"]));
    expect(shown(tabs)).toEqual(["sheet", "notes0+", "contacts5+", "tickets3", "activities", "projects0", "opportunities", "agreements", "configurations", "attachments", "sites", "finance0", "data"]);
    // a contact links a configuration; a company's fleet is the product's
    expect(accountTabs("contact", contact, detail({}, ["configuration.add"])).find((tab) => tab.id === "configurations")!.canAdd).toBe(true);
    expect(accountTabs("company", company, detail({}, ["configuration.add"])).find((tab) => tab.id === "configurations")!.canAdd).toBeUndefined();
  });
});

describe("the Profile", () => {
  it("is the card's own facts when the console sends no sheet: its phone, its contact, its open tickets, nothing invented", () => {
    const view = profileView("company", company, undefined, "en");
    expect(view.context).toEqual([]);
    expect(view.reach).toEqual([{ kind: "phone", value: "418 555-0100" }]);
    expect(view.people).toEqual([{ name: "Ada Lindqvist", ref: { product: "nimbus_desk", kind: "contact", id: "2204" }, role: "Main contact" }]);
    expect(view.tiles).toEqual([{ tab: "tickets", label: "Open tickets", value: "3" }]);
    expect(view.upcoming).toEqual([]);
    expect(view.facts.map((field) => field.label)).toEqual(["Account manager", "Identifier", "Type", "City", "Website", "Open tickets", "Active agreements", "Contacts"]);
    // a contact's two phones are two rows, its email a row too
    expect(profileView("contact", contact, undefined, "en").reach).toEqual([
      { kind: "email", value: "ada@acme.example" }, { kind: "phone", value: "418 555-0142" }, { kind: "phone", value: "418 555-0177" },
    ]);
  });

  it("is the console's sheet when it sends one, said once", () => {
    const raw = accountConsole("en", NOW).section("company", "sheet").sheet as Record<string, unknown>;
    const view = profileView("company", company, sheetOf(raw), "en");
    expect(view.context.at(-1)).toBe("customer since March 2019");
    expect(view.facts).toEqual([]);
    expect(view.people.map((person) => person.role)).toEqual(["Main", "Approver", "Technical"]);
    expect(sinceWords("2026-01-01", "en")).toBe("customer since January 2026");
  });

  it("makes the card's open tickets rows, a number only from an id people read", () => {
    expect(cardTicketRows(company)!.rows.map((row) => row.number)).toEqual(["#300187", "#300124", "#299950"]);
    const guid = parseRecordCard({ ...accountCompanyCard(NOW, "en"), lines: { state: "ok", items: [{ label: "x", ref: { product: "nimbus_desk", kind: "ticket", id: "6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34" } }], more: false } })!;
    expect(cardTicketRows(guid)!.rows[0]!.number).toBe("");
    expect(cardTicketRows(parseRecordCard({ ...accountCompanyCard(NOW, "en"), lines: undefined })!)).toBeUndefined();
  });
});

describe("the head's links", () => {
  it("call a number, write to an address and open a site, never anything else", () => {
    expect(phoneAddress("+1 (418) 555-0100")).toBe("tel:+14185550100");
    expect(phoneAddress("418 555-0100 poste 12")).toBe("tel:4185550100;ext=12");
    expect(phoneAddress("12")).toBeUndefined();
    expect(mailAddress("ada@acme.example")).toBe("mailto:ada@acme.example");
    for (const value of ["ada@acme", "a b@acme.example", "ada@acme.example?cc=x@y.z"]) expect(mailAddress(value), value).toBeUndefined();
    expect(webAddress("acme.example")).toBe("https://acme.example/");
    expect(webAddress("http://acme.example/a")).toBe("http://acme.example/a");
    for (const value of ["javascript:alert(1)", "localhost", "https://user:pw@acme.example", "acme example"]) expect(webAddress(value), value).toBeUndefined();
  });
});

describe("the sections the console sends", () => {
  const download = () => () => {};
  it("read a sheet tolerantly: an unknown kind is dropped, a feed of another kind is `other`, a share out of bounds is none", () => {
    const sheet = sheetOf({
      context: ["Managed", 3, ""], since: "2019-13-40",
      reach: [{ kind: "phone", value: "418 555-0100" }, { kind: "pager", value: "x" }, { kind: "email", value: "" }],
      tiles: [{ tab: "Tickets!", label: "Open", value: "3", share: 140, tone: "alert" }, { label: "", value: "1" }],
      feed: [{ kind: "mystery", text: "moved" }, { kind: "note", text: "" }],
      people: [{ name: "Ada", ref: { product: "nimbus_desk", kind: "contact", id: "../x" } }],
    });
    expect(sheet.context).toEqual(["Managed", "3"]);
    expect(sheet.since).toBeUndefined();
    expect(sheet.reach).toEqual([{ kind: "phone", value: "418 555-0100" }]);
    expect(sheet.tiles).toEqual([{ label: "Open", value: "3", tone: "alert" }]);
    expect(sheet.feed).toEqual([{ kind: "other", date: "", text: "moved" }]);
    expect(sheet.people).toEqual([{ name: "Ada" }]);
  });

  it("read the tickets with their next entry, the stats and the finance, every page's `next` kept", () => {
    const console_ = accountConsole("en", NOW);
    const tickets = parseDetailPage("tickets", { ...console_.section("company", "tickets"), next: 2 }, download);
    expect(tickets.next).toBe(2);
    const row = tickets.page.lines.find((one) => "number" in one && one.number === "#300124") as { next?: { who: string[] }; level?: string };
    expect(row.next!.who).toEqual(["Noor Haddad", "Bruno Tremblay"]);
    expect(row.level).toBe("normal");
    const stats = parseDetailPage("stats", console_.section("company", "stats"), download).page.stats!;
    expect(stats.hours).toHaveLength(6);
    expect(stats.billable.map((part) => part.billing)).toEqual(["B", "NC", "DNB"]);
    const finance = parseDetailPage("finance", console_.section("company", "finance"), download).page;
    expect(finance.finance!.aging.map((part) => part.tone)).toEqual(["done", "waiting", "alert", "open"]);
    expect(finance.lines).toHaveLength(3);
  });

  it("say a console with no detail for the kind is a route that is not there for it, never a section's failure", () => {
    expect(detailKindMissing(new ApiError("not found", 404, { state: "unavailable", code: "kind_unknown" }))).toBe(true);
    expect(detailKindMissing(new ApiError("not found", 404, { state: "unavailable", code: "record_unknown" }))).toBe(false);
  });
});
