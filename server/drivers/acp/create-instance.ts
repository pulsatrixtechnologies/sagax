/** ACP ProviderInstance factory. */
import { PROVIDER_CREDENTIAL_ENV, stripControlPlaneEnv, WORKSPACE_CREDENTIAL_ENV } from "../../config.ts";
import { openStartupModelCatalog, writeStartupModelCache } from "../../startup-model-catalog.ts";
import { DeviceAuthController } from "../device-auth.ts";
import { LinkSignInController } from "../link-sign-in.ts";
import { killCliTree, spawnCli } from "../../procs.ts";
import { sanitizeAcpToolMessage } from "./helpers.ts";
import type {
  DriverCreateInput,
  ProviderInstance,
  RuntimeEvent,
  RuntimeEventListener,
} from "../../contracts.ts";
import { newEventId } from "../../contracts.ts";
import { augmentedPath } from "../../env-path.ts";
import { appendNative } from "../native.ts";
import { sessionIdlePolicy } from "../session-idle.ts";
import { createSendTurn } from "./turn-send.ts";
import { createAcpMcp } from "./instance-mcp.ts";
import { createInstanceText } from "./instance-text.ts";
import { createOpenSession } from "./session-open.ts";
import { createSettle, createStartQuietWatch } from "./session-lifecycle.ts";
import type {
  AcpAskFinish,
  AcpConfig,
  AcpSession,
  AcpSupport,
} from "./types.ts";

