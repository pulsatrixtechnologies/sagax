/** ACP MCP gate broker and session mcpServers list. */
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { newId } from "../../contracts.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { takeSafetyNote } from "../../safety-review.ts";
import { canUseMcpServer } from "../../../shared/tool-scope.ts";
import { gateServer, mcpStdioServer } from "../../mcp-gate-config.ts";
import type { GateAnswer, GateAsk } from "../../mcp-gate-approval.ts";
import type { AcpAskFinish, AcpSession, AcpSupport } from "./types.ts";

export type AcpMcpDeps = {
  support: AcpSupport;
  DENY_TIMEOUT_NOTE: string;
  sessions: Map<string, AcpSession>;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
};

export function createAcpMcp(deps: AcpMcpDeps) {
  const { support, DENY_TIMEOUT_NOTE, sessions, emit, base } = deps;

    // Sagax's approval gate for MCP calls (mcp-gate-approval.ts). One
    // socket per driver instance; each thread's gates carry that thread's
    // secret token, so a gate can only ever open a card on its own thread's
    // running turn. Every failure answers deny.
    const gateTokens = new Map<string, string>();
    const gateThreads = new Map<string, string>();
    let gateBroker: { path: string; server: NetServer } | undefined;
    const gateToken = (threadId: string): string => {
      let token = gateTokens.get(threadId);
      if (!token) {
        token = randomBytes(24).toString("hex");
        gateTokens.set(threadId, token);
        gateThreads.set(token, threadId);
      }
      return token;
    };
    const handleGateConnection = (conn: Socket) => {
      conn.setEncoding("utf8");
      const open = new Set<() => void>();
      const answer = (id: string, behavior: "allow" | "deny", note?: string) => {
        if (conn.destroyed) return;
        const message: GateAnswer = { t: "answer", id, behavior, ...(note ? { note } : {}) };
        conn.write(`${JSON.stringify(message)}\n`);
      };
      let buf = "";
      conn.on("data", (chunk: string) => {
        buf += chunk;
        if (buf.length > 1_000_000) { conn.destroy(); return; }
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let ask: Partial<GateAsk> | undefined;
          try { ask = JSON.parse(line); } catch { continue; }
          if (ask?.t !== "ask" || typeof ask.id !== "string" || !ask.id) continue;
          const askId = ask.id;
          const threadId = typeof ask.token === "string" ? gateThreads.get(ask.token) : undefined;
          const current = threadId ? sessions.get(threadId)?.current : undefined;
          if (!threadId || !current || current.state.settled || current.state.stopped
            || typeof ask.server !== "string" || typeof ask.tool !== "string" || !ask.server || !ask.tool) {
            answer(askId, "deny");
            continue;
          }
          current.flushAssistantText();
          const mcpTool = `${ask.server}__${ask.tool}`;
          const preview = typeof ask.summary === "string" && ask.summary ? ` ${ask.summary}` : "";
          const requestId = newId();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish: AcpAskFinish = (behavior, source = "user", message) => {
            if (!current.asks.delete(requestId)) return "unavailable";
            if (timer) clearTimeout(timer);
            open.delete(onClose);
            // only an explicit "allow" from a person runs the call
            const allow = behavior === "allow" && source === "user";
            const noted = allow ? undefined : (message?.trim() || takeSafetyNote(requestId));
            answer(askId, allow ? "allow" : "deny", noted);
            emit({
              ...base(threadId, current.turnId),
              type: "request.resolved",
              requestId,
              behavior: allow ? "allow" : "deny",
              source,
              approvalScope: current.controlsHost ? "local-computer" : undefined,
            });
            return allow ? "allowed-once" : "rejected";
          };
          const onClose = () => { finish("deny", "system"); };
          open.add(onClose);
          timer = setTimeout(() => {
            emit({ ...base(threadId, current.turnId), type: "runtime.error", message: DENY_TIMEOUT_NOTE });
            finish("deny", "timeout");
          }, 15 * 60_000);
          timer.unref?.();
          current.asks.set(requestId, finish);
          emit({
            ...base(threadId, current.turnId),
            type: "request.opened",
            requestId,
            requestType: "permission",
            tool: "other",
            summary: `${mcpTool}${preview}`.slice(0, 200),
            mcpTool,
            ...(typeof ask.review === "string" && ask.review ? { input: ask.review.slice(0, 2000) } : {}),
            sagaxGate: true,
            approvalScope: current.controlsHost ? "local-computer" : undefined,
            // never a session-wide grant: every call is its own card
          });
        }
      });
      const closeAll = () => { for (const onClose of Array.from(open)) onClose(); };
      conn.on("close", closeAll);
      conn.on("error", closeAll);
    };
    const gateSocket = (): string => {
      if (gateBroker) return gateBroker.path;
      const name = `sgx-gate-${process.pid}-${randomBytes(6).toString("hex")}`;
      const path = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
      const server = createNetServer(handleGateConnection);
      server.on("error", (error) => {
        console.error(`[acp] approval gate socket failed: ${String(error)}; gated MCP calls are declined`);
      });
      server.listen(path, () => {
        if (process.platform !== "win32") {
          try { chmodSync(path, 0o600); } catch { /* the token still guards it */ }
        }
      });
      server.unref();
      gateBroker = { path, server };
      return path;
    };

    // ACP session mcpServers: stdio is the baseline every ACP agent
    // supports (mcpCapabilities.http/.sse only add EXTRA transports), so
    // an injected stdio proxy — e.g. the peer-agent comms tool — attaches
    // fine here. env is the ACP {name,value}[] shape.
    //
    // A URL server is always mounted as Sagax's remote proxy, even
    // for an agent that advertises http/sse: the proxy opens the
    // connection with the same minimal handshake as Settings → Test
    // (mcp-http.ts), where an agent's own MCP client adds capability
    // fields a strict server refuses (grok 1.0.25 sends
    // capabilities.extensions; rmcp 3.2, which it links, can add
    // elicitation.form.schemaValidation, the field a Voluum
    // server named before every tool came back "Tool not found"). The
    // catalog passes through whole: the agent searches tools itself.
    type AcpMcpServer = { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> };
    const acpMcpServers = (turn: SendTurnInput, approvalGated = false) => {
      const servers: AcpMcpServer[] = [];
      const acpEnv = (env: Record<string, string>) =>
        Object.entries(env).map(([name, value]) => ({ name, value: String(value) }));
      const agents = turn.integrations?.agents;
      if (agents) {
        servers.push({ name: "agents", command: agents.command, args: agents.args, env: acpEnv(agents.env) });
      }
      const browser = turn.integrations?.browser;
      if (browser) {
        servers.push({ name: "browser", command: browser.command, args: browser.args, env: acpEnv(browser.env) });
      }
      const data = turn.integrations?.data;
      if (data) {
        servers.push({ name: "data", command: data.command, args: data.args, env: acpEnv(data.env) });
      }
      // 2026-10-28: Messages (iMessage on this Mac), as Claude Code, Codex,
      // pi and the chat engines mount it: the turn's prompt names it. A
      // send still waits on the person's card (index.ts send_message).
      const messages = turn.integrations?.messages;
      if (messages) {
        servers.push({ name: "messages", command: messages.command, args: messages.args, env: acpEnv(messages.env) });
      }
      // The bot's computer, mounted exactly like the Claude driver does:
      // host and sandbox Cua connections expose Cua Driver's own MCP server.
      // (A cloud boat is not mounted here at all: a cloud turn runs ON the boat.)
      if (turn.integrations?.localComputer) {
        const local = turn.integrations.localComputer;
        servers.push({
          name: "computer",
          command: local.command,
          args: local.args,
          env: acpEnv(local.env ?? {}),
        });
      }
      // user-configured servers, after the built-ins: a residual name
      // collision keeps the built-in (reserved names are filtered at the
      // config boundary; this is defense in depth).
      const custom = new Set<string>();
      for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
        if (servers.some((existing) => existing.name === name)) continue;
        const stdio = "url" in server ? mcpStdioServer(server, { nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } }) : server;
        if (!stdio) {
          // Never a silent drop: a connector that cannot be mounted says so.
          console.warn(`[acp] MCP server "${name}" could not be mounted for ${support.displayName}: unsupported server shape; its tools are NOT available this turn`);
          continue;
        }
        servers.push({ name, command: stdio.command, args: stdio.args ?? [], env: acpEnv(stdio.env ?? {}) });
        custom.add(name);
      }
      // Approval gate: EVERY server rides the gate, built-in or not, and
      // only its reviewed read-only tools pass unasked.
      const customSpecs = turn.integrations?.custom ?? {};
      const approvalFor = (server: AcpMcpServer) => ({
        socket: gateSocket(),
        token: gateToken(turn.threadId),
        readOnly: support.approvalReadOnly?.({
          name: server.name,
          builtin: !custom.has(server.name),
          ...(custom.has(server.name) ? { spec: customSpecs[server.name] } : {}),
        }, turn.botId) ?? [],
      });
      // Sagax's own servers (agents, browser, computer) name their
      // tools admissibly; connectors (Perspicax profiles, URL and stdio
      // servers) can name them anything, so those ride the gate.
      const toolNames = support.mcpToolNames;
      const renames = (server: AcpMcpServer) => Boolean(toolNames) && custom.has(server.name);
      if (turn.toolScope === undefined && !servers.some(renames) && !approvalGated) return servers;
      return servers.filter((server) => turn.toolScope === undefined || canUseMcpServer(turn.toolScope, server.name)).map((server) => {
        if (turn.toolScope === undefined && !renames(server) && !approvalGated) return server;
        const original = { command: server.command, args: server.args, env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])) };
        const gated = gateServer({ name: server.name, server: original, threadId: turn.threadId, budget: 0,
          toolScope: turn.toolScope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" }, ...(toolNames && renames(server) ? { toolNames } : {}),
          ...(approvalGated ? { approval: approvalFor(server) } : {}) });
        if (!gated) throw new Error(turn.toolScope === undefined && !approvalGated ? "Tool names require an MCP gate." : "Tool selection requires an MCP gate.");
        return { name: server.name, command: gated.command, args: gated.args, env: acpEnv(gated.env) };
      });
    };


  return { gateToken, gateSocket, handleGateConnection, acpMcpServers, getGateBroker: () => gateBroker };
}
