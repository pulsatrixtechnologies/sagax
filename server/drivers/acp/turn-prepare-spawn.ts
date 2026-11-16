/** ACP spawn contract, launch, and pooled-session adopt (#1383). */
import { createHash } from "node:crypto";
import { MiB, warmResourcePerson, warmResources } from "../../resources/warm-resources.ts";
import { killCliTree } from "../../procs.ts";
import { narrowsNativeTools } from "../../../shared/tool-scope.ts";
import type { AcpSession } from "./types.ts";
import { contractFieldsChanged, takeEngineClosed } from "./turn-latency.ts";

export type AcpSpawnDeps = {
  support: any;
  turn: any;
  turnConfig: any;
  cliTurn: any;
  approvalGated: boolean;
  launch: any;
  env: Record<string, string | undefined>;
  cwd: string | undefined;
  accountModels: ReadonlySet<string> | null | undefined;
  openSession: (...args: any[]) => AcpSession;
  threadId: string;
  active: Map<string, unknown>;
  warming: Map<string, unknown>;
  sessions: Map<string, AcpSession>;
  closeSession: (threadId: string, reason: string) => void;
  sessionAllows: Map<string, unknown>;
  sessionServersKey: unknown;
};

export type AcpSpawnResult = {
  spawnArgs: string[];
  spawnEnv: Record<string, string | undefined>;
  launchEnv: Record<string, string | undefined>;
  launchModel: string | undefined;
  contractKey: string;
  sessionKey: string;
  launchSession: () => AcpSession;
  session: AcpSession;
  cursor: string | null;
  reused: boolean;
  sessionRef: { current: AcpSession };
  /** #4394: why no warm process took this turn (the latency line's spawnWhy) */
  spawnWhy?: string;
  getLaunchedThisTurn: () => boolean;
};

