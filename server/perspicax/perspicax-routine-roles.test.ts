import { describe, expect, it, vi } from "vitest";
import { PerspicaxMcp } from "./perspicax-mcp.ts";

interface Frame { id?: string; method: string; params?: { name?: string; arguments?: { command?: string; args?: Record<string, unknown> } } }

function fixture(tools = ["identity_switch", "flow"]) {
  const frames: Array<{ frame?: Frame; method?: string }> = [];
  const revoke = vi.fn(async () => true);
  const delegation = vi.fn(async () => ({ ok: true, token: "fixture-subject", expiresAt: Date.now() + 60_000 } as const));
  const subjectToken = vi.fn(async () => ({ ok: false, error: "no_session" } as const));
  const mcp = new PerspicaxMcp({
    issuer: "https://id.example.test", version: "0.0.0",
    subjectOf: () => ({ iss: "https://id.example.test", sub: "nova", disabled: false }),
    subjectToken, routineSubjectToken: delegation,
    link: () => ({ exchangeToken: async () => ({ ok: true, token: "fixture-mcp", expiresAt: Date.now() + 60_000 } as const), revokeExchanged: revoke, mcpEndpoint: () => "https://mcp.example.test/mcp" }),
    fetch: async (_url, init) => {
      const frame: Frame | undefined = init?.body ? JSON.parse(String(init.body)) : undefined;
      frames.push({ frame, method: init?.method });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (frame?.method === "notifications/initialized") return new Response(null, { status: 202 });
      let result: unknown = {};
      if (frame?.method === "tools/list") result = { tools: tools.map((name) => ({ name })) };
      if (frame?.method === "tools/call" && frame.params?.name === "identity_switch") {
        result = { structuredContent: { profiles: [{ slug: "service-desk", name: "Service Desk", can: { read: true, write: true } }, { slug: "full-access", name: "Full Access", explicit_only: true, can: { read: true, write: true } }] } };
      }
      if (frame?.method === "tools/call" && frame.params?.name === "flow") {
        result = { content: [{ type: "text", text: JSON.stringify({ routine: { inputs: { standing_mandate: ["schedule_create"] }, server_profiles: ["service-desk"] } }) }] };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame?.id, result }), { headers: { "mcp-session-id": "fixture-session" } });
    },
    log: () => {},
  });
  return { mcp, frames, revoke, delegation, subjectToken };
}

describe("probeRoutineRoles (2026-11-05, routine \"Au nom de\")", () => {
  it("lists the held roles and describes the recipe on the person's routine delegation, then closes", async () => {
    const h = fixture();
    const answer = await h.mcp.probeRoutineRoles("pr_alex", "nova", "morning-pass", AbortSignal.timeout(2_000));
    expect(answer.held.map((role) => role.slug)).toEqual(["service-desk", "full-access"]);
    expect(answer.held[1]?.explicitOnly).toBe(true);
    expect(answer.card).toEqual({ routine: { inputs: { standing_mandate: ["schedule_create"] }, server_profiles: ["service-desk"] } });
    const calls = h.frames.filter((row) => row.frame?.method === "tools/call").map((row) => row.frame!.params);
    expect(calls).toEqual([
      { name: "identity_switch", arguments: {} },
      { name: "flow", arguments: { command: "describe", args: { name: "morning-pass" } } },
    ]);
    expect(h.delegation).toHaveBeenCalledWith("pr_alex");
    expect(h.subjectToken).not.toHaveBeenCalled();
    expect(h.frames.at(-1)?.method).toBe("DELETE");
    expect(h.revoke).toHaveBeenCalledOnce();
    expect(h.mcp.size()).toBe(0);
  });

  it("without a recipe it never calls flow; without identity_switch it lists no role", async () => {
    const h = fixture(["flow"]);
    const answer = await h.mcp.probeRoutineRoles("pr_alex", "nova", undefined, AbortSignal.timeout(2_000));
    expect(answer).toEqual({ held: [] });
    expect(h.frames.some((row) => row.frame?.method === "tools/call")).toBe(false);
  });
});
