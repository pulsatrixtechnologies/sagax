/** Spawn (or adopt) the pi child for one turn (#1383). */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "../contracts.ts";
import { spawnCli } from "../procs.ts";
import { withoutTurnTokens } from "./spawn-contract.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { piHostToolArgs } from "./host-tools.ts";
import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { ASK_USER_TOOL } from "../../shared/ask-question.ts";
import type { SendTurnInput } from "../contracts.ts";
import { promptHalves, splitSessionPrompt } from "./prompt-split.ts";
import { attachPiEvents } from "./pi-send-events.ts";
import { attachPiRpc } from "./pi-send-rpc.ts";
import { attachPiStdio } from "./pi-send-stdio.ts";
import type { PiAskDecision, PiPrepared, PiSendCtx, PiSendDeps } from "./pi-turn-ctx.ts";

/** #3063: a retry after pi failed to load a kit extension keeps the turn's
 * id; the kit then leaves that one extension out (piKit). */
export type PiPrepareOptions = { turnId?: string };

/** #1276: a warm turn shows nothing; it only leaves a pi ready ahead. */
export type PiWarmed = { warmed: true; turnId: string };

export async function preparePiTurn(deps: PiSendDeps, turn: SendTurnInput, options: PiPrepareOptions = {}): Promise<PiSendCtx | PiWarmed> {
  const { hooks } = deps;
  const { threadId } = turn;
  const selection = parseToolScope(turn.toolScope);
  if (!selection.ok) throw new Error(selection.error);
  const toolScope = selection.scope;
  if (deps.active.has(threadId)) throw new Error("a turn is already running on this thread");
  // Per-bot Ask/Auto is authoritative for harness turns. Preserve the
  // legacy instance flag only for direct adapter callers that omit it.
  const fullAuto = turn.approvalMode === undefined ? deps.config.fullAuto : false;
  // Host control always routes through the permission card; full-auto must
  // never get unapproved hands on the user's machine (same guard as the
  // Claude and ACP drivers).
  const controlsHost = turn.integrations?.localComputer?.scope === "local-computer";
  if (controlsHost && fullAuto) {
    throw new Error("local computer control requires the interactive approval broker");
  }
  const turnId = options.turnId ?? newId();
  const pending = new Map<string, (decision: PiAskDecision) => void>();
  const askTimers = new Set<ReturnType<typeof setTimeout>>();
  // pi's RPC surface accepts image content directly. Read before spawning
  // so an attachment that disappeared produces one clear dispatch error
  // instead of starting a child that can never receive its prompt.
  const images = hooks.readPiPromptImages(turn);

  // Write ~/.pi/agent/models.json before creating any credential-bearing
  // MCP temp files. If model setup fails, there is nothing sensitive to
  // clean up yet.
  const homeEnv = {
    ...process.env,
    ...deps.environment,
    // the payer's own pi home, the one the child reads (piAccessEnvironment)
    ...(turn.access?.engineHome ? { PI_CODING_AGENT_DIR: turn.access.engineHome } : {}),
  };
  if (typeof turn.model === "string" && turn.model) {
    hooks.ensurePiInjectModel(turn.model, homeEnv, { contextWindow: hooks.modelContextWindow(turn.model) });
  }
  // #2024: the operator's pi kit (SAGAX_PI_KIT_DIR), copied into this
  // turn's pi home and loaded with explicit `-e`, which pi keeps under
  // --no-extensions; host tools stay withheld by --exclude-tools.
  // #3063: an extension pi failed to load is left out by itself, never a guard.
  const kit = hooks.piKit(homeEnv, turn.piKitIdentity);
  const kitArgs = kit.args;

  // integrations → stdio MCP servers for the pi-mcp-extension. The config
  // carries credentials (boat token, comms token), so it goes
  // into a 0600 temp file removed when the turn settles — never on argv.
  // The same extension registers ask_user: pi ships no ask tool that
  // works over RPC, so it is the only way a pi model can ask the person.
  // #1276: a compact turn's per-turn tokens ride files (as Claude Code's
  // warm process does), so a standby pi with the same contract can serve it.
  const mcpServers = hooks.buildMcpServers(turn.compactPrompt ? hooks.withWarmTokens(turn, threadId) : turn);
  const askUser = toolScope === undefined || allowsTool(toolScope, { kind: "native", name: ASK_USER_TOOL });
  let mcpTempDir: string | null = null;
  let scopeReadyPath: string | undefined;
  const mcpConfig: Record<string, unknown> = { mcpServers: mcpServers ?? {}, toolScope, approvalMode: turn.approvalMode, askUser, ...(turn.compactPrompt ? { stableCwd: true, splitStable: true } : {}) };
  const mounts = Boolean(mcpServers || toolScope !== undefined || askUser);
  const piArgs = [...deps.piArgs];
  const standbyArgs: string[] = [
    ...(turn.compactPrompt ? piArgs.filter((arg) => arg !== "--no-session") : piArgs),
    ...piHostToolArgs(turn.withholdHostTools === true),
    ...(mounts ? ["-e", SPAWNED_PROXIES.piMcpExtension] : []),
    ...kitArgs,
  ];
  const standbyKey = JSON.stringify({
    cli: deps.config.cli, args: standbyArgs, cwd: turn.cwd ?? null,
    config: { ...mcpConfig, mcpServers: withoutTurnTokens(mcpServers ?? {}) },
    environment: deps.environment ?? null, person: turn.principalId ?? null, access: turn.access ?? null, command: turn.commandEnvironment ?? null,
  });
  // #1276: only a session of this turn's own pi home is ever resumed
  const resumeCursor = hooks.piResumableSession(turn.resumeCursor, turn.access?.engineHome);
  // a warm leaves the thread's standby to its next turn (#1276)
  const warming = turn.warmOnly === true;
  if (!warming && turn.compactPrompt && !turn.sessionReset && resumeCursor) await hooks.settledPiStandby(threadId);
  const standby = warming ? undefined : turn.compactPrompt && !turn.sessionReset && resumeCursor
    ? hooks.takePiStandby(threadId, standbyKey, resumeCursor)
    : (hooks.dropPiStandby(threadId), undefined);
  // #1276: a new conversation takes the pi started ahead for this bot's
  // contract (everything but the folder and the MCP servers, which it
  // receives now) and switches it to a new session in this folder.
  const freshKey = JSON.stringify({
    bot: turn.botId ?? null, cli: deps.config.cli, args: standbyArgs,
    environment: deps.environment ?? null, person: turn.principalId ?? null, access: turn.access ?? null, command: turn.commandEnvironment ?? null,
  });
  const ahead = !standby && !warming && turn.compactPrompt && typeof turn.resumeCursor !== "string" && turn.cwd && mounts ? hooks.takePiFresh(freshKey) : undefined;
  if (standby) {
    mcpTempDir = standby.dir;
    scopeReadyPath = standby.scopeReadyPath;
  } else if (mounts) {
    mcpTempDir = ahead ? ahead.dir : mkdtempSync(join(tmpdir(), "omb-pi-mcp-"));
    if (toolScope !== undefined) scopeReadyPath = join(mcpTempDir, "scope-ready.json");
    try {
      writeFileSync(join(mcpTempDir, "mcp.json"), JSON.stringify({ ...mcpConfig, scopeReadyPath, ...(turn.compactPrompt ? { toolCachePath: join(mcpTempDir, deps.toolCacheName), warmPath: join(mcpTempDir, deps.warmName) } : {}) }), { mode: 0o600 });
    } catch (err) {
      // A failed write must not leave the temp dir behind — a partial file
      // could still hold the boat token / comms token.
      try {
        rmSync(mcpTempDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      throw err;
    }
  }
  // `--no-extensions` still loads an explicit `-e`, so the Sagax MCP
  // extension stays while the person's own pi extensions do not.
  // #1276: a compact prompt (a local model) keeps pi's session, so the
  // next turn resumes it (switch_session) and extends this very prompt:
  // the local server's prefix cache serves everything but the new turn.
  // Without it each turn replays the transcript into a fresh prompt.
  const childArgs = standbyArgs;
  const spawnEnv = hooks.piTurnEnvironment(hooks.piAccessEnvironment(hooks.piEnvironment({
    ...process.env,
    ...deps.environment,
    ...(mcpTempDir ? { SAGAX_MCP_CONFIG: join(mcpTempDir, "mcp.json") } : {}),
  }), turn.access, deps.environment), turn.commandEnvironment);

  // #1276: a warm (the person opened a new conversation or is typing) on
  // a local model: its prompt's stable part is computed now, no turn shown
  if (warming) {
    if (turn.compactPrompt && typeof turn.resumeCursor !== "string" && turn.cwd && mounts && mcpTempDir && !turn.warmSignal?.aborted) {
      const halves = promptHalves(turn);
      const composed = halves.stable !== null
        ? splitSessionPrompt(halves.stable, halves.volatile, null, turn.system, turn.text, false, 0, turn.systemVolatileSections).text
        : turn.system ? `${turn.system}\n\n${turn.text}` : turn.text;
      const chosen = typeof turn.model === "string" ? hooks.splitPiModel(turn.model) : null;
      await hooks.prefillPiFresh({
        person: hooks.warmPerson(turn), key: freshKey, cli: deps.config.cli, args: childArgs, cwd: turn.cwd, env: spawnEnv, dir: mcpTempDir,
        config: { ...mcpConfig, scopeReadyPath }, message: hooks.markSharedPrompt(composed, halves, turn.systemVolatileSections),
        model: chosen ? { provider: chosen.provider, modelId: chosen.modelId } : null,
      });
    } else if (mcpTempDir) {
      try { rmSync(mcpTempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    // a warm that could not run only leaves the first message cold
    return { warmed: true, turnId };
  }

  // spawnCli can throw synchronously (unresolvable CLI); if it does, the
  // 0600 temp file with the boat token / comms token must
  // not be left on disk — settle() never runs because no child existed.
  const child = standby ? standby.child : ahead ? ahead.child : (() => {
    try {
      return spawnCli(deps.config.cli, childArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: turn.cwd,
        env: spawnEnv,
      }, "bot");
    } catch (err) {
      if (mcpTempDir) {
        try {
          rmSync(mcpTempDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
      throw err;
    }
  })();
  const budget = standby?.budget ?? ahead?.budget ?? hooks.registerWarmBudget({
    person: hooks.warmPerson(turn),
    child,
  });
  hooks.armWarmBudgetClose(budget, child);

  // Listeners go on before this function returns. An await here would let a
  // fast child's first frames land with nobody reading them.
  const prepared: PiPrepared = {
    deps,
    turn,
    threadId,
    toolScope,
    turnId,
    pending,
    askTimers,
    settled: false,
    standbySession: null,
    endStopReason: undefined,
    endUsage: undefined,
    endErrorMessage: undefined,
    agentEndTimer: null,
    images,
    mcpServers,
    mcpTempDir,
    scopeReadyPath,
    mcpConfig,
    mounts,
    standbyKey,
    resumeCursor,
    standby,
    freshKey,
    ahead,
    childArgs,
    spawnEnv,
    child,
    budget,
    assistantText: "",
    toolNames: new Map(),
    toolArgs: new Map(),
    mcpServerNames: Object.keys(mcpServers ?? {}),
    searchedServers: hooks.piSearchedServers(mcpServers),
    compactionObserved: false,
    responseWaiters: new Map(),
    steerSeq: 0,
    sessionFile: resumeCursor,
    sessionReady: false,
    stderr: "",
    kit,
    retired: false,
    stdinClosed: false,
    closeTimer: null,
  };
  const ctx = attachPiRpc(prepared);
  attachPiEvents(ctx);
  attachPiStdio(ctx);
  return ctx;
}
