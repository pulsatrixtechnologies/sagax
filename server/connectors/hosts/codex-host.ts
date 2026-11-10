// The Codex connector host (#3353, connectors across engines L10; design
// docs/design/connectors-across-engines.md, part P4, measure M6 in
// docs/verification/connectors-hub-measures.md).
//
// One approved call of a person's ChatGPT app, on that person's own Codex
// sign-in on ChatGPT: a short `codex app-server` on that sign-in's own
// CODEX_HOME, `thread/start` (ephemeral, no turn), then
// `mcpServer/tool/call` on the `codex_apps` server with the approved tool
// and arguments. No model runs: no `turn/start` is ever sent, so nothing but
// the approved call can run. The same app-server reads the person's apps for
// the registry (`mcpServerStatus/list`). The process is ended before the
// call returns. No token is read or kept: Codex uses the sign-in it already
// has.
//
// M6: Codex asks the client nothing for such a call, so the held request of
// the calling turn (the person's own approval settings, P5) is the only
// decision. Should Codex ask for that same call anyway (its app-access form
// or its MCP tool approval), the host answers it as the person already
// decided: the approved call runs. Any other request (a command, a file, a
// question) is not part of the call and is answered as not available.
import { isAbsolute } from "node:path";
import { homedir } from "node:os";

import { codexHome } from "../../drivers/codex-identity.ts";
import { mcpAppApprovalForm } from "../../drivers/codex/approvals.ts";
import { engineStartGate } from "../../engines/engine-start-gate.ts";
import { killCliTree, spawnCli } from "../../procs.ts";
import { CODEX_APPS_SERVER, chatgptAppsDescribe, chatgptAppsResult, chatgptAppsRuleTool, chatgptAppsToolId, codexAccountAuth, type CodexAppsListing } from "../providers/chatgpt-apps.ts";
import type { ConnectorAccount } from "../types.ts";
import type { ConnectorHost, ConnectorHostCall, ConnectorHostResult } from "./types.ts";

/** The person's own Codex CLI on one sign-in: its command and environment
 * (CODEX_HOME in that sign-in's folder). */
export interface CodexConnectorLaunch {
  cli: string;
  env: Record<string, string | undefined>;
}

export interface CodexConnectorHostDeps {
  /** The sign-in that carries the account, or undefined when the person is
   * not signed in to it (the Connect card is posted). Never another
   * person's: the principal is the turn's. */
  launch(principalId: string, account: Pick<ConnectorAccount, "instanceId" | "slot">): CodexConnectorLaunch | undefined;
  /** Default: the engine start gate's probe slots. */
  gate?<T>(label: string, run: () => Promise<T>): Promise<T>;
  /** Default 90 s: a cold app-server (about 1 s measured) and the tool. */
  timeoutMs?: number;
  /** Default 30 s: a cold app-server and the list (under 100 ms measured). */
  listTimeoutMs?: number;
  now?: () => number;
}

export interface CodexConnectorHost extends ConnectorHost {
  /** Read one sign-in's ChatGPT apps (the registry's read); undefined when
   * Codex did not answer. */
  listApps(launch: CodexConnectorLaunch): Promise<CodexAppsListing | undefined>;
}

const CALL_TIMEOUT_MS = 90_000;
const LIST_TIMEOUT_MS = 30_000;
/** Pages of mcpServerStatus/list read at most (one answered on the measured account). */
const LIST_PAGES_MAX = 20;
const MESSAGE_MAX = 4 * 1024 * 1024;
/** Signs that Codex's own answer is about the sign-in, not the tool. */
const SIGN_IN_ERROR = /auth|sign.?in|log.?in|expired|unauthori[sz]ed|credential|refresh.?token/i;

/** The argv of one call: Codex's app-server, nothing else (no model runs). */
export function codexConnectorHostArgs(): string[] {
  return ["app-server"];
}

/** The environment of one call: the sign-in's own (CODEX_HOME), never an
 * API key, which carries no ChatGPT apps. */
export function codexConnectorHostEnv(base: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  delete env.OPENAI_API_KEY;
  return env;
}

