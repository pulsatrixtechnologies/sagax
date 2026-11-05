// A stdio MCP server that serves the synthetic Perspicax-like catalog
// (server/testing/perspicax-like-catalog.ts) for scripts/local-prompt/
// claude-prefix.ts (#1997). It answers initialize, tools/list and nothing
// else: the measurement only needs what the CLI puts in its first request.
import { createInterface } from "node:readline";

import { perspicaxLikeCatalog } from "../../server/testing/perspicax-like-catalog.ts";

const TOOLS = perspicaxLikeCatalog();
const INSTRUCTIONS = "Example organization profile: tickets, endpoints, backups. Find operations with api_search, describe one with api_describe.";

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

for await (const line of createInterface({ input: process.stdin })) {
  let message: { id?: unknown; method?: string } = {};
  try { message = JSON.parse(line); } catch { continue; }
  if (message.id === undefined) continue;
  if (message.method === "initialize") {
    reply(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "catalog", version: "1.0.0" }, instructions: INSTRUCTIONS });
  } else if (message.method === "tools/list") {
    reply(message.id, { tools: TOOLS });
  } else {
    reply(message.id, {});
  }
}
