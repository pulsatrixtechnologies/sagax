// The Grok connector host (#3350, connectors across engines L7; design
// docs/design/connectors-across-engines.md, part P4, measure M4 in
// docs/verification/connectors-hub-measures.md).
//
// One approved call of a person's grok.com connector, on that person's own
// Grok sign-in: a standalone `grok --permission-mode default agent
// --no-leader stdio` in the sign-in's own folder (GROK_HOME), with the
// managed gateway on, as probeGrokReach (server/drivers/acp/grok.ts) starts
// it. One pinned prompt asks for one use_tool call; in `default` mode Grok
// asks before it runs, and the host allows that ask only when it names the
// approved tool with an input equal to the approved arguments. Any other ask
// is refused, so nothing but the approved call runs. The result is read from
// the tool's own update and the prompt is cancelled. No token is read or
// kept: the CLI uses the sign-in it already has.
//
// #3357 (L14): the process stays warm for the next call of the same person
// on the same sign-in (server/connectors/host-pool.ts): each call opens its
// own session in it, so the exactness check is per call, and the model
// round each call spends (the cancelled prompt's own usage) is handed back
// for the calling thread's usage.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { grokCloudConnectorEnv, grokHome, readGrokModelsCache } from "../../drivers/acp/grok.ts";
import { engineStartGate } from "../../engines/engine-start-gate.ts";
import { resolveCli } from "../../procs.ts";
import { createConnectorHostPool, type ConnectorHostPoolOptions, type PoolWork, type WarmProcess } from "../host-pool.ts";
import { grokAskedCall, grokAskIsApproved, grokComDescribe, grokPinnedPrompt, grokToolResult } from "../providers/grok-com.ts";
import type { ConnectorAccount } from "../types.ts";
import type { ConnectorHost, ConnectorHostCall, ConnectorHostResult, ConnectorHostUsage } from "./types.ts";

/** The person's own Grok CLI on one sign-in: its command and environment
 * (HOME and GROK_HOME in that sign-in's folder). */
export interface GrokConnectorLaunch {
  cli: string;
  env: Record<string, string | undefined>;
}

export interface GrokConnectorHostDeps {
  /** The sign-in that carries the account, or undefined when the person is
   * not signed in to it (the Connect card is posted). Never another
   * person's: the principal is the turn's. */
  launch(principalId: string, account: ConnectorAccount): GrokConnectorLaunch | undefined;
  /** Default: the engine start gate's probe slots. */
  gate?<T>(label: string, run: () => Promise<T>): Promise<T>;
  /** Default 90 s: one model round (5.7 s measured) and the tool itself. */
  timeoutMs?: number;
  /** #3357: the warm pool (idle limit, memory guard). The start limit is
   * `gate`. */
  pool?: Omit<ConnectorHostPoolOptions, "gate">;
}

const CALL_TIMEOUT_MS = 90_000;
/** How long an ended process has to exit before it is killed hard. */
const EXIT_GRACE_MS = 2_000;
/** How long a cancelled prompt has to answer (with its usage) before its
 * process is treated as stuck and not kept. */
const CANCEL_GRACE_MS = 5_000;

/** The argv of one pinned call: `default` mode, where every gateway call
 * asks (M4, M5); a fast model when the account's catalog has one. */
export function grokConnectorHostArgs(env: Record<string, string | undefined>): string[] {
  const fast = (readGrokModelsCache(env) ?? []).find((model) => /fast/i.test(model.id))?.id;
  return ["--permission-mode", "default", "agent", "--no-leader", ...(fast ? ["-m", fast] : []), "stdio"];
}

/** The environment of one pinned call: the sign-in's own, the managed
 * gateway on as on the person's own turn, never an API key. */
export function grokConnectorHostEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env, GROK_AGENT: "grok-build", ...grokCloudConnectorEnv(undefined, true), SAGAX_GROK_CONNECTOR_CALL: "1" };
  delete out.XAI_API_KEY;
  return out;
}

const signIn = (name: string): ConnectorHostResult => ({
  text: `${name} needs a new sign-in to Grok before it can be called. The Connect card was posted: once signed in, call it again.`,
  isError: true,
  needsSignIn: true,
});

/** Signs that Grok's own answer is about the sign-in, not the tool. */
const SIGN_IN_ERROR = /auth|sign.?in|log.?in|expired|token|unauthori[sz]ed|credential/i;

/** The model round of a pinned prompt, from its own answer (`_meta` on
 * grok, `usage` on agents that put it at the root). */
