/** Claude CLI process spawn and Session object (#1383). */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnCli } from "../../procs.ts";
import { promptHalves, sectionFingerprints } from "../prompt-split.ts";
import { turnFiles } from "../spawn-contract.ts";
import { UNDELIVERED_VOLATILE } from "./messages.ts";
import { PERM_PROXY_PATH, removePrivateTempDir } from "./helpers.ts";
import { resolveClaudeConfigDir } from "./config.ts";
import type { ClaudeSession } from "./session-types.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";

export async function spawnClaudeSession(ctx: ClaudeTurnCtx): Promise<ClaudeTurnEarly | null> {
  const {
    turn, threadId, turnId, botId, sessionId, newSessionId, args, env, cwd,
    argsKey, contract, searchedMounts, replaysUserMessages, retryAbort, retry,
    sessions, active, emit, base, heldVolatile, warmContracts, sessionConfigDirs,
    support, config, controlsHost, commandCwd, permissionEnv, socketPath,
    mcpServers, settings, authSettingsPath, retryState, switches,
    relaunch,
  } = ctx;
  let { broker, mcpConfigPath, systemPromptPath } = ctx;
  const { createPermissionBroker, askQuestions, askSummary, parseChoices, questionChoices,
    permissionCommand, permissionPaths, withAbsolutePaths, askInputDetail, brokerSocketCandidates } = support;

// A new process gets the stable half only and its first message the
// volatile half (memory, recent work, roster...): the prompt file stays
// byte-identical while those change, so a relaunch of this thread
// (idle close, restart, a contract change) reads the conversation from
// the provider's cache instead of writing it again (port of
// OpenMausBot #3164). A legacy unsplit turn keeps its whole prompt.
const halves = promptHalves(turn);
const launchSystem = halves.stable ?? turn.system;
const launchVolatile = halves.stable !== null ? halves.volatile.trim() : "";
const heldBefore = heldVolatile.get(threadId);
heldVolatile.delete(threadId);
const held = halves.stable !== null && heldBefore && heldBefore.sessionId === sessionId ? heldBefore : undefined;

// Until sessions.set() below, this turn owns every launch resource.
// Any bind, private-config or synchronous spawn failure must release
// them here rather than leave a live listener or credential temp file.
const cleanupUnownedLaunch = () => {
  broker?.close();
  broker = undefined;
  if (mcpConfigPath) {
    try {
      rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
    } catch {}
    mcpConfigPath = null;
  }
  if (systemPromptPath) {
    removePrivateTempDir(systemPromptPath);
    systemPromptPath = null;
  }
  retryState.delete(threadId);
};

try {
  // Create the prompt file only for a new process. A compatible live
  // session has already consumed the same system prompt at launch.
  if (launchSystem) {
    systemPromptPath = join(mkdtempSync(join(tmpdir(), "omb-system-")), "prompt.txt");
    writeFileSync(systemPromptPath, launchSystem, { mode: 0o600 });
    args.push("--append-system-prompt-file", systemPromptPath);
  }
  // Only create a broker for a new process. A compatible retained
  // process keeps its existing proxy connection and broker across turns.
  if (socketPath) {
    // remembers which tool each pending ask came from, so the resolved
    // event can scope approvals to real desktop-control tools only
    const askTools = new Map<string, string | undefined>();
    broker = await createPermissionBroker({
      socketPaths: brokerSocketCandidates(threadId, botId),
      isActive: () => Boolean(sessions.get(threadId)?.turn),
      onAsk: (ask: any) => {
        const eventTurnId = sessions.get(threadId)?.turn?.turnId ?? turnId;
        askTools.set(ask.id, typeof ask.tool === "string" ? ask.tool : undefined);
        // Approve for me no longer runs the CLI's reviewer (see
        // requestedMode), so an ask never reports one.
        const questions = askQuestions(ask);
        emit({
          ...base(threadId, eventTurnId),
          type: "request.opened",
          requestId: ask.id,
          requestType: ask.kind,
          tool: ask.tool,
          summary: askSummary(ask),
          input: ask.kind === "permission" ? askInputDetail(withAbsolutePaths(ask.tool, ask.input, cwd) as typeof ask.input) : undefined,
          command: ask.kind === "permission" && ask.tool === "Bash"
            ? permissionCommand(ask.input.command, commandCwd) : undefined,
          paths: ask.kind === "permission" ? permissionPaths(ask.tool, ask.input, cwd) : undefined,
          requiresExplicitApproval: ask.kind === "permission" && ask.tool === "Bash" && ask.input.dangerouslyDisableSandbox === true || undefined,
          // the proxy hands Claude its own suggested rules on `always`,
          // on the person's own computer too: they live in this
          // thread's process only, which another thread, bot or
          // person never reuses (see the spawn contract)
          allowSession: ask.kind === "permission" ? true : undefined,
          approvalScope:
            typeof ask.tool === "string" && controlsHost && ask.tool.startsWith("mcp__computer")
              ? "local-computer"
              : undefined,
          questions: questions ?? undefined,
          // A structured ask still offers flat labels, for the phone
          // companions and any client that predates the question card.
          choices: questions ? questionChoices(questions) : parseChoices(ask.input?.choices),
        });
      },
      onResolve: (resolved: any) => {
        const eventTurnId = sessions.get(threadId)?.turn?.turnId ?? turnId;
        emit({
          ...base(threadId, eventTurnId),
          type: "request.resolved",
          requestId: resolved.id,
          behavior: resolved.behavior,
          source: resolved.source,
          approvalScope:
            controlsHost && typeof askTools.get(resolved.id) === "string" && askTools.get(resolved.id)!.startsWith("mcp__computer") ? "local-computer" : undefined,
        });
        askTools.delete(resolved.id);
      },
    });
    // A fallback bind means the deterministic pipe is still held by an
    // earlier process's child. The proxy learns its path from argv, so
    // point it at the pipe we actually bound. argsKey deliberately keeps
    // the base path: the nonce is not part of the spawn contract, and a
    // retained session keeps its own broker object anyway.
    if (broker && broker.socketPath !== socketPath && mcpConfigPath) {
      mcpServers.ogb = { command: process.execPath, args: [PERM_PROXY_PATH, broker.socketPath], env: permissionEnv, alwaysLoad: true };
    }
  }

  // Write once, only after the broker has selected its real endpoint.
  if (mcpConfigPath) {
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }), { mode: 0o600 });
  }
  if (authSettingsPath) {
    writeFileSync(authSettingsPath, JSON.stringify(settings), { mode: 0o600 });
  }
  if (sessionId) args.push("--resume", sessionId);
  else args.push("--session-id", newSessionId!);
  try {
    sessionConfigDirs.set(sessionId ?? newSessionId!, resolveClaudeConfigDir(undefined, env));
    if (sessionConfigDirs.size > 500) sessionConfigDirs.delete(sessionConfigDirs.keys().next().value!);
  } catch {}
} catch (error) {
  cleanupUnownedLaunch();
  throw error;
}

