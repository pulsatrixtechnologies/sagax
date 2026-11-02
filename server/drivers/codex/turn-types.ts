/** Shared types for Codex turn phase modules (issue #1383). */
import type { ChildProcess } from "node:child_process";
import type { SendTurnInput, StdioMcpSpec } from "../../contracts.ts";
import type { RenewalStep } from "../../context-renewal.ts";
import type { McpApprovalMode } from "./mcp-mount.ts";

/** Mutable turn-level state owned by sendTurn / launchAttempt. */
export type CodexTurnMutable = {
  turn: SendTurnInput;
  stopRequested: boolean;
  promptSubmitted: boolean;
  recoveredMissingSession: boolean;
  loginRaceRetried: boolean;
  announced: boolean;
  autoAcceptPermissions: boolean;
  renewalSteps: RenewalStep[];
  renewalLastText: string;
  inTurnRenewal: string | null;
};

export type PreparedCodexLaunch = {
  env: Record<string, string | undefined>;
  launchedLogin: string | null;
  appServerArgs: string[];
  privateEnv: string[];
  provenPrivateEnv: boolean;
  selectedMcp: Map<string, StdioMcpSpec>;
  selectedApprovals: Map<string, McpApprovalMode>;
  directoryMounts: Set<string>;
  selectionConfig: { config?: Record<string, unknown> };
  commandCwd: string;
  releaseSlot: () => void;
  child: ChildProcess;
};