export function grokPromptUsage(result: unknown, fallbackModel?: string): ConnectorHostUsage | undefined {
  const value = (result ?? {}) as { usage?: unknown; _meta?: unknown };
  const reported = (value.usage && typeof value.usage === "object" && "inputTokens" in (value.usage as object) ? value.usage : value._meta) as Record<string, unknown> | undefined;
  if (!reported || typeof reported !== "object") return undefined;
  const count = (entry: unknown) => (typeof entry === "number" && Number.isFinite(entry) && entry >= 0 ? Math.trunc(entry) : undefined);
  const input = count(reported.inputTokens);
  const output = count(reported.outputTokens);
  if (input === undefined && output === undefined) return undefined;
  const cached = count(reported.cachedReadTokens);
  const model = typeof reported.modelId === "string" && reported.modelId.trim() ? reported.modelId.trim() : fallbackModel || "grok";
  return { model, input: input ?? 0, output: output ?? 0, ...(cached ? { cachedInput: Math.min(cached, input ?? 0) } : {}), costUsd: null };
}

/** A start that answered instead of starting (a sign-in to renew, a refusal). */
class GrokStartRefused extends Error {
  readonly result: ConnectorHostResult;
  constructor(result: ConnectorHostResult) {
    super(result.text);
    this.result = result;
  }
}

type RpcAnswer = { result?: unknown; error?: { message?: unknown; code?: unknown } };

/** What one call listens to on its warm process. */
interface GrokCallListener {
  ask(id: unknown, params: unknown): void;
  /** `sessionId`: the session the update belongs to, when it says. */
  update(update: unknown, sessionId?: unknown): void;
  exit(): void;
}

/** One Grok CLI kept for one person and sign-in. */
interface GrokProcess extends WarmProcess {
  request(method: string, params: unknown): Promise<RpcAnswer>;
  notify(method: string, params: unknown): void;
  respond(id: unknown, body: { result: unknown } | { error: unknown }): void;
  listen(listener: GrokCallListener | undefined): void;
  cwd: string;
  model?: string;
}

function startGrokProcess(launch: GrokConnectorLaunch, name: string, timeoutMs: number, running: Set<ChildProcess>): Promise<GrokProcess> {
  const env = grokConnectorHostEnv(launch.env);
  const home = grokHome(env);
  const cwd = dirname(home);
  const args = grokConnectorHostArgs(env);
  const modelAt = args.indexOf("-m");
  const model = modelAt >= 0 ? args[modelAt + 1] : undefined;
  let child: ChildProcess;
  try {
    const resolved = resolveCli(launch.cli, args, env as NodeJS.ProcessEnv);
    child = spawn(resolved.command, resolved.args, { env: env as NodeJS.ProcessEnv, cwd, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  } catch (error) {
    return Promise.reject(new GrokStartRefused({ text: `Grok could not start for ${name}: ${error instanceof Error ? error.message : String(error)}`, isError: true }));
  }
  running.add(child);
  let listener: GrokCallListener | undefined;
  let exited = false;
  let stopping: Promise<void> | undefined;
  let nextId = 0;
  const pending = new Map<number, (message: RpcAnswer) => void>();
  const write = (message: unknown) => {
    try { child.stdin?.write(`${JSON.stringify(message)}\n`); } catch { /* the exit handler ends the call */ }
  };
  const gone = () => {
    if (exited) return;
    exited = true;
    running.delete(child);
    for (const resolve of pending.values()) resolve({ error: { message: "Grok stopped" } });
    pending.clear();
    listener?.exit();
  };
  child.on("exit", gone);
  child.on("error", gone);
  child.stdin?.on("error", () => { /* the exit handler ends the call */ });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown };
      try { message = JSON.parse(line); } catch { continue; }
      if (typeof message.id === "number" && message.method === undefined && pending.has(message.id)) {
        const resolve = pending.get(message.id)!;
        pending.delete(message.id);
        resolve(message as RpcAnswer);
      } else if (message.method === "session/request_permission" && message.id !== undefined) {
        if (listener) listener.ask(message.id, message.params);
        else write({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } });
      } else if (typeof message.method === "string" && message.id !== undefined) {
        // a file, a terminal, a question: a connector call needs none of them
        write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not available to a connector call" } });
      } else if (message.method === "session/update") {
        const params = message.params as { update?: unknown; sessionId?: unknown } | null;
        listener?.update(params?.update, params?.sessionId);
      }
    }
  });
  const proc: GrokProcess = {
    cwd,
    ...(model ? { model } : {}),
    alive: () => !exited && child.exitCode === null && child.signalCode === null,
    request: (method, params) => new Promise((resolve) => {
      if (exited) { resolve({ error: { message: "Grok stopped" } }); return; }
      const id = ++nextId;
      pending.set(id, resolve);
      write({ jsonrpc: "2.0", id, method, params });
    }),
    notify: (method, params) => write({ jsonrpc: "2.0", method, params }),
    respond: (id, body) => write({ jsonrpc: "2.0", id, ...body }),
    listen: (next) => { listener = next; },
    stop: () => stopping ??= new Promise<void>((done) => {
      if (exited || child.exitCode !== null || child.signalCode !== null) { gone(); done(); return; }
      const hard = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, EXIT_GRACE_MS);
      child.once("exit", () => { clearTimeout(hard); done(); });
      try { child.kill(); } catch { /* already gone */ }
    }),
  };
  return (async () => {
    const timer = setTimeout(() => { void proc.stop(); }, timeoutMs);
    try {
      const init = await proc.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      if (init.error) throw new GrokStartRefused({ text: `Grok did not start for ${name}: ${String(init.error.message ?? "initialize failed")}`, isError: true });
      const methods = (init.result as { authMethods?: Array<{ id?: string }> } | undefined)?.authMethods ?? [];
      const methodId = ["cached_token", "grok.com"].find((id) => methods.some((method) => method.id === id));
      if (!methodId) throw new GrokStartRefused(signIn(name));
      const auth = await proc.request("authenticate", { methodId });
      if (auth.error) {
        const why = String(auth.error.message ?? "");
        if (why === "Grok stopped") throw new GrokStartRefused({ text: `Grok stopped before ${name} answered, so the call did not complete.`, isError: true });
        throw new GrokStartRefused(SIGN_IN_ERROR.test(why) || !why ? signIn(name) : { text: `Grok refused the sign-in for ${name}: ${why}`, isError: true });
      }
      return proc;
    } catch (error) {
      await proc.stop();
      if (error instanceof GrokStartRefused) throw error;
      throw new GrokStartRefused({ text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true });
    } finally {
      clearTimeout(timer);
    }
  })();
}

