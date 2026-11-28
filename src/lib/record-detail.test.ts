// The board's and the invoice's sections of the record detail route
// (M-20261127-140): every row read tolerantly (a row without its parts is
// dropped, an unknown value is left out), and a console that serves no detail
// for a kind (`kind_unknown`) reads as no detail route, so its card is shown.
import { describe, expect, it } from "vitest";
import { ApiError } from "@/state/store";
import { detailRouteMissing, parseDetailCounts, parseDetailPage } from "./record-detail";
import { parseRecordAction } from "../../shared/record-actions";

const ref = { product: "nimbus_desk", kind: "ticket", id: "300124" };
const parse = (tab: Parameters<typeof parseDetailPage>[0], raw: unknown) => parseDetailPage(tab, raw, () => () => {}).page;

describe("a board's tickets", () => {
  it("reads a row, its next scheduling and who is planned, and drops a row without its number", () => {
    const page = parse("tickets", { lines: [
      { id: "300124", ref, number: "#300124", summary: "Partnership", company: "Acme", company_ref: { product: "nimbus_desk", kind: "company", id: "7310" }, status: "Waiting", status_tone: "waiting",
        priority: "3: Medium", priority_level: "normal", type: "Admin", owner: "Noor Haddad", mine: true, opened: "2026-10-23T13:50:00-04:00",
        next: { state: "planned", start: "2026-12-14T14:30:00-05:00", people: [{ name: "Noor Haddad", seen: true }, { name: "Bruno Tremblay", seen: false }, { name: "" }] } },
      { id: "1", summary: "No number" },
      { id: "2", number: "#2", summary: "Odd", status_tone: "bright", priority_level: "extreme", next: { state: "later" } },
    ] });
    expect(page.tab).toBe("tickets");
    const [row, odd] = page.lines as unknown as Array<Record<string, unknown>>;
    expect(page.lines).toHaveLength(2);
    expect(row).toMatchObject({ id: "300124", ref, number: "#300124", statusTone: "waiting", level: "normal", mine: true, opened: "2026-10-23T13:50:00-04:00" });
    expect(row!.next).toEqual({ state: "planned", at: "2026-12-14T14:30:00-05:00", people: [{ name: "Noor Haddad", seen: true }, { name: "Bruno Tremblay", seen: false }] });
    expect(odd).not.toHaveProperty("statusTone");
    expect(odd).not.toHaveProperty("level");
    expect(odd).not.toHaveProperty("next");
  });

  it("reads the weeks and the figures only the product knows", () => {
    const page = parse("stats", { lines: [{ week: "2026-11-16", opened: 15, closed: 16 }, { week: "not a day", opened: 1 }, { week: "2026-11-23", opened: -1, closed: 12 }], closed_this_week: 12, first_response: { text: "38 min", detail: "Target met 92%" } });
    expect(page.lines).toEqual([{ week: "2026-11-16", opened: 15, closed: 16 }, { week: "2026-11-23", closed: 12 }]);
    expect(page.stats).toEqual({ closedThisWeek: 12, firstResponse: { text: "38 min", detail: "Target met 92%" } });
    expect(parse("stats", { lines: [] }).stats).toBeUndefined();
  });
});

