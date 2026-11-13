/**
 * Shared types for the bots core HTTP routes (#1388 B1, split for #1383).
 * Handlers take this bag explicitly and never import server/index.ts.
 */
import type { IncomingMessage } from "node:http";

import type { ApprovalViewer } from "../approvals/approval-audience.ts";
import type { LookRefusal } from "../achievements/achievements-mastery.ts";
import type { Level } from "../auth/authz.ts";
import type { RemoteCwdDeps } from "../bots/bot-cwd.ts";
import type { NewBotDefaults } from "../bots/new-bot-defaults.ts";
import type { ProviderInstance } from "../contracts.ts";
import type { GithubCredential } from "../github/github-access.ts";
import type { OrgInstallStatus, ResolvedPreset } from "../presets.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, GroupRecord, Message, TaskRecord } from "../store.ts";
import type { TemporaryAgent } from "../temporary-agents.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { PermissionKey } from "../../shared/permissions.ts";
import type { BotVisibility } from "../../shared/wire.ts";

export const BOTS_READ_ONLY = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." } as const;
export const MEMBER_BOT_FULL_ACCESS = {
  error: "Turn Full access on from the bot's Permissions, where you confirm it once for this bot. Custom needs the desktop app on your own computer.",
  code: "member_bot_full_access",
} as const;
export const MAX_WORKSPACE_BOTS = 100;

export interface BotsCoreVisible {
  everything: boolean;
  bot(id: string): boolean;
  thread(id: string): boolean;
  group(id: string): boolean;
  sections(all: readonly string[]): string[];
}

export interface BotsCoreStore {
  readonly bots: readonly BotRecord[];
  readonly groups: readonly GroupRecord[];
  readonly sections: readonly string[];
  bot(id: string): BotRecord | null | undefined;
  createBot(input: Record<string, unknown>, opts?: { language?: "fr" | "en" }): BotRecord;
  patchBot(id: string, patch: Record<string, unknown>): BotRecord | null | undefined;
  patchBotProfile(id: string, patch: Record<string, unknown>): BotRecord | null | undefined;
  deleteBot(id: string): void;
  setPrimaryBot(id: string): BotRecord[] | null;
  clearPrimaryBot(id: string): BotRecord[] | null;
  setSoul(id: string, soul: string): BotRecord | null | undefined;
  projectBotForTask(botId: string, threadId: string): BotRecord | null | undefined;
  tasks(botId: string): readonly TaskRecord[];
  taskByThread(botId: string, threadId: string): TaskRecord | null | undefined;
  messagesFor(threadId: string): readonly Message[];
  messagesTail(threadId: string, limit: number): { messages: readonly Message[] };
  patchMessage(threadId: string, messageId: string, patch: Record<string, unknown>): Message | null | undefined;
  setActiveLeaf(threadId: string, messageId: string): string | null | undefined;
  activeLeaf(threadId: string): string | null | undefined;
  patchTask(botId: string, threadId: string, patch: Record<string, unknown>): TaskRecord | null | undefined;
  createTask(
    botId: string,
    title?: string,
    activate?: boolean,
    projectId?: string,
    _unused?: unknown,
    approvalMode?: string,
    ownerPrincipalId?: string,
    _unused2?: unknown,
    hidden?: boolean,
    cwd?: string,
    confidential?: boolean,
  ): TaskRecord | null | undefined;
  switchTask(botId: string, threadId: string): BotRecord | null | undefined;
  refreshTaskPermissions(botId: string, threadId: string): TaskRecord | null | undefined;
  switchTaskModel(
    botId: string,
    threadId: string,
    selection: ModelSelection,
    updateBotDefault: boolean,
    extra?: Record<string, unknown>,
  ): TaskRecord | null | undefined;
  deleteTask(botId: string, threadId: string): BotRecord | null | undefined;
  retitleTask(botId: string, threadId: string, expected: string | undefined, title: string): TaskRecord | null | undefined;
  reorderProjects(botId: string, projectIds: string[]): unknown[] | null | undefined;
  project(botId: string, projectId: string): unknown;
  createProject(botId: string, name: string, emoji?: string | null): unknown;
  patchProject(botId: string, projectId: string, patch: Record<string, unknown>): unknown;
  deleteProject(botId: string, projectId: string): BotRecord | null | undefined;
  isConfidentialThread(threadId: string): boolean;
}

export interface BotsCoreRoutines {
  create(input: Record<string, unknown>): { id: string };
  remove(id: string): void;
  update(id: string, patch: Record<string, unknown>): void;
  isActiveThread(threadId: string): boolean;
}

