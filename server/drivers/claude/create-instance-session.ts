/** Claude session maps and helpers for createClaudeInstance (#1383). */
import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import type { KeepWarmContract } from "../claude-keepwarm.ts";
import { sessionIdlePolicy } from "../session-idle.ts";
import type { ClaudeSession } from "./session-types.ts";
import { createSessionHelpers } from "./sessions.ts";

export function createClaudeSessionRuntime(input: {
  environment: (model?: string | null, access?: any) => NodeJS.ProcessEnv | Record<string, string | undefined>;
  active: Map<string, { stop: () => void; turnId: string; broker?: any }>;
  instanceId: string;
}) {
  // One live CLI process per thread, kept across turns. Under
  // --input-format stream-json the CLI settles a turn with `result` while
  // stdin stays open, takes the next user message on the same stdin as a
  // new turn, and folds a message that arrives MID-turn into the running
  // one before its next model call (verified against 2.1.221 — that fold
  // is what "steer" is). So a session is spawned once, reused while its
  // spawn contract (args, MCP config, cwd, model) is unchanged, closed
  // after SESSION_IDLE_MS of quiet, and resumed by --resume when needed.
  type Session = ClaudeSession;
  const sessions = new Map<string, Session>();
  // Prompt-cache keep-warm (claude-keepwarm.ts): what each live process
  // was launched with, so a ping can replay the exact request prefix, and
  // how long a keep-warm window wants that process kept past its idle
  // close (the next real turn must reuse it: a relaunch recomputes the
  // volatile system prompt and would miss the cache anyway).
  const warmContracts = new Map<string, KeepWarmContract>();
  const warmHolds = new Map<string, number>();

  /** What a closed process's conversation holds of the volatile half, by
   * thread: a relaunch that resumes that same session sends only what
   * changed since, like a live one (port of OpenMausBot #3164). Absent
   * (server restart, crash, unsettled turn, evicted entry): the whole
   * half rides. Bounded like the neighboring session caches. */
  const heldVolatile = new Map<string, { sessionId: string; volatile: string; sections?: Record<string, string> }>();
  /** Where each session's file was written (the config dir of its launch),
   * for sessionBytes. After a restart the default config dir is searched. */
  const sessionConfigDirs = new Map<string, string>();
  const sessionFiles = new Map<string, string>();
  /** A session whose file was not found, and when to look again: a miss
   * scans every projects/ folder, so it is not repeated on every turn. */
  const sessionMisses = new Map<string, number>();
  const { idleMs: SESSION_IDLE_MS } = sessionIdlePolicy("CLAUDE");
  /** #1373: the level a person chose while a turn was running, by thread,
   * for that logical turn's relaunches (see sendTurn). */
  const liveApprovalModes = new Map<string, { turnId: string; mode: ApprovalMode }>();
  const {
    sessionFileBytes,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
  } = createSessionHelpers({
    environment: input.environment,
    sessions,
    active: input.active,
    warmContracts,
    warmHolds,
    heldVolatile,
    sessionConfigDirs,
    sessionFiles,
    sessionMisses,
    liveApprovalModes,
    SESSION_IDLE_MS,
    instanceId: input.instanceId,
  });

  return {
    sessions,
    warmContracts,
    warmHolds,
    heldVolatile,
    sessionConfigDirs,
    sessionFiles,
    sessionMisses,
    SESSION_IDLE_MS,
    liveApprovalModes,
    sessionFileBytes,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
  };
}