export async function createAcpInstance(
  support: AcpSupport,
  input: DriverCreateInput<AcpConfig>,
  opts: {
    DRIVER_KIND: string;
    SOURCE: string;
    DENY_TIMEOUT_NOTE: string;
    QUESTION_NO_MATCH_NOTE: string;
  },
): Promise<ProviderInstance> {
  const { DRIVER_KIND, SOURCE, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE } = opts;

  const { instanceId, config } = input;
  const childEnv = (activeConfig = config) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...input.environment,
      PATH: augmentedPath(),
    };
    const allowedCredentials = new Set(support.credentialEnv ?? []);
    // two lists, one rule: foreign PROVIDER keys must not flip a CLI's
    // billing off its own login, and WORKSPACE credentials (boat token,
    // voice key, …) are the harness's secrets — riding along in
    // `...process.env` is not a grant. A driver keeps only what its
    // credentialEnv allowlist names.
    for (const key of [...PROVIDER_CREDENTIAL_ENV, ...WORKSPACE_CREDENTIAL_ENV]) {
      if (!allowedCredentials.has(key)) delete env[key];
    }
    // The operator's own secrets are outside any driver's allowlist.
    stripControlPlaneEnv(env);
    support.transformEnv?.(env, activeConfig, instanceId, input.environment);
    return env;
  };
  let models = support.models;
  // Models this account itself offered (see sessionModelEnv): the
  // discovered catalog, never the static one, or a live session's list.
  let accountModels: ReadonlySet<string> | null = null;
  const refreshModels = async () => {
    if (!support.resolveModels) return;
    try {
      const resolved = await support.resolveModels(childEnv(), config, instanceId);
      if (resolved.options.length) {
        models = resolved;
        accountModels = new Set(resolved.options.map((option) => option.id));
      }
    } catch {
      // Keep the last usable catalog when an optional discovery source is down.
    }
    try { writeStartupModelCache(instanceId, models); } catch { /* derived cache */ }
  };
  // A later start serves the saved list and refreshes behind listen.
  // The first run still waits so the seeded default model does not change.
  // Engines with no resolver (Gemini, custom ACP) and Antigravity
  // (resolveModelsOnCreate: false) stay on the instant path.
  let startupModelRefresh: Promise<void> | null = null;
  if (support.resolveModels && support.resolveModelsOnCreate !== false) {
    startupModelRefresh = (await openStartupModelCatalog({
      instanceId,
      use: (catalog) => { models = catalog; },
      current: () => models,
      refresh: refreshModels,
    }))?.pending ?? null;
  } else if (support.resolveModelsOnCreate !== false) {
    await refreshModels();
  }
  const deviceSignIn = support.deviceSignIn
    ? new DeviceAuthController(support.deviceSignIn, { cli: config.cli, environment: () => childEnv(), onAuthenticated: refreshModels })
    : null;
  const linkSignIn = support.linkSignIn
    ? new LinkSignInController(support.linkSignIn, { cli: config.cli, environment: () => childEnv(), onAuthenticated: refreshModels })
    : null;
  const listeners = new Set<RuntimeEventListener>();
  /** Threads whose native session ran out of context room: the next turn
   * (Retry) starts a fresh session from the chat's rebuild instead of
   * reopening the already-full one (server/context-renewal.ts). */
  const freshNextTurn = new Set<string>();
  let disposing = false;
  const requireRunning = () => {
    if (disposing) throw new Error(`${support.displayName} is shutting down`);
  };
  interface Turn {
    stop: () => void;
    interrupt: () => void;
    turnId: string;
    asks: Map<string, AcpAskFinish>;
  }
  const active = new Map<string, Turn>();
  // One live agent process per thread, kept across turns — the Claude
  // driver's pool. The ACP handshake (initialize, authenticate) and the
  // native session are established once; a later turn on the same spawn
  // contract prompts the live session instead of paying the handshake
  // again. An idle session closes after SESSION_IDLE_MS of quiet.
  const sessions = new Map<string, AcpSession>();
  // A call's warm in flight per thread (warmOnly): a real turn waits
  // for it instead of racing it on the same process.
  const warming = new Map<string, Promise<void>>();
  // The last configureSession notice shown per thread (see notice below).
  const threadNotices = new Map<string, string>();
  // Closing removes a session from the pool, not its native writer lease.
  // Retain every closing Qwen child until its process tree is gone, even
  // when Stop or a failed turn lets another turn start during cleanup.
  const retiring = new Map<string, Set<ReturnType<typeof spawnCli>>>();
  const retireChild = async (threadId: string, child: ReturnType<typeof spawnCli>): Promise<boolean> => {
    let children = retiring.get(threadId);
    if (!children) retiring.set(threadId, children = new Set());
    children.add(child);
    const stopped = await killCliTree(child);
    if (stopped) {
      children.delete(child);
      if (!children.size && retiring.get(threadId) === children) retiring.delete(threadId);
    }
    return stopped;
  };
  const { idleMs: SESSION_IDLE_MS } = sessionIdlePolicy("ACP");

  const closeSession = (threadId: string, why: string) => {
    const session = sessions.get(threadId);
    if (!session || session.closing) return;
    session.closing = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    appendNative(threadId, { dir: "out", source: SOURCE, msg: { close: why } });
    // a new turn must never adopt a closing session
    sessions.delete(threadId);
    session.acp.close();
    // EOF is not a guaranteed exit signal. Qwen must be tracked before
    // another turn can resume its history; other agents keep their grace.
    try {
      session.child.stdin.end();
    } catch {}
    if (support.restartOnMcpChange) void retireChild(threadId, session.child);
    else {
      const kill = setTimeout(() => {
        void killCliTree(session.child);
      }, 5_000);
      kill.unref?.();
    }
  };
  const armIdle = (threadId: string) => {
    const session = sessions.get(threadId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => closeSession(threadId, "idle"), SESSION_IDLE_MS);
    session.idleTimer.unref?.();
  };
  // "Always allow this session", remembered by the driver when the agent
  // offered no `allow_always` of its own: the exact operations (kind,
  // title, command, input, locations) a person allowed for the session,
  // per thread. A repeat is answered the way they did, once, for as long
  // as the native session lasts. A generic title with no input identifies
  // nothing and is never remembered.
  const sessionAllows = new Map<string, Set<string>>();

  const emit = (event: RuntimeEvent) => {
    for (const listener of listeners) listener(event);
  };

  // ACP content blocks may carry a complete raster image inline. Keep the
  // bytes on the wire, but never duplicate megabytes of base64 into the
  // provider-native diagnostic log in either direction.
  const nativeLogMessage = (msg: any): unknown => {
    let redacted = msg;
    const prompt = msg?.method === "session/prompt" ? msg?.params?.prompt : null;
    if (Array.isArray(prompt)) {
      redacted = {
        ...msg,
        params: {
          ...msg.params,
          prompt: prompt.map((content: any) =>
            content?.type === "image" && typeof content.data === "string"
              ? { ...content, data: `[image data: ${content.data.length} base64 chars]` }
              : content
          ),
        },
      };
    }
    const content = redacted?.params?.update?.content;
    if (
      redacted?.method !== "session/update" ||
      redacted?.params?.update?.sessionUpdate !== "agent_message_chunk" ||
      content?.type !== "image" ||
      typeof content.data !== "string"
    ) return support.sanitizeToolPayload ? sanitizeAcpToolMessage(redacted) : redacted;
    redacted = {
      ...redacted,
      params: {
        ...redacted.params,
        update: {
          ...redacted.params.update,
          content: { ...content, data: `[image data: ${content.data.length} base64 chars]` },
        },
      },
    };
    return support.sanitizeToolPayload ? sanitizeAcpToolMessage(redacted) : redacted;
  };
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: DRIVER_KIND,
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });


  const { acpMcpServers } = createAcpMcp({
    support, DENY_TIMEOUT_NOTE, sessions, emit, base,
  });
  const startQuietWatch = createStartQuietWatch({ support, emit, base });
  const settle = createSettle({
    support, DRIVER_KIND, emit, base, active, sessions, armIdle,
  });
  const openSession = createOpenSession({
    support, DRIVER_KIND, SOURCE, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE,
    emit, base, sessionAllows, active, sessions, settle, nativeLogMessage,
  });

  const sendTurn = createSendTurn({
    support, DRIVER_KIND, config, instanceId,
    childEnv, requireRunning,
    getStartupModelRefresh: () => startupModelRefresh,
    sessions, warming, active, freshNextTurn, sessionAllows, threadNotices,
    retiring, retireChild, openSession, closeSession, armIdle, settle, emit, base,
    acpMcpServers, startQuietWatch,
    getModels: () => models,
    getAccountModels: () => accountModels,
    setAccountModels: (next: ReadonlySet<string> | null) => { accountModels = next; },
    instanceEnvironment: input.environment,
  });

  const { snapshot, generateMemoryText, reviewPermission } = createInstanceText({
    support, config, instanceId, childEnv,
    getModels: () => models,
    getStartupModelRefresh: () => startupModelRefresh,
  });

  return {
    instanceId,
    driverKind: DRIVER_KIND,
    displayName: input.displayName,
    ...(support.backgroundText === false ? {} : { generateMemoryText, reviewPermission }),
    enabled: input.enabled,
    get models() {
      return models;
    },
    refreshModels: support.resolveModels ? refreshModels : undefined,
    ...(startupModelRefresh ? { startupModelRefresh } : {}),
    ...(deviceSignIn ? {
      startAuthentication: () => deviceSignIn.start(),
      getAuthentication: (flowId: string) => deviceSignIn.get(flowId),
      cancelAuthentication: () => deviceSignIn.cancel(),
    } : linkSignIn ? {
      authenticationMethod: "open-link" as const,
      startAuthentication: () => linkSignIn.start(),
      getAuthentication: (flowId: string) => linkSignIn.get(flowId),
      cancelAuthentication: () => linkSignIn.cancel(),
    } : {}),
    snapshot,
    adapter: {
      provider: DRIVER_KIND,
      capabilities: {
        sessionModelSwitch: "unsupported",
        agentsMcp: true,
    customMcp: true,
        computerMcp: true,
        browserMcp: true,
        dataMcp: true,
        images: support.images !== false,
        nativeImageInput: support.images === true,
        effortLevels: support.effortLevels,
        modelVariants: support.modelVariants === true,
        // Sagax supplies a per-bot approvalMode on every harness
        // turn, which safely overrides a legacy instance fullAuto value.
        // Direct adapter calls that omit it still fail closed in sendTurn.
        localComputerMcp: true,
        ...(support.withholdsHostTools ? { withholdsHostTools: true as const } : {}),
        ...(support.warmSession ? { warmSession: true } : {}),
      },
      sendTurn,
      interruptTurn: async (threadId) => active.get(threadId)?.interrupt(),
      respondToRequest: async (threadId, requestId, decision) => {
        const turn = active.get(threadId);
        const finish = turn?.asks.get(requestId);
        if (!finish) return "unavailable"; // settled, timed out, or turn gone
        return finish(decision.behavior, "user", decision.message, decision.always === true);
      },
      hasSession: (threadId) => active.has(threadId),
      releaseWarmSession: (threadId) => {
        const live = sessions.get(threadId);
        // A running turn owns the process. Hangup closes only an idle
        // one, including the process kept warm between call turns.
        if (!live || live.current || live.closing || active.has(threadId)) return;
        closeSession(threadId, "call ended");
      },
      stopAll: async () => {
        for (const { stop } of active.values()) stop();
        // idle pooled sessions have no running turn — close them too
        for (const threadId of Array.from(sessions.keys())) closeSession(threadId, "stopAll");
        for (const [threadId, children] of retiring) {
          for (const child of children) void retireChild(threadId, child);
        }
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    dispose: async () => {
      disposing = true;
      await deviceSignIn?.dispose();
      await linkSignIn?.dispose();
      const disposingSessions = Array.from(sessions);
      for (const { stop } of active.values()) stop();
      // Settle each running turn before the listeners go: its streamed partial reply is kept, and the turn ends as cancelled.
      for (const [threadId, session] of disposingSessions) {
        closeSession(threadId, "dispose");
        settle(threadId, session, true, "cancelled");
      }
      for (const [threadId, children] of retiring) {
        for (const child of children) void retireChild(threadId, child);
      }
      listeners.clear();
    },
  };

}
