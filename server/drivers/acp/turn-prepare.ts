/** ACP turn prepare + warm phase. */
import { homedir } from "node:os";
import { DATA_DIR } from "../../config.ts";
import { applyStoredEngineEnv } from "../../engines/engine-api-keys.ts";
import { applyEngineCommandVariables } from "../../vault/credential-command-env.ts";
import { newId } from "../../contracts.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { cachePrimePrompt } from "../../voice/voice-first-sentence.ts";
import { supportsApprovalMode } from "../../../shared/approval-mode.ts";
import { narrowsNativeTools, parseToolScope } from "../../../shared/tool-scope.ts";
import { TURN_TOKEN_ENV, warmCommsEnv } from "../spawn-contract.ts";
import {
  INIT_TIMEOUT,
  LOAD_SESSION_TIMEOUT,
  NEW_SESSION_TIMEOUT,
  SESSION_CONFIG_TIMEOUT,
} from "./constants.ts";
import { skipSubscriptionAuthForLocalInject } from "./helpers.ts";
import { newTurnLatency } from "./turn-latency.ts";
import type { SendTurnDeps } from "./turn-deps.ts";
import { warmResourceTokenThread } from "../../resources/warm-resources.ts";
import { turnTrace } from "../../turns/turn-trace.ts";
import { prepareAcpSpawn } from "./turn-prepare-spawn.ts";

export type PrepareEarly = { kind: "early"; result: { turnId: string; reused?: boolean } };
export type PrepareReady = { kind: "ready" } & Record<
  "turn" | "turnId" | "threadId" | "turnConfig" | "cwd" | "controlsHost" | "cliTurn" |
  "callAgentsEnv" | "spawnEnv" | "mcpServers" | "sessionKey" | "cursor" | "renewedFromChat" |
  "launchedThisTurn" | "reused" | "latency" | "session" | "sessionRef" | "request" | "initialize" |
  "authenticateOnce" | "sessionInputs" | "launchSession" | "approvalGated" | "env",
  any
>;
export type PrepareResult = PrepareEarly | PrepareReady;

export function createPrepareTurn(deps: SendTurnDeps) {
  return (turn: SendTurnInput) => prepareAcpTurn(deps, turn);
}

