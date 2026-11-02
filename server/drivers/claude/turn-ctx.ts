/** Mutable per-sendTurn context bag shared across Claude turn phases (#1383). */
import type { SendTurnInput } from "../../contracts.ts";
import type { ClaudeUserMessage } from "./messages.ts";
import type { ClaudePermissionBroker, ClaudeSession, NativeTurnResult } from "./session-types.ts";
import type { SendTurnDeps, SettleFn } from "./turn-deps.ts";

export type ClaudeTurnEarly = { turnId: string; reused?: boolean };

/** Per-turn bag. Phases read/write fields; SendTurnDeps sits on the prototype
 * via Object.create(deps) so instance maps stay live (Codex launch-attempt). */
export type ClaudeTurnCtx = SendTurnDeps & {
  [key: string]: any;
  turn: SendTurnInput;
  logicalTurnId?: string;
  threadId: string;
  botId: string | undefined;
  relaunch: boolean;
  turnId: string;
  retryAbort: AbortController;
  retry: {
    attempt: number;
    cancelled: boolean;
    rebuilt?: boolean;
    renewed?: boolean;
    authRaced?: boolean;
  };
  retryScale: number;
  renewedFromChat: boolean | null;
  promptMsg: ClaudeUserMessage;
  sessionId: string | null;
  newSessionId: string | null;
  requestedMode: string;
  autoAllowlist: boolean;
  permissionMode: string;
  controlsHost: boolean;
  args: string[];
  systemPromptPath: string | null;
  mcpServers: Record<string, unknown>;
  allowed: string[];
  searchedMounts: Set<string>;
  broker: ClaudePermissionBroker | undefined;
  socketPath: string;
  permissionEnv: Record<string, string>;
  mcpConfigPath: string | null;
  env: Record<string, string | undefined>;
  authSettingsPath: string | null;
  settings: Record<string, unknown>;
  cwd: string;
  commandCwd: string | undefined;
  contract: unknown;
  argsKey: string;
  turnModel: string | null | undefined;
  replaysUserMessages: boolean;
  isolated: boolean;
  switches: Record<string, boolean>;
  session: ClaudeSession;
  child: ClaudeSession["child"];
  markClosed: () => void;
  closeFinalized: boolean;
  settle: SettleFn;
  settleResult: (result: NativeTurnResult) => void;
  reachLimit: (frame: { api_error_params?: { rate_limit_info?: unknown } }, words: unknown) => void;
  noteCostState: (total: unknown, modelUsage: unknown, usage: { input: number; cacheRead: number; cacheWrite: number; output: number }) => void;
  currentTurnId: () => string;
  handleLine: (line: string) => void;
  finalizeClose: (code: number | null) => Promise<void>;
  sendTurn: (turn: SendTurnInput, logicalTurnId?: string) => Promise<ClaudeTurnEarly>;
  authRecovery: any;
};
