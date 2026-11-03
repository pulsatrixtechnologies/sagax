import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readPluginMcpServers } from "./plugin-mcp.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-mcp-"));
  dirs.push(dir);
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(value));
  }
  return dir;
}

it("reads both declaration locations once and resolves scripts in the person's environment", () => {
  const root = fixture({
    ".mcp.json": { mcpServers: { docs: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/bin/docs.js"], env: { DATA: "${CLAUDE_PLUGIN_ROOT}/data" } } } },
    ".claude-plugin/plugin.json": { mcpServers: { docs: { url: "https://duplicate.example.com/mcp" }, search: { type: "sse", url: "https://search.example.com/events" } } },
  });
  expect(readPluginMcpServers(root, "/workspace/sagax-plugins/docs")).toEqual({
    servers: [
      { name: "docs", entry: { command: "node", args: ["/workspace/sagax-plugins/docs/bin/docs.js"], env: { DATA: "/workspace/sagax-plugins/docs/data" } } },
      { name: "search", entry: { type: "sse", url: "https://search.example.com/events" } },
    ],
    skipped: [],
  });
});

it("reads a declared MCP file inside the plugin and reports a path outside it", () => {
  const root = fixture({
    ".claude-plugin/plugin.json": { mcpServers: "config/mcp.json" },
    "config/mcp.json": { docs: { url: "https://docs.example.com/mcp", headers: { "X-Region": "fixture-region" } } },
  });
  expect(readPluginMcpServers(root).servers).toEqual([{ name: "docs", entry: { type: "http", url: "https://docs.example.com/mcp", headers: { "X-Region": "fixture-region" } } }]);
  writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ mcpServers: "../../outside.json" }));
  expect(readPluginMcpServers(root)).toEqual({ servers: [], skipped: ["mcpServers path ../../outside.json"] });
});
