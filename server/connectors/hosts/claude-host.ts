// The Claude connector host (#3352, connectors across engines L9; design
// docs/design/connectors-across-engines.md, part P4, measures M1, M2 and M8
// in docs/verification/connectors-hub-measures.md).
//
// One approved call of a person's claude.ai connector, on that person's own
// Claude sign-in: the pinned `claude -p` of the artifact runner
// (server/claude-artifacts/pinned-call.ts), with the account's connectors
// left on (no strict flag, user settings kept, ENABLE_CLAUDEAI_MCP_SERVERS
// not set to false) and only ToolSearch allowed. The connector tool is not
// allowed: an ask rule sends it to the permission prompt tool Sagax ships
// (server/permission-proxy.ts) even when the account's own settings allow
// it, and the host answers that ask itself, before the tool runs. It allows
// the first ask only when it names the approved tool with an input equal to
// the approved arguments; any other ask is refused, so nothing but the
// approved call runs. The result is read from the tool's own frame. No
// token is read or kept: the CLI uses the sign-in it already has.
//
// #3357 (L14): the round's usage (the result line's tokens and cost) is
// handed back for the calling thread. This host keeps no warm process: each
// call's settings name its one approved tool, and `claude -p` reads its
// settings once, at its start.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPinnedClaudeCall, type PinnedClaudeChild, type PinnedClaudeSpawn } from "../../claude-artifacts/pinned-call.ts";
import { connectorReauthFailure } from "../../../shared/connector-setup.ts";
import { engineStartGate } from "../../engines/engine-start-gate.ts";
import { killCliTree } from "../../procs.ts";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import { claudeAiCallIsApproved, claudeAiCallResult, claudeAiPinnedPrompt, claudeAiServerStatus, claudeAiToolId } from "../providers/claude-ai.ts";
import type { ConnectorAccount, ConnectorEntry } from "../types.ts";
import type { ConnectorHost, ConnectorHostCall, ConnectorHostResult, ConnectorHostUsage } from "./types.ts";

/** The person's own Claude CLI on one sign-in: its command and environment
 * (CLAUDE_CONFIG_DIR in that sign-in's folder). */
export interface ClaudeConnectorLaunch {
  cli: string;
  env: NodeJS.ProcessEnv;
}

export interface ClaudeConnectorHostDeps {
  /** The sign-in that carries the account, or undefined when the person is
   * not signed in to it (the Connect card is posted). Never another
   * person's: the principal is the turn's. */
  launch(principalId: string, account: ConnectorAccount): ClaudeConnectorLaunch | undefined;
  /** Default: the engine start gate's probe slots. */
  gate?<T>(label: string, run: () => Promise<T>): Promise<T>;
  /** Default 90 s, the artifact runner's limit: a cold start, tool search,
   * the call (6.2 s measured). */
  timeoutMs?: number;
  model?: string;
  spawn?: PinnedClaudeSpawn;
}

export const CLAUDE_CONNECTOR_MODEL = "haiku";
const CALL_TIMEOUT_MS = 90_000;
/** The permission prompt tool's server, as the turn mounts it. */
const PROMPT_SERVER = "ogb";
const PROMPT_TOOL = `mcp__${PROMPT_SERVER}__approve`;

const SYSTEM_PROMPT = "Make exactly the tool call the user message names, with exactly the input it gives, then stop. Load the deferred tool with ToolSearch first. Reply with nothing else.";

/** The argv of one pinned call. No `--strict-mcp-config` and no
 * `--setting-sources`: either one drops the account's connectors (M8). */
export function claudeConnectorHostArgs(files: { mcpConfig: string; settings: string }, model = CLAUDE_CONNECTOR_MODEL): string[] {
  return [
    "-p", "--model", model,
    "--output-format", "stream-json", "--verbose",
    "--tools", "ToolSearch",
    "--allowedTools", "ToolSearch",
    "--permission-mode", "default",
    "--permission-prompt-tool", PROMPT_TOOL,
    "--mcp-config", files.mcpConfig,
    "--settings", files.settings,
    "--system-prompt", SYSTEM_PROMPT,
  ];
}

/** The environment of one pinned call: the sign-in's own, the account's
 * connectors on, tool search on, never an API key (connectors load on a
 * subscription sign-in only). */
export function claudeConnectorHostEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ENABLE_TOOL_SEARCH: "true", SAGAX_CLAUDE_CONNECTOR_CALL: "1" };
  delete env.ENABLE_CLAUDEAI_MCP_SERVERS;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

