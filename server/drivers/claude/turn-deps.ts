/** Shared deps bag for Claude create / sendTurn phases (#1383 wave 5). */
import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import type {
  DriverCreateInput,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  TurnAccessInput,
} from "../../contracts.ts";
import type { KeepWarmContract } from "../claude-keepwarm.ts";
import type { ClaudeCliVersion, ClaudeConfig } from "./config.ts";
import type { ClaudePermissionBroker, ClaudeSession, NativeTurnResult } from "./session-types.ts";
import type { ClaudeUserMessage } from "./messages.ts";

export type ClaudeActiveTurn = {
  stop: () => void;
  turnId: string;
  broker?: ClaudePermissionBroker;
};

export type ClaudeRetryState = {
  attempt: number;
  cancelled: boolean;
  rebuilt?: boolean;
  renewed?: boolean;
  authRaced?: boolean;
};

export type HeldVolatile = {
  sessionId: string;
  volatile: string;
  sections?: Record<string, string>;
};

/** Instance-scoped maps and helpers sendTurn / sessions close over. */
export type SendTurnDeps = {
  instanceId: string;
  input: DriverCreateInput<ClaudeConfig>;
  config: ClaudeConfig;
  environment: (model?: string | null, access?: TurnAccessInput) => Record<string, string | undefined>;
  getStartupModelRefresh: () => Promise<void> | null;
  getCliVersion: () => ClaudeCliVersion | null;
  setCliVersion: (version: ClaudeCliVersion | null) => void;
  getCliVersionChecked: () => boolean;
  setCliVersionChecked: (checked: boolean) => void;
  getCliHasAutocompact: () => boolean | null;
  readCliVersion: (env: NodeJS.ProcessEnv) => Promise<{ version: string } | { reason: string }>;
  sessions: Map<string, ClaudeSession>;
  active: Map<string, ClaudeActiveTurn>;
  warmContracts: Map<string, KeepWarmContract>;
  warmHolds: Map<string, number>;
  heldVolatile: Map<string, HeldVolatile>;
  sessionConfigDirs: Map<string, string>;
  sessionFiles: Map<string, string>;
  sessionMisses: Map<string, number>;
  liveApprovalModes: Map<string, { turnId: string; mode: ApprovalMode }>;
  retryState: Map<string, ClaudeRetryState>;
  renewedTurns: Set<string>;
  freshNextTurn: Set<string>;
  carriedCosts: Map<string, number>;
  liveCommands: Map<string, { names: string[]; terminal: string[] }>;
  liveCommandsKey: (botId: string, identity: string | undefined) => string;
  listeners: Set<RuntimeEventListener>;
  emit: (event: RuntimeEvent) => void;
  base: (threadId: string, turnId: string) => {
    eventId: string;
    provider: string;
    threadId: string;
    turnId: string;
    createdAt: string;
  };
  stopSession: (session: ClaudeSession) => void;
  closeSession: (threadId: string, why: string) => void;
  armIdle: (threadId: string) => void;
  holdWarm: (threadId: string, session: ClaudeSession, token: string, signal?: AbortSignal) => void;
  writeUser: (s: ClaudeSession, threadId: string, promptMsg: ClaudeUserMessage) => Promise<boolean>;
  controlRequest: (s: ClaudeSession, threadId: string, request: Record<string, unknown>) => Promise<boolean>;
  applyApprovalMode: (threadId: string, mode: ApprovalMode) => Promise<boolean>;
  sessionFileBytes: (sessionId: string) => number | undefined;
  refreshSubscriptionHome: (turn: SendTurnInput, force?: boolean) => Promise<
    { ok: true; renewed: boolean; expiresAt: number | null } | { ok: false; reason: string }
  >;
  SESSION_IDLE_MS: number;
  /** Module helpers still hosted on claude.ts (avoid leaf→parent cycles). */
  support: ClaudePrepareSupport;
};

/** Helpers prepare/spawn need from the parent driver module. */
export type ClaudePrepareSupport = Record<string, any>;


export type SettleFn = (
  ok: boolean,
  stopReason: string | null,
  total?: number | null,
  usage?: NativeTurnResult["usage"],
) => Promise<void> | void;
