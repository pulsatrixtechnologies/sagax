import { describe, expect, it } from "vitest";

import {
  cwActionAnchors,
  cwActionInstruction,
  cwActionMatchesWrite,
  cwActionSummary,
  cwActionWrite,
  cwRecordLink,
  cwSite,
  cwToolWords,
  cwWidgetFromToolCall,
  filterSortTickets,
  isCwTool,
  isCwWriteTool,
  mergeCwWidgets,
  parseCwAction,
  parseCwWidgetText,
  safeCwLink,
  ticketFacet,
  type CwTicket,
  type CwWidget,
} from "./index.ts";
import {
  FIXTURE_AGREEMENTS,
  FIXTURE_COMPANIES,
  FIXTURE_SCHEDULE,
  FIXTURE_TICKETS,
  FIXTURE_TICKET_NOTES,
  FIXTURE_TIME,
  fixtureMcpContent,
  fixtureQueryResult,
} from "./fixtures.ts";

const ticketsOf = (widget: CwWidget | null): CwTicket[] => {
  expect(widget?.family).toBe("ticket");
  return (widget as Extract<CwWidget, { family: "ticket" }>).records;
};

describe("ConnectWise tool names", () => {
  it("recognises every spelling the engines use", () => {
    for (const name of [
      "cw_psa_query",
      "cw_psa_query",
      "mcp__perspicax_pulsatrix_flow_owner__cw_psa_query",
      "mcp__claude_ai_Connectwise_PSA__cw_psa_query",
      "cw_psa_schedule_query",
      "mcp__connectwise__get_ticket",
    ]) expect(isCwTool(name), name).toBe(true);
    for (const name of ["Bash", "mcp__agents__list_bots", "cw_rmm__query", "mcp__github__get_issue", "screenconnect__list"]) {
      expect(isCwTool(name), name).toBe(false);
    }
    expect(cwToolWords("mcp__perspicax_x__cw_psa_schedule_query")).toEqual(["cw", "psa", "schedule", "query"]);
  });

  it("tells reads from writes, and counts an unclear name as a write", () => {
    expect(isCwWriteTool("cw_psa_query")).toBe(false);
    expect(isCwWriteTool("mcp__p__cw_psa_get_ticket")).toBe(false);
    expect(isCwWriteTool("cw_psa_write")).toBe(true);
    expect(isCwWriteTool("cw_psa_action")).toBe(true);
    expect(isCwWriteTool("cw_psa_tickets_update")).toBe(true);
    expect(isCwWriteTool("cw_psa_log_time")).toBe(true);
    expect(isCwWriteTool("cw_psa_ticket")).toBe(true);
    expect(isCwWriteTool("mcp__github__create_issue")).toBe(false);
  });
});

describe("deep links", () => {
  it("opens the record on the web host, never the API host", () => {
    const site = cwSite("api-na.myconnectwise.net", "pulsatrix");
    expect(site).toEqual({ host: "na.myconnectwise.net", company: "pulsatrix" });
    expect(cwRecordLink(site, "ServiceFv", 48213)).toBe(
      "https://na.myconnectwise.net/v4_6_release/services/system_io/router/openrecord.rails?recordType=ServiceFv&recid=48213&companyName=pulsatrix",
    );
  });

  it("refuses a host or link it would not build", () => {
    expect(cwSite("javascript:alert(1)")).toBeUndefined();
    expect(cwSite("na.myconnectwise.net/../x", "a b")).toEqual({ host: "na.myconnectwise.net" });
    expect(cwRecordLink(undefined, "ServiceFv", 1)).toBeUndefined();
    expect(safeCwLink("http://na.myconnectwise.net/v4_6_release/services/system_io/router/openrecord.rails")).toBeUndefined();
    expect(safeCwLink("https://evil.example/phish")).toBeUndefined();
    expect(safeCwLink("javascript:alert(1)")).toBeUndefined();
  });
});

