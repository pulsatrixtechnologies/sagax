/** Mutable Codex app-server session bag shared across launch phases. */
import type { ChildProcess } from "node:child_process";
import type { RequestOutcome, RuntimeEvent, SendTurnInput, SteerOutcome, StdioMcpSpec } from "../../contracts.ts";
import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import type { RenewalStep } from "../../context/context-renewal.ts";
import type { CodexRoute } from "../codex-errors.ts";
import type { CodexConfig } from "./config.ts";
import type { McpApprovalMode } from "./mcp-mount.ts";
import type { McpStartupTracker } from "./mcp-startup.ts";
import type { WarmResourceLease } from "../../resources/warm-resources.ts";

/** One retained app-server process for a thread (#1969). Lives with CodexSession
 * so sessions.ts and turn-types.ts stay leaves of this module (#1381). */
export type CodexProcess = {
  key: string;
  identity: string;
  initialized: boolean;
  /** From the initialize reply; reused when the process stays warm. */
  userAgent?: unknown;
  closing?: boolean;
  session?: CodexSession;
  idle?: ReturnType<typeof setTimeout>;
  unwatch?: () => void;
  budget?: WarmResourceLease;
};

/** Session registry methods a live CodexSession calls (park / forget / put). */
export type CodexSessionsHandle = {
  put(threadId: string, process: CodexProcess): void;
  forget(s: CodexSession, treeStopped?: boolean): void;
  park(s: CodexSession): void;
};

export type PreparedCodexLaunch = {
  env: Record<string, string | undefined>;
  launchedLogin: string | null;
  appServerArgs: string[];
  privateEnv: string[];
  provenPrivateEnv: boolean;
  selectedMcp: Map<string, StdioMcpSpec>;
  selectedApprovals: Map<string, McpApprovalMode>;
  /** A selected mount's own `env` table (the person's environment proxy). */
  selectedLiterals: Map<string, Record<string, string>>;
  /** Mounts written on argv without going through selectedMcp (phone, messages, workplace). */
  directMounts: string[];
  directoryMounts: Set<string>;
  selectionConfig: { config?: Record<string, unknown> };
  commandCwd: string;
  releaseSlot: () => void;
  child: ChildProcess;
  process: CodexProcess;
  previous?: CodexSession;
};

export type CodexSession = PreparedCodexLaunch & {
  input: SendTurnInput;
  attempt: number;
  // turn identity
  threadId: string;
  turnId: string;
  // instance/turn deps
  emit: (event: RuntimeEvent) => void;
  base: (threadId: string, turnId: string) => { eventId: string; provider: string; threadId: string; turnId: string; createdAt: string };
  stopRequested: boolean;
  stopSignal: AbortController;
  active: Map<string, { stop: () => Promise<boolean>; turnId: string; asks: Map<string, Function>; steer?: Function }>;
  approvalMode: ApprovalMode;
  route: CodexRoute;
  chatgptTurn: boolean;
  plan: boolean;
  config: CodexConfig;
  withholdHostTools: boolean;
  autoAcceptPermissions: boolean;
  promptSubmitted: boolean;
  recoveredMissingSession: boolean;
  loginRaceRetried: boolean;
  announced: boolean;
  retryScale: number;
  renewalSteps: RenewalStep[];
  renewalLastText: string;
  inTurnRenewal: string | null;
  freshNextTurn: Set<string>;
  renewedTurns: Set<string>;
  turnReviewers: Map<string, { mode: ApprovalMode; sagaxAnswers: boolean }>;
  loginMark: () => [string, string] | null;
  loginRefused: () => void;
  loginAccepted: (mark?: [string, string] | null) => void;
  ownLogin: boolean;
  // session mutables / handlers (filled by phases)
  abandoned: boolean;
  codexThreadId: string | null;
  codexTurnId: string | null;
  startingNativeTurn: boolean;
  earlyNotifications: any[];
  state: {
    settled: boolean;
    lastError: string;
    lastErrorSetup: boolean;
    retryError: string;
    authRecovery: boolean;
    contextFullStop: boolean;
    lastText: string;
    sawStreamDelta: boolean;
    streamed: boolean;
    usage?: { input: number; output: number; cachedInput?: number };
    usageBaseline?: { input: number; output: number; cachedInput: number };
  };
  asks: Map<string, (behavior: "allow" | "deny" | "answer", message?: string, source?: "user" | "timeout" | "system") => void | Promise<RequestOutcome>>;
  nextId: number;
  sensitiveResponseIds: Set<number>;
  rpcPending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  send: (obj: unknown) => void;
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<any>;
  stopping?: Promise<boolean>;
  terminate: () => Promise<boolean>;
  completeStoppedTurn?: () => void;
  interruptRequested: boolean;
  stop: () => Promise<boolean>;
  settle: (ok: boolean, stopReason: string | null) => Promise<void>;
  relaunch: (reason: string, failure: string, failedStop: string) => Promise<void>;
  renewContext: () => Promise<void>;
  steerActiveTurn: (text: string, steerId?: string) => Promise<SteerOutcome>;
  controlsHost: boolean;
  handleServerRequest: (msg: any) => void;
  handleNotification: (msg: any) => void;
  mcpStartup: McpStartupTracker;
  reviewWarning: boolean;
  timedOutReview: boolean;
  seenReviews: Set<string>;
  reviewNotice: (status: "warning" | "timedOut" | "denied", action?: unknown) => void;
  turnError: (error: { message?: unknown; codexErrorInfo?: unknown }) => void;
  retryLoginRace: (raw: string, refused: boolean) => boolean;
  buf: string;
  stderr: string;
  stderrSinceOutput: string;
  runLaunchAttempt: (attempt: number) => Promise<void>;
  sessions: CodexSessionsHandle;
  detachStream: () => void;
  lastUsage?: { input: number; output: number; cachedInput: number };
  recoverCrash: (nativeThreadId: string | null, acknowledged: boolean) => boolean;
};