/** The launch's own settings: the connector tool always asks, so the
 * account's allow rules never let a different input run unchecked. */
export function claudeConnectorHostSettings(toolId: string): Record<string, unknown> {
  return { permissions: { ask: [toolId] } };
}

const signIn = (name: string): ConnectorHostResult => ({
  text: `${name} needs a new sign-in to Claude before it can be called. The Connect card was posted: once signed in, call it again.`,
  isError: true,
  needsSignIn: true,
});

function socketPath(): string {
  const tag = randomBytes(6).toString("hex");
  return process.platform === "win32" ? `\\\\.\\pipe\\sagax-connector-${tag}` : join(tmpdir(), `sgx-conn-${tag}.sock`);
}

interface Ask { t?: unknown; id?: unknown; kind?: unknown; tool?: unknown; input?: unknown }

/** The broker the permission proxy speaks to, for one call: it answers the
 * proxy's asks itself (the person's settings already decided the call). */
function pinnedBroker(path: string, decide: (ask: Ask) => { behavior: "allow" | "deny"; message?: string }): Promise<Server> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let ask: Ask;
          try { ask = JSON.parse(line) as Ask; } catch { continue; }
          if (ask.t !== "ask") continue;
          const answer = decide(ask);
          try { socket.write(`${JSON.stringify({ t: "answer", id: ask.id, ...answer, source: "system" })}\n`); } catch { /* the CLI is gone */ }
        }
      });
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    });
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      const close = server.close.bind(server);
      server.close = ((callback?: (error?: Error) => void) => {
        for (const socket of sockets) socket.destroy();
        return close(callback);
      }) as Server["close"];
      resolve(server);
    });
  });
}

/** #3357: the model round of one pinned `claude -p` call, from its stream:
 * the model its init names, the result line's usage (input is the whole
 * prompt: fresh, cache reads and cache writes; cachedInput the reads) and
 * its reported cost. Undefined when the stream has no result line. */
export function claudePinnedUsage(stdout: string, fallbackModel: string): ConnectorHostUsage | undefined {
  let model: string | undefined;
  let usage: ConnectorHostUsage | undefined;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let frame: { type?: unknown; subtype?: unknown; model?: unknown; usage?: Record<string, unknown>; total_cost_usd?: unknown };
    try { frame = JSON.parse(line); } catch { continue; }
    if (frame.type === "system" && frame.subtype === "init" && typeof frame.model === "string" && frame.model.trim()) model = frame.model.trim();
    if (frame.type === "result" && frame.usage && typeof frame.usage === "object") {
      const fresh = count(frame.usage.input_tokens);
      const reads = count(frame.usage.cache_read_input_tokens);
      const writes = count(frame.usage.cache_creation_input_tokens);
      const cost = typeof frame.total_cost_usd === "number" && Number.isFinite(frame.total_cost_usd) && frame.total_cost_usd >= 0 ? frame.total_cost_usd : null;
      usage = { model: "", input: fresh + reads + writes, output: count(frame.usage.output_tokens), ...(reads ? { cachedInput: reads } : {}), costUsd: cost };
    }
  }
  return usage ? { ...usage, model: model ?? fallbackModel } : undefined;
}

