import { describe, expect, it } from "vitest";

import { describedProducts, familyCallPlan, filterNamingAnswer, flowReachOf, flowTargetOf, offProductOfFamilyCall, offProductOfReach, offProductOfCall, offProductOfDescribeAnswer, productOffText, sweepArgsWithoutOff, withoutOffTools, type BotProductsView } from "./bot-products-filter.ts";

const view: BotProductsView = { off: new Set(["edr"]), known: new Set(["edr", "psa", "ps"]), name: (id) => (id === "edr" ? "Endpoint security" : undefined) };
const none: BotProductsView = { off: new Set(), known: new Set(["edr"]) };

describe("products off for one bot (#4359)", () => {
  it("finds the off product of a call, a gateway call naming it, and a plan step", () => {
    expect(offProductOfCall(view, "edr_query", {})).toBe("edr");
    expect(offProductOfCall(view, "edr__write", {})).toBe("edr");
    expect(offProductOfCall(view, "psa_query", {})).toBeUndefined();
    expect(offProductOfCall(view, "api_describe", { api: "EDR", op_id: "agents" })).toBe("edr");
    expect(offProductOfCall(view, "api_describe", { op_id: "edr_query" })).toBe("edr");
    expect(offProductOfCall(view, "api_describe", { op_id: "edr" })).toBe("edr");
    expect(offProductOfCall(view, "api_lookup", { api: "edr", type: "site" })).toBe("edr");
    expect(offProductOfCall(view, "api_plan", { steps: [{ tool: "psa_query" }, { tool: "edr_query" }] })).toBe("edr");
    expect(offProductOfCall(view, "api_search", { query: "edr" })).toBeUndefined();
    expect(offProductOfCall(none, "edr_query", {})).toBeUndefined();
  });

  it("takes the off products out of an identity sweep and of its answer", () => {
    expect(sweepArgsWithoutOff(view, "identity", { query: "host" })).toEqual({ kind: "args", args: { query: "host", apis: ["psa", "ps"] } });
    expect(sweepArgsWithoutOff(view, "identity", { query: "host", apis: ["edr", "psa"] })).toEqual({ kind: "args", args: { query: "host", apis: ["psa"] } });
    expect(sweepArgsWithoutOff(view, "identity", { query: "host", apis: ["EDR"] })).toEqual({ kind: "off", id: "edr" });
    expect(sweepArgsWithoutOff(view, "identity", { query: "host", apis: ["psa"] })).toEqual({ kind: "none" });
    expect(sweepArgsWithoutOff(view, "api_plan", { steps: [{ tool: "psa_query" }, { tool: "identity", args: { query: "host", apis: ["edr"] } }] })).toEqual({ kind: "off", id: "edr" });
    expect(sweepArgsWithoutOff(view, "api_plan", { steps: [{ tool: "identity", args: { query: "host" } }] })).toEqual({ kind: "args", args: { steps: [{ tool: "identity", args: { query: "host", apis: ["psa", "ps"] } }] } });
    expect(sweepArgsWithoutOff(view, "psa_query", { resource: "x" })).toEqual({ kind: "none" });
    expect(sweepArgsWithoutOff(none, "identity", { query: "host" })).toEqual({ kind: "none" });
    const value = { matches: [{ api: "edr", items: [] }, { api: "psa", items: [] }], lookups: [{ api: "edr" }], errors: [], calls: 2 };
    const out = filterNamingAnswer(view, "identity", { id: 1, result: { structuredContent: value } }) as { result: { structuredContent: typeof value } };
    expect(out.result.structuredContent).toEqual({ matches: [{ api: "psa", items: [] }], lookups: [], errors: [], calls: 2 });
  });

  it("names the product and the way to turn it on", () => {
    const text = productOffText(view, "edr");
    expect(text).toMatch(/^Endpoint security is off for this bot/);
    expect(text).toContain("ask_choice");
    expect(text).toContain('sagax_settings set bot.products with {"edr": true}');
    expect(text).not.toMatch(/[–—]/);
  });

  it("drops the off tools of a list and leaves a list without any untouched", () => {
    const body = { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "edr_query" }, { name: "psa_query" }, { name: "memory_recall" }] } };
    expect((withoutOffTools(view, body) as typeof body).result.tools.map((tool) => tool.name)).toEqual(["psa_query", "memory_recall"]);
    expect(withoutOffTools(none, body)).toBe(body);
  });

  it("filters api_search results and marks api_list, in the structured content and in the JSON text", () => {
    const search = { results: [{ api: "edr", tool: "edr_query" }, { api: "psa", tool: "psa_query" }, { tool: "edr_query" }] };
    const body = { id: 2, result: { structuredContent: search, content: [{ type: "text", text: JSON.stringify(search) }] } };
    const out = filterNamingAnswer(view, "api_search", body) as { result: { structuredContent: typeof search; content: Array<{ text: string }> } };
    expect(out.result.structuredContent.results).toEqual([{ api: "psa", tool: "psa_query" }]);
    expect(JSON.parse(out.result.content[0]!.text).results).toEqual([{ api: "psa", tool: "psa_query" }]);
    const list = { apis: [{ id: "edr" }, { id: "psa" }] };
    const listed = filterNamingAnswer(view, "api_list", { id: 3, result: { content: [{ type: "text", text: JSON.stringify(list) }] } }) as { result: { content: Array<{ text: string }> } };
    const value = JSON.parse(listed.result.content[0]!.text);
    expect(value.apis).toEqual([{ id: "edr", off_for_this_bot: true }, { id: "psa" }]);
    expect(value.off_for_this_bot_note).toMatch(/turned off for this bot/);
    const plain = { id: 4, result: { content: [{ type: "text", text: "not json" }] } };
    expect(filterNamingAnswer(view, "api_search", plain)).toBe(plain);
  });

  // a product id that differs from its tools' prefix: a family (api_list `group`)
  const members = ["cw_psa_service", "cw_psa_time", "cw_psa_finance"];
  const fam: BotProductsView = { off: new Set(["cw_psa_service"]), known: new Set([...members, "cw_rmm", "twilio_api"]), groups: new Map([["cw_psa", members]]) };

  it("plans a family call by its resource, action or task tool, never by the tool's name", () => {
    expect(familyCallPlan(fam, "cw_psa_query", { resource: "service.tickets" })).toEqual({ kind: "resolve", group: "cw_psa", members, name: "service.tickets" });
    expect(familyCallPlan(fam, "cw_psa__write", { resource: "agreements" })).toMatchObject({ kind: "resolve", name: "agreements" });
    expect(familyCallPlan(fam, "cw_psa_action", { action: "sheets_approve" })).toMatchObject({ kind: "resolve", name: "sheets_approve" });
    expect(familyCallPlan(fam, "cw_psa_find_tickets", {})).toMatchObject({ kind: "resolve", name: "cw_psa_find_tickets" });
    expect(familyCallPlan(fam, "cw_psa_query", { api: "cw_psa_service", resource: "x" })).toEqual({ kind: "off", id: "cw_psa_service" });
    expect(familyCallPlan(fam, "cw_psa_query", { api: "cw_psa_time", resource: "x" })).toEqual({ kind: "none" });
    expect(familyCallPlan(fam, "flow_action", { name: "x" })).toEqual({ kind: "none" });
    expect(familyCallPlan(fam, "flow_run", { command: "run.init", args: { routine: "x" } })).toEqual({ kind: "none" });
    expect(familyCallPlan(fam, "flow_filter", { items: [] })).toEqual({ kind: "none" });
    expect(familyCallPlan(fam, "cw_rmm_query", {})).toEqual({ kind: "none" });
    expect(familyCallPlan({ ...fam, off: new Set(["cw_psa_time"]) }, "cw_psa_query", {})).toEqual({ kind: "none" });
    expect(familyCallPlan({ ...fam, off: new Set(members) }, "cw_psa_query", {})).toEqual({ kind: "off", id: "cw_psa_service" });
  });

  it("reads Perspicax's mapping: api, a task tool's target, the family's apis of an ambiguous name", () => {
    expect(describedProducts({ api: "cw_psa_service" }, members)).toEqual(["cw_psa_service"]);
    expect(describedProducts({ target: "cw_psa_time/entries" }, members)).toEqual(["cw_psa_time"]);
    expect(describedProducts({ code: "params_invalid", details: { apis: ["cw_psa_project", "cw_psa_service", "cw_rmm"] } }, members)).toEqual(["cw_psa_service"]);
    expect(describedProducts({ api: "cw_rmm" }, members)).toEqual([]);
    expect(describedProducts("not json", members)).toEqual([]);
  });

  it("refuses describing an off product and hides a family's tools only when all of it is off", () => {
    const body = (value: unknown) => ({ id: 1, result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
    expect(offProductOfDescribeAnswer(fam, "api_describe", body({ api: "cw_psa_service" }))).toBe("cw_psa_service");
    expect(offProductOfDescribeAnswer(fam, "api_describe", body({ target: "cw_psa_service/tickets" }))).toBe("cw_psa_service");
    expect(offProductOfDescribeAnswer(fam, "api_describe", body({ api: "cw_psa_time" }))).toBeUndefined();
    expect(offProductOfDescribeAnswer(fam, "api_search", body({ api: "cw_psa_service" }))).toBeUndefined();
    const list = { id: 2, result: { tools: [{ name: "cw_psa_query" }, { name: "cw_psa_find_tickets" }, { name: "flow_run" }, { name: "twilio_api_query" }] } };
    const names = (out: unknown) => (out as typeof list).result.tools.map((tool) => tool.name);
    expect(names(withoutOffTools(fam, list, new Set(["cw_psa_find_tickets"])))).toEqual(["cw_psa_query", "flow_run", "twilio_api_query"]);
    expect(names(withoutOffTools({ ...fam, off: new Set(members) }, list))).toEqual(["flow_run", "twilio_api_query"]);
  });

  it("finds the action or routine a Flow call runs, and what Perspicax's card of it reaches", () => {
    expect(flowTargetOf("flow_action", { name: "close-ticket", params: {} })).toBe("close-ticket");
    expect(flowTargetOf("flow_action", { resume: { run_id: "r1" } })).toBeUndefined();
    expect(flowTargetOf("flow_run", { command: "run.init", args: { routine: "hourly-watch" } })).toBe("hourly-watch");
    expect(flowTargetOf("flow_run", { command: "status" })).toBeUndefined();
    expect(flowTargetOf("flow_filter", { name: "x" })).toBeUndefined();
    expect(flowReachOf({ action: { name: "a", tools: ["sentinelone__query", "cw_psa_log_time"], products: ["sentinelone"] } }).sort()).toEqual(["cw_psa_log_time", "sentinelone", "sentinelone_query"]);
    expect(flowReachOf({ routine: { name: "r", steps: "1. Read with cw_psa_find_tickets.\n2. Text with twilio_api_write." } })).toEqual(expect.arrayContaining(["cw_psa_find_tickets", "twilio_api_write"]));
    expect(flowReachOf({ status: "blocked" })).toEqual([]);
  });

  it("refuses a Flow action only when what it reaches is off, inside or outside a family", async () => {
    const view: BotProductsView = { ...fam, off: new Set(["sentinelone"]), known: new Set([...fam.known, "sentinelone"]) };
    const mapping = async (_group: string, _members: readonly string[], name: string) => (name === "cw_psa_find_tickets" ? ["cw_psa_service"] : name === "cw_psa_log_time" ? ["cw_psa_time"] : []);
    expect(await offProductOfReach(view, ["cw_psa_log_time", "sentinelone_query"], mapping)).toBe("sentinelone");
    expect(await offProductOfReach(fam, ["cw_psa_log_time"], mapping)).toBeUndefined();
    expect(await offProductOfReach(fam, ["cw_psa_find_tickets"], mapping)).toBe("cw_psa_service");
    expect(await offProductOfReach(fam, ["cw_psa_query"], mapping)).toBe("cw_psa_service");
    expect(await offProductOfReach(fam, ["sentinelone_query", "memory_recall"], mapping)).toBeUndefined();
    const flow = async (name: string) => (name === "edr-isolate" ? ["sentinelone_write"] : name === "time-log" ? ["cw_psa_log_time"] : null);
    expect(await offProductOfFamilyCall(view, "flow_action", { name: "edr-isolate" }, mapping, flow)).toBe("sentinelone");
    expect(await offProductOfFamilyCall(fam, "flow_action", { name: "time-log" }, mapping, flow)).toBeUndefined();
    expect(await offProductOfFamilyCall(fam, "flow_action", { name: "unknown" }, mapping, flow)).toBeUndefined();
  });
});