export async function prepareAcpTurn(deps: SendTurnDeps, turn: SendTurnInput): Promise<PrepareResult> {
  const {
    support, DRIVER_KIND, config, instanceId,
    childEnv, requireRunning,
    sessions, warming, active, freshNextTurn, sessionAllows,
    openSession, closeSession, armIdle, emit, base,
    acpMcpServers,
    getAccountModels, setAccountModels, instanceEnvironment,
  } = deps;
  let accountModels = getAccountModels();
  const syncCatalog = () => { accountModels = getAccountModels(); };
  void setAccountModels;

    const startupModelRefresh = deps.getStartupModelRefresh();
    syncCatalog();
    requireRunning();
    const latency = newTurnLatency(Date.now(), turn.receivedAt);
    if (startupModelRefresh) await startupModelRefresh;
    requireRunning();
    const parsedScope = parseToolScope(turn.toolScope);
    if (!parsedScope.ok) throw new Error(parsedScope.error);
    turn = { ...turn, toolScope: parsedScope.scope };
    if (narrowsNativeTools(turn.toolScope) && !support.toolScopeSessionParams) {
      throw new Error(`${support.displayName}: native tool selection is not supported by this engine. Keep native:* in the selection or choose a supported engine.`);
    }
    const { threadId } = turn;
    // The last native session filled up: Retry (or any new message) must
    // not reopen it. Start fresh from the chat's rebuild; a warm only
    // prepares a process, so it leaves the mark for the turn that follows.
    let renewedFromChat = false;
    if (turn.warmOnly !== true && freshNextTurn.has(threadId)) {
      freshNextTurn.delete(threadId);
      if (typeof turn.resumeCursor === "string" && !turn.sessionReset) {
        const recovery = turn.recoveryText?.trim() && turn.recoveryText.trim() !== turn.text.trim()
          ? turn.recoveryText : undefined;
        turn = {
          ...turn,
          resumeCursor: undefined,
          sessionReset: true,
          recoveryText: undefined,
          ...(recovery ? { text: recovery } : {}),
        };
        renewedFromChat = Boolean(recovery);
      }
    }
    if (turn.warmOnly === true && (!support.warmSession || turn.sessionReset)) {
      // Nothing to keep: a reset turn closes whatever a warm would start.
      return { kind: "early" as const, result: { turnId: newId() } };
    }
    const warmInFlight = warming.get(threadId);
    if (warmInFlight) await warmInFlight;
    if (active.has(threadId)) throw new Error("a turn is already running on this thread");
    // Provider-instance `fullAuto` predates per-bot approval levels. Every
    // harness turn now carries the bot's mode, so Ask/Auto must explicitly
    // put the native agent back into its interactive mode. Otherwise a
    // legacy Grok bypassPermissions / Cursor --force / Droid auto-high /
    // Antigravity yolo setting would silently outrank the selector. Calls
    // that omit approvalMode retain the old adapter-level behavior for
    // embedders and tests outside the harness.
    const turnConfig = turn.approvalMode === undefined
      ? config
      : { ...config, fullAuto: turn.approvalMode === "full" && supportsApprovalMode(DRIVER_KIND, "full") };
    const controlsHost = turn.integrations?.localComputer?.scope === "local-computer";
    if (controlsHost && turnConfig.fullAuto && turn.approvalMode !== "full") {
      throw new Error("local computer control requires interactive provider approvals");
    }
    const turnId = newId();
    const cwd = turn.withholdHostTools === true && support.withheldWorkspace
      ? support.withheldWorkspace()
      : turn.cwd ?? turnConfig.workspace ?? homedir();
    const env = childEnv(turnConfig);
    if (turn.access) support.applyAccess?.(env, turn.access, instanceEnvironment);
    // After applyAccess: a driver's own hook may clear a variable and
    // restore only a Perspicax key. A pasted key fills the variable when
    // it is still empty, and only for this person.
    if (turn.access?.localKeyPrincipal) {
      applyStoredEngineEnv(env, DRIVER_KIND, DATA_DIR, { organization: true, principalId: turn.access.localKeyPrincipal });
    }
    if (
      support.requireAuthenticationBeforeSpawn
      && !skipSubscriptionAuthForLocalInject(turn.model)
    ) {
      const authenticated = await support.isAuthenticated(env, turnConfig, instanceId);
      requireRunning();
      if (!authenticated) {
        if (turn.warmOnly === true) throw new Error(support.loginNote);
        emit({ ...base(threadId, turnId), type: "turn.started" });
        emit({ ...base(threadId, turnId), type: "runtime.error", message: support.loginNote, setup: true });
        emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
        return { kind: "early" as const, result: { turnId } };
      }
    }
    const resolvedModel = support.resolveTurnModel?.(turn.model, env);
    // On a call (keepWarm) the pooled process keeps one native session
    // from turn to turn. The comms token is minted per turn, so it rides
    // a file the agents proxy re-reads on every request (the Claude
    // driver's mechanism, server/drivers/agents-client.ts) and is masked
    // out of the session inputs below: a new turn's token alone never
    // re-establishes the session (no session/load, no MCP reconnect).
    const callAgents = turn.keepWarm === true && turn.integrations?.agents?.env?.SAGAX_COMMS_TOKEN
      ? turn.integrations.agents : undefined;
    const withAgentsEnv = (agentsEnv: Record<string, string>): SendTurnInput =>
      ({ ...turn, integrations: { ...turn.integrations, agents: { ...callAgents!, env: agentsEnv } } });
    const callAgentsEnv = callAgents ? warmCommsEnv(warmResourceTokenThread(turn), turn.botId, callAgents.env) : undefined;
    // Rebound once, before the prompt, when a fallbackModel support swaps
    // a model this session does not offer for one it does.
    let cliTurn =
      resolvedModel !== undefined && resolvedModel !== turn.model
        ? { ...turn, model: resolvedModel }
        : turn;
    // One decision per turn, shared by the MCP mounts and spawnArgs: a
    // turn can never get the ungated mode with ungated servers.
    const approvalGated = support.approvalGate?.(turnConfig, cliTurn, { env, cwd }) === true;
    const mcpServers = acpMcpServers(callAgentsEnv ? withAgentsEnv(callAgentsEnv) : turn, approvalGated);
    // Masked only when the turn files were written (warmCommsEnv falls
    // back to the env on a write failure, which must re-establish).
    const sessionServersKey = callAgentsEnv?.SAGAX_COMMS_TOKEN_FILE
      ? acpMcpServers(withAgentsEnv({
        ...callAgentsEnv,
        ...Object.fromEntries(TURN_TOKEN_ENV.filter((key) => key in callAgentsEnv).map((key) => [key, "(turn token)"])),
      }), approvalGated)
      : mcpServers;
    support.applyTurnEnv?.(env, {
      model: resolvedModel, requestedModel: turn.model, fullAuto: turnConfig.fullAuto === true, botId: turn.botId, cwd, toolScope: turn.toolScope,
      withholdHostTools: turn.withholdHostTools === true,
      accountConnectors: turn.grokCloudConnectors === true,
      approvalGated,
      localKeyPrincipal: turn.access?.localKeyPrincipal,
      threadId, mcpServers,
    });
    // Command variables the person exposed to this bot
    // (server/vault/credential-command-env.ts): the engine's own shell inherits
    // them, never a name the engine reads as its own sign-in. They are in
    // the env fingerprint below, so a change or a revoke starts a fresh
    // process at the next turn.
    applyEngineCommandVariables(env, turn.commandEnvironment, support.credentialEnv ?? []);
    let launch: { command: string; args?: string[]; env?: Record<string, string | undefined> };
    try {
      launch = support.resolveCommand
        ? await support.resolveCommand(env, turnConfig, instanceId)
        : { command: turnConfig.cli };
    } catch (error) {
      requireRunning();
      // a warm shows nothing in the thread: the call's first turn reports it
      if (turn.warmOnly === true) throw error;
      emit({ ...base(threadId, turnId), type: "turn.started" });
      emit({
        ...base(threadId, turnId),
        type: "runtime.error",
        message: error instanceof Error ? error.message : String(error),
        setup: true,
      });
      emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "setup_required", cost: null });
      return { kind: "early" as const, result: { turnId } };
    }
    requireRunning();

    const spawned = prepareAcpSpawn({
      support, turn, turnConfig, cliTurn, approvalGated, launch, env, cwd, accountModels,
      openSession, threadId, active, warming, sessions, closeSession, sessionAllows, sessionServersKey,
    });
    const {
      spawnEnv, launchEnv, sessionKey, launchSession,
      cursor, reused, sessionRef,
    } = spawned;
    let session = spawned.session;
    const launchedThisTurn = () => spawned.getLaunchedThisTurn();

    const request = (
      method: string,
      params: unknown,
      timeoutMs?: number,
      receive?: (result: any) => void,
      idleMs?: number,
      idleMessage?: string | (() => string),
    ): Promise<any> =>
      sessionRef.current.acp.request(method, params, timeoutMs, receive, idleMs, idleMessage);
    const initialize = () => request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: { name: "openmausbot", version: "0.0.0" },
        clientCapabilities: {
          fs: {
            readTextFile: support.clientFileSystem === true,
            writeTextFile: support.clientFileSystem === true,
          },
          terminal: false,
          ...(support.clientCapabilitiesMeta ? { _meta: support.clientCapabilitiesMeta } : {}),
        },
      },
      INIT_TIMEOUT,
    );
    // authenticate is once per process; a turn that skips subscription
    // auth neither checks nor marks the flag
    const authenticateOnce = async () => {
      const live = sessionRef.current;
      if (skipSubscriptionAuthForLocalInject(turn.model) || live.authenticated) return;
      const methods: Array<{ id?: string }> = Array.isArray(live.initResult?.authMethods)
        ? live.initResult.authMethods
        : [];
      const methodId = support.pickAuthMethod(methods, launchEnv);
      if (methodId) {
        try {
          await request("authenticate", { methodId }, INIT_TIMEOUT);
          live.authenticated = true;
        } catch {
          if (support.authFailure !== "continue") throw new Error(support.loginNote);
          // else: proceed on an ambient login
        }
      } else if (support.authFailure === "fail") {
        throw new Error(support.loginNote);
      }
    };
    // What session/new and session/load|resume establish with.
    const sessionInputs = (init: any) => {
      // every server is stdio (a url server rides through mcpStdioServer),
      // the baseline every ACP agent accepts
      const sessionServers = mcpServers;
      // A withheld turn sends its profile even when the bot did not narrow
      // native tools. Otherwise session/new would keep the CLI defaults.
      const selectionParams = (narrowsNativeTools(turn.toolScope) || turn.withholdHostTools === true) && support.toolScopeSessionParams
        ? support.toolScopeSessionParams(turn, init, sessionServers.length > 0, { config: turnConfig, env, cwd }) : {};
      return { sessionServers, selectionParams };
    };

    // A call / composer prewarm (warmOnly): pay the handshake, establish the
    // native session, and run configureSession (model pin, MCP settle) now,
    // with no prompt and no turn events, so the first real turn is a bare
    // session/prompt (#2055). A warm that fails leaves the turn path to start
    // over; it never shows in the thread.
    if (turn.warmOnly === true) {
      const result = { turnId, ...(reused ? { reused: true } : {}) };
      if (!reused) {
        const warm = (async () => {
          if (!session.initResult) session.initResult = await initialize();
          await authenticateOnce();
          const { sessionServers, selectionParams } = sessionInputs(session.initResult);
          if (cursor) {
            try {
              await request(
                support.resumeMethod === "resume" ? "session/resume" : "session/load",
                { sessionId: cursor, cwd, mcpServers: sessionServers, ...selectionParams },
                LOAD_SESSION_TIMEOUT,
                (loaded) => {
                  if (!loaded) return;
                  if (support.acceptsLoadedSession && !support.acceptsLoadedSession({
                    turn: cliTurn, currentModelId: loaded?.models?.currentModelId,
                  })) return;
                  session.sessionId = cursor;
                  session.sessionKey = sessionKey;
                  session.sessionConfigResult = loaded;
                },
              );
            } catch {
              // the session is gone or the load was refused: the turn
              // decides (a fresh process, or a new session with history)
            }
          } else {
            await request("session/new", { cwd, mcpServers: sessionServers, ...selectionParams }, NEW_SESSION_TIMEOUT, (created) => {
              session.sessionId = typeof created?.sessionId === "string" ? created.sessionId : null;
              session.sessionKey = sessionKey;
              session.sessionConfigResult = created;
            });
          }
          const sessionId = session.sessionId;
          if (sessionId && support.configureSession) {
            await support.configureSession({
              request: async (method, params, timeoutMs) => {
                const configured = await request(method, params, timeoutMs ?? SESSION_CONFIG_TIMEOUT);
                if (method === "session/set_model" && params && typeof params === "object" &&
                    "modelId" in params && typeof (params as { modelId?: unknown }).modelId === "string") {
                  session.sessionConfigResult = {
                    ...session.sessionConfigResult,
                    models: {
                      ...session.sessionConfigResult?.models,
                      currentModelId: (params as { modelId: string }).modelId,
                    },
                  };
                }
                return configured;
              },
              sessionId,
              env: spawnEnv,
              config: turnConfig,
              turn: cliTurn,
              sessionModels: Array.isArray(session.sessionConfigResult?.models?.availableModels)
                ? session.sessionConfigResult.models.availableModels
                : [],
              currentModelId: session.sessionConfigResult?.models?.currentModelId,
              configOptions: Array.isArray(session.sessionConfigResult?.configOptions)
                ? session.sessionConfigResult.configOptions
                : [],
              // Just established: settle MCP and pin the model once here.
              reused: false,
              notice: () => {},
            });
          }
          turnTrace(threadId, "acp-prewarmed");
        })();
        const settled = warm.then(() => {}, () => {});
        warming.set(threadId, settled);
        try {
          await warm;
        } catch (error) {
          if (sessions.get(threadId) === session && !session.current) closeSession(threadId, "warm-failed");
          throw error;
        } finally {
          if (warming.get(threadId) === settled) warming.delete(threadId);
        }
      } else {
        turnTrace(threadId, "acp-prewarmed");
      }
      const signal = turn.warmSignal;
      const releaseIfIdle = () => {
        if (sessions.get(threadId) === session && !session.current && !active.has(threadId)) closeSession(threadId, "call ended");
      };
      if (signal?.aborted) releaseIfIdle();
      else {
        signal?.addEventListener("abort", releaseIfIdle, { once: true });
        if (sessions.get(threadId) === session && !session.current) armIdle(threadId);
      }
      // The handshake established the session and wrote no prompt, so the
      // first spoken turn would be a cold prefill. One background prompt
      // of the same system prefix fills the provider cache. It is not
      // awaited: a warm still returns with no turn, and the spoken turn
      // joins it for a moment (joinCachePrime).
      if (turn.cachePrime === true && !signal?.aborted && session.sessionId && turn.system?.trim() && !session.cachePrimed) {
        const primed = session;
        const sessionId = session.sessionId;
        const prime = request(
          "session/prompt",
          { sessionId, prompt: [{ type: "text", text: cachePrimePrompt(turn.system) }] },
          20_000,
        ).then(() => {
          if (sessions.get(threadId) === primed) primed.cachePrimed = true;
        }, () => {
          // cancelled, or the call ended: the spoken turn pays the prefill
        });
        primed.cachePrime = prime;
        signal?.addEventListener("abort", () => {
          if (!primed.cachePrimed && primed.sessionId) {
            primed.acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: primed.sessionId } });
          }
        }, { once: true });
      }
      return { kind: "early" as const, result };
    }
        return { kind: "ready" as const, turn, turnId, threadId, turnConfig, cwd, controlsHost, cliTurn, callAgentsEnv, spawnEnv, mcpServers, sessionKey, cursor, renewedFromChat, launchedThisTurn: launchedThisTurn(), reused, latency, session, sessionRef, request, initialize, authenticateOnce, sessionInputs, launchSession, approvalGated, env };
}
