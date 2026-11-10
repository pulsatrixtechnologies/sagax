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
// the tool's own update, the prompt is cancelled and the process is ended
// before the call returns. No token is read or kept: the CLI uses the
// sign-in it already has.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { grokCloudConnectorEnv, grokHome, readGrokModelsCache } from "../../drivers/acp/grok.ts";
import { engineStartGate } from "../../engines/engine-start-gate.ts";
import { resolveCli } from "../../procs.ts";
import { grokAskedCall, grokAskIsApproved, grokComDescribe, grokPinnedPrompt, grokToolResult } from "../providers/grok-com.ts";
import type { ConnectorAccount } from "../types.ts";
import type { ConnectorHost, ConnectorHostCall, ConnectorHostResult } from "./types.ts";

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
}

const CALL_TIMEOUT_MS = 90_000;
/** How long an ended process has to exit before it is killed hard. */
const EXIT_GRACE_MS = 2_000;

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

export function createGrokConnectorHost(deps: GrokConnectorHostDeps): ConnectorHost {
  const gate = deps.gate ?? (<T>(label: string, run: () => Promise<T>) => engineStartGate.run("probe", label, run));
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
  const running = new Set<ChildProcess>();

  async function call(request: ConnectorHostCall): Promise<ConnectorHostResult> {
    const name = request.connector.name;
    const launch = deps.launch(request.principalId, request.account);
    if (!launch) return signIn(name);
    const env = grokConnectorHostEnv(launch.env);
    const home = grokHome(env);
    if (!existsSync(join(home, "auth.json"))) return signIn(name);
    const tool = request.tool;
    const input = request.arguments;
    return gate(`${launch.cli} agent (connector call)`, () => new Promise<ConnectorHostResult>((done) => {
      let settled = false;
      let child: ChildProcess | undefined;
      let sessionId: string | undefined;
      let allowedCallId: string | undefined;
      let asked = false;
      let refused: { tool?: string; altered: boolean } | undefined;
      const finish = (value: ConnectorHostResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const proc = child;
        if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
          if (proc) running.delete(proc);
          done(value);
          return;
        }
        // the result returns once the process is gone
        let hard: ReturnType<typeof setTimeout> | undefined;
        proc.once("exit", () => {
          if (hard) clearTimeout(hard);
          running.delete(proc);
          done(value);
        });
        if (sessionId) write({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
        try { proc.kill(); } catch { /* already gone */ }
        hard = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already gone */ } }, EXIT_GRACE_MS);
      };
      const timer = setTimeout(() => finish({ text: `${name} did not answer in time, so its result is unknown.`, isError: true }), timeoutMs);
      const write = (message: unknown) => {
        try { child?.stdin?.write(`${JSON.stringify(message)}\n`); } catch { /* the exit handler ends the call */ }
      };
      try {
        const resolved = resolveCli(launch.cli, grokConnectorHostArgs(env), env as NodeJS.ProcessEnv);
        child = spawn(resolved.command, resolved.args, { env: env as NodeJS.ProcessEnv, cwd: dirname(home), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
        running.add(child);
      } catch (error) {
        finish({ text: `Grok could not start for ${name}: ${error instanceof Error ? error.message : String(error)}`, isError: true });
        return;
      }
      child.on("error", (error) => finish({ text: `Grok could not start for ${name}: ${error.message}`, isError: true }));
      child.on("exit", () => finish({ text: `Grok stopped before ${name} answered, so the call did not complete.`, isError: true }));
      child.stdin?.on("error", () => { /* the exit handler ends the call */ });

      let nextId = 0;
      const pending = new Map<number, (message: { result?: unknown; error?: unknown }) => void>();
      const send = (method: string, params: unknown): Promise<{ result?: unknown; error?: { message?: unknown } }> => new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve as (message: { result?: unknown; error?: unknown }) => void);
        write({ jsonrpc: "2.0", id, method, params });
      });
      const answerAsk = (id: unknown, params: unknown) => {
        const options = ((params as { options?: Array<{ optionId?: unknown; kind?: unknown }> } | null)?.options ?? []);
        const pick = (kind: string, fallback: string) => {
          const option = options.find((entry) => entry.kind === kind && typeof entry.optionId === "string");
          return (option?.optionId as string | undefined) ?? fallback;
        };
        // only the first ask can be the approved call; every other is refused
        const first = !asked;
        asked = true;
        if (first && grokAskIsApproved(params, tool, input)) {
          allowedCallId = grokAskedCall(params).toolCallId;
          write({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId: pick("allow_once", "allow-once") } } });
          return;
        }
        const other = grokAskedCall(params);
        refused ??= { ...(other.tool ? { tool: other.tool } : {}), altered: other.tool === tool };
        write({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId: pick("reject_once", "reject-once") } } });
      };
      const notRun = (): ConnectorHostResult => ({
        text: refused?.altered
          ? `Grok asked to run ${tool} with other input than the approved call, so it was not run and nothing was sent.`
          : `Grok asked to run ${refused?.tool ?? "another tool"} instead of the approved ${tool}, so it was not run and nothing was sent.`,
        isError: true,
      });

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
            pending.get(message.id)!(message);
            pending.delete(message.id);
          } else if (message.method === "session/request_permission" && message.id !== undefined) {
            answerAsk(message.id, message.params);
          } else if (typeof message.method === "string" && message.id !== undefined) {
            // a file, a terminal, a question: this call needs none of them
            write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not available to a connector call" } });
          } else if (message.method === "session/update") {
            const update = (message.params as { update?: unknown } | null)?.update;
            const output = grokToolResult(update);
            // only the allowed call's own result; nothing else ran
            const ours = output && !refused && asked
              && (allowedCallId !== undefined ? output.toolCallId === allowedCallId : output.tool === tool);
            if (output && ours) {
              finish({ text: output.text, ...(output.isError ? { isError: true } : {}) });
            }
          }
        }
      });

      void (async () => {
        const init = await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
        const methods = (init.result as { authMethods?: Array<{ id?: string }> } | undefined)?.authMethods ?? [];
        const methodId = ["cached_token", "grok.com"].find((id) => methods.some((method) => method.id === id));
        if (init.error) return finish({ text: `Grok did not start for ${name}: ${String(init.error.message ?? "initialize failed")}`, isError: true });
        if (!methodId) return finish(signIn(name));
        const auth = await send("authenticate", { methodId });
        if (auth.error) {
          const why = String(auth.error.message ?? "");
          return finish(SIGN_IN_ERROR.test(why) || !why ? signIn(name) : { text: `Grok refused the sign-in for ${name}: ${why}`, isError: true });
        }
        const created = await send("session/new", { cwd: dirname(home), mcpServers: [] });
        const id = (created.result as { sessionId?: unknown } | undefined)?.sessionId;
        if (created.error || typeof id !== "string") return finish({ text: `Grok did not open a session for ${name}.`, isError: true });
        sessionId = id;
        const prompt = await send("session/prompt", { sessionId, prompt: [{ type: "text", text: grokPinnedPrompt(tool, input) }] });
        if (settled) return;
        if (refused) return finish(notRun());
        if (prompt.error) return finish({ text: `Grok ended the call to ${name}: ${String(prompt.error.message ?? "error")}`, isError: true });
        finish({ text: `Grok ended without calling ${tool}, so nothing was run.`, isError: true });
      })().catch((error) => finish({ text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }));
    }));
  }

  return {
    provider: "grok-com",
    call,
    async describe(_principalId, _account, connector, tool) {
      return grokComDescribe(connector, tool);
    },
    close() {
      for (const proc of running) {
        try { proc.kill(); } catch { /* already gone */ }
      }
      running.clear();
    },
  };
}
