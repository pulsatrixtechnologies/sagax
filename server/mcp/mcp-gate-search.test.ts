// #1935: a Perspicax profile bridge in a compact prompt lists its own core
// tools whole, so a bot sees cw_psa_query on the profile's server instead of
// only search_tools there (and api_search's names on the agents server).
import { describe, expect, it } from "vitest";
import { compactGateSearch, gateSearchEnv, parseGateSearch, PERSPICAX_BRIDGE_PINS, pinnedToolNames, SUFFIX_PINNED_MAX } from "./mcp-gate-search.ts";

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
    expect(parsed.pinned).toEqual(["api_describe", "api_result_query", "api_search"]);
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
