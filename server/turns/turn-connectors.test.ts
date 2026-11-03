import { describe, expect, it } from "vitest";
import { normalizeTurnConnectors } from "../../shared/turn-connectors.ts";
import { turnConnectorsRecord } from "./turn-connectors.ts";

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
});
