// #1935: a Perspicax profile bridge in a compact prompt lists its own core
// tools whole, so a bot sees cw_psa_query on the profile's server instead of
// only search_tools there (and api_search's names on the agents server).
import { describe, expect, it } from "vitest";
import { compactGateSearch, connectorKeptGate, gateMaySearch, gateSearchEnv, keptGateSearch, keptSearchedServers, listedToolNames, parseGateSearch, PERSPICAX_BRIDGE_PINS, pinnedToolNames, searchedCatalog, SUFFIX_PINNED_MAX } from "./mcp-gate-search.ts";

const fail = (message: string): never => { throw new Error(message); };
const tools = (names: string[]) => names.map((name) => ({ name }));

describe("compact gate search pins (#1935)", () => {
  it("a Perspicax bridge pins the gateway's finding tools and each product's core by suffix", () => {
    expect(compactGateSearch(["cw_psa_find_tickets"], true)).toEqual({
      pinned: ["cw_psa_find_tickets", ...PERSPICAX_BRIDGE_PINS.pinned],
      pinnedSuffixes: [...PERSPICAX_BRIDGE_PINS.pinnedSuffixes],
    });
    // any other server keeps the bot's own most used tools only
    expect(compactGateSearch(["get_ticket"], false)).toEqual({ pinned: ["get_ticket"] });
  });

  it("the setting survives the environment round trip, and a bad suffix fails closed", () => {
    const parsed = parseGateSearch(gateSearchEnv(compactGateSearch([], true)), fail)!;
    expect(parsed.pinned).toEqual([
      "api_describe", "api_list", "api_result_query", "api_search", "flow", "flow_action", "flow_run",
      "identity_switch", "memory_find", "memory_recall", "memory_search",
    ]);
    expect(parsed.pinnedSuffixes).toEqual(["_action", "_query", "_write"]);
    expect(parseGateSearch(gateSearchEnv({ pinned: ["x"] }), fail)!.pinnedSuffixes).toEqual([]);
    expect(() => parseGateSearch(JSON.stringify({ pinned: [], pinnedSuffixes: ["a b"] }), fail)).toThrow(/suffixes/);
    expect(() => parseGateSearch(JSON.stringify({ pinned: [], pinnedSuffixes: "_query" }), fail)).toThrow(/suffixes/);
  });

  it("lists the exact pins and the suffix matches, shortest first, never a directory tool", () => {
    const catalog = tools(["api_search", "api_list", "cw_psa_query", "cw_psa_write", "cw_cpq_quoteItems_write", "search_tools", "_query", "cw_psa_find_tickets"]);
    const names = pinnedToolNames(catalog, { pinned: ["api_search"], pinnedSuffixes: ["_query", "_write"] });
    expect(names).toEqual(["api_search", "cw_psa_query", "cw_psa_write", "cw_cpq_quoteItems_write"]);
    expect(names).not.toContain("search_tools");
    // a name that is only the suffix is not a product tool
    expect(names).not.toContain("_query");
  });

  it("lists at most SUFFIX_PINNED_MAX tools by suffix", () => {
    const catalog = tools(Array.from({ length: 40 }, (_, i) => `product_${String(i).padStart(2, "0")}_write`));
    expect(pinnedToolNames(catalog, { pinned: [], pinnedSuffixes: ["_write"] })).toHaveLength(SUFFIX_PINNED_MAX);
  });
});