/** The app-server methods the host sends, in order (M6), and the one it
 * never sends: no `turn/start`, so no model runs. */
export const CODEX_CONNECTOR_HOST_METHODS = ["initialize", "initialized", "account/read", "thread/start", "mcpServerStatus/list", "mcpServer/tool/call"] as const;

type RpcMessage = { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { message?: unknown } };

class RpcError extends Error {}

/** One short app-server on one sign-in: requests, the answers Codex's own
 * requests get, and an end that waits for the process to be gone. */
interface AppServer {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  cwd: string;
}

/** What the host answers a request Codex sends during the call. */
function answerServerRequest(method: string, params: unknown): { result: unknown } | { error: { code: number; message: string } } {
  if (method === "mcpServer/elicitation/request") {
    const value = (params ?? {}) as { serverName?: unknown; _meta?: { codex_approval_kind?: unknown } };
    const ours = value.serverName === undefined || value.serverName === CODEX_APPS_SERVER;
    // the approved call itself: the person's settings already decided it
    if (ours && value._meta?.codex_approval_kind === "mcp_tool_call") return { result: { action: "accept", content: {} } };
    const form = ours ? mcpAppApprovalForm(params) : null;
    if (form) return { result: form.allowResult };
    return { result: { action: "decline" } };
  }
  return { error: { code: -32601, message: "not available to a connector call" } };
}