describe("an invoice's sections", () => {
  it("reads the document as the product wrote it, never computing an amount", () => {
    const page = parse("document", {
      document: {
        issued: "2026-10-01", due: "2026-10-31", terms: "Net 30", subtotal: "$1,236.50", total: "$1,421.67", paid: "$0.00", balance: "$1,421.67", owed: true, pdf: true,
        billed_to: { name: "Acme", attention: "Ada", address: ["1 Main", 4, "City"] },
        links: [{ label: "#300124", ref }, { label: "" }],
        taxes: [{ label: "GST 5%", amount: "$61.83" }, { label: "QST", amount: "" }],
        steps: [{ step: "issued", at: "2026-10-01", done: true }, { step: "paid", at: "2026-10-02" }, { step: "next_reminder", at: "2026-12-01T09:00:00-05:00" }],
        client: { balance: "$4,820.15", pays_in: "38 days" },
      },
      lines: [{ label: "Support", detail: "6.5 h", amount: "$877.50" }, { amount: "$1" }],
    });
    expect(page.lines).toEqual([{ label: "Support", detail: "6.5 h", amount: "$877.50" }]);
    expect(page.document).toEqual({
      issued: "2026-10-01", due: "2026-10-31", terms: "Net 30", subtotal: "$1,236.50", total: "$1,421.67", paid: "$0.00", balance: "$1,421.67", owed: true, pdf: true,
      billedTo: { name: "Acme", attention: "Ada", address: ["1 Main", "4", "City"] },
      links: [{ label: "#300124", ref }],
      taxes: [{ label: "GST 5%", amount: "$61.83" }],
      steps: [{ step: "issued", at: "2026-10-01", done: true }, { step: "next_reminder", at: "2026-12-01T09:00:00-05:00" }],
      client: { balance: "$4,820.15", paysIn: "38 days" },
    });
  });

  it("reads the payments and the history, a calendar day kept as a day", () => {
    expect(parse("payments", { lines: [{ id: "9", date: "2026-11-27", type: "Transfer", amount: "$200.00", by: "Noor" }, { date: "Nov 2", amount: "$5" }, { type: "No amount" }] }).lines)
      .toEqual([{ id: "9", day: "2026-11-27", date: "", type: "Transfer", amount: "$200.00", by: "Noor" }, { date: "Nov 2", type: "", amount: "$5" }]);
    expect(parse("history", { lines: [{ at: "2026-11-15T08:00:00-05:00", text: "Reminder sent", tone: "done" }, { date: "Oct 1", text: "Created", tone: "loud" }, { at: "2026-11-15" }] }).lines)
      .toEqual([{ at: "2026-11-15T08:00:00-05:00", date: "", text: "Reminder sent", tone: "done" }, { date: "Oct 1", text: "Created" }]);
  });

  it("counts the payments and the history beside the ticket's sections", () => {
    expect(parseDetailCounts({ counts: { payments: 0, history: 3, tickets: 27, nonsense: 4 }, actions: ["payment.add", "invoice.burn"] })).toMatchObject({ counts: { payments: 0, history: 3, tickets: 27 }, actions: new Set(["payment.add"]) });
  });

  it("checks a payment before it is sent: an amount and a day, its own fields only", () => {
    expect(parseRecordAction({ action: "payment.add", set: { amount: "200", date: "2026-11-27", reference: "TX-1" } })).toEqual({ action: "payment.add", set: { amount: 200, date: "2026-11-27", reference: "TX-1" } });
    expect(parseRecordAction({ action: "payment.add", set: { amount: "200" } })).toBeNull();
    expect(parseRecordAction({ action: "payment.add", set: { amount: "0", date: "2026-11-27" } })).toBeNull();
    expect(parseRecordAction({ action: "payment.add", id: "4", set: { amount: "1", date: "2026-11-27" } })).toBeNull();
    expect(parseRecordAction({ action: "payment.add", set: { amount: "1", date: "2026-11-27", billing: "B" } })).toBeNull();
  });
});

describe("a console that serves no detail for a kind", () => {
  it("reads kind_unknown as no detail route, and any other code as that section's failure", () => {
    expect(detailRouteMissing(new ApiError("", 404, { state: "unavailable", code: "kind_unknown" }))).toBe(true);
    expect(detailRouteMissing(new ApiError("", 404, { state: "unavailable" }))).toBe(true);
    expect(detailRouteMissing(new ApiError("", 404, { state: "unavailable", code: "record_unknown" }))).toBe(false);
    expect(detailRouteMissing(new ApiError("", 500, { code: "kind_unknown" }))).toBe(false);
  });
});
