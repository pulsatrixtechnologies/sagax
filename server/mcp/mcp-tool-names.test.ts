// Grok admits `server__tool` only with exactly one `__`, [A-Za-z0-9_-], no
// leading `_` on the tool and at most 256 characters (grok 1.0.50 user guide,
// 07-mcp-servers.md). Every advertised tool must get exactly one admissible,
// deterministic name; none may ever be dropped.
import { describe, expect, it } from "vitest";

import { GROK_MAX_QUALIFIED, grokToolNameProblem, mapJsonStrings, planToolNames, ToolNameAliases, toolNameParity } from "./mcp-tool-names.ts";

const PERSPICAX = "perspicax_profil_ottoline_limited";

/** Grok's admission rule, written from its documentation, independently of
 * the module under test. */
function grokAdmits(server: string, tool: string): boolean {
  const key = `${server}__${tool}`;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(server) && /^[A-Za-z0-9_-]+$/.test(tool)
    && key.split("__").length === 2 && !key.includes("___") && key.length <= 256;
}

describe("grokToolNameProblem", () => {
  it("matches Grok's documented admission rule", () => {
    for (const tool of ["read_file", "2fa_enable", "cw_psa__query", "_hidden", "a.b", "x:y", "tail_", "with-dash", "a".repeat(300)]) {
      expect(grokToolNameProblem(PERSPICAX, tool) === undefined).toBe(grokAdmits(PERSPICAX, tool));
    }
    expect(grokToolNameProblem(PERSPICAX, "cw_psa__query")).toBe("double_underscore");
  });
});

describe("planToolNames", () => {
  it("registers cw_psa__query from perspicax_profil_ottoline_limited (regression 2026-10-11)", () => {
    const names = ["memory_search", "api_search", "cw_psa__query", "cw_psa__write", "cw_psa__action"];
    const plan = planToolNames(PERSPICAX, names);
    expect(plan.unregistrable).toEqual([]);
    expect(plan.registered.get("cw_psa__query")).toBe("cw_psa_query");
    expect(plan.registered.get("cw_psa__write")).toBe("cw_psa_write");
    expect(plan.registered.get("cw_psa__action")).toBe("cw_psa_action");
    expect(plan.registered.get("memory_search")).toBe("memory_search");
    expect(toolNameParity(PERSPICAX, names, plan.registered)).toEqual([]);
    for (const name of plan.registered.values()) expect(grokAdmits(PERSPICAX, name)).toBe(true);
  });

  it("keeps dashes, maps dots, colons and leading underscores, never drops", () => {
    const names = ["get-thing", "files.read", "ns:act", "_private", "a___b", "ok_name"];
    const plan = planToolNames("srv", names);
    expect(plan.unregistrable).toEqual([]);
    expect(plan.registered.get("get-thing")).toBe("get-thing");
    expect(plan.registered.get("files.read")).toBe("files-read");
    expect(plan.registered.get("ns:act")).toBe("ns-act");
    expect(plan.registered.get("_private")).toBe("private");
    expect(plan.registered.get("a___b")).toBe("a_b");
    expect(toolNameParity("srv", names, plan.registered)).toEqual([]);
  });

  it("never collides: an original name wins, the alias gets a deterministic hash suffix", () => {
    const names = ["cw_psa__query", "cw_psa_query", "cw__psa_query", "files.read", "files-read"];
    const plan = planToolNames(PERSPICAX, names);
    expect(plan.registered.get("cw_psa_query")).toBe("cw_psa_query");
    expect(plan.registered.get("files-read")).toBe("files-read");
    const all = [...plan.registered.values()];
    expect(new Set(all).size).toBe(names.length);
    for (const name of all) expect(grokAdmits(PERSPICAX, name)).toBe(true);
    expect(plan.registered.get("cw_psa__query")).toMatch(/^cw_psa_query-[0-9a-f]{8}$/);
    expect(toolNameParity(PERSPICAX, names, plan.registered)).toEqual([]);
    // deterministic, whatever the order the server lists them in
    const again = planToolNames(PERSPICAX, [...names].reverse());
    expect([...again.registered].sort()).toEqual([...plan.registered].sort());
  });

  it("shortens names over Grok's 256-character key deterministically, with a hash, never dropping", () => {
    const long = `${"x".repeat(240)}__tail`;
    const sibling = `${"x".repeat(240)}__other`;
    const plan = planToolNames(PERSPICAX, [long, sibling]);
    const a = plan.registered.get(long)!;
    const b = plan.registered.get(sibling)!;
    expect(a).not.toBe(b);
    expect(`${PERSPICAX}__${a}`.length).toBeLessThanOrEqual(GROK_MAX_QUALIFIED);
    expect(grokAdmits(PERSPICAX, a) && grokAdmits(PERSPICAX, b)).toBe(true);
    expect(planToolNames(PERSPICAX, [long, sibling]).registered.get(long)).toBe(a);
    expect(toolNameParity(PERSPICAX, [long, sibling], plan.registered)).toEqual([]);
  });

  it("reports, never hides, tools on a server name Grok rejects", () => {
    const plan = planToolNames("1bad", ["read"]);
    expect(plan.unregistrable).toEqual([{ upstream: "read", reason: "invalid_server" }]);
  });
});

describe("toolNameParity", () => {
  it("fails on a missing, inadmissible or shared registered name", () => {
    expect(toolNameParity("s", ["a", "b__c", "d"], new Map([["a", "a"], ["b__c", "b__c"]]))).toEqual([
      "b__c: registered as b__c, which Grok skips (double_underscore)",
      "d: not registered",
    ]);
    expect(toolNameParity("s", ["a", "b"], new Map([["a", "x"], ["b", "x"]]))).toEqual(["b: registered as x, already used by a"]);
  });
});