export function createClaudeConnectorHost(deps: ClaudeConnectorHostDeps): ConnectorHost {
  const gate = deps.gate ?? (<T>(label: string, run: () => Promise<T>) => engineStartGate.run("probe", label, run));
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
  const running = new Set<PinnedClaudeChild>();

  async function call(request: ConnectorHostCall): Promise<ConnectorHostResult> {
    const connector: ConnectorEntry = request.connector;
    const name = connector.name;
    const toolId = claudeAiToolId(connector, request.tool);
    if (!toolId) return { text: `${request.tool} is not a tool of ${name}, so nothing was run.`, isError: true };
    if (connector.state === "needs-sign-in") return signIn(name);
    const launch = deps.launch(request.principalId, request.account);
    if (!launch) return signIn(name);
    const input = request.arguments;
    let staging: string;
    try {
      staging = realpathSync(mkdtempSync(join(tmpdir(), "sagax-claude-connector-")));
    } catch (error) {
      return { text: `Claude could not start for ${name}: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
    let asked = false;
    let allowed = false;
    let refused: { tool?: string; altered: boolean } | undefined;
    const decide = (ask: Ask): { behavior: "allow" | "deny"; message?: string } => {
      // a question to the person: this call has none to ask
      if (ask.kind === "question") return { behavior: "deny", message: "Sagax: no question can be asked during a connector call." };
      // finding the tool runs nothing
      if (ask.tool === "ToolSearch") return { behavior: "allow" };
      // only the first ask can be the approved call; every other is refused
      const first = !asked;
      asked = true;
      if (first && claudeAiCallIsApproved(ask.tool, ask.input, toolId, input)) {
        allowed = true;
        return { behavior: "allow" };
      }
      refused ??= { ...(typeof ask.tool === "string" ? { tool: ask.tool } : {}), altered: ask.tool === toolId };
      return { behavior: "deny", message: "Sagax: only the approved call runs here, exactly as approved. Stop now." };
    };
    let broker: Server | undefined;
    try {
      const path = socketPath();
      broker = await pinnedBroker(path, decide);
      const mcpConfig = join(staging, "mcp.json");
      const settings = join(staging, "settings.json");
      writeFileSync(mcpConfig, JSON.stringify({
        mcpServers: {
          [PROMPT_SERVER]: { command: process.execPath, args: [SPAWNED_PROXIES.permission, path], env: { ELECTRON_RUN_AS_NODE: "1" } },
        },
      }), { mode: 0o600 });
      writeFileSync(settings, JSON.stringify(claudeConnectorHostSettings(toolId)), { mode: 0o600 });
      const args = claudeConnectorHostArgs({ mcpConfig, settings }, deps.model);
      const env = claudeConnectorHostEnv(launch.env);
      const stdout = await gate(`${launch.cli} -p (connector call)`, () => runPinnedClaudeCall({
        cli: launch.cli,
        args,
        env,
        cwd: staging,
        prompt: claudeAiPinnedPrompt(toolId, input),
        timeoutMs,
        label: name,
        ...(deps.spawn ? { spawn: deps.spawn } : {}),
        onChild: (child, alive) => { if (alive) running.add(child); else running.delete(child); },
      }));
      const read = claudeAiCallResult(stdout.out, toolId);
      // #3357: the pinned round's own usage, for the calling thread
      const usage = claudePinnedUsage(stdout.out, deps.model ?? CLAUDE_CONNECTOR_MODEL);
      if (read.ran && allowed) {
        const result = read.result;
        if (result.isError && connectorReauthFailure(toolId, result.text)) return { ...signIn(name), text: `${signIn(name).text}\n${result.text}` };
        return usage ? { ...result, usage } : result;
      }
      if (refused) {
        return {
          ...(usage ? { usage } : {}),
          text: refused.altered
            ? `Claude asked to run ${toolId} with other input than the approved call, so it was not run and nothing was sent.`
            : `Claude asked to run ${refused.tool ?? "another tool"} instead of the approved ${toolId}, so it was not run and nothing was sent.`,
          isError: true,
        };
      }
      if (read.ran) {
        // ran without passing the check: never reported as the approved call
        return { ...(usage ? { usage } : {}), text: `Claude ran ${toolId} without the check of the approved call, so its result is not used.`, isError: true };
      }
      if (stdout.error && stdout.error.endsWith("timed out")) return { text: `${name} did not answer in time, so its result is unknown.`, isError: true };
      const status = claudeAiServerStatus(read.reading.servers, name);
      const said = read.reading.finalText.trim();
      if ((status && /needs.?auth/i.test(status)) || connectorReauthFailure(toolId, said) || /not logged in|please run \/login|invalid api key/i.test(said)) return signIn(name);
      if (status && /fail/i.test(status)) return { text: `${name} failed to connect on Claude, so nothing was run.`, isError: true };
      if (stdout.error) return { text: `Claude could not run ${name}: ${stdout.error}`, isError: true };
      return { ...(usage ? { usage } : {}), text: `Claude ended without calling ${toolId}, so nothing was run.${said ? ` It said: ${said.slice(0, 500)}` : ""}`, isError: true };
    } catch (error) {
      return { text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    } finally {
      await new Promise<void>((done) => { if (broker) broker.close(() => done()); else done(); });
      try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  return {
    provider: "claude-ai",
    call,
    close() {
      for (const child of running) {
        void killCliTree(child).catch(() => { /* already gone */ });
      }
      running.clear();
    },
  };
}
