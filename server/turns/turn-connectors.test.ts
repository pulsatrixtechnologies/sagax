import { describe, expect, it } from "vitest";
import { normalizeTurnConnectors } from "../../shared/turn-connectors.ts";
import { keepHubRows, turnConnectorsRecord, withHubCall } from "./turn-connectors.ts";

const base = { at: 1, mounted: [], serverServers: [], personalServers: [], plugins: [], claudeAi: false, grokCloud: false };

describe("turn connectors record", () => {
  it("sorts what the turn mounted by source and leaves Sagax's own servers out", () => {
    const record = turnConnectorsRecord({
      ...base,
      mounted: ["sagax-environment", "sagax-flow", "perspicax_workshop", "notes", "github", "docs"],
      serverServers: [{ name: "github", auth: "connected" }, { name: "docs", auth: "expired" }],
      personalServers: ["notes", "calendar"],
      plugins: ["review"],
      claudeAi: true,
      claudeConnectors: [{ name: "Mail", status: "connected" }, { name: "Drive", status: "needs_auth" }, { name: "Odd", status: "unknown" }],
      grokCloud: true,
    });
    expect(record.connectors).toEqual([
      { name: "Drive", source: "claude", state: "reconnect" },
      { name: "Mail", source: "claude", state: "connected" },
      { name: "grok.com", source: "grok", state: "connected" },
      { name: "workshop", source: "perspicax", state: "connected" },
      { name: "calendar", source: "personal", state: "reconnect" },
      { name: "notes", source: "personal", state: "connected" },
      { name: "docs", source: "server", state: "reconnect" },
      { name: "github", source: "server", state: "connected" },
      { name: "review", source: "plugin", state: "connected" },
    ]);
    expect(record.claudeAccount).toBeUndefined();
  });

  it("names the Claude account when its connector list was not read yet", () => {
    expect(turnConnectorsRecord({ ...base, claudeAi: true })).toEqual({ at: 1, connectors: [], claudeAccount: true });
  });

  it("lists no account connectors on a turn that does not carry them", () => {
    expect(turnConnectorsRecord({ ...base, claudeConnectors: [{ name: "Mail", status: "connected" }] }).connectors).toEqual([]);
  });

  it("reads back only known sources and printable names", () => {
    expect(normalizeTurnConnectors({ at: 5, connectors: [
      { name: "ok", source: "server", state: "connected" },
      { name: "ok", source: "server", state: "connected" },
      { name: "bad", source: "elsewhere", state: "connected" },
      { name: "a\u0007b", source: "server" },
      { name: "x", source: "plugin", state: "weird" },
    ] })).toEqual({ at: 5, connectors: [{ name: "ok", source: "server", state: "connected" }, { name: "x", source: "plugin", state: "connected" }] });
    expect(normalizeTurnConnectors(null)).toBeUndefined();
  });

  // #3357: the dev panel counts the calls this conversation made through the hub
  it("counts hub calls per provider and connector, with warm runs and model tokens", () => {
    const record = turnConnectorsRecord({ ...base, grokCloud: true });
    let next = withHubCall(record, { provider: "grok-com", name: "Mail", isError: false, warm: false, input: 120, output: 12, at: 5 });
    next = withHubCall(next, { provider: "grok-com", name: "mail", isError: true, warm: true, input: 100, output: 10, at: 6 });
    next = withHubCall(next, { provider: "chatgpt-apps", name: "Drive", isError: false, warm: false, at: 7 });
    expect(next.connectors).toEqual(record.connectors);
    expect(next.hub).toEqual([
      { provider: "chatgpt-apps", name: "Drive", calls: 1, errors: 0, warm: 0, input: 0, output: 0, at: 7, last: "ok" },
      { provider: "grok-com", name: "Mail", calls: 2, errors: 1, warm: 1, input: 220, output: 22, at: 6, last: "error" },
    ]);
    // read back from the wire: the same rows; unknown providers and odd names dropped
    expect(normalizeTurnConnectors(JSON.parse(JSON.stringify(next)))?.hub).toEqual(next.hub);
    expect(normalizeTurnConnectors({ at: 1, connectors: [], hub: [{ provider: "other", name: "X", calls: 1 }, { provider: "grok-com", name: "a\u0007b", calls: 1 }] })?.hub).toBeUndefined();
  });

  it("keeps the conversation's hub counters when the next turn writes its record", () => {
    const earlier = withHubCall(turnConnectorsRecord(base), { provider: "grok-com", name: "Mail", isError: false, warm: false, input: 120, output: 12, at: 5 });
    const next = turnConnectorsRecord({ ...base, at: 8, claudeAi: true });
    expect(keepHubRows(earlier, next)).toEqual({ ...next, hub: earlier.hub });
    expect(keepHubRows(undefined, next)).toEqual(next);
  });

  it("starts a record for a hub call that came before the turn's record", () => {
    expect(withHubCall(undefined, { provider: "claude-ai", name: "Docs", isError: false, warm: false, input: 10, output: 2, at: 9 })).toEqual({
      at: 9,
      connectors: [],
      hub: [{ provider: "claude-ai", name: "Docs", calls: 1, errors: 0, warm: 0, input: 10, output: 2, at: 9, last: "ok" }],
    });
  });
});