describe("cwWidgetFromToolCall: tickets", () => {
  const input = JSON.stringify({ resource: "service/tickets", conditions: "closedFlag=false", pageSize: 25 });

  it("maps a ticket query to a list, with the site read from _info", () => {
    const widget = cwWidgetFromToolCall("mcp__perspicax_x__cw_psa_query", input, fixtureQueryResult(FIXTURE_TICKETS, 112));
    expect(widget?.view).toBe("list");
    expect(widget?.total).toBe(112);
    expect(widget?.site).toEqual({ host: "na.myconnectwise.net" });
    const [first] = ticketsOf(widget);
    expect(first).toMatchObject({
      id: 48213,
      summary: "Imprimante du 2e étage hors ligne",
      status: "En cours",
      priority: "Priority 2 - High",
      company: "Clinique vétérinaire Beauport",
      contact: "Marie-Ève Gagnon",
      board: "Soutien technique",
      owner: "Julien Tremblay",
      budgetHours: 2,
      actualHours: 1.25,
      closed: false,
      entered: "2026-10-06T13:05:00Z",
      updated: "2026-10-09T15:42:10Z",
    });
    expect(first!.link).toContain("recordType=ServiceFv&recid=48213");
  });

  it("maps one ticket to a card, through MCP text blocks, with the server's site", () => {
    const widget = cwWidgetFromToolCall(
      "cw_psa_query",
      JSON.stringify({ resource: "service/tickets/48213" }),
      fixtureMcpContent(FIXTURE_TICKETS[0]),
      { site: { host: "cw.example.ca", company: "acme" } },
    );
    expect(widget?.view).toBe("card");
    expect(ticketsOf(widget)[0]!.link).toBe(
      "https://cw.example.ca/v4_6_release/services/system_io/router/openrecord.rails?recordType=ServiceFv&recid=48213&companyName=acme",
    );
  });

  it("maps a ticket's notes to its timeline, newest first", () => {
    const widget = cwWidgetFromToolCall(
      "cw_psa_query",
      JSON.stringify({ resource: "service/tickets/48213/notes", orderBy: "id asc" }),
      JSON.stringify([...FIXTURE_TICKET_NOTES].reverse()),
    );
    const [ticket] = ticketsOf(widget);
    expect(ticket!.id).toBe(48213);
    expect(ticket!.notes?.map((note) => note.id)).toEqual([99120, 99098]);
    expect(ticket!.notes?.[0]).toMatchObject({ internal: true, by: "Julien Tremblay" });
    expect(ticket!.notes?.[1]).toMatchObject({ by: "Marie-Ève Gagnon" });
    expect(ticket!.notes?.[1]?.internal).toBeUndefined();
  });

  it("draws the ticket a write answers with", () => {
    const updated = { ...FIXTURE_TICKETS[0], status: { id: 18, name: "Résolu" } };
    const widget = cwWidgetFromToolCall("cw_psa_write", JSON.stringify({ resource: "service/tickets/48213", operation: "patch" }), JSON.stringify(updated));
    expect(ticketsOf(widget)[0]!.status).toBe("Résolu");
  });

  it("reads a cut-short input preview without guessing", () => {
    const widget = cwWidgetFromToolCall("cw_psa_query", '{"resource":"service/tickets/48213/notes","conditions":"…', JSON.stringify(FIXTURE_TICKET_NOTES));
    expect(ticketsOf(widget)[0]!.id).toBe(48213);
  });

  it("maps nothing for other tools, errors, prose or empty results", () => {
    expect(cwWidgetFromToolCall("Bash", input, fixtureQueryResult(FIXTURE_TICKETS))).toBeNull();
    expect(cwWidgetFromToolCall("cw_psa_query", input, "Error: 401 Unauthorized")).toBeNull();
    expect(cwWidgetFromToolCall("cw_psa_query", input, "[]")).toBeNull();
    expect(cwWidgetFromToolCall("cw_psa_query", input, JSON.stringify([{ id: 4, name: "Something else" }]))).toBeNull();
    expect(cwWidgetFromToolCall("cw_psa_query", input, undefined)).toBeNull();
  });

  it("keeps at most 50 records and says how many there were", () => {
    const many = Array.from({ length: 70 }, (_, index) => ({ ...FIXTURE_TICKETS[1], id: 50000 + index }));
    const widget = cwWidgetFromToolCall("cw_psa_query", input, JSON.stringify(many));
    expect(ticketsOf(widget)).toHaveLength(50);
    expect(widget?.total).toBe(70);
  });
});

