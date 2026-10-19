// Claims through Perspicax (server/perspicax-claims.ts): the native tools are
// listed only while a Perspicax profile is mounted, the dispatcher posts to
// the harness route, the harness pins the holder to the bot and calls
// Perspicax with the speaker's exchanged token (PerspicaxMcp.callTool), and a
// refusal comes back as a result with the current holder.
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { callTool, type ToolCallContext } from "./drivers/agents-call.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { CLAIM_TOOL_NAMES, claimArguments, claimHolder, runClaimTool, withClaimsFlag } from "./perspicax-claims.ts";
import { PerspicaxMcp, type PerspicaxMcpLink } from "./perspicax-mcp.ts";

const ISS = "https://px.example.test";
const CATALOG = [{ id: "P1", slug: "dispatch", name: "Dispatch", description: "" }];

/** A Perspicax that keeps leases: the user is the token's subject, the
 * holder is the user plus the `holder` argument. */
function fakePerspicax() {
  const leases = new Map<string, { user: string; agent: string; purpose: string }>();
  const calls: Array<{ method: string; headers: Record<string, string>; body: any }> = [];
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init?.method), headers, body });
    if (init?.method === "DELETE" || body.id === undefined) return new Response(null, { status: 202 });
    const sse = (result: unknown) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
    });
    if (body.method === "initialize") return sse({ protocolVersion: "2025-06-18", capabilities: {} });
    if (!headers["mcp-session-id"]) return new Response("Unexpected message, expect initialize request", { status: 422 });
    const user = headers.authorization!.split(".")[1]!;
    const args = body.params.arguments;
    const name = body.params.name;
    let value: unknown;
    if (name === "claim") {
      const held = leases.get(args.name);
      if (held && (held.user !== user || held.agent !== args.holder)) {
        value = { ok: false, claimed: false, reason: "held_by_other", current: { name: args.name, holder: { user_id: held.user, agent: held.agent }, purpose: held.purpose } };
      } else {
        leases.set(args.name, { user, agent: args.holder, purpose: args.purpose ?? "" });
        value = { ok: true, claimed: true, claim: { name: args.name, holder: { user_id: user, agent: args.holder } } };
      }
    } else if (name === "claim_list") {
      value = { claims: [...leases].map(([lease, h]) => ({ name: lease, holder: { user_id: h.user, agent: h.agent } })) };
    } else {
      return sse({ content: [{ type: "text", text: `unknown tool ${name}` }], isError: true });
    }
    return sse({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false });
  }) as typeof fetch;
  return { fetcher, calls };
}

function perspicax(fetcher: typeof fetch) {
  let n = 0;
  const link: PerspicaxMcpLink = {
    exchangeToken: async (subjectToken, profileId): Promise<ExchangeResult> => ({ ok: true, token: `pxlo1.${subjectToken.split(".")[1]}.mcp-${profileId}-${++n}`, expiresAt: Date.now() + 900_000 }),
    revokeExchanged: async () => true,
    mcpEndpoint: () => "http://perspicax:8787/mcp",
    profileCatalog: () => CATALOG,
  };
  const subjects: Record<string, { iss: string; sub: string; disabled: boolean }> = {
    pr_ann: { iss: ISS, sub: "ANN", disabled: false },
    pr_bob: { iss: ISS, sub: "BOB", disabled: false },
  };
  return new PerspicaxMcp({
    issuer: ISS,
    link: () => link,
    subjectOf: (id) => subjects[id] ?? null,
    subjectToken: async (subject) => ({ ok: true, token: `pxlo1.${subject.sub}.signin`, expiresAt: Date.now() + 3_600_000 }),
    botProfiles: () => ["P1"],
    version: "0.1.0",
    fetch: fetcher,
    log: () => {},
  });
}

async function mount(mcp: PerspicaxMcp, botId: string, threadId: string, speaker: string) {
  await mcp.prepareTurn({ threadId, generation: "g1", bot: { id: botId, perspicax: { profiles: ["P1"] } }, speakerPrincipalId: speaker, speakerOrigin: "person" });
}