export function prepareAcpSpawn(deps: AcpSpawnDeps): AcpSpawnResult {
  const {
    support, turn, turnConfig, cliTurn, approvalGated, launch, env, cwd, accountModels,
    openSession, threadId, active, warming, sessions, closeSession, sessionAllows, sessionServersKey,
  } = deps;
  // The spawn contract: everything that changes what process a turn
  // gets. The model rides argv where a support passes -m, and a
  // selectModel support re-applies it over the wire on the live
  // session, so the model is not a separate axis; fullAuto covers the
  // transformEnv-policy supports (opencode). mcpServers are session
  // establishment inputs — they ride session/new and session/load over
  // the wire — and change when a turn's integrations or their grants do
  // (a thread keeps its integration credentials across turns). Most
  // agents apply changes on live load; those that cache the old MCP
  // clients must resume on a fresh process (see sessionKey).
  // The env the spawned child actually receives is part of the
  // contract too, and arrives hashed as envFingerprint for the same
  // reason.
  const spawnArgs = support.spawnArgs(turnConfig, cliTurn, { approvalGate: approvalGated });
  const spawnEnv = launch.env ?? env;
  // Env is part of the spawn contract: a turn that changes auth env
  // (FACTORY_API_KEY placeholder, a fresh login file) must not keep
  // riding a child spawned under the old env. Hash it so secrets
  // never sit in the key itself.
  const envFingerprint = createHash("sha256").update(JSON.stringify(spawnEnv)).digest("hex").slice(0, 16);
  const inheritedScopeFingerprint = narrowsNativeTools(turn.toolScope) && support.toolScopeCacheKey
    ? createHash("sha256").update(support.toolScopeCacheKey({ config: turnConfig, env, cwd })).digest("hex") : null;
  // A support that applies the approval mode to the session on every
  // turn gets the same process whatever the mode: an approval change
  // is one RPC, not a cold start.
  const contractKey = JSON.stringify([
    warmResourcePerson(turn), turn.botId ?? null,
    launch.command, launch.args ?? [], spawnArgs, cwd,
    support.sessionScopedApproval ? null : turnConfig.fullAuto === true, envFingerprint,
    support.spawnFingerprint?.(spawnEnv, turnConfig) ?? null,
    turn.toolScope ?? null,
    inheritedScopeFingerprint,
  ]);
  // The new-session default model rides the spawn env but stays out of
  // the fingerprint above: only session/new reads it, and a pooled
  // process switches later models over the wire as before.
  const launchModel = support.sessionModelEnv && cliTurn.model && /^[\w.:/-]{1,200}$/u.test(cliTurn.model)
    && accountModels?.has(cliTurn.model) ? cliTurn.model : undefined;
  const launchEnv = support.sessionModelEnv && launchModel
    ? { ...spawnEnv, [support.sessionModelEnv]: launchModel }
    : spawnEnv;
  // whether this turn's process was started by this turn: its model
  // list is then current, not a pooled process's older one
  let launchedThisTurn = false;
  const launchSession = () => {
    const opened = openSession(threadId, launch, [...(launch.args ?? []), ...spawnArgs], launchEnv, cwd, contractKey);
    opened.launchModel = launchModel;
    opened.budget = warmResources.register({
      person: warmResourcePerson(turn), kind: "acp", bytes: 256 * MiB,
      pids: () => opened.child.pid ? [opened.child.pid] : [],
      protected: () => Boolean(opened.current) || active.has(threadId) || warming.has(threadId),
      evict: () => {
        if (sessions.get(threadId) === opened) closeSession(threadId, "warm budget");
        return killCliTree(opened.child);
      },
    });
    launchedThisTurn = true;
    return opened;
  };
  const sessionKey = JSON.stringify([sessionServersKey, turn.toolScope ?? null, inheritedScopeFingerprint, turn.withholdHostTools === true]);

  if (turn.sessionReset) {
    closeSession(threadId, "reset");
    sessionAllows.delete(threadId);
  }
  const pooled = sessions.get(threadId);
  let session: AcpSession;
  const contractMismatch = Boolean(pooled) && pooled!.contractKey !== contractKey;
  const sessionMismatch = Boolean(pooled) && Boolean(support.restartOnMcpChange) && pooled!.sessionKey !== sessionKey;
  const budgetGone = Boolean(pooled) && !(pooled!.budget?.active() ?? true);
  if (process.env.SAGAX_ACP_REUSE_DIAG === "1") {
    if (!pooled) console.error(`[acp-reuse-diag] thread=${threadId.slice(0, 8)} why=none`);
    else {
      const why = pooled.dead ? "dead" : pooled.closing ? "closing" : contractMismatch ? "contract" : sessionMismatch ? "sessionKey" : "reuse";
      const diffHint = contractMismatch ? ` fields=${contractFieldsChanged(pooled.contractKey, contractKey)}` : "";
      console.error(`[acp-reuse-diag] thread=${threadId.slice(0, 8)} why=${why}${diffHint} sessionKeyChanged=${pooled.sessionKey !== sessionKey} exit=${pooled.child.exitCode} dead=${pooled.dead} closing=${pooled.closing} sid=${pooled.sessionId}`);
    }
  }
  // #4394: why this turn starts a process instead of a warm one (spawnWhy)
  let spawnWhy: string | undefined;
  if (pooled && !pooled.dead && !pooled.closing && !contractMismatch && !budgetGone && !sessionMismatch) {
    // adoption cancels the idle countdown — a running turn is not quiet
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
    pooled.idleTimer = null;
    session = pooled;
  } else {
    const closed = takeEngineClosed(threadId);
    spawnWhy = turn.sessionReset ? "reset"
      : !pooled ? (closed ? `closed:${closed}` : "none")
      : pooled.dead ? "exited" : pooled.closing ? "closing"
      : contractMismatch ? `contract:${contractFieldsChanged(pooled.contractKey, contractKey)}`
      : budgetGone ? "budget" : "tools";
    if (pooled) {
      // a dead child already exited — just drop the record; a live one
      // gets the full close (contract changed)
      if (pooled.dead) sessions.delete(threadId);
      else closeSession(threadId, "contract");
      takeEngineClosed(threadId);
    }
    session = launchSession();
    sessions.set(threadId, session);
  }
  const cursor = !turn.sessionReset && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
  // The turn reaches a live process whose native session it can
  // prompt as is: no handshake, no session/load (the voice latency log
  // reads this, server/voice/voice-latency.ts).
  const reused = session === pooled && session.sessionId !== null && session.sessionKey === sessionKey
    && (cursor === null || cursor === session.sessionId);
  // `session` rebinds mid-turn: when the establishment retry below
  // respawns the child, every wire call must reach the live record, so
  // nothing captures the connection off it. Phases share this holder.
  const sessionRef = { current: session };

  return {
    spawnArgs, spawnEnv, launchEnv, launchModel, contractKey, sessionKey, launchSession,
    session, cursor, reused, sessionRef, spawnWhy,
    getLaunchedThisTurn: () => launchedThisTurn,
  };
}