describe("ticket list filters and sorting", () => {
  const tickets = ticketsOf(cwWidgetFromToolCall("cw_psa_query", "{}", JSON.stringify(FIXTURE_TICKETS)));

  it("sorts priorities by their number, not their words", () => {
    const sorted = filterSortTickets(tickets, {}, { key: "priority", dir: "asc" });
    expect(sorted.map((ticket) => ticket.id)).toEqual([48197, 48213, 48150, 48021]);
    expect(ticketFacet(tickets, "priority")).toEqual(["Priority 1 - Critical", "Priority 2 - High", "Priority 3 - Normal"]);
  });

  it("filters by status, company, open tickets and text", () => {
    expect(filterSortTickets(tickets, { company: "Clinique vétérinaire Beauport" }, { key: "id", dir: "desc" }).map((t) => t.id)).toEqual([48213, 48150]);
    expect(filterSortTickets(tickets, { openOnly: true }, { key: "id", dir: "asc" })).toHaveLength(3);
    expect(filterSortTickets(tickets, { query: "vpn" }, { key: "id", dir: "asc" }).map((t) => t.id)).toEqual([48150]);
    expect(filterSortTickets(tickets, { status: "Nouveau" }, { key: "id", dir: "asc" }).map((t) => t.id)).toEqual([48197]);
  });

  it("sorts by last update, newest first", () => {
    expect(filterSortTickets(tickets, {}, { key: "updated", dir: "desc" }).map((t) => t.id)).toEqual([48197, 48213, 48150, 48021]);
  });
});

describe("mergeCwWidgets", () => {
  it("joins a ticket's notes to its card and names a notes-only card from the list", () => {
    const card = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "service/tickets/48213" }), JSON.stringify(FIXTURE_TICKETS[0]))!;
    const notes = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "service/tickets/48213/notes" }), JSON.stringify(FIXTURE_TICKET_NOTES))!;
    const merged = mergeCwWidgets([{ key: "a", widget: card }, { key: "b", widget: notes }]);
    expect(merged).toHaveLength(1);
    const [ticket] = ticketsOf(merged[0]!.widget);
    expect(ticket!.summary).toBe("Imprimante du 2e étage hors ligne");
    expect(ticket!.notes).toHaveLength(2);

    const list = cwWidgetFromToolCall("cw_psa_query", "{}", JSON.stringify(FIXTURE_TICKETS))!;
    const named = mergeCwWidgets([{ key: "a", widget: list }, { key: "b", widget: notes }]);
    expect(named).toHaveLength(2);
    expect(ticketsOf(named[1]!.widget)[0]!.summary).toBe("Imprimante du 2e étage hors ligne");
  });
});

describe("a widget written as text (```cw fence, Claude-style artifact)", () => {
  it("keeps known fields and drops markup, foreign links and unknown keys", () => {
    const widget = parseCwWidgetText(JSON.stringify({
      v: 1,
      family: "ticket",
      site: { host: "na.myconnectwise.net", company: "pulsatrix" },
      records: [{
        id: 48213,
        summary: "Imprimante",
        status: "En cours",
        link: "javascript:alert(1)",
        html: "<script>alert(1)</script>",
        notes: [{ text: "Une note", at: "2026-10-09T15:40:00Z", internal: true }, { text: 42 }],
      }],
    }));
    const [ticket] = ticketsOf(widget);
    expect(widget?.view).toBe("card");
    expect(ticket).not.toHaveProperty("html");
    expect(ticket!.link).toContain("na.myconnectwise.net");
    expect(ticket!.notes).toEqual([{ text: "Une note", at: "2026-10-09T15:40:00Z", internal: true }]);
  });

  it("accepts raw ConnectWise records and refuses anything else", () => {
    const widget = parseCwWidgetText(JSON.stringify({ family: "ticket", records: FIXTURE_TICKETS.slice(0, 2) }));
    expect(widget?.view).toBe("list");
    expect(ticketsOf(widget)[1]!.status).toBe("Nouveau");
    expect(parseCwWidgetText("not json")).toBeNull();
    expect(parseCwWidgetText(JSON.stringify({ family: "ticket", records: [] }))).toBeNull();
    expect(parseCwWidgetText(JSON.stringify({ family: "unknown", records: [{ id: 1 }] }))).toBeNull();
    expect(parseCwWidgetText(JSON.stringify({ v: 9, family: "ticket", records: [{ id: 1, summary: "x" }] }))).toBeNull();
  });
});

