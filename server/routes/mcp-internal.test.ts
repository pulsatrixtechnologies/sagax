import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext, InternalRouteHandler } from "./internal-route.ts";
import { createMcpAuditInternalRoutes } from "./mcp-audit-internal.ts";
import { createPerspicaxToolInternalRoutes } from "./perspicax-tool-internal.ts";
import { PASS } from "./table.ts";

async function call(route: InternalRouteHandler, path: string, body: Record<string, unknown>) {
  const sent: Array<{ status: number; body: any }> = [];
  const out = await route({
    res: {} as ServerResponse,
    path,
    method: "POST",
    json: ((_res: ServerResponse, status: number, b: unknown) => { sent.push({ status, body: b }); }) as InternalRouteContext["json"],
    capability: { botId: "bot-1", threadId: "t-1", generation: "g-1" },
    readBody: async () => body,
  });
  return { out, sent };
}

describe("POST /api/internal/perspicax/tool", () => {
  const tools = new Set(["api_search", "identity"]);

  it("forwards a listed tool under its real name, as the capability's turn, after the review", async () => {
    const callTool = vi.fn(async () => ({ ok: true as const, isError: false, value: { results: 2 } }));
    const review = vi.fn(async () => null);
    const route = createPerspicaxToolInternalRoutes({ tools, perspicaxMcp: () => ({ callTool }), review });
    const { sent } = await call(route, "/api/internal/perspicax/tool", { tool: "api_search", args: { query: "vpn" } });
    expect(review).toHaveBeenCalledWith(JSON.stringify({ tool: "api_search", args: { query: "vpn" } }), expect.objectContaining({ botId: "bot-1" }));
    expect(callTool).toHaveBeenCalledWith({ threadId: "t-1", generation: "g-1", botId: "bot-1", name: "api_search", args: { query: "vpn" } });
    expect(sent).toEqual([{ status: 200, body: { text: "{\"results\":2}", isError: false } }]);
  });

  it("names who opened a remote support session, and only on remote_support_* answers", async () => {
    const callTool = vi.fn(async () => ({ ok: true as const, isError: false, value: { code: "BQDHS7" } }));
    const owner = vi.fn(() => ({ principalId: "person-a", botId: "bot-1" }));
    const route = createPerspicaxToolInternalRoutes({ tools: new Set(["remote_support_open", "identity"]), perspicaxMcp: () => ({ callTool }), review: async () => null, owner });
    expect((await call(route, "/api/internal/perspicax/tool", { tool: "remote_support_open", args: {} })).sent[0]?.body).toMatchObject({ owner: { principalId: "person-a", botId: "bot-1" } });
    expect((await call(route, "/api/internal/perspicax/tool", { tool: "identity", args: {} })).sent[0]?.body).not.toHaveProperty("owner");
    expect(owner).toHaveBeenCalledTimes(1);
  });

  it("checks the support folder owner before Perspicax for status and close (finding d)", async () => {
    const callTool = vi.fn(async () => ({ ok: true as const, isError: false, value: { state: "connected" } }));
    const owner = () => ({ principalId: "person-a", botId: "bot-1" });
    const ownsSupportCode = vi.fn((code: string) => code === "MINE55");
    const route = createPerspicaxToolInternalRoutes({
      tools: new Set(["remote_support_status", "remote_support_close"]),
      perspicaxMcp: () => ({ callTool }), review: async () => null, owner, ownsSupportCode,
    });
    // someone else's code: refused here, Perspicax never called
    const refused = await call(route, "/api/internal/perspicax/tool", { tool: "remote_support_close", args: { code: "OTHER9", outcome: "ended" } });
    expect(refused.sent[0]).toMatchObject({ status: 200, body: { isError: true } });
    expect(callTool).not.toHaveBeenCalled();
    // our code: the gate passes and Perspicax is called
    await call(route, "/api/internal/perspicax/tool", { tool: "remote_support_status", args: { code: "MINE55" } });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(ownsSupportCode).toHaveBeenCalled();
  });

  it("refuses an unlisted name, a review refusal, no link and no mounted profile", async () => {
    const callTool = vi.fn(async () => ({ ok: false as const, code: "profile_not_mounted" as const, error: "x" }));
    const ok = createPerspicaxToolInternalRoutes({ tools, perspicaxMcp: () => ({ callTool }), review: async () => null });
    expect((await call(ok, "/api/internal/perspicax/tool", { tool: "api_query" })).sent[0]?.status).toBe(400);
    expect((await call(ok, "/api/internal/perspicax/tool", { tool: "identity", args: { query: "acme" } })).sent[0]).toMatchObject({ status: 409, body: { code: "profile_not_mounted" } });
    const held = createPerspicaxToolInternalRoutes({ tools, perspicaxMcp: () => ({ callTool }), review: async () => "held" });
    expect((await call(held, "/api/internal/perspicax/tool", { tool: "identity" })).sent[0]).toEqual({ status: 200, body: { text: "held", isError: true } });
    const unlinked = createPerspicaxToolInternalRoutes({ tools, perspicaxMcp: () => null, review: async () => null });
    expect((await call(unlinked, "/api/internal/perspicax/tool", { tool: "identity" })).sent[0]?.status).toBe(409);
    expect((await call(ok, "/api/internal/mcp-audit", {})).out).toBe(PASS);
  });
});

describe("POST /api/internal/mcp-audit", () => {
  it("keeps the whitelisted fields of a valid record, under the capability's bot", async () => {
    const rows: unknown[] = [];
    const route = createMcpAuditInternalRoutes({ append: (row) => rows.push(row) });
    const record = { at: "2026-10-15T00:00:00.000Z", principal: "p", role: "member", tool: "cw_psa__write", permission: "api:write", scope: "self", decision: "denied", reason: "resource_denied", resource: "cw_psa:tickets.update", enforced: false, args: { secret: 1 } };
    expect((await call(route, "/api/internal/mcp-audit", record)).sent).toEqual([{ status: 200, body: { ok: true } }]);
    expect(rows).toEqual([expect.objectContaining({ action: "mcp.shadow", target: { kind: "bot", id: "bot-1" } })]);
    expect(JSON.stringify(rows)).not.toContain("secret");
  });

  it("refuses a record that is not one", async () => {
    const rows: unknown[] = [];
    const route = createMcpAuditInternalRoutes({ append: (row) => rows.push(row) });
    expect((await call(route, "/api/internal/mcp-audit", { tool: "x" })).sent[0]?.status).toBe(400);
    expect((await call(route, "/api/internal/mcp-audit", { tool: "x", permission: "y", reason: "ok", decision: "maybe", scope: "self" })).sent[0]?.status).toBe(400);
    expect(rows).toEqual([]);
  });
});
