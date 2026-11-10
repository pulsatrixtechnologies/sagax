import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { ConnectorAccount } from "../connectors/types.ts";
import { createConnectorHub } from "../connectors/hub.ts";
import type { ConnectorHost, ConnectorHostCall } from "../connectors/hosts/types.ts";
import type { HeldDecision } from "../harness/held-requests.ts";
import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute, createConnectorsInternalRoutes, CONNECTORS_INTERNAL_PATH, type CallConnectorHold } from "./internal-connectors.ts";
import { PASS } from "./table.ts";

function account(principal: string, connectors: ConnectorAccount["connectors"]): ConnectorAccount {
  return { provider: "claude-ai", driver: "claudeAgent", instanceId: "i1", slot: "primary", key: `k-${principal}`, label: `Claude of ${principal}`, auth: "subscription", connectors, at: 1 };
}

const ACCOUNTS: Record<string, ConnectorAccount[]> = {
  "ana@example.com": [account("ana@example.com", [
    { id: "mail", name: "Mail", state: "connected", tools: [
      { id: "send_message", description: "Send a mail message", inputSchema: { type: "object" } } as never,
      { id: "search_messages" }
    ] },
    { name: "Drive", state: "needs-sign-in", tools: [] }
  ])],
  "ben@example.com": [account("ben@example.com", [{ name: "Calendar", state: "connected", tools: [{ id: "list_events" }] }])]
};

/** Threads: t1 is bot b1's (Ana speaks), t2 is bot b1's (Ben speaks), t3 is
 * a confined guest turn of bot b1. Bot b2 owns none of them. */
function route() {
  const asked: string[] = [];
  const handler = createConnectorsInternalRoutes({
    ownsThread: (botId, threadId) => botId === "b1" && ["t1", "t2", "t3"].includes(threadId),
    principal: (_botId, threadId) => ({ t1: "Ana@Example.com ", t2: "ben@example.com", t3: "ana@example.com" } as Record<string, string>)[threadId] ?? "",
    confined: (threadId) => threadId === "t3",
    accounts: (principal) => { asked.push(principal); return ACCOUNTS[principal] ?? []; }
  });
  async function call(input: { botId?: string; threadId?: string; body?: unknown; path?: string; method?: string }) {
    let status = 0;
    let payload: Record<string, unknown> = {};
    const result = await handler({
      res: {} as ServerResponse,
      path: input.path ?? CONNECTORS_INTERNAL_PATH,
      method: input.method ?? "POST",
      json: ((_res: ServerResponse, code: number, body: Record<string, unknown>) => { status = code; payload = body; }) as never,
      capability: { botId: input.botId ?? "b1", threadId: input.threadId ?? "t1", generation: "g" },
      readBody: async () => (input.body ?? {}) as Record<string, unknown>
    });
    return { result, status, payload };
  }
  return { call, asked };
}

