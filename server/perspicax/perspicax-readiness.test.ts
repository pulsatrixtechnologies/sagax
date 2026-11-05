import { describe, expect, it, vi } from "vitest";
import { PerspicaxMcp, type PerspicaxMcpOptions } from "./perspicax-mcp.ts";
function fixture(status = 200, exchangeError?: "unreachable" | "not_held") {
  const revoke = vi.fn(async () => true);
  const calls: Array<{ method: string; frame?: Record<string, unknown>; session: string | null }> = [];
  const mcp = new PerspicaxMcp({
    issuer: "https://id.example.test", version: "0.0.0", botExists: () => true,
    subjectOf: () => ({ iss: "https://id.example.test", sub: "osprey", disabled: false }),
    subjectToken: async () => ({ ok: false, error: "no_session" }),
    routineSubjectToken: async () => ({ ok: true, token: "fixture-subject", expiresAt: Date.now() + 60_000 }),
    link: () => ({ exchangeToken: async () => exchangeError ? { ok: false, error: exchangeError } : { ok: true, token: "fixture-mcp", expiresAt: Date.now() + 60_000 },
      revokeExchanged: revoke, mcpEndpoint: () => "https://mcp.example.test/mcp" }),
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      const frame = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init?.method ?? "GET", frame, session: headers.get("mcp-session-id") });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (frame?.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }), { status, headers: { "mcp-session-id": "fixture-session" } });
      if (frame?.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [] } }), { status: 200 });
    }, log: () => {},
  } as PerspicaxMcpOptions);
  return { mcp, calls, revoke };
}
describe("routine account readiness uses only an isolated cheap read", () => {
  it("initializes, lists tools, closes its session and revokes its token without a turn", async () => {
    const h = fixture();
    expect(await h.mcp.probeReadiness("pr_osprey", AbortSignal.timeout(4_000))).toEqual({});
    expect(h.calls.map(call => call.frame?.method ?? call.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "DELETE"]);
    expect(h.calls[2]?.session).toBe("fixture-session"); expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(h.mcp.size()).toBe(0);
  });
  it.each([401, 403])("blocks an explicit HTTP %s account refusal", async (status) => {
    expect(await fixture(status).mcp.probeReadiness("pr_osprey", AbortSignal.timeout(4_000))).toMatchObject({ refused: true, detail: `${status} invalid_token` });
  });
  it("reports a transient exchange as detail, and unavailable account access as a refusal", async () => {
    expect(await fixture(200, "unreachable").mcp.probeReadiness("pr_osprey", AbortSignal.timeout(4_000))).toMatchObject({ detail: "unreachable" });
    expect(await fixture(200, "not_held").mcp.probeReadiness("pr_osprey", AbortSignal.timeout(4_000))).toMatchObject({ refused: true });
  });
});