/** One approved call in its own session of a warm process. `keep`: the
 * process answered as expected and may serve the next call. */
function runGrokCall(proc: GrokProcess, request: ConnectorHostCall, timeoutMs: number, warm: boolean): Promise<PoolWork<ConnectorHostResult>> {
  const name = request.connector.name;
  const tool = request.tool;
  const input = request.arguments;
  return new Promise<PoolWork<ConnectorHostResult>>((done) => {
    let settled = false;
    let sessionId: string | undefined;
    let allowedCallId: string | undefined;
    let asked = false;
    let refused: { tool?: string; altered: boolean } | undefined;
    let output: ConnectorHostResult | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: ConnectorHostResult, keep: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      proc.listen(undefined);
      done({ value: { ...value, ...(warm ? { warm: true } : {}) }, keep });
    };
    const timer = setTimeout(() => {
      if (sessionId) proc.notify("session/cancel", { sessionId });
      finish(output ?? { text: `${name} did not answer in time, so its result is unknown.`, isError: true }, false);
    }, timeoutMs);
    const notRun = (): ConnectorHostResult => ({
      text: refused?.altered
        ? `Grok asked to run ${tool} with other input than the approved call, so it was not run and nothing was sent.`
        : `Grok asked to run ${refused?.tool ?? "another tool"} instead of the approved ${tool}, so it was not run and nothing was sent.`,
      isError: true,
    });
    // a late ask or update of an earlier session on this warm process is not this call's
    const another = (session: unknown) => typeof session === "string" && session !== sessionId;
    proc.listen({
      ask(id, params) {
        if (another((params as { sessionId?: unknown } | null)?.sessionId)) {
          proc.respond(id, { result: { outcome: { outcome: "cancelled" } } });
          return;
        }
        const options = ((params as { options?: Array<{ optionId?: unknown; kind?: unknown }> } | null)?.options ?? []);
        const pick = (kind: string, fallback: string) => {
          const option = options.find((entry) => entry.kind === kind && typeof entry.optionId === "string");
          return (option?.optionId as string | undefined) ?? fallback;
        };
        // only the first ask of this call can be the approved call; every other is refused
        const first = !asked;
        asked = true;
        if (first && grokAskIsApproved(params, tool, input)) {
          allowedCallId = grokAskedCall(params).toolCallId;
          proc.respond(id, { result: { outcome: { outcome: "selected", optionId: pick("allow_once", "allow-once") } } });
          return;
        }
        const other = grokAskedCall(params);
        refused ??= { ...(other.tool ? { tool: other.tool } : {}), altered: other.tool === tool };
        proc.respond(id, { result: { outcome: { outcome: "selected", optionId: pick("reject_once", "reject-once") } } });
      },
      update(update, session) {
        if (another(session)) return;
        const result = grokToolResult(update);
        // only the allowed call's own result; nothing else ran
        const ours = result && !refused && asked
          && (allowedCallId !== undefined ? result.toolCallId === allowedCallId : result.tool === tool);
        if (!result || !ours || output) return;
        output = { text: result.text, ...(result.isError ? { isError: true } : {}) };
        // the call is done: the prompt is cancelled and answers with its usage
        if (sessionId) proc.notify("session/cancel", { sessionId });
        grace = setTimeout(() => finish(output!, false), CANCEL_GRACE_MS);
      },
      exit() {
        // once the approved call was allowed it may have run: its result is unknown, never "not run"
        const lost = allowedCallId !== undefined || (asked && !refused);
        finish(output ?? (lost
          ? { text: `Grok stopped before ${name} answered, so its result is unknown.`, isError: true }
          : { text: `Grok stopped before ${name} answered, so the call did not complete.`, isError: true }), false);
      },
    });
    void (async () => {
      const created = await proc.request("session/new", { cwd: proc.cwd, mcpServers: [] });
      const id = (created.result as { sessionId?: unknown } | undefined)?.sessionId;
      if (created.error || typeof id !== "string") return finish({ text: `Grok did not open a session for ${name}.`, isError: true }, false);
      sessionId = id;
      const prompt = await proc.request("session/prompt", { sessionId, prompt: [{ type: "text", text: grokPinnedPrompt(tool, input) }] });
      if (settled) return;
      const usage = prompt.error ? undefined : grokPromptUsage(prompt.result, proc.model);
      const used = usage ? { usage } : {};
      if (output) return finish({ ...output, ...used }, proc.alive());
      if (refused) return finish({ ...notRun(), ...used }, proc.alive());
      if (prompt.error) return finish({ text: `Grok ended the call to ${name}: ${String(prompt.error.message ?? "error")}`, isError: true }, false);
      finish({ text: `Grok ended without calling ${tool}, so nothing was run.`, isError: true, ...used }, proc.alive());
    })().catch((error) => finish({ text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }, false));
  });
}

