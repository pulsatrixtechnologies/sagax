/** Mutable per-sendTurn bag shared by pi turn phases (#1383). */
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { EffortLevel, RuntimeEvent, SendTurnInput, SteerOutcome, TurnAccessInput } from "../contracts.ts";
import type { ToolScope } from "../../shared/tool-scope.ts";
import type { PiKitInstall } from "./pi-kit.ts";

export type PiChild = ChildProcessByStdio<Writable, Readable, Readable>;

export type PiAskDecision = { behavior: "allow" | "deny" | "answer"; message?: string };

export type PiActiveTurn = {
  stop: () => void;
  turnId: string;
  pending: Map<string, (decision: PiAskDecision) => void>;
  child?: { stdin: { write: (s: string) => void } };
  steer?: (text: string, steerId?: string) => Promise<SteerOutcome>;
};

export type PiEventBase = {
  eventId: string;
  provider: string;
  providerInstanceId: string;
  threadId: string;
  turnId: string;
  createdAt: string;
};

export type PiUsage = { input?: number; output?: number };

export type PiPromptImage = { type: "image"; data: string; mimeType: string };

/** Opaque chunk reassembler. pi.ts owns `PiRpcChunks`; phases only pass it through. */
export type PiRpcChunkBag = object;

/** Opaque warm-resource lease. pi.ts owns the concrete type. */
export type PiWarmBudget = {
  retiring?: () => void;
  idle?: () => void;
  active?: () => boolean;
};

export type PiStandbyTake = {
  budget?: PiWarmBudget;
  child: PiChild;
  dir: string;
  scopeReadyPath: string | undefined;
};

export type PiFreshTake = {
  budget?: PiWarmBudget;
  child: PiChild;
  dir: string;
  sessionsRoot: string;
};

export type PiStandbyStart = {
  person: string;
  threadId: string;
  key: string;
  sessionFile: string;
  cli: string;
  args: string[];
  cwd: string | undefined;
  env: Record<string, string | undefined>;
  config: Record<string, unknown>;
  toolCache: Record<string, unknown> | undefined;
  warm: Record<string, unknown> | undefined;
};

export type PiResponseWaiter = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Helpers that stay in pi.ts. Passed in so phase files never import pi.ts. */
export type PiTurnHooks = {
  settledPiStandby: (threadId: string) => Promise<void>;
  dropPiStandby: (threadId: string) => void;
  takePiStandby: (threadId: string, key: string, sessionFile: string) => PiStandbyTake | undefined;
  takePiFresh: (key: string) => PiFreshTake | undefined;
  startPiStandby: (input: PiStandbyStart) => Promise<void>;
  startPiFresh: (input: { person: string; key: string; cli: string; args: string[]; cwd: string | undefined; env: Record<string, string | undefined> }) => Promise<void>;
  /** #1276: the warm before a new conversation's first message (local model). */
  prefillPiFresh: (input: {
    person: string; key: string; cli: string; args: string[]; cwd: string; env: Record<string, string | undefined>;
    dir: string; config: Record<string, unknown>; message: string; model: { provider: string; modelId: string } | null;
  }) => Promise<boolean>;
  readPiToolCache: (dir: string | null, file?: string) => Record<string, unknown> | undefined;
  writePiSession: (sessionsRoot: string, cwd: string) => string;
  readPiPromptImages: (turn: SendTurnInput) => PiPromptImage[];
  piNativeLogMessage: (message: Record<string, unknown>) => Record<string, unknown>;
  ensurePiInjectModel: (
    modelId: string,
    env?: Record<string, string | undefined>,
    meta?: { contextWindow?: number; maxTokens?: number },
  ) => { provider: string; modelId: string } | null;
  modelContextWindow: (modelId: string) => number | undefined;
  /** #2024/#3063: install the kit in the turn's pi home, leaving out any
   * extension pi failed to load (never a guard); empty without a kit. */
  piKit: (homeEnv: Record<string, string | undefined>, identity: SendTurnInput["piKitIdentity"]) => PiKitInstall;
  warmPerson: (turn: SendTurnInput) => string;
  registerWarmBudget: (input: { person: string; child: PiChild }) => PiWarmBudget;
  /** Arm retireClosedWarmProcess on the child's close (idempotent with standby/fresh). */
  armWarmBudgetClose: (budget: PiWarmBudget | undefined, child: PiChild) => void;
  buildMcpServers: (turn: SendTurnInput) => Record<string, unknown> | null;
  withWarmTokens: (turn: SendTurnInput, threadId: string) => SendTurnInput;
  piResumableSession: (cursor: unknown, engineHome: string | undefined) => string | null;
  piSearchedServers: (mounted: Record<string, unknown> | null) => ReadonlySet<string>;
  piGatedMcpTool: (title: unknown, mounted: Record<string, unknown> | null) => string | undefined;
  piGatedMcpInput: (message: unknown, mcpTool: string) => string;
  piSearchedCall: (mcpTool: string, input: string, searched: ReadonlySet<string>) => { mcpTool: string; input: string; refused?: string };
  decodePiFrame: (line: string, chunks: PiRpcChunkBag) => Record<string, unknown> | null;
  piLineReader: (onLine: (line: string) => boolean | void) => (chunk: string) => void;
  newChunks: () => PiRpcChunkBag;
  splitPiModel: (id: string) => { provider: string; modelId: string } | null;
  piThinkingLevel: (effort: EffortLevel) => string;
  markSharedPrompt: (message: string, halves: { stable: string | null; volatile: string }, sections: Array<{ id: string; text: string }> | undefined) => string;
  piEnvironment: (source: Record<string, string | undefined>) => Record<string, string | undefined>;
  piAccessEnvironment: (
    env: Record<string, string | undefined>,
    access: TurnAccessInput | undefined,
    orgKeys?: Record<string, string | undefined>,
  ) => Record<string, string | undefined>;
  piTurnEnvironment: (env: Record<string, string | undefined>, commandEnvironment: Record<string, string> | undefined) => Record<string, string | undefined>;
  refusal: (message: string) => Error;
  isRefusal: (error: unknown) => boolean;
};

