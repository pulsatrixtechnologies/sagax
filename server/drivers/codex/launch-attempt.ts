/** Orchestrate one Codex app-server launch attempt (issue #1383 wave 5). */
import type { PrepareLaunchDeps } from "./prepare-launch.ts";
import { prepareCodexLaunch } from "./prepare-launch.ts";
import { wireCodexSession } from "./wire.ts";
import { attachCodexTools } from "./tools.ts";
import { attachCodexStream } from "./stream.ts";
import { finishCodexLaunch } from "./finish.ts";
import type { CodexSession } from "./session-types.ts";
import type { PreparedCodexLaunch } from "./turn-types.ts";

export type LaunchAttemptDeps = PrepareLaunchDeps & Omit<CodexSession,
  keyof PreparedCodexLaunch | "abandoned" | "codexThreadId" | "codexTurnId" | "startingNativeTurn" |
  "earlyNotifications" | "state" | "asks" | "nextId" | "sensitiveResponseIds" | "rpcPending" |
  "send" | "request" | "stopping" | "terminate" | "completeStoppedTurn" | "interruptRequested" |
  "stop" | "settle" | "relaunch" | "renewContext" | "steerActiveTurn" | "controlsHost" |
  "handleServerRequest" | "handleNotification" | "reviewWarning" | "timedOutReview" | "seenReviews" |
  "reviewNotice" | "turnError" | "retryLoginRace" | "buf" | "stderr" | "stderrSinceOutput" |
  "runLaunchAttempt" | "attempt" | "input"
> & {
  input: CodexSession["input"];
  runLaunchAttempt: (attempt: number) => Promise<void>;
};

export async function runLaunchAttempt(deps: LaunchAttemptDeps, attempt: number): Promise<void> {
  const prepared = await prepareCodexLaunch(deps, attempt);
  if (!prepared) return;

  // Keep deps accessors (loginRaceRetried, promptSubmitted, inTurnRenewal, …)
  // on the prototype so phase writes reach sendTurn's outer lets. A plain
  // `{ ...deps }` would copy getter values once and drop the setters.
  const s = Object.assign(Object.create(deps), {
    ...prepared,
    attempt,
    abandoned: false,
    codexThreadId: null as string | null,
    codexTurnId: null as string | null,
    startingNativeTurn: false,
    earlyNotifications: [] as any[],
    state: {
      settled: false,
      lastError: "",
      lastErrorSetup: false,
      retryError: "",
      authRecovery: false,
      contextFullStop: false,
      lastText: "",
      sawStreamDelta: false,
      streamed: false,
    },
    asks: new Map(),
    nextId: 1,
    sensitiveResponseIds: new Set<number>(),
    rpcPending: new Map(),
    buf: "",
    stderr: "",
    stderrSinceOutput: "",
    seenReviews: new Set<string>(),
    reviewWarning: false,
    timedOutReview: false,
  }) as unknown as CodexSession;

  wireCodexSession(s);
  attachCodexTools(s);
  attachCodexStream(s);
  await finishCodexLaunch(s);
}
