// Stdio MCP proxy for Messages and the other Apple apps (mac_* tools). It
// holds only the turn token and forwards every call to the Sagax server on
// loopback. It does not open chat.db and it does not launch any app.
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { macAppInfo, macAppOfTool } from "../../electron/mac-apps.mjs";

/** Longer than the longest wait behind it: the desktop bridge gives a Mac
 * call up to 3 minutes (server/desktop/desktop-bridge.ts), and the Mac's own
 * script stops at 60 s. 2026-11-17: at 30 s this proxy gave up first, so a
 * slow Mail read came back as "Messages could not be reached" while Mail
 * was still answering. */
export const MESSAGES_PROXY_TIMEOUT_MS = 720_000;

/** The app a call acts in, as the person reads it (mac_mail_search: Mail). */
export function messagesCallApp(params: Record<string, unknown>): string {
  const app = typeof params.name === "string" ? macAppOfTool(params.name) : null;
  return (app && macAppInfo(app)?.name) || "Messages";
}

/** Why a call never got the server's answer, in words the bot can act on. */
export function messagesCallFailure(app: string, error: unknown, status?: number, said?: unknown): string {
  if (status !== undefined) {
    const words = typeof said === "string" && said.trim() ? ` (${said.trim().slice(0, 300)})` : "";
    return `${app} on your Mac could not be used: the Sagax server answered HTTP ${status}${words}. Nothing was done.`;
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return `${app} on your Mac did not answer within ${Math.round(MESSAGES_PROXY_TIMEOUT_MS / 60_000)} minutes. The outcome is unknown: check in ${app} before repeating it.`;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return `${app} on your Mac could not be reached: the connection to the Sagax server failed${message ? ` (${message.slice(0, 300)})` : ""}. Nothing was done.`;
}

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
      signal: AbortSignal.timeout(MESSAGES_PROXY_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok || !payload || typeof payload !== "object" || !Object.hasOwn(payload, "result")) {
      ok(id, { content: [{ type: "text", text: messagesCallFailure(messagesCallApp(params), null, response.status, payload?.error) }], isError: true });
      return;
    }
    ok(id, payload.result);
  } catch (error) {
    ok(id, { content: [{ type: "text", text: messagesCallFailure(messagesCallApp(params), error) }], isError: true });
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
