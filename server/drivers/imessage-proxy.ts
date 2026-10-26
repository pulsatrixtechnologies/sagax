// Stdio MCP proxy for Messages. It holds only the turn token and forwards
// every call to the solo server on loopback. It does not open chat.db and
// it does not launch Messages.app.
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

type Json = Record<string, unknown>;

const send = (message: Json) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

export async function forwardMessagesCall(message: Json, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const id = message.id;
  const method = message.method;
  const params = (message.params ?? {}) as Json;
  if (method === "initialize") {
    ok(id, { protocolVersion: String(params.protocolVersion ?? "2024-11-05"), capabilities: { tools: {} }, serverInfo: { name: "sagax-messages", version: "1" } });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") { ok(id, {}); return; }
  if (method !== "tools/list" && method !== "tools/call") {
    if (id !== undefined) rpcError(id, -32601, `Method not found: ${String(method)}`);
    return;
  }
  const url = env.SAGAX_HARNESS_URL?.trim() ?? "";
  const token = env.SAGAX_MESSAGES_TOKEN?.trim() ?? "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { rpcError(id, -32000, "Messages is not connected to Sagax."); return; }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !token) {
    rpcError(id, -32000, "Messages is not connected to Sagax.");
    return;
  }
  try {
    const response = await fetchImpl(new URL("/api/internal/messages/mcp", parsed), {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (!response.ok || !payload || typeof payload !== "object" || !Object.hasOwn(payload, "result")) {
      ok(id, { content: [{ type: "text", text: "Messages is unavailable on this Mac." }], isError: true });
      return;
    }
    ok(id, payload.result);
  } catch {
    ok(id, { content: [{ type: "text", text: "Messages could not be reached. Nothing was sent." }], isError: true });
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && /imessage-proxy\.(?:ts|js)$/.test(process.argv[1])) {
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as Json;
      void forwardMessagesCall(message).catch((error) => rpcError(message.id, -32603, error instanceof Error ? error.message : String(error)));
    } catch { /* a bad line is not a tool call */ }
  });
}