describe("widget actions", () => {
  it("validates the change a widget asks for", () => {
    expect(parseCwAction({ kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" }))
      .toEqual({ kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" });
    expect(parseCwAction({ kind: "ticket.status", ticketId: 48213, status: "En cours", from: "En cours" })).toBeNull();
    expect(parseCwAction({ kind: "ticket.status", ticketId: -1, status: "Résolu" })).toBeNull();
    expect(parseCwAction({ kind: "ticket.status", ticketId: 1, status: "x".repeat(81) })).toBeNull();
    expect(parseCwAction({ kind: "ticket.note", ticketId: 1, text: "   " })).toBeNull();
    expect(parseCwAction({ kind: "ticket.delete", ticketId: 1 })).toBeNull();
    expect(parseCwAction({ kind: "ticket.note", ticketId: 7, text: "Rappeler le client", internal: true }))
      .toEqual({ kind: "ticket.note", ticketId: 7, text: "Rappeler le client", internal: true });
  });

  it("builds the write, its anchors and the words", () => {
    const status = parseCwAction({ kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" })!;
    expect(cwActionWrite(status)).toEqual({
      resource: "service/tickets/48213",
      operation: "patch",
      body: [{ op: "replace", path: "status", value: { name: "Résolu" } }],
    });
    expect(cwActionAnchors(status)).toEqual([48213]);
    expect(cwActionSummary(status, "fr")).toBe("Changer le statut du billet #48213 de « En cours » à « Résolu »");
    expect(cwActionSummary(status, "en")).toBe('Change ticket #48213 status from "En cours" to "Résolu"');
    const note = parseCwAction({ kind: "ticket.note", ticketId: 48213, text: "Pièce commandée.", internal: false })!;
    expect(cwActionWrite(note)).toEqual({
      resource: "service/tickets/48213/notes",
      operation: "create",
      body: { text: "Pièce commandée.", detailDescriptionFlag: true, internalAnalysisFlag: false },
    });
    expect(cwActionSummary(note, "fr")).toBe("Ajouter une note à la discussion au billet #48213");
    expect(cwActionInstruction(note, "fr")).toContain('"resource":"service/tickets/48213/notes"');
    expect(cwActionInstruction(note, "fr")).toContain("Pièce commandée.");
  });

  it("maps time, schedule, agreements and companies, and drops a foreign website", () => {
    const time = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "time/entries" }), fixtureQueryResult(FIXTURE_TIME));
    expect(time).toMatchObject({ family: "time", view: "list" });
    expect(time?.family === "time" && time.records[0]).toMatchObject({ id: 88021, charge: "Ticket #48213", billable: "Billable", hours: 1.25 });

    const schedule = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "schedule/entries/33011" }), fixtureQueryResult([FIXTURE_SCHEDULE[0]]));
    expect(schedule).toMatchObject({ family: "schedule", view: "card" });
    expect(schedule?.family === "schedule" && schedule.records[0]?.done).toBe(false);

    const agreements = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "finance/agreements" }), fixtureQueryResult(FIXTURE_AGREEMENTS));
    expect(agreements).toMatchObject({ family: "agreement", view: "list" });

    const companies = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "company/companies" }), fixtureQueryResult(FIXTURE_COMPANIES));
    expect(companies?.family === "company" && companies.records.map((company) => company.website)).toEqual(["https://clinique.example/", undefined]);
  });

  it("keeps a fence honest and refuses a script or a foreign link", () => {
    const widget = parseCwWidgetText(JSON.stringify({
      v: 1,
      family: "company",
      records: [{ id: 250, name: "Clinique", website: "javascript:alert(1)", link: "https://evil.example/steal", phone: "418-555-0142" }],
    }));
    expect(widget?.family).toBe("company");
    expect(widget?.family === "company" && widget.records[0]).toMatchObject({ name: "Clinique", phone: "418-555-0142" });
    expect(widget?.family === "company" && widget.records[0]?.website).toBeUndefined();
    expect(widget?.family === "company" && widget.records[0]?.link).toBeUndefined();
    expect(parseCwWidgetText(JSON.stringify({ v: 2, family: "ticket", records: [{ id: 1, summary: "x" }] }))).toBeNull();
  });

  it("does not let one record's approval cover another family's write", () => {
    const time = parseCwAction({ kind: "time.billable", entryId: 48213, billable: "DoNotBill", from: "Billable" })!;
    const company = parseCwAction({ kind: "company.note", companyId: 48213, text: "Appelé le client." })!;
    const ticketNote = JSON.stringify({ resource: "service/tickets/48213/notes", text: "x" });
    expect(cwActionMatchesWrite(time, ticketNote)).toBe(false);
    expect(cwActionMatchesWrite(company, ticketNote)).toBe(false);
    expect(cwActionMatchesWrite(time, JSON.stringify(cwActionWrite(time)))).toBe(true);
    expect(cwActionMatchesWrite(company, JSON.stringify(cwActionWrite(company)))).toBe(true);
    expect(cwActionWrite(parseCwAction({ kind: "schedule.done", entryId: 33011, done: true })!)).toMatchObject({
      resource: "schedule/entries/33011",
    });
  });
});

