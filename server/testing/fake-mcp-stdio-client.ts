// A minimal stdio MCP client for the fake engine CLIs (#3286): one session on
// a server of the turn's MCP config, the calls in order, each answer's first
// text or "error <message>". The fake pi CLI and the fake Muse Code CLI call
// the agents server through it, as the real engines do with their own client.
import { spawn } from "node:child_process";

export interface StdioServer { command: string; args?: string[]; env?: Record<string, string> }
export interface McpCall { name: string; args: Record<string, unknown> }

export function callMcp(def: StdioServer, calls: McpCall[]): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(def.command, def.args ?? [], { env: { ...process.env, ...def.env }, stdio: ["pipe", "pipe", "ignore"] });
    const results: string[] = [];
    let step = -1;
    let buffer = "";
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) while (results.length < calls.length) results.push(`error ${error}`);
      child.kill();
      resolve(results);
    };
    const timer = setTimeout(() => finish("mcp timeout"), 120_000);
    const write = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const next = () => {
      step += 1;
      if (step >= calls.length) return finish();
      write({ jsonrpc: "2.0", id: step + 2, method: "tools/call", params: { name: calls[step]!.name, arguments: calls[step]!.args } });
    };
    child.on("error", (error) => finish(error.message));
    child.on("exit", () => finish("mcp exited"));
    child.stdin.on("error", (error) => finish(error.message));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: any;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === undefined || message.method !== undefined) continue;
        if (step === -1) {
          write({ jsonrpc: "2.0", method: "notifications/initialized" });
          next();
          continue;
        }
        results.push(message.error ? `error ${String(message.error.message ?? "call failed")}` : String(message.result?.content?.[0]?.text ?? ""));
        next();
      }
    });
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fake-engine", version: "1.0.0" } } });
  });
}

/** The calls a fake's environment scripts: `<PREFIX>_MCP_CALLS="tool,tool"`
 * with `<PREFIX>_MCP_CALL_ARGS='{"tool":{...}}'`. */
export function scriptedCalls(prefix: string): McpCall[] {
  const tools = (process.env[`${prefix}_MCP_CALLS`] ?? "").split(",").map((tool) => tool.trim()).filter(Boolean);
  let args: Record<string, Record<string, unknown>> = {};
  try { args = JSON.parse(process.env[`${prefix}_MCP_CALL_ARGS`] ?? "{}"); } catch { /* no arguments given */ }
  return tools.map((name) => ({ name, args: args[name] ?? {} }));
}
