import { describe, expect, it } from "vitest";

import { listMcpServers, parseMcpServerMutation, parseStoredMcpServer } from "./mcp-registry.ts";
import { disabledToolScope, withDisabledTools } from "./mcp-tool-filter.ts";

describe("tools switched off for a whole MCP server", () => {
  it("persists the list on the stored server, sorted and without duplicates, and lists it", () => {
    const stored = parseStoredMcpServer("notes", { command: "npx", args: [], env: {}, enabled: true, disabledTools: ["write", "delete", "write"] });
    expect(stored.ok && stored.server.disabledTools).toEqual(["delete", "write"]);
    const [listing] = listMcpServers({ notes: stored.ok ? stored.server : {} });
    expect(listing).toMatchObject({ name: "notes", disabledTools: ["delete", "write"] });
  });

  it("keeps the saved list through an edit that does not mention it, and clears it with an empty list", () => {
    const saved = parseStoredMcpServer("docs", { type: "http", url: "https://mcp.example.com/mcp", headers: {}, disabledTools: ["drop_table"] });
    if (!saved.ok) throw new Error(saved.error);
    const edited = parseMcpServerMutation("docs", { type: "http", url: "https://mcp.example.com/v2" }, saved.server);
    expect(edited.ok && edited.server.disabledTools).toEqual(["drop_table"]);
    const cleared = parseMcpServerMutation("docs", { type: "http", url: "https://mcp.example.com/v2", disabledTools: [] }, saved.server);
    expect(cleared.ok && "disabledTools" in cleared.server).toBe(false);
  });

  it("refuses wildcard and multi-line tool names", () => {
    expect(parseStoredMcpServer("notes", { command: "npx", disabledTools: ["*"] }).ok).toBe(false);
    expect(parseStoredMcpServer("notes", { command: "npx", disabledTools: ["a\nb"] }).ok).toBe(false);
  });

  it("gates only the servers that have tools off, with a deny-only scope", () => {
    const calls: unknown[] = [];
    const gate = (input: { name: string; toolScope?: unknown; budget: number }) => {
      calls.push(input);
      return { command: "node", args: ["mcp-gate.js"], env: { SAGAX_GATE_NAME: input.name } };
    };
    const servers = {
      notes: { command: "npx", args: [], env: {} },
      docs: { type: "http" as const, url: "https://mcp.example.com/mcp", headers: {} },
    };
    const out = withDisabledTools(servers, { docs: ["drop_table"] }, "thread-1", gate);
    expect(out.notes).toBe(servers.notes);
    expect(out.docs).toEqual({ command: "node", args: ["mcp-gate.js"], env: { SAGAX_GATE_NAME: "docs" } });
    expect(calls).toEqual([expect.objectContaining({ name: "docs", budget: 0, toolScope: { deny: ["mcp:docs:drop_table"] } })]);
  });

  it("leaves a server out rather than mounting it whole when it cannot be gated", () => {
    const out = withDisabledTools({ notes: { command: "npx", args: [], env: {} } }, { notes: ["write"] }, "t", () => {
      throw new Error("unsupported");
    });
    expect(out).toEqual({});
    expect(disabledToolScope("notes", [])).toBeUndefined();
  });
});
