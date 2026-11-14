#!/usr/bin/env node
// Fake of the Muse Code CLI for the connector matrix (#3286): `--version`, and
// `serve ...` speaking the Muse Session Protocol the way @muse-code/sdk reads
// it (server/drivers/muse-code.ts): newline-delimited JSON-RPC 2.0 on stdio,
// `initialize` with the schema fingerprint and the granted `sessionMcp`
// capability, `model/list`, `session/start` / `session/resume` /
// `session/setApprovalMode` / `session/setModel`, and `turn/start`, which
// runs the turn and settles it with `item/completed` and `turn/completed`
// notifications. A turn connects the "agents" server of the session's
// `config.mcpServers` as Muse's own MCP client and calls, in order,
// FAKE_MUSE_MCP_CALLS="tool,tool" with FAKE_MUSE_MCP_CALL_ARGS='{"tool":{...}}',
// each a toolCall item, then replies "agents:<tool> -> <result>" per call.
//
//   FAKE_MUSE_MODELS comma-separated model ids (default "fake-model")
//   FAKE_MUSE_NO_MCP grant no sessionMcp, as a Muse Code too old for it
import { callMcp, scriptedCalls, type StdioServer } from "./fake-mcp-stdio-client.ts";

/** The stable schema fingerprint @muse-code/sdk 1.4.6 pins; a mismatch is
 * only a warning in the SDK, the same pin keeps the fake quiet. */
const FINGERPRINT = "sha256:eae467ab60cb9a5d5af4de616830f065e59375c987fd59269c8cc33ed2a1137f";

if (process.argv.includes("--version")) {
  process.stdout.write("muse 1.0.0 (fake)\n");
  process.exit(0);
}
if (process.argv[2] !== "serve") {
  process.stderr.write(`fake muse: unsupported command ${process.argv.slice(2).join(" ")}\n`);
  process.exit(2);
}

const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method: string, params: Record<string, unknown>) => send({ jsonrpc: "2.0", method, params });
const answer = (id: unknown, result: Record<string, unknown>) => send({ jsonrpc: "2.0", id, result });

interface Session { sessionId: string; modelId: string; agents: StdioServer | null }
const sessions = new Map<string, Session>();
let counter = 0;

function agentsOf(params: Record<string, any>): StdioServer | null {
  const server = params.config?.mcpServers?.agents;
  return server && typeof server.command === "string" ? { command: server.command, args: server.args ?? [], env: server.env ?? {} } : null;
}

async function runTurn(session: Session, turnId: string) {
  const { sessionId } = session;
  const calls = scriptedCalls("FAKE_MUSE");
  const lines: string[] = [];
  for (const [index, call] of calls.entries()) {
    const item = { itemId: `tool_${turnId}_${index}`, kind: "toolCall", turnId, tool: `agents_${call.name}`, args: JSON.stringify(call.args) };
    notify("item/started", { sessionId, item: { ...item, status: "inProgress" } });
    const [result = ""] = session.agents ? await callMcp(session.agents, [call]) : ["error not mounted"];
    const failed = result.startsWith("error ");
    notify("item/completed", { sessionId, item: { ...item, status: failed ? "failed" : "completed", visibleOutput: result, ...(failed ? { failureReason: result } : {}) } });
    lines.push(`agents:${call.name} -> ${result}`);
  }
  const text = lines.length ? lines.join("\n") : "ok";
  notify("item/completed", { sessionId, item: { itemId: `msg_${turnId}`, kind: "agentMessage", status: "completed", turnId, text } });
  notify("turn/completed", { sessionId, turnId, terminal: "completed", usage: { inputTokens: 12, outputTokens: 2 } });
}

function handle(message: Record<string, any>) {
  if (typeof message.method !== "string" || message.id === undefined) return; // notifications and answers
  const params = (message.params ?? {}) as Record<string, any>;
  const ack = (extra: Record<string, unknown> = {}) => answer(message.id, { ...(params.commandId !== undefined ? { commandId: params.commandId } : {}), ...extra });
  switch (message.method) {
    case "initialize":
      answer(message.id, {
        schema: { fingerprint: FINGERPRINT },
        grantedCapabilities: process.env.FAKE_MUSE_NO_MCP ? [] : (params.capabilities?.requestedCapabilities ?? []),
        serverInfo: { name: "fake-muse", version: "1.0.0" },
      });
      return;
    case "model/list": {
      const ids = (process.env.FAKE_MUSE_MODELS ?? "fake-model").split(",").map((id) => id.trim()).filter(Boolean);
      answer(message.id, { models: ids.map((modelId, index) => ({ modelId, isDefault: index === 0 })) });
      return;
    }
    case "session/start": {
      const sessionId = `muse-session-${++counter}`;
      const session = { sessionId, modelId: String(params.modelId ?? "fake-model"), agents: agentsOf(params) };
      sessions.set(sessionId, session);
      answer(message.id, { session: { sessionId, modelId: session.modelId } });
      return;
    }
    case "session/resume": {
      const sessionId = String(params.sessionId ?? "");
      const known = sessions.get(sessionId);
      // a fresh host knows no session: the driver then starts a new one
      if (!known) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32004, message: "session not found", data: { kind: "sessionNotFound" } } });
        return;
      }
      known.agents = agentsOf(params) ?? known.agents;
      answer(message.id, { session: { sessionId, modelId: known.modelId } });
      return;
    }
    case "session/setModel": {
      const session = sessions.get(String(params.sessionId ?? ""));
      if (session && typeof params.model?.modelId === "string") session.modelId = params.model.modelId;
      ack();
      return;
    }
    case "turn/start": {
      const session = sessions.get(String(params.sessionId ?? ""));
      ack();
      if (session) void runTurn(session, String(params.commandId));
      return;
    }
    case "turn/interrupt":
      ack();
      notify("turn/completed", { sessionId: params.sessionId, turnId: params.turnId, terminal: "cancelled" });
      return;
    default:
      ack(); // session/setApprovalMode, turn/steer, approval/decide: accepted
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { /* not a frame */ }
  }
});
// the SDK closes a host by ending its stdin
process.stdin.on("end", () => process.exit(0));