describe("POST /api/internal/connectors", () => {
  it("lists only the turn's own person, lowercased", async () => {
    const { call, asked } = route();
    const { status, payload } = await call({});
    expect(status).toBe(200);
    expect(asked).toEqual(["ana@example.com"]);
    const accounts = payload.accounts as Array<{ label: string; connectors: Array<{ name: string; state: string; tools: number }> }>;
    expect(accounts.map((entry) => entry.label)).toEqual(["Claude of ana@example.com"]);
    expect(accounts[0].connectors).toEqual([
      { name: "Mail", id: "mail", state: "connected", tools: 2 },
      { name: "Drive", state: "needs-sign-in", tools: 0 }
    ]);
    expect(JSON.stringify(payload)).not.toContain("Calendar");
  });

  it("never reads a person from the arguments", async () => {
    const { call, asked } = route();
    const { status } = await call({ body: { principalId: "ben@example.com" } });
    expect(status).toBe(400);
    expect(asked).toEqual([]);
    const other = await call({ body: { connector: "Calendar" } });
    expect(other.payload.matches).toEqual([]);
    expect(asked).toEqual(["ana@example.com"]);
  });

  it("a token of another bot lists nothing", async () => {
    const { call, asked } = route();
    const { status, payload } = await call({ botId: "b2" });
    expect(status).toBe(403);
    expect(payload.accounts).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("a thread of another person lists that person only, never the first one", async () => {
    const { call } = route();
    const { payload } = await call({ threadId: "t2" });
    expect(JSON.stringify(payload)).toContain("Calendar");
    expect(JSON.stringify(payload)).not.toContain("Mail");
  });

  it("a thread the bot does not own lists nothing", async () => {
    const { call, asked } = route();
    const { status } = await call({ threadId: "t9" });
    expect(status).toBe(403);
    expect(asked).toEqual([]);
  });

  it("a confined guest turn lists nothing", async () => {
    const { call, asked } = route();
    const { status, payload } = await call({ threadId: "t3" });
    expect(status).toBe(200);
    expect(payload.accounts).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("finds a connector's tools by query, with description and schema when given", async () => {
    const { call } = route();
    const { payload } = await call({ body: { connector: "mail", query: "send" } });
    const matches = payload.matches as Array<{ connector: string; tools: unknown[] }>;
    expect(matches).toHaveLength(1);
    expect(matches[0].connector).toBe("Mail");
    expect(matches[0].tools).toEqual([{ name: "send_message", description: "Send a mail message", inputSchema: { type: "object" } }]);
    const all = await call({ body: { connector: "Mail" } });
    expect((all.payload.matches as Array<{ tools: unknown[] }>)[0].tools).toEqual([
      { name: "send_message", description: "Send a mail message", inputSchema: { type: "object" } },
      { name: "search_messages" }
    ]);
  });

  it("says when a provider lists tools only at call time", async () => {
    const { call } = route();
    const { payload } = await call({ body: { connector: "Drive" } });
    const matches = payload.matches as Array<{ tools: unknown[]; note?: string }>;
    expect(matches[0].tools).toEqual([]);
    expect(matches[0].note).toMatch(/only when it is called/);
  });

  it("passes other paths and refuses other methods", async () => {
    const { call } = route();
    expect((await call({ path: "/api/internal/other" })).result).toBe(PASS);
    expect((await call({ method: "GET" })).status).toBe(405);
  });
});

describe("POST /api/internal/call-connector (#3348 review)", () => {
  const ROSTER: ConnectorAccount[] = [account("ana@example.com", [
    { id: "mail", name: "Mail", state: "connected", tools: [{ id: "send_message" }] },
    { id: "files", name: "Files", state: "unknown", tools: [{ id: "write_file" }] },
    { id: "tasks", name: "Tasks", state: "failed", tools: [{ id: "list_tasks" }] },
    { id: "drive", name: "Drive", state: "needs-sign-in", tools: [] }
  ])];

  function callRoute() {
    const held: CallConnectorHold[] = [];
    const ran: ConnectorHostCall[] = [];
    const host: ConnectorHost = {
      provider: "claude-ai",
      async call(input) {
        ran.push(input);
        return input.connector.state === "connected" ? { text: "done" } : { text: `provider says: ${input.connector.name} answered 502`, isError: true };
      }
    };
    const hub = createConnectorHub([host]);
    const handler = createCallConnectorInternalRoute({
      ownsThread: () => true,
      principal: () => "ana@example.com",
      confined: () => false,
      accounts: () => ROSTER,
      hub: () => hub,
      hold: (input) => { held.push(input); return { engine: "claudeAgent", decision: Promise.resolve({ behavior: "allow" } as HeldDecision) }; }
    });
    async function call(body: unknown) {
      let payload: Record<string, unknown> = {};
      await handler({
        res: {} as ServerResponse,
        path: CALL_CONNECTOR_INTERNAL_PATH,
        method: "POST",
        json: ((_res: ServerResponse, _code: number, out: Record<string, unknown>) => { payload = out; }) as never,
        capability: { botId: "b1", threadId: "t1", generation: "g" },
        readBody: async () => body as Record<string, unknown>
      });
      return payload;
    }
    return { call, held, ran };
  }

  it("sends arguments larger than 64 KiB to the held request and the host whole", async () => {
    const { call, held, ran } = callRoute();
    const body = "x".repeat(200 * 1024);
    const payload = await call({ connector: "Mail", tool: "send_message", arguments: { body } });
    expect(payload).toMatchObject({ ok: true, result: "done" });
    expect(held).toHaveLength(1);
    expect(ran[0]!.arguments).toEqual({ body });
  });

  it.each(["Files", "Tasks"])("lets a %s connector in an unknown or failed state reach the host, so the provider's own error comes back", async (name) => {
    const { call, held, ran } = callRoute();
    const tool = name === "Files" ? "write_file" : "list_tasks";
    const payload = await call({ connector: name, tool, arguments: {} });
    expect(held).toHaveLength(1);
    expect(ran).toHaveLength(1);
    expect(payload).toMatchObject({ ok: false, connector: name, error: `provider says: ${name} answered 502` });
  });

  it("answers a connector waiting for a sign-in with open_connector_setup, before any hold", async () => {
    const { call, held, ran } = callRoute();
    const payload = await call({ connector: "Drive", tool: "list_files" });
    expect(payload.ok).toBe(false);
    expect(String(payload.error)).toContain("open_connector_setup");
    expect(held).toHaveLength(0);
    expect(ran).toHaveLength(0);
  });
});