describe("ToolNameAliases", () => {
  it("rewrites the catalog and maps calls back explicitly", () => {
    const aliases = new ToolNameAliases(PERSPICAX);
    const out = aliases.catalog([{ name: "cw_psa__query", description: "Read ConnectWise." }, { name: "memory_search" }]);
    expect(out.tools.map((tool) => tool.name)).toEqual(["cw_psa_query", "memory_search"]);
    expect(out.tools[0]!.description).toBe("Read ConnectWise.");
    expect(out.renamed).toEqual([{ upstream: "cw_psa__query", registered: "cw_psa_query", reason: "double_underscore" }]);
    expect(out.parity).toEqual([]);
    expect(aliases.upstream("cw_psa_query")).toBe("cw_psa__query");
    expect(aliases.upstream("memory_search")).toBe("memory_search");
    // a second page keeps earlier names stable and does not reuse them
    const page2 = aliases.catalog([{ name: "cw_psa_query" }]);
    expect(page2.tools[0]!.name).not.toBe("cw_psa_query");
    expect(aliases.upstream("cw_psa_query")).toBe("cw_psa__query");
  });
});

describe("connector names in what the bot reads (2026-11-02)", () => {
  const catalog = [
    { name: "cw_psa__query", description: "Read ConnectWise. See api_describe cw_psa__query." },
    { name: "cw_psa_time__entries_write", description: "Write time entries." },
    { name: "api_describe", description: "Describe a tool, e.g. cw_psa__query.", inputSchema: { type: "object", properties: { name: { type: "string", enum: ["cw_psa__query", "api_list"] } } } },
    { name: "memory_search" },
  ];

  it("round trip: instructions in, alias out; an alias argument reaches the server as the connector name", () => {
    const aliases = new ToolNameAliases(PERSPICAX);
    const instructions = aliases.instructionsToAliases("Call cw_psa__query for reads and cw_psa_time__entries_write for time; memory_search finds notes.");
    expect(instructions).toBe("Call cw_psa_query for reads and cw_psa_time_entries_write for time; memory_search finds notes.");
    const out = aliases.catalog(catalog);
    expect(out.predictionMismatches).toEqual([]);
    expect(out.tools.map((tool) => tool.name)).toEqual(["cw_psa_query", "cw_psa_time_entries_write", "api_describe", "memory_search"]);
    expect(out.tools[0]!.description).toBe("Read ConnectWise. See api_describe cw_psa_query.");
    expect(out.tools[2]!.description).toBe("Describe a tool, e.g. cw_psa_query.");
    expect(out.tools[2]!.inputSchema).toEqual({ type: "object", properties: { name: { type: "string", enum: ["cw_psa_query", "api_list"] } } });
    expect(aliases.upstream("cw_psa_query")).toBe("cw_psa__query");
    expect(aliases.argumentsToUpstream({ name: "cw_psa_query", verbose: true })).toEqual({ name: "cw_psa__query", verbose: true });
    expect(aliases.argumentsToUpstream({ steps: [{ tool: "cw_psa_time_entries_write", args: { notes: "cw_psa_query ran" } }] }))
      .toEqual({ steps: [{ tool: "cw_psa_time__entries_write", args: { notes: "cw_psa_query ran" } }] });
  });

  it("a result that holds both forms comes out with the alias only, the rest untouched", () => {
    const aliases = new ToolNameAliases(PERSPICAX);
    aliases.catalog(catalog);
    const text = "Use cw_psa__query (or cw_psa_query) then cw_psa_time__entries_write; `cw_psa__query`.";
    expect(aliases.toAliases(text)).toBe("Use cw_psa_query (or cw_psa_query) then cw_psa_time_entries_write; `cw_psa_query`.");
    expect(mapJsonStrings({ tools: [{ name: "cw_psa__query", total: 3 }], hint: "unknown tool cw_psa__query" }, (t) => aliases.toAliases(t)))
      .toEqual({ tools: [{ name: "cw_psa_query", total: 3 }], hint: "unknown tool cw_psa_query" });
  });

  it("a name without an alias stays as it is", () => {
    const aliases = new ToolNameAliases(PERSPICAX);
    aliases.catalog(catalog);
    for (const text of ["memory_search and api_describe", "endpointsec__query is not served here", "xcw_psa__query", "cw_psa__queryx", "__init__"]) {
      expect(aliases.toAliases(text)).toBe(text);
    }
    expect(aliases.argumentsToUpstream({ name: "memory_search", other: "endpointsec_query" })).toEqual({ name: "memory_search", other: "endpointsec_query" });
    // before any catalog, nothing is rewritten in results or arguments
    const fresh = new ToolNameAliases(PERSPICAX);
    expect(fresh.toAliases("cw_psa__query")).toBe("cw_psa__query");
    expect(fresh.argumentsToUpstream({ name: "cw_psa_query" })).toEqual({ name: "cw_psa_query" });
  });

  it("no tool registered with the engine keeps a second __ after its server prefix, on any API", () => {
    const names = ["cw_psa__query", "cw_psa_time__entries_write", "endpointsec__read_action", "twilio_lookups__PhoneNumbers_Overrides",
      "x360recover__d2c_agent_write", "a____b", "bookstack__query", "cw_psa_query", "api_list", "files.read", "_private"];
    const out = new ToolNameAliases(PERSPICAX).catalog(names.map((name) => ({ name })));
    for (const tool of out.tools) {
      const qualified = `mcp__${PERSPICAX}__${tool.name}`;
      expect(qualified.slice(`mcp__${PERSPICAX}__`.length)).not.toContain("__");
      expect(grokAdmits(PERSPICAX, tool.name)).toBe(true);
    }
    expect(new Set(out.tools.map((tool) => tool.name)).size).toBe(names.length);
  });
});
