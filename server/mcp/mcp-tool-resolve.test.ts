import { describe, expect, it } from "vitest";
import { closeNamesSentence, closeServedNames, foldToolName, isUnknownToolText, readToolPages, resolveServedTool, unknownToolResultText } from "./mcp-tool-resolve.ts";

const served = ["cw_psa_query", "cw_psa_write", "cw_psa_find_tickets", "api_list", "identity"];

describe("resolveServedTool (#4837)", () => {
  it("keeps an exact served name", () => {
    expect(resolveServedTool("cw_psa_query", served)).toEqual({ kind: "exact", name: "cw_psa_query" });
  });

  it("folds separators and case to the one served name", () => {
    expect(resolveServedTool("cw_psa__query", served)).toEqual({ kind: "folded", name: "cw_psa_query" });
    expect(resolveServedTool("CW-PSA.query", served)).toEqual({ kind: "folded", name: "cw_psa_query" });
  });

  it("resolves a namespaced name to the longest served tail", () => {
    expect(resolveServedTool("mcp__perspicax__cw_psa_query", served)).toEqual({ kind: "namespaced", name: "cw_psa_query" });
    expect(resolveServedTool("perspicax.api_list", [...served, "list"])).toEqual({ kind: "namespaced", name: "api_list" });
  });

  it("resolves a unique suffix, never an ambiguous one", () => {
    expect(resolveServedTool("old__get_ticket", ["desk__get_ticket"])).toEqual({ kind: "suffix", name: "desk__get_ticket" });
    expect(resolveServedTool("find_tickets", served)).toEqual({ kind: "suffix", name: "cw_psa_find_tickets" });
    expect(resolveServedTool("write", [...served, "sentinelone_write"])).toMatchObject({ kind: "none" });
  });

  it("does not resolve an equal fold that two served names share", () => {
    expect(resolveServedTool("a_b", ["a__b", "a-b"])).toMatchObject({ kind: "none" });
  });

  it("names close served tools when nothing fits", () => {
    const found = resolveServedTool("cw_psa_list_tickets", served);
    expect(found.kind).toBe("none");
    expect(found.kind === "none" && found.close[0]).toBe("cw_psa_find_tickets");
    expect(closeServedNames("zzz", served)).toEqual([]);
    expect(closeNamesSentence(["a", "b"])).toBe(" Close served names: a, b.");
    expect(closeNamesSentence([])).toBe("");
  });

  it("folds names and reads unknown tool texts", () => {
    expect(foldToolName("__a--B..c__")).toBe("a_b_c");
    expect(isUnknownToolText("Unknown tool: x. Close served names follow.", "x")).toBe(true);
    expect(isUnknownToolText("Unknown tool: x", "x")).toBe(true);
    expect(isUnknownToolText("MCP error -32602: Unknown tool: x", "x")).toBe(true);
    expect(isUnknownToolText("tool x not found", "x")).toBe(true);
    expect(isUnknownToolText("invalid argument", "x")).toBe(false);
  });

  it("reads only a whole short unknown tool message about the asked tool", () => {
    expect(isUnknownToolText("Unknown tool: y", "x")).toBe(false);
    expect(isUnknownToolText("unknown tool expand: called while running x", "x")).toBe(false);
    expect(isUnknownToolText("Mcp error -32602: unknown tool get_ticket: tools/list names the tools served on this connection", "get_ticket")).toBe(true);
    expect(isUnknownToolText("step 2 failed: Unknown tool: x", "x")).toBe(false);
    expect(isUnknownToolText("Unknown tool: x\nthe write ran", "x")).toBe(false);
    const result = (patch: object) => ({ isError: true, content: [{ type: "text", text: "Unknown tool: x" }], ...patch });
    expect(unknownToolResultText(result({}), "x")).toBe("Unknown tool: x");
    expect(unknownToolResultText(result({ structuredContent: {} }), "x")).toBeUndefined();
    expect(unknownToolResultText(result({ isError: false }), "x")).toBeUndefined();
    expect(unknownToolResultText(result({ content: [{ type: "text", text: "Unknown tool: x" }, { type: "text", text: "more" }] }), "x")).toBeUndefined();
  });

  it("never falls through to a weaker level when a stronger one is ambiguous", () => {
    expect(resolveServedTool("ns_query", ["ns__query", "ns-query", "query"])).toMatchObject({ kind: "none" });
    expect(resolveServedTool("x__ns_query", ["ns_query", "NS-query", "query"])).toMatchObject({ kind: "none" });
    expect(resolveServedTool("x__ns_query", ["ns_query", "query"])).toEqual({ kind: "namespaced", name: "ns_query" });
    expect(resolveServedTool("x__a_query", ["a_query", "b_a_query"])).toEqual({ kind: "namespaced", name: "a_query" });
    expect(resolveServedTool("pre__q", ["q", "pre_q_x"])).toMatchObject({ name: "q" });
    expect(resolveServedTool("ab_cd", ["d", "cd"])).toMatchObject({ name: "cd" });
  });

  it("reads every page, and stops on a repeated or invalid cursor", async () => {
    const seen: Array<string | undefined> = [];
    const pages: Record<string, { names: string[]; nextCursor?: unknown }> = { first: { names: ["a"], nextCursor: "p2" }, p2: { names: ["b"] } };
    expect(await readToolPages(async (cursor) => { seen.push(cursor); return pages[cursor ?? "first"]!; })).toEqual(["a", "b"]);
    expect(seen).toEqual([undefined, "p2"]);
    await expect(readToolPages(async () => ({ names: ["a"], nextCursor: "same" }))).rejects.toThrow("cursor");
    await expect(readToolPages(async () => ({ names: [], nextCursor: 7 }))).rejects.toThrow("cursor");
  });
});