export type PiSendDeps = {
  startupModelRefresh: Promise<void> | null;
  config: { cli: string; fullAuto: boolean };
  environment: Record<string, string>;
  active: Map<string, PiActiveTurn>;
  emit: (event: RuntimeEvent) => void;
  base: (threadId: string, turnId: string) => PiEventBase;
  piArgs: readonly string[];
  negotiateFrame: Record<string, unknown>;
  toolCacheName: string;
  warmName: string;
  agentEndGraceMs: number;
  promptReAnchorTurns: number;
  hooks: PiTurnHooks;
};

export type PiPrepared = {
  deps: PiSendDeps;
  turn: SendTurnInput;
  threadId: string;
  toolScope: ToolScope | undefined;
  turnId: string;
  pending: Map<string, (decision: PiAskDecision) => void>;
  askTimers: Set<ReturnType<typeof setTimeout>>;
  settled: boolean;
  standbySession: string | null;
  endStopReason: string | undefined;
  endUsage: PiUsage | undefined;
  endErrorMessage: string | undefined;
  agentEndTimer: ReturnType<typeof setTimeout> | null;
  images: PiPromptImage[];
  mcpServers: Record<string, unknown> | null;
  mcpTempDir: string | null;
  scopeReadyPath: string | undefined;
  mcpConfig: Record<string, unknown>;
  mounts: boolean;
  standbyKey: string;
  resumeCursor: string | null;
  standby: PiStandbyTake | undefined;
  freshKey: string;
  ahead: PiFreshTake | undefined;
  childArgs: string[];
  spawnEnv: Record<string, string | undefined>;
  child: PiChild;
  budget: PiWarmBudget;
  assistantText: string;
  toolNames: Map<string, string>;
  toolArgs: Map<string, unknown>;
  mcpServerNames: string[];
  searchedServers: ReadonlySet<string>;
  compactionObserved: boolean;
  responseWaiters: Map<string, PiResponseWaiter>;
  steerSeq: number;
  sessionFile: string | null;
  sessionReady: boolean;
  stderr: string;
  /** #3063: what this turn loaded from the kit, and what it left out. */
  kit: PiKitInstall;
  /** #3063: set once the child failed to load a kit extension and the turn
   * moved to a new child without that one; this attempt then stays silent. */
  retired: boolean;
  /** #3063: pi's stdin broke (pi is exiting): the close decides the turn. */
  stdinClosed: boolean;
  /** #3063: the fallback that fails the turn if no close follows a broken stdin. */
  closeTimer: ReturnType<typeof setTimeout> | null;
  /** #3063: set while a retry may still follow; called when pi exits
   * because it failed to load this kit extension (not a guard), with pi's
   * line. The turn runs again without that one extension. */
  onExtensionLoadFailure?: (arg: string, line: string) => void;
};

export type PiRpcSlots = {
  rejectWaiters: (err: Error) => void;
  awaitResponse: (command: string, timeoutMs?: number, key?: string) => Promise<unknown>;
  send: (obj: Record<string, unknown>) => void;
  flushAssistantText: () => void;
  settle: (ok: boolean, stopReason?: string | null, usage?: PiUsage) => void;
  finishRun: () => void;
  stop: () => void;
  /** #3063: end this attempt without a turn.completed (a retry follows). */
  retire: () => void;
  /** Fail the turn with this message; once pi's stdin broke, pi's close
   * decides instead (a retry, or pi's own words), with a short fallback. */
  failTurn: (message: string) => void;
};

export type PiSendCtx = PiPrepared & PiRpcSlots;