export function createCodexConnectorHost(deps: CodexConnectorHostDeps): CodexConnectorHost {
  const gate = deps.gate ?? (<T>(label: string, run: () => Promise<T>) => engineStartGate.run("probe", label, run));
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
  const listTimeoutMs = deps.listTimeoutMs ?? LIST_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const running = new Set<ReturnType<typeof spawnCli>>();

  /** Run `work` on a fresh app-server of this sign-in; the process is gone
   * before the answer returns. Rejects on a timeout or an early exit. */
  function withAppServer<T>(launch: CodexConnectorLaunch, limitMs: number, work: (server: AppServer) => Promise<T>): Promise<T> {
    const env = codexConnectorHostEnv(launch.env);
    const home = codexHome(env);
    const cwd = home && isAbsolute(home) ? home : env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir();
    return new Promise<T>((resolve, reject) => {
      let child: ReturnType<typeof spawnCli>;
      try {
        child = spawnCli(launch.cli, codexConnectorHostArgs(), { cwd, env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      running.add(child);
      let settled = false;
      let nextId = 0;
      const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
      const end = (outcome: { value: T } | { error: Error }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const entry of pending.values()) entry.reject(new Error("the app-server stopped"));
        pending.clear();
        void killCliTree(child, 1_000).then((stopped) => {
          if (!stopped) { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
        }).catch(() => undefined).finally(() => {
          running.delete(child);
          if ("value" in outcome) resolve(outcome.value);
          else reject(outcome.error);
        });
      };
      const timer = setTimeout(() => end({ error: new Error("timeout") }), limitMs);
      const write = (message: unknown) => {
        try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { /* the exit handler ends it */ }
      };
      child.stdin.on("error", () => { /* the exit handler ends it */ });
      // never kept nor logged: raw CLI errors may name the account
      child.stderr.resume();
      child.on("error", (error) => end({ error }));
      child.on("close", () => end({ error: new Error("the app-server stopped") }));
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > MESSAGE_MAX) { end({ error: new Error("answer too large") }); return; }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let message: RpcMessage;
          try { message = JSON.parse(line) as RpcMessage; } catch { continue; }
          if (typeof message.method === "string" && message.id !== undefined) {
            write({ jsonrpc: "2.0", id: message.id, ...answerServerRequest(message.method, message.params) });
          } else if (message.method === undefined && typeof message.id === "number" && pending.has(message.id)) {
            const entry = pending.get(message.id)!;
            pending.delete(message.id);
            if (message.error) entry.reject(new RpcError(String(message.error.message ?? "error")));
            else entry.resolve(message.result);
          }
        }
      });
      const server: AppServer = {
        cwd,
        request: (method, params) => new Promise((resolveRequest, rejectRequest) => {
          const id = ++nextId;
          pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
          write({ jsonrpc: "2.0", id, method, params });
        }),
        notify: (method, params) => write({ jsonrpc: "2.0", method, params }),
      };
      work(server).then((value) => end({ value }), (error: unknown) => end({ error: error instanceof Error ? error : new Error(String(error)) }));
    });
  }

  /** initialize, then what the sign-in is (account/read). */
  async function open(server: AppServer): Promise<CodexAppsListing["auth"]> {
    await server.request("initialize", { clientInfo: { name: "sagax", title: "Sagax", version: "1" }, capabilities: { experimentalApi: true } });
    server.notify("initialized", {});
    const read = await server.request("account/read", { refreshToken: false }) as { account?: unknown } | undefined;
    return codexAccountAuth(read?.account === undefined ? undefined : read.account);
  }

  async function startThread(server: AppServer): Promise<string> {
    const started = await server.request("thread/start", { cwd: server.cwd, ephemeral: true }) as { thread?: { id?: unknown } } | undefined;
    const id = started?.thread?.id;
    if (typeof id !== "string" || !id) throw new RpcError("no thread");
    return id;
  }

  async function listApps(launch: CodexConnectorLaunch): Promise<CodexAppsListing | undefined> {
    try {
      return await gate(`${launch.cli} app-server (connector list)`, () => withAppServer(launch, listTimeoutMs, async (server) => {
        const auth = await open(server);
        if (auth !== "subscription") return { auth, servers: [], at: now() };
        await startThread(server);
        const servers: unknown[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < LIST_PAGES_MAX; page++) {
          const answer = await server.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) }) as { data?: unknown; nextCursor?: unknown } | undefined;
          if (Array.isArray(answer?.data)) servers.push(...answer.data);
          cursor = typeof answer?.nextCursor === "string" && answer.nextCursor ? answer.nextCursor : undefined;
          if (!cursor) break;
        }
        return { auth, servers, at: now() };
      }));
    } catch {
      return undefined;
    }
  }

  const signIn = (name: string, why?: string): ConnectorHostResult => ({
    text: `${name} needs a sign-in to Codex with ChatGPT before it can be called${why ? ` (${why})` : ""}. The Connect card was posted: once signed in, call it again.`,
    isError: true,
    needsSignIn: true,
  });

  async function call(request: ConnectorHostCall): Promise<ConnectorHostResult> {
    const name = request.connector.name;
    const launch = deps.launch(request.principalId, request.account);
    if (!launch) return signIn(name);
    const tool = chatgptAppsToolId(request.connector, request.tool) ?? request.tool;
    try {
      return await gate(`${launch.cli} app-server (connector call)`, () => withAppServer(launch, timeoutMs, async (server): Promise<ConnectorHostResult> => {
        const auth = await open(server);
        if (auth === "none") return signIn(name);
        if (auth === "key") return signIn(name, "this Codex sign-in is an API key, which carries no ChatGPT apps");
        const threadId = await startThread(server);
        try {
          const result = await server.request("mcpServer/tool/call", { server: CODEX_APPS_SERVER, threadId, tool, arguments: request.arguments });
          return chatgptAppsResult(result);
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          if (error instanceof RpcError && SIGN_IN_ERROR.test(why)) return signIn(name);
          throw error;
        }
      }));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (why === "timeout") return { text: `${name} did not answer in time, so its result is unknown.`, isError: true };
      if (error instanceof RpcError) return { text: `Codex did not run ${tool} of ${name}: ${why}`, isError: true };
      return { text: `Codex could not start for ${name}: ${why}`, isError: true };
    }
  }

  return {
    provider: "chatgpt-apps",
    call,
    ruleTool: (connector, tool) => chatgptAppsRuleTool(connector, tool),
    async list(_principalId, _account, connector) {
      return connector.tools.map((entry) => chatgptAppsDescribe(connector, entry.id) ?? { id: entry.id });
    },
    async describe(_principalId, _account, connector, tool) {
      return chatgptAppsDescribe(connector, tool);
    },
    listApps,
    close() {
      for (const child of running) {
        try { child.kill(); } catch { /* already gone */ }
      }
      running.clear();
    },
  };
}
