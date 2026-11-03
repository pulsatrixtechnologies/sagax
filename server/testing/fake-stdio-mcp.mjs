// A tiny MCP server over stdio for the console's Test (server/mcp/mcp-stdio-test.test.ts).
// FAKE_MCP_MODE: ok (two tools), refuse (initialize answers an error that
// echoes FAKE_MCP_SECRET), exit (exits with code 3), hang (never answers).
// FAKE_MCP_PID_FILE: where it writes its pid, so the test can see it stopped.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MCP_MODE ?? "ok";
if (process.env.FAKE_MCP_PID_FILE) writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));
process.stderr.write(`starting with ${process.env.FAKE_MCP_SECRET ?? ""}\n`);
if (mode === "exit") process.exit(3);
process.stdout.write("a banner line that is not JSON-RPC\n");
const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  if (mode === "hang") return;
  const frame = JSON.parse(line);
  if (frame.method === "initialize") {
    if (mode === "refuse") send({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: `bad key ${process.env.FAKE_MCP_SECRET}` } });
    else send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  } else if (frame.method === "tools/list") {
    send({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "alpha", inputSchema: { type: "object" } }, { name: "beta", inputSchema: { type: "object" } }] } });
  }
});
setInterval(() => {}, 60_000);
