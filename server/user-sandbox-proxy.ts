// Per-turn MCP entry point for a person's server environment
// ("sagax-environment"). Only a turn-scoped capability crosses into the agent
// process; the provisioner address and its key stay in the Sagax server, which
// runs the call in the sandbox of the person the turn's capability names
// (the speaker, or the bot owner for routines).
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 2_097_152;
const MAX_OUTPUT_BYTES = 16_777_216;
const MAX_PENDING = 8;
type RpcId = string | number | null;

function failure(id: RpcId, method: unknown, message: string, code = -32603): unknown {
  return method === "tools/call"
    ? { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } }
    : { jsonrpc: "2.0", id, error: { code, message } };
}

/** Which tool server this proxy is: the person's server environment, their
 * own computer through the desktop bridge (server/desktop-bridge.ts), or the
 * Auto computer choice (server/auto-computer.ts). */
export const PROXIED_TOOL_SERVERS = {
  "sagax-environment": { endpoint: "/api/internal/sandbox/mcp", unavailable: "The server environment is not connected. Start a new bot turn from Sagax.", interrupted: "The connection to the server environment was interrupted. Check the result before repeating the action." },
  "sagax-desktop": { endpoint: "/api/internal/desktop/mcp", unavailable: "Your computer is not connected through Sagax. Start a new bot turn from Sagax.", interrupted: "The connection to your computer was interrupted. Check the result before repeating the action." },
  "sagax-computer": { endpoint: "/api/internal/workplace/mcp", unavailable: "Computer selection is not available. Start a new bot turn from Sagax.", interrupted: "The connection to Sagax was interrupted. Call computer_select again." },
} as const;
export type ProxiedToolServer = keyof typeof PROXIED_TOOL_SERVERS;

export async function userSandboxProxyRequest(frame: unknown, connection: { url: string; token: string; server?: ProxiedToolServer }, fetchImpl: typeof fetch = fetch): Promise<unknown | undefined> {
  const serverName: ProxiedToolServer = connection.server ?? "sagax-environment";
  const server = PROXIED_TOOL_SERVERS[serverName];
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return failure(null, null, "Invalid request.", -32600);
  const message = frame as { id?: RpcId; jsonrpc?: unknown; method?: unknown; params?: unknown };
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || (id !== null && typeof id !== "number" && typeof id !== "string")) return failure(null, null, "Invalid request.", -32600);
  if (!Object.hasOwn(message, "id")) return undefined;
  if (message.method === "initialize") return {
    jsonrpc: "2.0", id,
    result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: serverName, version: "1" } },
  };
  if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (message.method !== "tools/list" && message.method !== "tools/call") return failure(id, message.method, "Method not found.", -32601);
  try {
    const url = new URL(connection.url);
    if (!connection.token || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(server.unavailable);
    }
    const body = JSON.stringify({ method: message.method, params: message.params ?? {} });
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) throw new Error("The request exceeded the size limit.");
    const response = await fetchImpl(new URL(server.endpoint, url), {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.token}` },
      body, signal: AbortSignal.timeout(720_000),
    });
    const payload = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok || !payload || !Object.hasOwn(payload, "result")) {
      throw new Error(typeof payload?.error === "string" ? payload.error.slice(0, 2_000) : "The server environment is unavailable. Try again in a moment.");
    }
    return { jsonrpc: "2.0", id, result: payload.result };
  } catch (error) {
    const detail = error instanceof Error && !/fetch failed|abort|timeout/i.test(error.message)
      ? error.message : "The connection to the server environment was interrupted. Check the result before repeating the action.";
    return failure(id, message.method, detail);
  }
}

/** The tool server name of a person's own MCP server command relayed to
 * their server environment (server/sandbox-stdio-mcp.ts): every frame goes
 * through as is, notifications included. */
export const PERSONAL_STDIO_TOOL_SERVER = "sagax-stdio";
const PERSONAL_STDIO_ENDPOINT = "/api/internal/personal-mcp";

/** One frame of the relay: the server's answer for a request, nothing for a
 * notification. Never throws: a failure answers the request. */
export async function personalStdioRelayRequest(frame: unknown, connection: { url: string; token: string }, fetchImpl: typeof fetch = fetch): Promise<unknown | undefined> {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return failure(null, null, "Invalid request.", -32600);
  const message = frame as { id?: RpcId; jsonrpc?: unknown; method?: unknown };
  const isRequest = typeof message.method === "string" && message.id !== undefined && message.id !== null;
  try {
    const url = new URL(connection.url);
    if (!connection.token || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Your MCP server is not connected. Start a new bot turn from Sagax.");
    }
    const body = JSON.stringify({ message: frame });
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) throw new Error("The request exceeded the size limit.");
    const response = await fetchImpl(new URL(PERSONAL_STDIO_ENDPOINT, url), {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.token}` },
      body, signal: AbortSignal.timeout(720_000),
    });
    const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown } | null;
    if (!response.ok || !payload) throw new Error(typeof payload?.error === "string" ? payload.error.slice(0, 2_000) : "Your MCP server is unavailable. Try again in a moment.");
    return isRequest ? payload.message ?? failure(message.id ?? null, message.method, "Your MCP server gave no answer.") : undefined;
  } catch (error) {
    if (!isRequest) return undefined;
    const detail = error instanceof Error && !/fetch failed|abort|timeout/i.test(error.message)
      ? error.message : "The connection to your MCP server was interrupted. Check the result before repeating the action.";
    return failure(message.id ?? null, message.method, detail);
  }
}