// #4527 lot D: a connector on an engine with no tool search of its own lists
// every tool but the ones the bot's session leaves out of it.
describe("kept listing of a connector (#4527 lot D)", () => {
  const big = tools([...Array.from({ length: 14 }, (_, i) => `crm_tool_${String(i).padStart(2, "0")}`), "old_report"]);

  it("takes this server's left out tools only, by their own names", () => {
    expect(keptGateSearch("crm", ["crm/old_report", "mail/send", "crm/old_report", "crm2/x"])).toEqual({ leftOut: ["old_report"] });
    expect(keptGateSearch("crm", [])).toEqual({ leftOut: [] });
  });

  it("survives the environment round trip; an unreadable list stops the gate", () => {
    const parsed = parseGateSearch(gateSearchEnv({ leftOut: ["old_report", "b"] }), fail)!;
    expect(parsed.leftOut).toEqual(["b", "old_report"]);
    expect(parseGateSearch(gateSearchEnv({ leftOut: [] }), fail)!.leftOut).toEqual([]);
    // a compact or bridge setting has no kept listing
    expect(parseGateSearch(gateSearchEnv({ pinned: ["x"] }), fail)!.leftOut).toBeUndefined();
    expect(() => parseGateSearch(JSON.stringify({ pinned: [], leftOut: "old_report" }), fail)).toThrow(/left out/);
    expect(() => parseGateSearch(JSON.stringify({ pinned: [], leftOut: [""] }), fail)).toThrow(/left out/);
  });

  it("is searched only when it leaves out one of the catalog's tools, above the floor", () => {
    const kept = parseGateSearch(gateSearchEnv({ leftOut: ["old_report"] }), fail)!;
    expect(searchedCatalog(big, kept)).toBe(true);
    // nothing of this catalog is left out: listed as before, whole
    expect(searchedCatalog(big, parseGateSearch(gateSearchEnv({ leftOut: ["gone"] }), fail)!)).toBe(false);
    // a small catalog stays whole: three directory tools would cost what they save
    expect(searchedCatalog(tools(["a", "old_report"]), kept)).toBe(false);
    // the remote proxy's own directory over a big catalog passes through
    expect(searchedCatalog(tools(["search_tools", "describe_tool", "call_tool"]), kept)).toBe(false);
    // over 40 tools with nothing left out: still whole (the compact search would search it)
    const huge = tools(Array.from({ length: 60 }, (_, i) => `t${i}`));
    expect(searchedCatalog(huge, parseGateSearch(gateSearchEnv({ leftOut: [] }), fail)!)).toBe(false);
    expect(searchedCatalog(huge, parseGateSearch(gateSearchEnv({ pinned: [] }), fail)!)).toBe(true);
  });

  it("lists every tool but the left out ones, never a directory tool's own name", () => {
    const names = listedToolNames([...big, { name: "search_tools" }], { pinned: [], pinnedSuffixes: [], leftOut: ["old_report"] });
    expect(names).toHaveLength(14);
    expect(names).not.toContain("old_report");
    expect(names).not.toContain("search_tools");
    // a compact setting lists the pins only, as before
    expect(listedToolNames(big, { pinned: ["old_report"], pinnedSuffixes: [] })).toEqual(["old_report"]);
  });

  it("a driver mounts the kept listing from the turn, with the file its gate notes the offered tools into", () => {
    const kept = { crm: { leftOut: ["crm/old_report"], offered: "/data/offered/crm.json" }, mail: { leftOut: [], offered: "/data/offered/mail.json" } };
    expect(connectorKeptGate(kept, "crm")).toEqual({ search: { leftOut: ["old_report"] }, offered: "/data/offered/crm.json" });
    // nothing left out: no search unless the driver mounts a gate anyway
    expect(connectorKeptGate(kept, "mail")).toEqual({ offered: "/data/offered/mail.json" });
    expect(connectorKeptGate(kept, "mail", { mount: true })).toEqual({ search: { leftOut: [] }, offered: "/data/offered/mail.json" });
    expect(connectorKeptGate(kept, "constructor")).toEqual({});
    expect(connectorKeptGate(undefined, "crm")).toEqual({});
    expect(gateMaySearch(connectorKeptGate(kept, "crm").search)).toBe(true);
    expect(gateMaySearch(connectorKeptGate(kept, "mail", { mount: true }).search)).toBe(false);
    expect(gateMaySearch(compactGateSearch([], true))).toBe(true);
    expect([...keptSearchedServers({ connectorsKept: kept })]).toEqual(["crm"]);
  });
});
