// A real read of the apps already connected to a bot. List, then one read
// call. No send, no change, no browser: a tool that is not a read is not called.
import { probeEnvironment, probeMcpServer, type McpProbeResult } from "../mcp/mcp-probe.ts";
import { RemoteMcpClient } from "../mcp/mcp-http.ts";
import { isRemoteMcpServer, type StoredMcpServer } from "../mcp/mcp-registry.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { createLineSplitter } from "../mcp/mcp-bridge.ts";
import type { McpServerSpec } from "../contracts.ts";
import { briefReadTools, type BriefApp } from "./background-brief.ts";

const CALL_MS = 8_000;

function textOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as { isError?: boolean; content?: unknown; structuredContent?: unknown };
  if (record.isError === true) return null;
  if (record.structuredContent !== undefined) {
    try {
      return JSON.stringify(record.structuredContent).slice(0, 2_000);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(record.content)) return null;
  const text = record.content.map((block) => {
    if (!block || typeof block !== "object") return "";
    const row = block as { type?: unknown; text?: unknown };
    return row.type === "text" && typeof row.text === "string" ? row.text : "";
  }).join("\n").trim();
  return text ? text.slice(0, 2_000) : null;
}

async function callRemote(server: McpServerSpec, tool: string, signal: AbortSignal): Promise<string | null> {
  if (!isRemoteMcpServer(server)) return null;
  const client = new RemoteMcpClient(server);
  try {
    await client.initialize("Sagax", signal);
    return textOf(await client.request("tools/call", { name: tool, arguments: {} }, signal));
  } catch {
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

function callStdio(server: McpServerSpec, tool: string, signal: AbortSignal): Promise<string | null> {
  if (isRemoteMcpServer(server) || !("command" in server)) return Promise.resolve(null);
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(server.command, server.args, {
        cwd: process.cwd(),
        env: probeEnvironment(server),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      killCliTree(child);
      resolve(text);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), CALL_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    const write = (frame: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      } catch {
        finish(null);
      }
    };
    let initialized = false;
    const splitter = createLineSplitter((line) => {
      if (settled || !line.trim()) return;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      const value = frame as { id?: unknown; result?: unknown };
      if (value.id === 1 && value.result && !initialized) {
        initialized = true;
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: {} } });
        return;
      }
      if (value.id === 2) finish(textOf(value.result));
    });
    child.stdout.on("data", (chunk: Buffer) => splitter.push(chunk));
    child.stderr.resume();
    child.once("error", () => finish(null));
    child.once("close", () => finish(null));
    write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Sagax", version: "brief" } },
    });
  });
}

/** Tools a connected app actually offers. A server that does not answer
 * stays connected, with nothing to read. */
export async function listBriefApps(servers: Record<string, McpServerSpec>, disabled: Record<string, string[]>, signal?: AbortSignal): Promise<BriefApp[]> {
  const apps: BriefApp[] = [];
  for (const [name, server] of Object.entries(servers)) {
    let listed: McpProbeResult;
    try {
      listed = await probeMcpServer(server as StoredMcpServer, CALL_MS, signal, name);
    } catch {
      apps.push({ name, tools: [] });
      continue;
    }
    if (!listed.ok) {
      apps.push({ name, tools: [] });
      continue;
    }
    const off = new Set(disabled[name] ?? []);
    const tools = briefReadTools(listed.tools.map((tool) => tool.name).filter((tool) => !off.has(tool)));
    apps.push({ name, tools });
  }
  return apps;
}

/** One read of one connected app. Null when it does not answer. */
export function readBriefTool(server: McpServerSpec, tool: string, signal?: AbortSignal): Promise<string | null> {
  const timeout = AbortSignal.timeout(CALL_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return isRemoteMcpServer(server) ? callRemote(server, tool, combined) : callStdio(server, tool, combined);
}