export interface BotsCoreRouteDeps {
  store: BotsCoreStore;
  /** #2045: stable section id for a display name (org servers). */
  resolveSectionId?: (section: string, auth: RequestAuth, bot?: { ownerUserId?: string }) => string | undefined;
  /** I2: the caller's team model and computer for a new bot in that team. */
  teamDefaultsFor?: (auth: RequestAuth, section: string) => import("../rooms/section-context.ts").TeamDefaultsRecord | null;
  cfg: { newBotDefaults?: NewBotDefaults; browserProfiles?: ReadonlyArray<{ id: string }> };
  identity: { kind: "solo" | "perspicax" };
  desktopManaged: boolean;
  fixedWorkspaceSeam: boolean;
  threadDeletedMessage: string;
  visibleFor(auth: RequestAuth, path: string): BotsCoreVisible;
  viewerId(auth: RequestAuth): string | undefined;
  refreshGroupUsage(): void;
  pageSize(raw: string | null): number | null | undefined;
  listedBotVisible(bot: BotRecord, viewerId: string | undefined): boolean;
  publicBotQueuedMessages(): Record<string, unknown>;
  threadsWithActiveCoordination(): ReadonlySet<string>;
  privateThreads(): boolean;
  ensureViewerThread(bot: BotRecord, viewerId: string): string | undefined;
  wireBot(bot: BotRecord): Record<string, unknown>;
  viewerBotActivity(bot: BotRecord, viewerId: string): Record<string, unknown>;
  listedTasks<T extends { threadId: string; hidden?: true }>(selectedThreadId: string | undefined, tasks: readonly T[]): T[];
  threadsShownTo<T extends { ownerPrincipalId?: unknown }>(bot: { ownerUserId?: unknown }, tasks: readonly T[], viewerId: string | undefined): T[];
  wireTask(task: unknown, botModel: ModelSelection, coordinated?: ReadonlySet<string>): unknown;
  messagePage(threadId: string, limit: number | undefined, before: string | null | undefined, viewer: ApprovalViewer): Record<string, unknown>;
  viewerForApproval(auth: RequestAuth): ApprovalViewer;
  threadKeyedForViewer<T>(entries: Record<string, T>, viewerId: string | undefined): Record<string, T>;
  orgVisibleSections(all: readonly string[], viewerId: string | undefined): string[];
  groupVisible(group: { id?: unknown; humanIds?: string[]; section?: unknown; peopleDm?: boolean; archivedAt?: number }, viewerId: string | undefined): boolean;
  peopleDmProjection(group: GroupRecord, personId: string | undefined, knows: boolean, page?: { limit: number | undefined; viewer: ApprovalViewer }): object;
  groupReaderId(auth: RequestAuth): string | undefined;
  knowsPersonThreads(req: IncomingMessage): boolean;
  publicGroupState(group: GroupRecord): object;
  botComputerControlSnapshot(botId: string): { held: unknown; helpReason: unknown };
  newBotApprovalMode(): "ask" | "auto" | "full";
  memberDefaultSelection(principalId: string | null | undefined): Promise<ModelSelection>;
  defaultSelection(): Promise<ModelSelection>;
  githubCredentialsFor(actor: string | null | undefined): readonly GithubCredential[];
  orgAvatarImageConfig(principalId: string | null): { imageGen?: { provider?: string; key?: string; customApiKey?: string; customModel?: string; customUrl?: string }; xai?: { key?: string } } | null;
  requesterPrincipal(auth: RequestAuth): string | null;
  takeTemporaryCreateToken(token: unknown, auth: RequestAuth): TemporaryAgent | null;
  botCreationAllowed(auth: RequestAuth): boolean;
  personBotsReadOnly(principalId: string | undefined | null): boolean;
  botsReadOnlyRefusal(principalId: string | undefined | null): Record<string, unknown>;
  memberBotFieldRefusal(auth: RequestAuth, body: unknown): { field: string; permission?: PermissionKey } | null;
  presetStore: { resolve(id: string): ResolvedPreset | null };
  orgInstallStatuses(): ReadonlyMap<string, OrgInstallStatus>;
  requestedWorksOn(value: unknown): "off" | "local" | "cloud" | "vm" | "browser" | undefined;
  memberAutoRefused(bot: { ownerUserId?: unknown }, froms: Array<string | undefined>, to: string): boolean;
  creatingBotOwnerId(auth: RequestAuth): string;
  storedAvatarExists(avatarUrl: string): boolean;
  personalProfileOf(principalId: string | null | undefined, profileId: unknown): boolean;
  memberFolderRefusal(principal: string | null, folder: string | null | undefined): { error: string; code?: string } | null;
  memberFolderPrincipal(auth: RequestAuth): string | null;
  checkedModelSelection(
    raw: unknown,
    current: { selection?: ModelSelection; busy?: boolean } | undefined,
    requireAvailable: boolean,
    principal: string | null,
  ): { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string };
  hostedModels: { allows(selection: ModelSelection): boolean; error(): string; resetTask?(from: ModelSelection, to: ModelSelection): Record<string, unknown> } | null;
  ownerChosenVisibility(auth: RequestAuth, visibility: BotVisibility): BotVisibility;
  routines: BotsCoreRoutines;
  projectBotTranscript<T extends object>(bot: T, viewer: ApprovalViewer): T;
  publicBot(bot: BotRecord, viewer?: ApprovalViewer): Record<string, unknown>;
  botEditsNeedOwner(auth: RequestAuth): boolean;
  memberOwnsBot(auth: RequestAuth, bot: { ownerUserId?: unknown }): boolean;
  viewerBotLevel(auth: RequestAuth, bot: BotRecord): Level | "owner" | null;
  lockedLookRefusal(auth: RequestAuth, bot: BotRecord | null | undefined, nextLook: unknown): LookRefusal | null;
  ownerSettingsForbidden(auth: RequestAuth, bot: BotRecord | null | undefined, flags: Record<string, boolean>): Record<string, unknown> | null;
  recordPersonaSave(auth: RequestAuth, botId: string, before: { soul: string } | undefined, after: { soul: string }): void;
  broadcast(payload: Record<string, unknown>): void;
  actorPrincipalId(auth: RequestAuth): string;
  effectiveBotOwner(bot: { ownerUserId?: unknown }): string;
  ownerOrAdminOf(auth: RequestAuth, bot: BotRecord): boolean;
  computerOwner(auth: RequestAuth): boolean;
  previewSystemPrompt(bot: BotRecord, principal?: string): unknown;
  botOverview(bot: BotRecord): Promise<unknown>;
  requestedTaskBot(botId: string, rawThreadId: unknown): BotRecord;
  /** Request-scoped: needs auth + req (companion header) as well as botId/threadId. */
  requirePinnedClientThread(auth: RequestAuth, req: IncomingMessage, botId: string, threadId: unknown): void;
  threadBusy(botId: string, threadId: string): boolean;
  phoneSecretSubmissions: { hasThread(threadId: string): boolean; hasBot(botId: string): boolean };
  callerCan(auth: RequestAuth, key: PermissionKey): boolean;
  terminalPrincipalId(auth: RequestAuth): string | undefined;
  remoteSessions: RemoteCwdDeps["sessions"];
  callerBotsReadOnly(auth: RequestAuth): boolean;
  orgFullAccessRefusalFor(auth: RequestAuth, bot: BotRecord, confirmed: boolean): ({ status: number; error: string; code?: string } & ({ permission: PermissionKey } | { permission?: undefined })) | null;
  localPrincipalId(): string;
  sharedWorkspaceFullAccessEnabled(): boolean;
  approvalModeStepUpGate(input: Record<string, unknown>): { status: number; body: unknown } | null;
  ruleManager(auth: RequestAuth): string | null;
  supportsApprovalMode(target: ModelSelection | { instanceId?: string; driverKind?: string } | undefined, mode: ApprovalMode): boolean;
  confidentialThreadsByDefault(): boolean;
  scopedThreadViewer(): string | undefined;
  conversationThreadFor(bot: BotRecord, personId?: string): string | undefined;
  selectViewerThread(botId: string, viewerId: string, threadId: string): void;
  noteStreamSend(botId: string, threadId: string, singleStream: boolean): void;
  refreshStreamDigests(botId: string, threadId: string): void;
  actorKey(auth: RequestAuth & { kind: "session" }): string;
  threadStarters: { set(threadId: string, actor: string): void };
  makeThreadConfidential(botId: string, threadId: string): void;
  privateFolderThread(botId: string, threadId: string): boolean;
  liveCoordination(threadId: string): boolean;
  computerSelectionMoves: { delete(threadId: string): void };
  checkedTaskModelSwitch(
    current: BotRecord | Record<string, unknown>,
    raw: unknown,
    updateBotDefault: boolean,
    requireAvailable: boolean,
  ): { ok: true } | { ok: false; status: number; error: string };
  auditApprovalModeChange(auth: RequestAuth | null, botId: string, before: ApprovalMode, after: ApprovalMode, threadId?: string): void;
  runningTurnLevels(botId: string): unknown;
  applyStricterApprovalLive(botId: string, before: unknown): Promise<void>;
  stricterApprovalStopError(error: unknown): string;
  primaryAskedReplay(): boolean;
  memberOwnedInOrg(bot: { ownerUserId?: unknown }): boolean;
  stagedSkillCleanupsForThread(threadId: string): Array<{ botId: string; stagedId: string }>;
  coordinator: { cancelDirect(threadId: string, reason: string): void };
  cancelTeamSetupResumesForThread(threadId: string): void;
  confidentialThreadAttachments(botId: string, threadId: string): string[];
  threadEngineKeys(botId: string, threadId: string): string[];
  wipeConfidentialThread(botId: string, threadId: string, attachmentNames: readonly string[], engineKeys: readonly string[]): void;
  clearTurnDigestState(threadId: string): void;
  revokeInternalCapabilitiesForThread(threadId: string): void;
  handoffs: { forget(threadId: string): void };
  routableSteers: { forgetThread(threadId: string): void };
  directTurnGenerationByThread: { get(threadId: string): string | undefined };
  settleDirectFollowup(generation: string | undefined): void;
  rejectDeletedThreadSkillStages(cleanups: Array<{ botId: string; stagedId: string }>): void;
  threadTitleGate(bot: Pick<BotRecord, "modelSelection">, principalId?: string | null): { ok: true; instance: ProviderInstance } | { ok: false; refusal: string };
  titleRegenerations: Set<string>;
  /** `bot`: the title signs in as that bot's turn does (#3519). */
  generateThreadTitle(instance: ProviderInstance, excerpt: string, kind: string, bot?: BotRecord): Promise<string | null | undefined>;
}
