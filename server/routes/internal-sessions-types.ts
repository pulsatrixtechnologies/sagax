// Shared types for internal session routes (#1383).
// Handlers import these; createInternalSessionsRoutes re-exports them.
import type { BotActivity } from "../../shared/wire.ts";
import type { DirectApply } from "../direct-apply.ts";
import type { RosterMember } from "../peers/peer-roster.ts";
import type { skillDiscoveryPage } from "../skills/skill-discovery.ts";
import type { applySkillWriteWithReceipt, listStagedSkillWrites, stageSkillWrite } from "../skills/skills.ts";
import type { InternalCapabilityView } from "./internal-route.ts";
import type { SummarySession } from "../recall/session-summary.ts";

export interface InternalSessionsBot extends RosterMember {
  color: string;
  modelSelection: { model?: string };
  threadId?: string;
  tasks?: Array<{ threadId: string }>;
  memoryEnabled?: boolean;
  activity?: BotActivity;
}

export interface InternalSessionsTask {
  threadId: string;
  title: string;
  activity?: string;
  unread?: boolean;
  openedBy?: { botId?: string; at: number; delegationId?: string };
  createdAt: number;
  closedBy?: { botId: string; name: string; at: number };
}

export interface InternalSessionsGroup {
  id: string;
  name: string;
  memberIds: string[];
  dm?: boolean;
  threadId: string;
  tasks?: Array<{ threadId: string; title?: string }>;
}

/** Opaque Local VM handle for attach/exec; index wires the real target. */
export type InternalSessionsVm = { workspaceDir: string };

export interface InternalSessionsDeps {
  /** session_search: a short model summary of the matching conversations
   * (#2610). Absent or null: the search answers with its hits alone. */
  summarizeRecall?(bot: InternalSessionsBot, query: string, sessions: readonly SummarySession[]): Promise<string | null>;
  bot(id: string): InternalSessionsBot | null | undefined;
  bots(): readonly InternalSessionsBot[];
  tasks(botId: string): readonly InternalSessionsTask[];
  taskByThread(botId: string, threadId: string): InternalSessionsTask | null | undefined;
  groups(): readonly InternalSessionsGroup[];
  groupByThread(threadId: string): InternalSessionsGroup | null | undefined;
  isConfidentialThread(threadId: string): boolean;
  ownsThread(botId: string, threadId: string): { group?: InternalSessionsGroup } | null;
  threadBusy(botId: string, threadId: string): boolean;
  awaitingAnswer(threadId: string): boolean;
  activeDirect(threadId: string): boolean;
  appendMessage(threadId: string, message: unknown): unknown;
  patchTask(botId: string, threadId: string, patch: { unread?: boolean }): void;
  setTaskClosedBy(botId: string, threadId: string, closedBy: { botId: string; name: string; at: number }): void;
  roomPostEligibility(bot: InternalSessionsBot, group: InternalSessionsGroup): { ok: true } | { ok: false; status: number; error: string };
  attachmentVm(capability: InternalCapabilityView): Promise<InternalSessionsVm | undefined>;
  personDirectTurn(bot: InternalSessionsBot, threadId: string): boolean;
  messageFileRoots(botId: string, threadId: string): string[];
  dataDir(): string;
  isActive(capability: InternalCapabilityView & { localVmTarget?: InternalSessionsVm }): boolean;
  requireActive(capability: InternalCapabilityView): void;
  computerHeld(botId: string): boolean;
  commandVariables(botId: string, threadId: string): Record<string, string>;
  touchVmIdle(vm: InternalSessionsVm): void;
  containerRuntime(): Promise<string | undefined>;
  containerExec(
    vm: InternalSessionsVm,
    command: string,
    opts: { runtime: string; timeoutSeconds?: number; commandVariables: Record<string, string> },
  ): Promise<unknown>;
  roomFeedsBot(group: InternalSessionsGroup, bot: Pick<InternalSessionsBot, "visibility">): boolean;
  privateRecallFilter(bot: InternalSessionsBot, threadId: string): ((candidate: string) => boolean) | null;
  turnSpeaker(threadId: string): string | undefined;
  localPrincipalId(): string;
  isPerspicax(): boolean;
  runningTurnInstance(bot: InternalSessionsBot, threadId: string): { driverKind: string } | null | undefined;
  scopedSkillInventory(
    bot: InternalSessionsBot,
    instance: { driverKind: string } | null | undefined,
    person: string,
  ): { rows: Parameters<typeof skillDiscoveryPage>[0]; incomplete: boolean };
  stagedSkillListing(staged: ReturnType<typeof listStagedSkillWrites>[number]): unknown;
  skillAuthoringEnabled(): boolean;
  vaultPrincipal(threadId: string): string | null;
  personalFeatureOn(feature: "skillAuthoring", installation: boolean, principalId: string | null | undefined): boolean;
  appliesDirectly(botId: string, threadId: string, targetBotId: string): DirectApply | null;
  skillProposalPersistence(botId: string, threadId: string, opensCard: boolean):
    | { ok: true }
    | { ok: false; status: number; error: string };
  recordSkillLearned(threadId: string, skillName: string): void;
  keptCardRule(
    bot: InternalSessionsBot,
    threadId: string,
    candidate: { tool: string; scope: Record<string, string> },
    classes: readonly string[],
  ): { id: string } | undefined;
  appendSkillRequestCard(args: {
    botId: string;
    threadId: string;
    staged: {
      id: string;
      action: "create" | "update";
      name: string;
      gist: string;
      source: string;
      files: Array<{ path: string; content: string }>;
      sha256: string;
      warnings: string[];
    };
    applied?: boolean;
    previous?: { preview: string; source: string };
    ownerRule?: { tool: string; scope: Record<string, string>; description: string };
  }): { requestId: string; summary: string };
  /** Apply a skill the bot staged for itself (skill_manage and automatic review). */
  applyOwnStagedSkill(
    from: InternalSessionsBot,
    threadId: string,
    staged: Exclude<ReturnType<typeof stageSkillWrite>, { error: string }>,
    direct: DirectApply,
  ): ReturnType<typeof applySkillWriteWithReceipt>;
  appendDecision(row: Record<string, unknown>): void;
}
