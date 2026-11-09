import { describe, expect, it } from "vitest";

import { macOnlyMcpServer, mcpServerRunsHere } from "./mcp-platform.ts";

describe("macOS-only MCP servers (#3181)", () => {
  it("knows the iMessage plugin and what only a Mac has", () => {
    expect(macOnlyMcpServer("imessage", { command: "bun", args: ["run", "start"], env: {} })).toBe(true);
    expect(macOnlyMcpServer("iMessage", { command: "bun", args: [], env: {} })).toBe(true);
    expect(macOnlyMcpServer("say", { command: "/usr/bin/osascript", args: ["-e", "say hi"], env: {} })).toBe(true);
    expect(macOnlyMcpServer("chat", { command: "node", args: ["server.js"], env: { DB: "/Users/me/Library/Messages/chat.db" } })).toBe(true);
    expect(macOnlyMcpServer("notes", { command: "/Applications/Notes Helper.app/Contents/MacOS/mcp", args: [], env: {} })).toBe(true);
  });

  it("leaves every other server alone, and a URL server always", () => {
    expect(macOnlyMcpServer("rea", { command: "npx", args: ["-y", "rea-agents@6.8.0", "mcp"], env: {} })).toBe(false);
    expect(macOnlyMcpServer("docs", { command: "node", args: ["/workspace/osascript-notes.md"], env: {} })).toBe(false);
    expect(macOnlyMcpServer("imessage", { type: "http", url: "https://imessage.example.com/mcp", headers: {} })).toBe(false);
  });

  it("runs on a Mac only, and the server environment is Linux", () => {
    const spec = { command: "bun", args: [], env: {} };
    expect(mcpServerRunsHere("imessage", spec, { organization: false, platform: "darwin" })).toBe(true);
    expect(mcpServerRunsHere("imessage", spec, { organization: false, platform: "linux" })).toBe(false);
    expect(mcpServerRunsHere("imessage", spec, { organization: true, platform: "darwin" })).toBe(false);
    expect(mcpServerRunsHere("tools", spec, { organization: true })).toBe(true);
  });
});