describe("claims", () => {
  it("pins the holder to the bot and forwards only the tool's own arguments", () => {
    expect(claimHolder("bot 1/é")).toBe("sagax:bot-1/-");
    expect(claimHolder("x".repeat(100))).toHaveLength(64);
    expect(claimArguments("claim", { name: "dispatch", ttl_seconds: 60, purpose: "p", holder: "someone-else", extra: 1 }, "b1"))
      .toEqual({ name: "dispatch", ttl_seconds: 60, purpose: "p", holder: "sagax:b1" });
    expect(claimArguments("claim_release", { name: "dispatch", purpose: "p" }, "b1")).toEqual({ name: "dispatch", holder: "sagax:b1" });
    expect(claimArguments("claim_list", { holder: "x" }, "b1")).toEqual({});
  });

  it("lists the native tools only while a Perspicax profile is mounted, never to an external runtime", () => {
    const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);
    expect(names({}).filter((name) => (CLAIM_TOOL_NAMES as readonly string[]).includes(name))).toEqual([]);
    expect(names({ SAGAX_CLAIMS: "1" }).filter((name) => (CLAIM_TOOL_NAMES as readonly string[]).includes(name))).toEqual([...CLAIM_TOOL_NAMES]);
    expect(names({ SAGAX_CLAIMS: "1", SAGAX_EXTERNAL_RUNTIME: "1" }).filter((name) => (CLAIM_TOOL_NAMES as readonly string[]).includes(name))).toEqual([]);
    const tools = availableTools(catalogProfileFromEnv({ SAGAX_CLAIMS: "1" }));
    const list = tools.find((tool) => tool.name === "claim_list") as { annotations?: { readOnlyHint?: boolean } };
    const claim = tools.find((tool) => tool.name === "claim") as { annotations?: unknown; inputSchema: { properties: Record<string, unknown> } };
    expect(list.annotations?.readOnlyHint).toBe(true);
    expect(claim.annotations).toBeUndefined();
    // The model is never offered a holder to fill in.
    expect(Object.keys(claim.inputSchema.properties)).toEqual(["name", "ttl_seconds", "purpose"]);
  });

  it("the dispatcher posts a claim tool to the harness route and reads its answer", async () => {
    const posted: Array<{ path: string; body: unknown }> = [];
    const answers: Array<{ ok: boolean; status: number; body: Record<string, unknown> }> = [
      { ok: true, status: 200, body: { result: { ok: false, claimed: false, reason: "held_by_other" }, isError: false } },
      { ok: false, status: 409, body: { error: "Claims need a Perspicax profile mounted in this turn; this bot has none for the person speaking.", code: "profile_not_mounted" } },
      { ok: true, status: 200, body: { result: { code: "params_invalid" }, isError: true } },
    ];
    const context = (externalRuntime = false): ToolCallContext => ({
      botId: "b1", threadId: "t1", depth: 0, externalRuntime, sharedComputers: false,
      client: {
        api: async () => ({}),
        apiResponse: async (path, init) => {
          posted.push({ path, body: JSON.parse(String(init?.body)) });
          return answers.shift()!;
        },
      },
    });
    expect(await callTool("claim", { name: "dispatch", purpose: "p" }, context())).toEqual({ text: JSON.stringify({ ok: false, claimed: false, reason: "held_by_other" }) });
    expect(await callTool("claim_renew", { name: "dispatch" }, context())).toEqual({ text: "Claims need a Perspicax profile mounted in this turn; this bot has none for the person speaking.", isError: true });
    expect(await callTool("claim_list", {}, context())).toEqual({ text: JSON.stringify({ code: "params_invalid" }), isError: true });
    expect(await callTool("claim", { name: "dispatch" }, context(true))).toEqual({ text: "Unknown tool: claim", isError: true });
    expect(posted).toEqual([
      { path: "/api/internal/perspicax/claims", body: { tool: "claim", args: { name: "dispatch", purpose: "p" } } },
      { path: "/api/internal/perspicax/claims", body: { tool: "claim_renew", args: { name: "dispatch" } } },
      { path: "/api/internal/perspicax/claims", body: { tool: "claim_list", args: {} } },
    ]);
  });

  it("calls Perspicax as the speaker, opening a session first, and two bots of one person are two holders", async () => {
    const { fetcher, calls } = fakePerspicax();
    const mcp = perspicax(fetcher);
    expect(mcp.hasMounted("t1", "g1", "b1")).toBe(false);
    expect(await runClaimTool(mcp, { threadId: "t1", generation: "g1", botId: "b1", tool: "claim", args: { name: "dispatch" } }))
      .toEqual({ status: 409, body: { error: "Claims need a Perspicax profile mounted in this turn; this bot has none for the person speaking.", code: "profile_not_mounted" } });

    await mount(mcp, "b1", "t1", "pr_ann");
    await mount(mcp, "b2", "t2", "pr_ann");
    await mount(mcp, "b3", "t3", "pr_bob");
    expect(mcp.hasMounted("t1", "g1", "b1")).toBe(true);
    expect(mcp.hasMounted("t1", "g1", "b2")).toBe(false);

    const first = await runClaimTool(mcp, { threadId: "t1", generation: "g1", botId: "b1", tool: "claim", args: { name: "dispatch", purpose: "run", holder: "sagax:b2" } });
    expect(first).toEqual({ status: 200, body: { isError: false, result: { ok: true, claimed: true, claim: { name: "dispatch", holder: { user_id: "ANN", agent: "sagax:b1" } } } } });
    // The first call opened a session (initialize, initialized), then called.
    expect(calls.map((call) => call.body?.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(calls[2]!.headers).toMatchObject({ authorization: "Bearer pxlo1.ANN.mcp-P1-1", "mcp-session-id": "sess-1" });
    expect(calls[2]!.body.params).toEqual({ name: "claim", arguments: { name: "dispatch", purpose: "run", holder: "sagax:b1" } });

    // The same person's other bot is another holder: refused, told who holds it.
    const other = await runClaimTool(mcp, { threadId: "t2", generation: "g1", botId: "b2", tool: "claim", args: { name: "dispatch" } });
    expect(other).toEqual({ status: 200, body: { isError: false, result: { ok: false, claimed: false, reason: "held_by_other", current: { name: "dispatch", holder: { user_id: "ANN", agent: "sagax:b1" }, purpose: "run" } } } });
    // Another person, refused the same way.
    const bob = await runClaimTool(mcp, { threadId: "t3", generation: "g1", botId: "b3", tool: "claim", args: { name: "dispatch" } });
    expect((bob.body.result as { reason: string }).reason).toBe("held_by_other");

    const list = await runClaimTool(mcp, { threadId: "t3", generation: "g1", botId: "b3", tool: "claim_list", args: { holder: "ignored" } });
    expect(list).toEqual({ status: 200, body: { isError: false, result: { claims: [{ name: "dispatch", holder: { user_id: "ANN", agent: "sagax:b1" } }] } } });

    expect(await runClaimTool(mcp, { threadId: "t1", generation: "g1", botId: "b1", tool: "memory_write", args: {} }))
      .toEqual({ status: 400, body: { error: "unknown claim tool", code: "unknown_tool" } });
    expect(await runClaimTool(null, { threadId: "t1", generation: "g1", botId: "b1", tool: "claim", args: {} }))
      .toMatchObject({ status: 409, body: { code: "profile_not_mounted" } });

    // After the turn ends, nothing is mounted any more.
    await mcp.endGeneration("t1", "g1");
    expect(mcp.hasMounted("t1", "g1", "b1")).toBe(false);
  });
});

describe("claim tools listed after a late mount", () => {
  it("withClaimsFlag turns the flag on for the catalog without touching the rest", () => {
    const built = { command: "node", args: ["proxy"], env: { SAGAX_CLAIMS: "0", SAGAX_BOT_ID: "b1" } };
    const mounted = withClaimsFlag(built, true);
    expect(mounted.env).toEqual({ SAGAX_CLAIMS: "1", SAGAX_BOT_ID: "b1" });
    expect(built.env.SAGAX_CLAIMS).toBe("0");
    const listed = availableTools(catalogProfileFromEnv(mounted.env)).map((tool) => tool.name);
    expect(CLAIM_TOOL_NAMES.every((name) => listed.includes(name))).toBe(true);
    const unlisted = availableTools(catalogProfileFromEnv(withClaimsFlag(mounted, false).env)).map((tool) => tool.name);
    expect(CLAIM_TOOL_NAMES.some((name) => unlisted.includes(name))).toBe(false);
  });
});