describe("the cw schema the prompt teaches", () => {
  it("names exactly the families the validator draws, with their required fields", async () => {
    const { CW_FAMILIES, CW_REQUIRED_FIELDS, CW_VIEWS, CW_WIDGET_EXAMPLE } = await import("./schema.ts");
    for (const family of CW_FAMILIES) {
      const record = Object.fromEntries(CW_REQUIRED_FIELDS[family].map((field) => [field, field === "id" ? 7 : "Seven"]));
      for (const view of CW_VIEWS) {
        expect(parseCwWidgetText(JSON.stringify({ family, view, records: [record] }))?.view).toBe(view);
      }
      // each required field is truly required (a ticket keeps id alone, summary is asked for clarity)
      if (family !== "ticket") {
        for (const field of CW_REQUIRED_FIELDS[family]) {
          const { [field]: _dropped, ...rest } = record;
          expect(parseCwWidgetText(JSON.stringify({ family, view: "card", records: [rest] }))).toBeNull();
        }
      }
    }
    for (const family of ["widget", "custom", "contact", "project"]) {
      expect(parseCwWidgetText(JSON.stringify({ family, view: "card", records: [{ id: 1, name: "x", summary: "x" }] }))).toBeNull();
    }
    expect(parseCwWidgetText(CW_WIDGET_EXAMPLE)?.family).toBe("ticket");
  });

  it("says why a fence drew nothing", async () => {
    const { cwWidgetRejection, cwWidgetRejectionText } = await import("./validate.ts");
    const custom = cwWidgetRejection('{"family":"widget","view":"custom","records":[{"id":1}]}');
    expect(custom).toEqual({ reason: "family", family: "widget" });
    expect(cwWidgetRejectionText(custom!)).toBe('unknown family "widget"; use ticket, time, schedule, agreement or company');
    expect(cwWidgetRejection("not json")).toEqual({ reason: "json" });
    expect(cwWidgetRejection('{"family":"ticket","records":{}}')).toEqual({ reason: "records", family: "ticket" });
    const empty = cwWidgetRejection('{"family":"company","records":[{"id":1}]}');
    expect(empty).toEqual({ reason: "empty", family: "company" });
    expect(cwWidgetRejectionText(empty!)).toBe("no usable record; each company record needs id and name");
    expect(cwWidgetRejection('{"family":"ticket","records":[{"id":1,"summary":"x"}]}')).toBeNull();
  });
});