export function createGrokConnectorHost(deps: GrokConnectorHostDeps): ConnectorHost {
  const gate = deps.gate ?? (<T>(label: string, run: () => Promise<T>) => engineStartGate.run("probe", label, run));
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
  const running = new Set<ChildProcess>();
  const pool = createConnectorHostPool<GrokProcess>({ ...deps.pool, gate });

  async function call(request: ConnectorHostCall): Promise<ConnectorHostResult> {
    const name = request.connector.name;
    const launch = deps.launch(request.principalId, request.account);
    if (!launch) return signIn(name);
    const home = grokHome(grokConnectorHostEnv(launch.env));
    if (!existsSync(join(home, "auth.json"))) return signIn(name);
    // one time limit for the start and the call together, not one each
    let deadline: number | undefined;
    try {
      return await pool.use(
        { principalId: request.principalId, accountKey: request.account.key },
        `${launch.cli} agent (connector call)`,
        () => {
          deadline = Date.now() + timeoutMs;
          return startGrokProcess(launch, name, timeoutMs, running);
        },
        (proc, warm) => runGrokCall(proc, request, deadline === undefined ? timeoutMs : Math.max(1, deadline - Date.now()), warm),
      );
    } catch (error) {
      if (error instanceof GrokStartRefused) return error.result;
      return { text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  return {
    provider: "grok-com",
    call,
    async describe(_principalId, _account, connector, tool) {
      return grokComDescribe(connector, tool);
    },
    stopPrincipal: (principalId, accountKey) => pool.stopPrincipal(principalId, accountKey),
    poolStats: () => pool.stats(),
    async close() {
      await pool.close();
      for (const proc of running) {
        try { proc.kill(); } catch { /* already gone */ }
      }
      running.clear();
    },
  };
}