/** Set by a driver that runs every MCP server from one shared environment
 * (Codex): this proxy's variables then arrive under that prefix, so two
 * proxies never read each other's capability. */
export const PROXY_ENV_PREFIX_VARIABLE = "SAGAX_PROXY_ENV_PREFIX";

/** Restore the plain variable names from a driver-given prefix. */
export function restorePrefixedEnvironment(environment: NodeJS.ProcessEnv): void {
  const prefix = environment[PROXY_ENV_PREFIX_VARIABLE];
  if (!prefix) return;
  for (const [key, value] of Object.entries(environment)) {
    if (key.startsWith(prefix) && key.length > prefix.length && value !== undefined) environment[key.slice(prefix.length)] = value;
  }
}

function run(): void {
  restorePrefixedEnvironment(process.env);
  const named = process.env.SAGAX_TOOL_SERVER;
  const personal = named === PERSONAL_STDIO_TOOL_SERVER;
  const connection = {
    url: process.env.SAGAX_HARNESS_URL ?? "", token: process.env.SAGAX_SANDBOX_TOKEN ?? "",
    server: named && Object.hasOwn(PROXIED_TOOL_SERVERS, named) ? named as ProxiedToolServer : "sagax-environment" as const,
  };
  let input = Buffer.alloc(0);
  let pending = 0;
  const output = (message: unknown) => {
    if (message === undefined) return;
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_OUTPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; return; }
    process.stdout.write(line);
  };
  process.stdout.on("error", () => { process.stdin.destroy(); process.exitCode = 1; });
  process.stdin.on("data", (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    let newline: number;
    while ((newline = input.indexOf(10)) !== -1) {
      if (newline > MAX_INPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; return; }
      const line = input.subarray(0, newline).toString("utf8");
      input = input.subarray(newline + 1);
      if (!line.trim()) continue;
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { output(failure(null, null, "Parse error.", -32700)); continue; }
      if (pending >= MAX_PENDING) {
        const request = frame as { id?: RpcId; method?: unknown } | null;
        if (request && Object.hasOwn(request, "id")) output(failure(request.id ?? null, request.method, "Too many pending requests."));
        continue;
      }
      pending++;
      const relayed = personal ? personalStdioRelayRequest(frame, connection) : userSandboxProxyRequest(frame, connection);
      void relayed.then(output).finally(() => { pending--; });
    }
    if (input.length > MAX_INPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
