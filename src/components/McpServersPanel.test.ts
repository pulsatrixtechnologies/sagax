import { afterEach, describe, expect, it } from "vitest";

import { parseMcpArguments, parseMcpEnvironment, parseMcpHeaders } from "./McpServersPanel";
import { parseMcpResultBudget, resultBudgetDraft, withResultBudget } from "./McpResultBudgetField";
import { setLocale, t } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("MCP server form", () => {
  it("uses one explicit argument per line", () => {
    expect(parseMcpArguments("-y\n  @scope/server  \n\n--read-only")).toEqual([
      "-y",
      "@scope/server",
      "--read-only",
    ]);
  });

  it("preserves write-only saved values without putting them back in the form", () => {
    expect(parseMcpEnvironment("TOKEN=\nMODE=read-only", ["TOKEN"])).toEqual({
      ok: true,
      env: { TOKEN: true, MODE: "read-only" },
    });
  });

  it("rejects malformed and duplicate environment names", () => {
    expect(parseMcpEnvironment("NOT A KEY=value")).toEqual({
      ok: false,
      error: { key: "mcp.env.invalidName", params: { key: "NOT A KEY" } },
    });
    expect(parseMcpEnvironment("TOKEN=one\nTOKEN=two")).toEqual({
      ok: false,
      error: { key: "mcp.env.duplicate", params: { key: "TOKEN" } },
    });
  });

  it("reads headers as Name: value lines, keeping saved values behind blanks", () => {
    expect(parseMcpHeaders("Authorization: Bearer abc:def\nX-Org:acme\n\nCookie: ", ["Cookie"])).toEqual({
      ok: true,
      headers: { Authorization: "Bearer abc:def", "X-Org": "acme", Cookie: true },
    });
    expect(parseMcpHeaders("Authorization Bearer x")).toEqual({
      ok: false,
      error: { key: "mcp.headers.useColon", params: { line: "Authorization Bearer x" } },
    });
    expect(parseMcpHeaders("Bad Header: x")).toEqual({
      ok: false,
      error: { key: "mcp.headers.invalidName", params: { key: "Bad Header" } },
    });
    expect(parseMcpHeaders("X-A: 1\nX-A: 2")).toEqual({
      ok: false,
      error: { key: "mcp.headers.duplicate", params: { key: "X-A" } },
    });
  });

  it("retains the offending input while an existing error changes language", () => {
    setLocale("de");
    const result = parseMcpEnvironment("TOKEN_WITHOUT_EQUALS");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an environment error");

    expect(t(result.error.key, result.error.params)).toContain("TOKEN_WITHOUT_EQUALS");
    setLocale("en");
    expect(t(result.error.key, result.error.params)).toBe('Use KEY=value for “TOKEN_WITHOUT_EQUALS”.');
  });
});

describe("MCP result size limit field", () => {
  it("reads blank as the default, 0 as never, and groups of three as thousands", () => {
    expect(parseMcpResultBudget("")).toEqual({ ok: true, value: undefined });
    expect(parseMcpResultBudget("  ")).toEqual({ ok: true, value: undefined });
    expect(parseMcpResultBudget("0")).toEqual({ ok: true, value: 0 });
    expect(parseMcpResultBudget("40000")).toEqual({ ok: true, value: 40_000 });
    expect(parseMcpResultBudget("40,000")).toEqual({ ok: true, value: 40_000 });
    expect(parseMcpResultBudget("2 000 000")).toEqual({ ok: true, value: 2_000_000 });
  });

  it("refuses decimals, negatives, text and anything over 2,000,000", () => {
    for (const bad of ["12.5", "1,5", "-1", "abc", "2000001", "2,000,001"]) {
      expect(parseMcpResultBudget(bad)).toEqual({ ok: false, error: { key: "mcp.err.resultBudget" } });
    }
  });

  it("adds the limit to the request body only when typed, and checks it first", () => {
    const build = () => ({ ok: true as const, body: { command: "npx" } });
    expect(withResultBudget("", build)).toEqual({ ok: true, body: { command: "npx" } });
    expect(withResultBudget("40000", build)).toEqual({ ok: true, body: { command: "npx", resultBudget: 40_000 } });
    expect(withResultBudget("x", build)).toEqual({ ok: false, error: { key: "mcp.err.resultBudget" } });
    expect(resultBudgetDraft({ resultBudget: 0 })).toBe("0");
    expect(resultBudgetDraft({})).toBe("");
  });

  it("has its strings in English and French", () => {
    for (const key of ["mcp.field.resultBudget", "mcp.resultBudgetHint", "mcp.err.resultBudget"] as const) {
      setLocale("en");
      const en = t(key);
      setLocale("fr");
      expect(t(key)).not.toBe(en);
    }
  });
});