// Stop reached the relaunch handle while this attempt was still setting
// up (model probe, broker). Settle the logical turn as interrupted
// instead of spawning a process nobody wants.
if (relaunch && retry.cancelled) {
  cleanupUnownedLaunch();
  if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
  emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "interrupted", cost: null });
  return { turnId };
}
// The call ended while this warm was still building its config.
if (turn.warmOnly === true && turn.warmSignal?.aborted) {
  cleanupUnownedLaunch();
  return { turnId };
}

let child: ReturnType<typeof spawnCli>;
try {
  child = spawnCli(config.cli, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }, "bot");
} catch (error) {
  cleanupUnownedLaunch();
  throw error;
}
let markClosed!: () => void;
const session: ClaudeSession = {
  closed: new Promise<void>((resolve) => { markClosed = resolve; }),
  child,
  broker,
  mcpConfigPath,
  systemPromptPath,
  argsKey,
  switches,
  turnFiles: turnFiles(mcpServers),
  contract,
  mcpNames: Object.keys(mcpServers),
  searchedMounts,
  // Launched with the stable half only, a warm process holds no
  // volatile half until its first real turn delivers it.
  // An engine slash command's launch message is the bare command, so
  // the process holds no newer copy than the one it resumed with.
  ...((turn.warmOnly === true || turn.harnessCommand) && held
    ? { volatile: held.volatile, ...(held.sections ? { volatileSections: held.sections } : {}) }
    : launchVolatile && (turn.warmOnly === true || turn.harnessCommand) ? { volatile: UNDELIVERED_VOLATILE }
      : { volatile: turn.systemVolatile ?? "", ...(turn.systemVolatileSections ? { volatileSections: sectionFingerprints(turn.systemVolatileSections) } : {}) }),
  sessionId: sessionId ?? newSessionId,
  sawInit: false,
  nativePermissionMode: null,
  replaysUserMessages,
  toolNames: new Map(),
  // A warm has no turn from the start, so a fast init cannot emit
  // under a phantom turn id.
  turn: turn.warmOnly === true ? null : { turnId, input: turn, retryAbort, settled: false, sawStreamDelta: false, pendingSteers: new Set(), deferred: null, continuationGrace: null, continuationSilence: null },
  idleWarm: turn.warmOnly === true,
  warmToken: turn.warmOnly === true ? turnId : undefined,
  idleTimer: null,
  closing: false,
  stderr: "",
  costTotal: undefined,
};
sessions.set(threadId, session);
// The contract a keep-warm ping replays. Never for a guest's turn.
if (turn.guestConfined) warmContracts.delete(threadId);
else {
  warmContracts.set(threadId, {
    args: [...args], env: { ...env }, cwd, system: turn.system ?? null,
    mcpServers: mcpConfigPath ? JSON.parse(JSON.stringify(mcpServers)) : null,
    settings: authSettingsPath ? JSON.parse(JSON.stringify(settings)) : null,
  });
}

  Object.assign(ctx, { session, child, broker, mcpConfigPath, systemPromptPath, markClosed, held, launchVolatile });
  return null;
}
