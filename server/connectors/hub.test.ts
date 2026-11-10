import { describe, expect, it } from "vitest";

import { connectorCallOutbound, createConnectorHub, defaultConnectorRuleTool } from "./hub.ts";
import type { ConnectorHost, ConnectorHostCall } from "./hosts/types.ts";
import type { ConnectorAccount, ConnectorEntry } from "./types.ts";

const connector: ConnectorEntry = { id: "fixture_mail", name: "Fixture Mail", state: "connected", tools: [{ id: "search_messages" }] };
const account = { provider: "chatgpt-apps", driver: "codex", instanceId: "i", slot: "primary", key: "k", label: "Test", auth: "subscription", connectors: [connector], at: 0 } as ConnectorAccount;
const call = (over: Partial<ConnectorHostCall> = {}): ConnectorHostCall => ({ principalId: "p1", account, connector, tool: "search_messages", arguments: { q: 1 }, engine: "claudeAgent", ...over });

describe("connector hub", () => {
  it("is callable only for a provider with a host", () => {
    const host: ConnectorHost = { provider: "chatgpt-apps", call: async () => ({ text: "ok" }) };
    const hub = createConnectorHub([host]);
    expect(hub.callable("chatgpt-apps")).toBe(true);
    expect(hub.callable("claude-ai")).toBe(false);
  });

  it("answers a plain error, and asks no host, when the provider has none", async () => {
    const hub = createConnectorHub([]);
    const result = await hub.call(call());
    expect(result.isError).toBe(true);
    expect(result.text).toContain("cannot be called through call_connector yet");
    expect(hub.stats()).toEqual([expect.objectContaining({ engine: "claudeAgent", provider: "chatgpt-apps", calls: 1, errors: 1 })]);
  });

  it("passes the exact call to the host and counts per engine", async () => {
    const seen: ConnectorHostCall[] = [];
    let t = 100;
    const hub = createConnectorHub([{ provider: "chatgpt-apps", call: async (c) => (seen.push(c), { text: "MARK" }) }], () => t++);
    expect(await hub.call(call())).toEqual({ text: "MARK" });
    expect(seen[0]).toMatchObject({ principalId: "p1", tool: "search_messages", arguments: { q: 1 } });
    expect(hub.stats()[0]).toMatchObject({ calls: 1, ok: 1, errors: 0, lastOkAt: 100 });
  });

  it("turns a host that throws into an error result, cut for the counters", async () => {
    const hub = createConnectorHub([{ provider: "chatgpt-apps", call: async () => { throw new Error("x".repeat(500)); } }]);
    const result = await hub.call(call({ engine: "grokAgent" }));
    expect(result.isError).toBe(true);
    expect(hub.stats()[0]?.lastError?.length).toBe(300);
  });

  it("names the rule tool like a native call and reads sends as outbound", () => {
    expect(defaultConnectorRuleTool({ id: "Fixture Mail", name: "x" }, "send_message")).toBe("fixture_mail__send_message");
    expect(defaultConnectorRuleTool({ name: "x" }, "srv__tool")).toBe("srv__tool");
    const hub = createConnectorHub([{ provider: "chatgpt-apps", ruleTool: (c, t) => `${c.id}__${t}`, call: async () => ({ text: "" }) }]);
    expect(hub.ruleTool("chatgpt-apps", connector, "search_messages")).toBe("fixture_mail__search_messages");
    expect(connectorCallOutbound("fixture_mail__send_message")).toBe(true);
    expect(connectorCallOutbound("fixture_mail__search_messages")).toBe(false);
  });
});
