/**
 * Bots core HTTP routes (#1388 wave 3 B1): list/create bots, bot-defaults,
 * profile, primary, soul/system-prompt/overview/cards, active-branch,
 * projects and tasks.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 */
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { ApprovalViewer } from "../approvals/approval-audience.ts";
import type { LookRefusal } from "../achievements-mastery.ts";
import { atLeast, type Level } from "../authz.ts";
import { generateAvatarImage, avatarGenerationRequestSchema } from "../avatar-image.ts";
import { validateBotCwd, validateBotCwdFor, type RemoteCwdDeps } from "../bot-cwd.ts";
import { soulFile, readSoulDrift, writeSoulMirror } from "../bot-folder.ts";
import { parseBotProfilePatch } from "../bot-profile.ts";
import { memberBot, memberGroup, parseVisibility } from "../bot-visibility.ts";
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import {
  confidentialPatch,
  newThreadConfidential,
} from "../threads/confidential-threads.ts";
import type { ProviderInstance } from "../contracts.ts";
import { autoNewBotSelection } from "../models/default-model-selection.ts";
import { githubSkillFetch, type GithubCredential } from "../github-access.ts";
import { mcpServerNameError, MAX_MCP_SERVERS } from "../mcp/mcp-registry.ts";
import { MEMBER_AUTO_NOT_ALLOWED } from "../approvals/member-auto-approval.ts";
import { journalMemoryWrite } from "../memory/memory-journal.ts";
import { pickBotName } from "../names.ts";
import {
  botSkillTemplateSchema,
  newBotDefaultsSchema,
  resolveBotCreationDefaults,
  type NewBotDefaults,
} from "../new-bot-defaults.ts";
import { newConversationFullAllowed } from "../org/org-full-access.ts";
import { orgXaiRefusal } from "../org/org-xai-media.ts";
import { peopleDmForViewer } from "../people-dms.ts";
import { isPrincipalId } from "../principals.ts";
import {
  applyPresetToBot,
  presetOffered,
  PRESET_UNAVAILABLE_MESSAGE,
  type OrgInstallStatus,
  type ResolvedPreset,
} from "../presets.ts";
import { profileRevision, profileSnapshot } from "../profile-revision.ts";
import { recordProfileChange } from "../profile-versions.ts";
import type { RequestAuth } from "../request-auth.ts";
import { sessionPrincipal } from "../request-auth.ts";
import { fetchSkillFromSource } from "../skills/skill-fetch.ts";
import { installOrgSkill, installSkill, setSkillEnabled } from "../skills/skills.ts";
import type { BotRecord, GroupRecord, Message, TaskRecord } from "../store.ts";
import { parseSurface } from "../surface.ts";
import type { TemporaryAgent } from "../temporary-agents.ts";
import {
  parseFolderBody,
  parseFolderOrder,
  parseThreadOrganization,
} from "../threads/thread-folders.ts";
import { titleConversationExcerpt } from "../threads/thread-title.ts";
import { writeMemoryFile, writeMemoryTopic } from "../workspace.ts";
import {
  approvalModeFor,
  approvalModeWidens,
  liveApprovalChange,
  type ApprovalMode,
} from "../../shared/approval-mode.ts";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { BOT_FIELD_PERMISSIONS, permissionRefusal, type PermissionKey } from "../../shared/permissions.ts";
import { parseSkillMd, scanSkillText } from "../../shared/skill-md.ts";
import { threadLinkUrl } from "../../shared/thread-link.ts";
import type { BotVisibility } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BOTS_READ_ONLY = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." } as const;
const MEMBER_BOT_FULL_ACCESS = {
  error: "Turn Full access on from the bot's Permissions, where you confirm it once for this bot. Custom needs the desktop app on your own computer.",
  code: "member_bot_full_access",
} as const;
const MAX_WORKSPACE_BOTS = 100;

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
  createBot(input: Record<string, unknown>): BotRecord;
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
  newBotApprovalMode(): "ask" | "auto";
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
  applyAutoReviewDefault(auth: RequestAuth, botId: string, threadId: string): void;
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
  generateThreadTitle(instance: ProviderInstance, excerpt: string, kind: string): Promise<string | null | undefined>;
}

export function createBotsCoreRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!(path === "/api/bots" || path.startsWith("/api/bot-defaults") || path.startsWith("/api/bots/"))) {
      return PASS;
    }

    const {
      store,
      cfg,
      refreshGroupUsage,
      pageSize,
      listedBotVisible,
      publicBotQueuedMessages,
      threadsWithActiveCoordination,
      privateThreads,
      ensureViewerThread,
      wireBot,
      viewerBotActivity,
      listedTasks,
      threadsShownTo,
      wireTask,
      messagePage,
      viewerForApproval,
      threadKeyedForViewer,
      orgVisibleSections,
      groupVisible,
      peopleDmProjection,
      groupReaderId,
      knowsPersonThreads,
      publicGroupState,
      botComputerControlSnapshot,
      newBotApprovalMode,
      memberDefaultSelection,
      defaultSelection,
      githubCredentialsFor,
      orgAvatarImageConfig,
      requesterPrincipal,
      takeTemporaryCreateToken,
      botCreationAllowed,
      personBotsReadOnly,
      botsReadOnlyRefusal,
      memberBotFieldRefusal,
      presetStore,
      orgInstallStatuses,
      requestedWorksOn,
      memberAutoRefused,
      creatingBotOwnerId,
      storedAvatarExists,
      personalProfileOf,
      memberFolderRefusal,
      memberFolderPrincipal,
      checkedModelSelection,
      hostedModels,
      ownerChosenVisibility,
      routines,
      projectBotTranscript,
      publicBot,
      botEditsNeedOwner,
      memberOwnsBot,
      viewerBotLevel,
      lockedLookRefusal,
      ownerSettingsForbidden,
      recordPersonaSave,
      broadcast,
      actorPrincipalId,
      effectiveBotOwner,
      ownerOrAdminOf,
      computerOwner,
      previewSystemPrompt,
      botOverview,
      requestedTaskBot,
      requirePinnedClientThread,
      threadBusy,
      phoneSecretSubmissions,
      callerCan,
      terminalPrincipalId,
      remoteSessions,
      callerBotsReadOnly,
      orgFullAccessRefusalFor,
      localPrincipalId,
      sharedWorkspaceFullAccessEnabled,
      approvalModeStepUpGate,
      ruleManager,
      supportsApprovalMode,
      confidentialThreadsByDefault,
      scopedThreadViewer,
      conversationThreadFor,
      selectViewerThread,
      applyAutoReviewDefault,
      noteStreamSend,
      refreshStreamDigests,
      actorKey,
      threadStarters,
      makeThreadConfidential,
      privateFolderThread,
      liveCoordination,
      computerSelectionMoves,
      checkedTaskModelSwitch,
      auditApprovalModeChange,
      runningTurnLevels,
      applyStricterApprovalLive,
      stricterApprovalStopError,
      primaryAskedReplay,
      memberOwnedInOrg,
      stagedSkillCleanupsForThread,
      coordinator,
      cancelTeamSetupResumesForThread,
      confidentialThreadAttachments,
      threadEngineKeys,
      wipeConfidentialThread,
      clearTurnDigestState,
      revokeInternalCapabilitiesForThread,
      handoffs,
      routableSteers,
      directTurnGenerationByThread,
      settleDirectFollowup,
      rejectDeletedThreadSkillStages,
      threadTitleGate,
      titleRegenerations,
      generateThreadTitle,
    } = deps;
    const IDENTITY = deps.identity;
    const DESKTOP_MANAGED = deps.desktopManaged;
    const FIXED_WORKSPACE_SEAM = deps.fixedWorkspaceSeam;
    const THREAD_DELETED = deps.threadDeletedMessage;
    const visible = deps.visibleFor(auth, path);
    const viewerId = deps.viewerId(auth);
    let m: RegExpMatchArray | null = null;

    if (method === "GET" && path === "/api/bots") {
      try { refreshGroupUsage(); } catch { /* accounting must not block a snapshot */ }
      const limit = pageSize(url.searchParams.get("messages"));
      if (limit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // wireBot(), not publicBot(): this snapshot answers with the page it
      // was asked for, not the default one. tasks stays explicit, as in
      // publicBot(): wireBot() omits the key entirely for a bot record
      // carrying no tasks, where clients expect [].
      // A member on a workspace with a restricted bot gets only what they may
      // see (bot-visibility.ts); for everyone else these filters keep all.
      // Temporary agents (create_agent) are never listed in the app.
      const shownBots = store.bots.filter((bot) => !bot.temporary && visible.bot(bot.id) && listedBotVisible(bot, viewerId));
      const queued = publicBotQueuedMessages();
      const coordinated = threadsWithActiveCoordination();
      // Organization server: each person opens a bot on their own thread
      // (started for them the first time) and lists only their threads.
      const listed = shownBots.map((bot) => {
        const mine = viewerId && privateThreads() ? ensureViewerThread(bot, viewerId) : undefined;
        const record = mine ? store.projectBotForTask(bot.id, mine) ?? bot : bot;
        return memberBot({
          ...wireBot(record),
          // busy while any of the viewer's threads works, not only the one shown
          ...(viewerId && privateThreads() ? viewerBotActivity(bot, viewerId) : {}),
          tasks: listedTasks(record.threadId, threadsShownTo(bot, store.tasks(bot.id), viewerId)).map((task) => wireTask(task, bot.modelSelection, coordinated)),
          ...messagePage(record.threadId, limit, null, viewerForApproval(auth)),
        }, visible as never);
      });
      return json(res, 200, {
        bots: listed,
        botQueuedMessages: threadKeyedForViewer(visible.everything ? queued : Object.fromEntries(Object.entries(queued).filter(([threadId]) => visible.thread(threadId))), viewerId),
        sections: orgVisibleSections(visible.sections(store.sections), viewerId),
        groups: store.groups.filter((g) => visible.group(g.id) && groupVisible(g, viewerId)).map((g) => {
          // A person conversation opens on the thread this person has open
          // (a client that knows threads), else on its default thread.
          const room = g.peopleDm
            ? peopleDmProjection(g, groupReaderId(auth), knowsPersonThreads(req), { limit, viewer: viewerForApproval(auth) })
            : peopleDmForViewer({ ...publicGroupState(g), ...messagePage(g.threadId, limit, null, viewerForApproval(auth)) }, groupReaderId(auth));
          return visible.everything ? room : memberGroup(room);
        }),
        computerControl: Object.fromEntries(
          shownBots.map((bot) => {
            const snapshot = botComputerControlSnapshot(bot.id);
            return [bot.id, { held: snapshot.held, helpReason: snapshot.helpReason }];
          }),
        ),
      });
    }

    if (method === "GET" && path === "/api/bot-defaults") {
      // #1445: a member's new bot is not built from the admin's template
      // (POST /api/bots): the model it starts on is the one chosen for them,
      // among what they can run.
      const member = auth.kind === "session" && !auth.scopes.includes("admin");
      return json(res, 200, {
        defaults: structuredClone(cfg.newBotDefaults ?? newBotDefaultsSchema.parse({})),
        // 2026-10-11: what a new bot starts on when the template names no
        // level (New bot shows it): Approve for me, or the organization's.
        approvalMode: newBotApprovalMode(),
        // A new bot opens on Auto (docs/plans/2026-10-08-auto-model.md): the
        // engine is auto-resolved, the model is Auto. A template that pins a
        // model wins over this on the client, so an advanced default is kept.
        modelSelection: member ? await memberDefaultSelection(sessionPrincipal(auth)) : autoNewBotSelection(await defaultSelection()),
        ...(member ? { memberDefault: true } : {}),
        suggestedName: pickBotName(store.bots.map(bot => bot.name)),
      });
    }
    if (method === "POST" && path === "/api/bot-defaults/skills/preview") {
      const checked = z.object({ source: z.string().min(1).max(2000) }).strict().safeParse(await readBody(req));
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const input = checked.data;
      const fetched = await fetchSkillFromSource(input.source, githubSkillFetch(githubCredentialsFor(sessionPrincipal(auth))));
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const skills = [];
      for (const skill of fetched.skills) {
        const file = skill.files.find(file => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"));
        if (!file) continue;
        const parsed = parseSkillMd(file.content);
        if ("error" in parsed) return json(res, 422, { error: parsed.error });
        const skippedWarnings = skill.files.filter(candidate => candidate !== file)
          .map(candidate => `skipped supporting file "${candidate.path}" — v1 imports only SKILL.md`);
        const template = botSkillTemplateSchema.safeParse({ name: parsed.name, description: parsed.description, source: skill.source, text: file.content,
          enabled: false, warnings: [...scanSkillText(file.content), ...skippedWarnings] });
        if (!template.success) return json(res, 422, { error: template.error.message });
        skills.push(template.data);
      }
      return json(res, 200, { skills });
    }
    if (method === "POST" && path === "/api/bot-defaults/avatar") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "avatar preview must be a JSON object" });
      const profile = parseBotProfilePatch(body.profile, true);
      if (!profile.ok) return json(res, 400, { error: profile.error });
      const checked = avatarGenerationRequestSchema.safeParse({ prompt: body.prompt });
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const { prompt } = checked.data;
      const imageCfg = orgAvatarImageConfig(requesterPrincipal(auth));
      if (!imageCfg) return json(res, 403, orgXaiRefusal("image"));
      const generated = await generateAvatarImage(imageCfg as never, {
        name: profile.patch.name ?? "", title: profile.patch.title ?? "", description: profile.patch.description ?? "",
      }, prompt);
      // A preview belongs to the draft. Upload it through the existing image
      // endpoint only when the user commits the new bot or its defaults.
      return json(res, 200, { dataUrl: `data:${generated.mime};base64,${generated.bytes.toString("base64")}` });
    }
    if (method === "POST" && path === "/api/bots") {
      let body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "bot must be a JSON object" });
      }
      // create_agent for a person's AI client (Perspicax #321): a one-use
      // token from the agent API marks the new bot temporary.
      let temporary: TemporaryAgent | undefined;
      if (body.temporaryToken !== undefined) {
        const taken = takeTemporaryCreateToken(body.temporaryToken, auth);
        if (!taken) return json(res, 400, { error: "temporaryToken is not valid" });
        temporary = taken;
        const { temporaryToken: _token, ...rest } = body;
        body = rest;
      }
      // An organization member's bot starts from nothing the admin saved
      // (New bot defaults can set a folder, a computer or skills): only the
      // fields memberBotFieldViolation allows, and it is theirs.
      const memberCreate = auth.kind === "session" && !auth.scopes.includes("admin");
      if (memberCreate && !botCreationAllowed(auth)) {
        if (personBotsReadOnly(auth.session.principalId)) return json(res, 403, botsReadOnlyRefusal(auth.session.principalId));
        return json(res, 403, { error: "forbidden: only a member of the organization can create bots", code: "create_bots_members_only" });
      }
      const template = memberCreate
        ? resolveBotCreationDefaults(undefined, { ...body, useDefaults: false })
        : resolveBotCreationDefaults(cfg.newBotDefaults, body);
      const settings = template.profile;
      if (memberCreate) {
        // 2026-10-09: a field beyond MEMBER_BOT_FIELDS needs its permission
        // (BOT_FIELD_PERMISSIONS). 2026-10-26: a preset the server
        // offers only fills the member's own new bot, so it is theirs to pick.
        const extra = ["visibility", "section", "cwd"].filter((key) => body[key] !== undefined);
        const refused = memberBotFieldRefusal(auth, { ...settings, ...Object.fromEntries(extra.map((key) => [key, body[key]])) });
        if (refused) {
          if (refused.permission) return json(res, 403, { ...permissionRefusal(refused.permission), field: refused.field });
          return json(res, 403, { error: `forbidden: a member's new bot may set its name, look, instructions and model, not "${refused.field}"` });
        }
      }
      // A preset (presets.ts) supplies content: playbooks, skills and
      // starter notes. Name, look and instructions stay the request's own.
      if (body.preset !== undefined && (typeof body.preset !== "string" || !/^[\w-]{1,64}$/.test(body.preset))) {
        return json(res, 400, { error: "preset must be a preset id from New bot" });
      }
      const resolvedPreset = typeof body.preset === "string" ? presetStore.resolve(body.preset) : null;
      const preset = resolvedPreset && presetOffered(resolvedPreset.row, orgInstallStatuses()) ? resolvedPreset : null;
      if (body.preset !== undefined && !preset) return json(res, 404, { error: PRESET_UNAVAILABLE_MESSAGE });
      // This computer and the cloud computer are kept. A Local VM or the
      // browser still creates an Auto bot. Off stays.
      // A request that named This computer keeps its guards: the Approve
      // for me warning, and Ask as the starting level.
      const namedThisComputer = settings.computer === "local";
      if (Object.hasOwn(settings, "computer")) settings.computer = requestedWorksOn(settings.computer) ?? undefined;
      body = { ...body, ...settings, name: settings.name };
      if (settings.approvalMode === "full" || settings.approvalMode === "custom") {
        return json(res, 403, { error: "This approval level requires the desktop permission flow. Use the bot creation dialog or explicitly choose Ask/Auto for API creation.", code: "approval_desktop_required" });
      }
      if (namedThisComputer && settings.approvalMode === "auto" && body.acknowledgeLocalAuto !== true) {
        return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
      }
      // 2026-10-17 (re-review of #688): a member's new bot is never saved on
      // an automatic level the organization refuses for members' bots.
      if (settings.approvalMode && memberAutoRefused({ ownerUserId: creatingBotOwnerId(auth) }, ["ask"], settings.approvalMode)) {
        return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
      }
      if (settings.avatarUrl && !storedAvatarExists(settings.avatarUrl)) {
        return json(res, 400, { error: "avatarUrl must reference an existing stored image" });
      }
      if (settings.browserProfile && settings.browserProfile !== "guest" && !(cfg.browserProfiles ?? []).some(profile => profile.id === settings.browserProfile)
        && !personalProfileOf(creatingBotOwnerId(auth), settings.browserProfile)) {
        return json(res, 400, { error: "browserProfile must name an existing browser profile" });
      }
      if (settings.mcpServers?.some(name => mcpServerNameError(name) !== null) || (settings.mcpServers?.length ?? 0) > MAX_MCP_SERVERS) {
        return json(res, 400, { error: "Invalid MCP server selection" });
      }
      if (settings.managedSections?.length) {
        if (!settings.chiefOfStaff || settings.managedSections.some(name => name !== "" && !store.sections.includes(name))) {
          return json(res, 400, { error: "Only a Primary Bot may manage existing additional teams" });
        }
        if (body.acknowledgePeerScope !== true) return json(res, 400, { error: "Confirm additional team access (acknowledgePeerScope)" });
        if (auth.kind === "loopback" && !DESKTOP_MANAGED && store.bots.some(bot => bot.busy)) {
          return json(res, 409, { error: "Stop running bots before granting access to another team" });
        }
      }
      const checkedCwd = validateBotCwd(settings.cwd ?? null);
      if (!checkedCwd.ok) return json(res, 400, { error: checkedCwd.error });
      // #1098 (isolation): a member's new bot works in their own roots
      const outsideCwd = memberCreate ? memberFolderRefusal(memberFolderPrincipal(auth), checkedCwd.cwd) : null;
      if (outsideCwd) return json(res, 403, { ...outsideCwd, field: "cwd" });
      if (body.requireAvailableModel !== undefined && typeof body.requireAvailableModel !== "boolean") {
        return json(res, 400, { error: "requireAvailableModel must be true or false" });
      }
      if (body.requireAvailableModel === true && body.modelSelection === undefined) {
        return json(res, 400, { error: "requireAvailableModel requires modelSelection" });
      }
      const profileInput = Object.fromEntries(
        ["name", "title", "description"]
          .filter((key) => body[key] !== undefined)
          .map((key) => [key, body[key]]),
      );
      const profile = parseBotProfilePatch(profileInput, true);
      if (!profile.ok) return json(res, 400, { error: profile.error });
      let section: string | undefined;
      if (body.section !== undefined && body.section !== null) {
        if (typeof body.section !== "string") return json(res, 400, { error: "section must be a string" });
        section = body.section.trim() || undefined;
        if (section && section.length > 60) {
          return json(res, 400, { error: "section must be at most 60 characters" });
        }
      }
      let selection: ModelSelection;
      if (body.modelSelection === undefined) {
        // A member's bot is not built from the admin's template: the
        // person's own model first, then the organization's (#1074, #1060).
        selection = memberCreate ? await memberDefaultSelection(sessionPrincipal(auth)) : await defaultSelection();
      } else {
        const checked = checkedModelSelection(body.modelSelection, undefined, body.requireAvailableModel === true, sessionPrincipal(auth));
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        selection = checked.selection;
      }
      if (hostedModels && !hostedModels.allows(selection)) return json(res, 400, { error: hostedModels.error() });
      // Keep the capacity check immediately beside the synchronous write.
      // Awaiting provider discovery before this point cannot race the cap.
      if (store.bots.length >= MAX_WORKSPACE_BOTS) {
        return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
      }
      // Apply the audience before creation can announce the bot to members.
      const created = body.visibility === undefined ? null : parseVisibility(body.visibility);
      if (created && !created.ok) return json(res, 400, { error: created.error });
      if (created?.ok) created.visibility = ownerChosenVisibility(auth, created.visibility);
      const bot = store.createBot({ ...profile.patch, soul: settings.soul, section, modelSelection: selection,
        ownerUserId: creatingBotOwnerId(auth),
        toolScope: settings.toolScope ?? undefined,
        ...(temporary ? { temporary } : {}),
        ...(created?.ok ? { visibility: created.visibility } : {}) });
      const createdRoutines: Array<{ id: string; enabled: boolean }> = [];
      try {
        const { chiefOfStaff: _chief, managedSections: _managed, toolScope: _toolScope, ...ordinary } = settings;
        // The server's new bot level (Approve for me, or the organization's
        // policy) unless the request chose another level, or the bot works
        // on this computer (that warning is its own confirmation).
        const defaultMode = namedThisComputer ? "ask" : newBotApprovalMode();
        const approvalMode = ordinary.approvalMode ?? (memberAutoRefused(bot, ["ask"], defaultMode) ? "ask" : defaultMode);
        store.patchBot(bot.id, {
          // Store creation completes workspace defaults (including effort).
          // Applying the rest of the template must not undo that selection.
          ...ordinary, name: bot.name, section, modelSelection: bot.modelSelection,
          mascotExpression: ordinary.mascotExpression ?? undefined,
          avatarUrl: ordinary.avatarUrl || undefined,
          computer: ordinary.computer ?? undefined, cwd: checkedCwd.cwd ?? undefined,
          peers: ordinary.peers ?? undefined, mcpServers: ordinary.mcpServers ?? undefined,
          browserProfile: ordinary.browserProfile || undefined,
          approvalMode,
          autoApprove: approvalMode === "auto",
        });
        store.patchTask(bot.id, bot.threadId, { approvalMode, autoApprove: approvalMode === "auto" });
        // What the preset brings wins over the saved defaults for the same
        // skill name or note file.
        const presetSkills = new Set(preset?.preset.skills ?? []);
        const presetNotes = new Set(Object.keys(preset?.preset.seed?.memory ?? {}));
        for (const [file, text] of Object.entries(template.memory)) {
          if (presetNotes.has(file)) continue;
          journalMemoryWrite(bot.id, file, text, { actor: "person", via: "api" });
        }
        if (preset) {
          applyPresetToBot(bot.id, preset, {
            store: store as never,
            skills: { install: installSkill, setEnabled: setSkillEnabled, installOrg: installOrgSkill },
            memory: { writeIndex: writeMemoryFile, writeTopic: writeMemoryTopic },
          });
        }
        for (const skill of template.skills) {
          if (presetSkills.has(skill.name)) continue;
          const parsed = parseSkillMd(skill.text);
          if ("error" in parsed || parsed.name !== skill.name) throw Object.assign(new Error("Skill name does not match its contents"), { status: 400 });
          const installed = installSkill(bot.id, skill.source, [{ path: "SKILL.md", content: skill.text }]);
          if ("error" in installed) throw Object.assign(new Error(installed.error), { status: 422 });
          if (skill.enabled) {
            const enabled = setSkillEnabled(bot.id, skill.name, true);
            if ("error" in enabled) throw Object.assign(new Error(enabled.error), { status: 422 });
          }
        }
        for (const routine of template.routines) {
          const created = routines.create({ ...routine, botId: bot.id, enabled: false });
          createdRoutines.push({ id: created.id, enabled: routine.enabled !== false });
        }
      } catch (error) {
        for (const routine of createdRoutines) routines.remove(routine.id);
        store.deleteBot(bot.id);
        throw error;
      }
      // Creation is complete. Activation errors must not invite a duplicate
      // creation retry or delete a bot whose routine may already have run.
      const warnings: string[] = [];
      if (settings.chiefOfStaff) {
        try {
          store.patchBot(bot.id, { managedSections: settings.managedSections ?? [] });
          store.setPrimaryBot(bot.id);
        } catch {
          warnings.push("Bot created; review its Primary Bot setting before delegating work.");
        }
      }
      for (const routine of createdRoutines) if (routine.enabled) {
        try { routines.update(routine.id, { enabled: true }); }
        catch { warnings.push(`Bot created; routine ${routine.id} could not be activated.`); }
      }
      return json(res, 201, {
        ...(warnings.length ? { warnings } : {}),
        bot: projectBotTranscript({
          ...wireBot(bot),
          messages: [...store.messagesFor(bot.threadId)],
          activeLeafId: store.activeLeaf(bot.threadId),
        }, viewerForApproval(auth)),
      });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/profile$/);
    if (m && method === "PATCH") {
      const target = store.bot(m[1]);
      if (target && botEditsNeedOwner(auth) && !memberOwnsBot(auth, target) && !atLeast(viewerBotLevel(auth, target), "edit")) {
        return json(res, 403, { error: "forbidden: only the bot owner can change its profile", code: "bot_profile_owner_only" });
      }
      const parsed = parseBotProfilePatch(await readBody(req), true);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      if (parsed.patch.avatarUrl && !storedAvatarExists(parsed.patch.avatarUrl)) {
        return json(res, 400, { error: "avatarUrl must reference an existing stored image" });
      }
      const existingBot = store.bot(m[1]);
      const lookLocked = lockedLookRefusal(auth, existingBot, parsed.patch.mascotLook);
      if (lookLocked) return json(res, 403, lookLocked);
      // On a Cloud home a bot's name, title, description and standing
      if (parsed.patch.notifications !== undefined) {
        const refusal = ownerSettingsForbidden(auth, existingBot, { notifications: true });
        if (refusal) return json(res, 403, refusal);
      }
      const beforeProfile = existingBot ? profileSnapshot(existingBot) : undefined;
      const bot = store.patchBotProfile(m[1], parsed.patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (beforeProfile) recordProfileChange(bot.id, "user", "api", beforeProfile, profileSnapshot(bot));
      recordPersonaSave(auth, bot.id, beforeProfile, profileSnapshot(bot));
      const visible = wireBot(bot);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/primary$/);
    if (m && method === "POST") {
      const target = store.bot(m[1]);
      if (!target) return json(res, 404, { error: "no such bot" });
      const actor = actorPrincipalId(auth).trim().toLowerCase();
      const owner = effectiveBotOwner(target);
      const soloAdmin = IDENTITY.kind !== "perspicax" && (auth.kind !== "session" || auth.scopes.includes("admin"));
      if (!soloAdmin && (!actor || owner !== actor)) {
        return json(res, 403, { error: "Only this bot's owner can make it their Primary Bot", code: "not_bot_owner" });
      }
      const changed = store.setPrimaryBot(target.id);
      if (changed === null) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { bot: wireBot(store.bot(target.id)!), changed: changed.map((bot) => bot.id) });
    }
    // Leave the role. The same people who may take it may give it up. A
    // member cannot PATCH chiefOfStaff (it is not a member field), so this
    // is the step-down that matches POST.
    if (m && method === "DELETE") {
      const target = store.bot(m[1]);
      if (!target) return json(res, 404, { error: "no such bot" });
      const actor = actorPrincipalId(auth).trim().toLowerCase();
      const owner = effectiveBotOwner(target);
      const soloAdmin = IDENTITY.kind !== "perspicax" && (auth.kind !== "session" || auth.scopes.includes("admin"));
      if (!soloAdmin && (!actor || owner !== actor)) {
        return json(res, 403, { error: "Only this bot's owner can step down their Primary Bot", code: "not_bot_owner" });
      }
      const changed = store.clearPrimaryBot(target.id);
      if (changed === null) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { bot: wireBot(store.bot(target.id)!), changed: changed.map((bot) => bot.id) });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/soul$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can read its instructions here", code: "bot_instructions_owner_only" });
      const soul = bot.soul ?? "";
      const drift = readSoulDrift(bot.id, soul, bot.soulHash ?? "");
      return json(res, 200, {
        soul,
        revision: profileRevision(bot),
        bytes: Buffer.byteLength(soul, "utf8"),
        limit: BOT_PROFILE_LIMITS.soul,
        file: soulFile(bot.id),
        drift: drift.drift,
        ...(drift.drift ? { fileText: drift.fileText } : {}),
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/soul\/apply-file$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (body?.expectedRevision !== profileRevision(bot)) {
        return json(res, 409, { error: "This bot's profile changed; reload and look again" });
      }
      const drift = readSoulDrift(bot.id, bot.soul ?? "", bot.soulHash ?? "");
      if (!drift.drift) return json(res, 409, { error: "SOUL.md matches the record; nothing to apply" });
      if (typeof body?.fileText !== "string" || body.fileText !== drift.fileText) {
        return json(res, 409, { error: "SOUL.md changed since you read it; reload and look again" });
      }
      // The file is user input like any other: same cap, same error copy.
      const parsed = parseBotProfilePatch({ soul: drift.fileText });
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      // store.bot() returns the live record and setSoul mutates it in place,
      // so the snapshot must be taken before the call — after, `bot` and
      // `updated` are the same object and the diff would always be empty.
      const beforeProfile = profileSnapshot(bot);
      const updated = store.setSoul(bot.id, parsed.patch.soul ?? "");
      if (!updated) return json(res, 404, { error: "no such bot" });
      recordProfileChange(bot.id, "file", "ui", beforeProfile, profileSnapshot(updated));
      recordPersonaSave(auth, bot.id, beforeProfile, profileSnapshot(updated));
      const visible = wireBot(updated);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/soul\/discard-file$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (body?.expectedRevision !== profileRevision(bot)) {
        return json(res, 409, { error: "This bot's profile changed; reload and look again" });
      }
      const drift = readSoulDrift(bot.id, bot.soul ?? "", bot.soulHash ?? "");
      if (!drift.drift || typeof body?.fileText !== "string" || body.fileText !== drift.fileText) {
        return json(res, 409, { error: "SOUL.md changed since you read it; reload and look again" });
      }
      writeSoulMirror(bot.id, bot.soul ?? "");
      const updated = store.patchBot(bot.id, { soulDrift: false }) ?? bot;
      const visible = wireBot(updated);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/system-prompt$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session (iOS parity) previews the prompt of a bot it owns.
      if (!ownerOrAdminOf(auth, bot) && !computerOwner(auth)) {
        return json(res, 403, { error: "forbidden: only the bot owner or an admin can read its prompt", code: "bot_prompt_owner_only" });
      }
      return json(res, 200, previewSystemPrompt(bot, sessionPrincipal(auth) ?? undefined));
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/overview$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session (iOS parity) reads it for a bot it owns.
      if (!ownerOrAdminOf(auth, bot) && !computerOwner(auth)) {
        return json(res, 403, { error: "forbidden: only the bot owner or an admin can read what it does", code: "bot_activity_owner_only" });
      }
      return json(res, 200, await botOverview(bot));
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const bot = requestedTaskBot(m[1], body.threadId);
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      if (existing.card.requestId) {
        return json(res, 409, { error: "request cards must be answered through the approval endpoint" });
      }
      if (Object.keys(body).some((key) => key !== "answered" && key !== "dismissed" && key !== "threadId")) {
        return json(res, 400, { error: "only answered and dismissed may be changed" });
      }
      if (body.answered !== undefined && typeof body.answered !== "string") {
        return json(res, 400, { error: "answered must be a string" });
      }
      if (body.dismissed !== undefined && typeof body.dismissed !== "boolean") {
        return json(res, 400, { error: "dismissed must be true or false" });
      }
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(body.answered !== undefined ? { answered: body.answered } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
        },
      });
      return json(res, 200, { message: patched });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/active-branch$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body.threadId);
      const notYours = cloudThreadRefusal(auth, bot.threadId);
      if (notYours) return json(res, 403, { error: notYours });
      if (threadBusy(bot.id, bot.threadId)) return json(res, 409, { error: "the thread is working — stop it before switching versions" });
      if (phoneSecretSubmissions.hasThread(bot.threadId)) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      const leaf = store.setActiveLeaf(bot.threadId, String(body.messageId ?? ""));
      if (!leaf) return json(res, 404, { error: "no such message" });
      // provider sessions still hold the other branch — next turn replays
      store.patchTask(bot.id, bot.threadId, { rewound: true });
      return json(res, 200, { activeLeafId: leaf });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/projects\/order$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session organizes the folders of a bot it owns (its own
      // threads), never another person's bot.
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can organize its folders", code: "bot_folders_owner_only" });
      const order = parseFolderOrder(await readBody(req));
      if (!order.ok) return json(res, 400, { error: order.error });
      const projects = store.reorderProjects(bot.id, order.projectIds);
      if (!projects) return json(res, 400, { error: "projectIds must include each of this bot's folders exactly once" });
      return json(res, 200, { projects, bot: projectBotTranscript(publicBot(bot), viewerForApproval(auth)) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/projects(?:\/([\w-]+))?$/);
    if (m && ((method === "POST" && !m[2]) || (method === "PATCH" && m[2]) || (method === "DELETE" && m[2]))) {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can organize its folders", code: "bot_folders_owner_only" });
      if (m[2] && !store.project(bot.id, m[2])) return json(res, 404, { error: "no such folder" });
      if (method === "DELETE") {
        const updated = store.deleteProject(bot.id, m[2]!);
        return json(res, 200, { bot: projectBotTranscript(publicBot(updated!), viewerForApproval(auth)) });
      }
      const folder = parseFolderBody(await readBody(req), method === "POST");
      if (!folder.ok) return json(res, 400, { error: folder.error });
      const patch = folder.patch;
      const project = method === "POST"
        ? store.createProject(bot.id, patch.name!, patch.emoji)
        : store.patchProject(bot.id, m[2]!, patch);
      return json(res, method === "POST" ? 201 : 200, { project, bot: projectBotTranscript(publicBot(bot), viewerForApproval(auth)) });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      let cwd: string | undefined;
      if (body.cwd !== undefined) {
        // Opening a conversation is client-scoped, choosing where its file
        // tools run has the same authority as editing the bot's folder: an
        // admin, or on an organization server the bot's owner holding the
        // folder permission (folders.botWorkingFolder, the PATCH rule).
        const folderPermission = BOT_FIELD_PERMISSIONS.cwd!;
        if (!auth.scopes.includes("admin") && !(IDENTITY.kind === "perspicax" && ownerOrAdminOf(auth, bot) && callerCan(auth, folderPermission))) {
          return json(res, 403, { error: "Choosing a working folder needs the right to choose your bots' working folder.", ...(IDENTITY.kind === "perspicax" ? permissionRefusal(folderPermission) : {}) });
        }
        const checked = await validateBotCwdFor(body.cwd, { principalId: terminalPrincipalId(auth), botId: bot.id, sessions: remoteSessions });
        if (!checked.ok) return json(res, 400, { error: checked.error });
        if (!checked.cwd) return json(res, 400, { error: "Choose an existing working folder, or omit cwd to use the bot's default" });
        const outside = checked.remote ? null : memberFolderRefusal(memberFolderPrincipal(auth), checked.cwd);
        if (outside) return json(res, 403, { ...outside, field: "cwd" });
        cwd = checked.cwd;
      }
      if (body.approvalMode !== undefined && body.approvalMode !== "ask" && body.approvalMode !== "full") {
        return json(res, 400, { error: "new task approvalMode must be ask or full" });
      }
      if (body.approvalMode === "full") {
        // 2026-10-27 (#1098): the bot's owner who already confirmed Full
        // access for this bot opens a new conversation on Full, from any of
        // their apps: on an organization server the signed-in owner holding
        // that confirmation, on a solo server the operator (this computer or
        // one of their admin devices) once the desktop app confirmed it.
        const ownerConfirmedFull = (IDENTITY.kind !== "perspicax" || (!callerBotsReadOnly(auth) && orgFullAccessRefusalFor(auth, bot, false) === null))
          && newConversationFullAllowed({
            identity: IDENTITY.kind,
            callerPrincipalId: sessionPrincipal(auth),
            ownerPrincipalId: effectiveBotOwner(bot),
            soloOwner: (auth.kind === "loopback" && auth.trust !== "service") || (auth.kind === "session" && auth.scopes.includes("admin")),
            localPrincipalId: localPrincipalId().trim().toLowerCase(),
            consent: bot.fullAccessConsent,
          });
        if (!ownerConfirmedFull && memberOwnedInOrg(bot)) return json(res, 409, MEMBER_BOT_FULL_ACCESS);
        if (!ownerConfirmedFull && (auth.kind !== "loopback" || !sharedWorkspaceFullAccessEnabled())) {
          return json(res, 403, { error: "New Full tasks require the operator's dedicated shared-workspace policy" });
        }
        if (bot.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        if (!supportsApprovalMode(bot.modelSelection, "full")) {
          return json(res, 400, { error: "This provider does not support Full access" });
        }
        const fullStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: bot.id, op: "new-task", thread: "*", froms: ["ask"], to: "full", stepUp: body.stepUp });
        if (fullStepUp) return json(res, fullStepUp.status, fullStepUp.body);
      }
      if (phoneSecretSubmissions.hasBot(bot.id)) {
        return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
      }
      if (body.projectId !== undefined && (typeof body.projectId !== "string" || !store.project(bot.id, body.projectId))) {
        return json(res, 400, { error: "projectId must belong to this bot" });
      }
      if (body.hidden !== undefined && body.hidden !== true) return json(res, 400, { error: "hidden must be true when given" });
      if (body.stream !== undefined && typeof body.stream !== "boolean") return json(res, 400, { error: "stream must be a boolean when given" });
      // #1170: `hidden` (an older AI client's hidden conversation, #291) is
      // accepted and ignored: no conversation is hidden from its person any
      // more. Still started beside the person's chat, never selected, so
      // nothing on their screens moves to it.
      const startedAside = body.hidden === true;
      const hidden = false;
      // A confidential thread (server/threads/confidential-threads.ts): the person's
      // choice, else the organization's default. Its files stay in its own
      // folder, so no other working folder is taken with it.
      const confidentialChoice = newThreadConfidential(body.confidential, confidentialThreadsByDefault());
      if (!confidentialChoice.ok) return json(res, 400, { error: confidentialChoice.error });
      if (confidentialChoice.confidential && cwd !== undefined) {
        return json(res, 400, { error: "A confidential thread works in its own folder: omit cwd", code: "confidential_thread" });
      }
      // Organization server: the new thread is its creator's, and only their
      // selection moves (the bot's own selection is its owner's).
      const creator = scopedThreadViewer();
      // "New topic" over a conversation nobody wrote in yet: that one already
      // is a new topic (no empty segments pile up, on any device).
      if (body.stream === true && !hidden && !confidentialChoice.confidential && cwd === undefined) {
        const current = conversationThreadFor(bot, creator);
        const task = current ? store.taskByThread(bot.id, current) : undefined;
        if (task && store.messagesFor(task.threadId).length === 0) {
          if (creator) selectViewerThread(bot.id, creator, task.threadId);
          if ((!creator || viewerBotLevel(auth, bot) === "owner") && bot.threadId !== task.threadId) store.switchTask(bot.id, task.threadId);
          const same = publicBot(store.projectBotForTask(bot.id, task.threadId) ?? store.bot(bot.id)!);
          return json(res, 200, { bot: projectBotTranscript(same, viewerForApproval(auth)), task: wireTask(task, store.bot(bot.id)!.modelSelection) });
        }
      }
      const ownerCreates = !creator || viewerBotLevel(auth, bot) === "owner";
      const task = store.createTask(bot.id, typeof body.title === "string" ? body.title : undefined, ownerCreates && !startedAside, body.projectId, undefined, body.approvalMode, creator && isPrincipalId(creator) ? creator : undefined, undefined, hidden, cwd, confidentialChoice.confidential);
      if (!task) return json(res, 500, { error: "couldn't create that task" });
      // Settings > Bot > Auto-review: a new conversation starts reviewed.
      if (body.approvalMode === undefined) applyAutoReviewDefault(auth, bot.id, task.threadId);
      if (creator && !startedAside) selectViewerThread(bot.id, creator, task.threadId);
      // "New topic" in a single stream (threads off): a stream segment from
      // the start, and the topic it closes gets its digest written now, in
      // the background, while the person types (server/single-stream.ts).
      if (body.stream === true && !hidden && !confidentialChoice.confidential) {
        noteStreamSend(bot.id, task.threadId, true);
        refreshStreamDigests(bot.id, task.threadId);
      }
      // Who opened it decides who may answer its cards on a shared workspace.
      if (auth.kind === "session") threadStarters.set(task.threadId, actorKey(auth));
      // A non-owner's new thread is not the bot's selection: answer with
      // the bot as seen from that thread.
      const fresh = publicBot(ownerCreates && !startedAside ? store.bot(bot.id)! : store.projectBotForTask(bot.id, task.threadId) ?? store.bot(bot.id)!);
      return json(res, 201, { bot: projectBotTranscript(fresh, viewerForApproval(auth)), task: wireTask(store.taskByThread(bot.id, task.threadId) ?? task, store.bot(bot.id)!.modelSelection) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (phoneSecretSubmissions.hasBot(bot.id)) {
        return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
      }
      // Navigation only: execution owns its thread, never this selected id.
      const requestedMessages = url.searchParams.get("messages");
      const switchLimit = pageSize(requestedMessages);
      if (switchLimit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // Organization server: the gate already refused a thread that is not
      // the caller's; switching moves the caller's selection, and the bot's
      // own only for its owner.
      const switcher = scopedThreadViewer();
      if (switcher && store.taskByThread(bot.id, m[2])) selectViewerThread(bot.id, switcher, m[2]);
      const switched = switcher && viewerBotLevel(auth, bot) !== "owner"
        ? store.projectBotForTask(bot.id, m[2])
        : store.switchTask(bot.id, m[2]);
      if (!switched) return json(res, 404, { error: "no such task" });
      const switchCoordinated = threadsWithActiveCoordination();
      const switchedSettings = { ...wireBot(switched), tasks: listedTasks(switched.threadId, store.tasks(switched.id)).map((task) => wireTask(task, switched.modelSelection, switchCoordinated)) };
      // "0" is settings only, a positive page is a bounded transcript, and no
      // parameter is the whole thread — the one branch that materialises it.
      // Search results land through that branch (src/lib/focus-message.ts):
      // the hit can be older than one page.
      const responseBot = requestedMessages === "0"
        ? switchedSettings
        : projectBotTranscript({ ...switchedSettings, ...messagePage(switched.threadId, switchLimit, null, viewerForApproval(auth)) }, viewerForApproval(auth));
      return json(res, 200, { bot: responseBot });
    }
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const current = store.projectBotForTask(m[1], m[2]);
      if (!current) return json(res, 404, { error: "no such task" });
      const taskStepUp = body.stepUp;
      delete body.stepUp;
      const allowed = new Set(["title", "projectId", "modelSelection", "updateBotDefault", "approvalMode", "autoApprove", "requireAvailableModel", "pinnedMessageId", "acknowledgeLocalAuto", "confirmFullAccess", "archivedAt", "pinned", "snoozedUntil", "surface", "refreshPermissions", "link", "confidential", "confirmConfidential"]);
      if (Object.keys(body).some((key) => !allowed.has(key))) return json(res, 400, { error: "unsupported thread setting" });
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      // Confidential is one way (server/threads/confidential-threads.ts): on with the
      // person's confirmation that it is permanent, never off again.
      const confidentialChange = confidentialPatch(store.taskByThread(m[1], m[2]) ?? {}, body);
      if (confidentialChange.kind === "refused") {
        return json(res, confidentialChange.status, { error: confidentialChange.error, ...(confidentialChange.code ? { code: confidentialChange.code } : {}) });
      }
      delete body.confidential;
      delete body.confirmConfidential;
      if (confidentialChange.kind === "make") {
        if (threadBusy(current.id, current.threadId)) return json(res, 409, { error: "Stop this thread before making it confidential." });
        if (liveCoordination(current.threadId)) {
          return json(res, 409, { error: "Teammate work this thread is part of is still under way. Let it finish or stop it, then make the thread confidential.", code: "confidential_live_work" });
        }
        // A thread that already works in a shared folder (the bot's project
        // folder, a chosen one) cannot take its files back from there, and
        // its checkpoints live with that folder: it stays ordinary.
        if (!privateFolderThread(current.id, current.threadId)) {
          return json(res, 409, { error: "This thread already works in a shared folder, so its files cannot be kept to you. Open a new confidential thread instead.", code: "confidential_shared_folder" });
        }
        makeThreadConfidential(current.id, current.threadId);
        if (!Object.keys(body).length) {
          return json(res, 200, { task: wireTask(store.taskByThread(m[1], m[2])!, store.bot(m[1])!.modelSelection), bot: projectBotTranscript(publicBot(store.bot(m[1])!), viewerForApproval(auth)) });
        }
      }
      for (const key of ["requireAvailableModel", "acknowledgeLocalAuto", "confirmFullAccess", "updateBotDefault"] as const) {
        if (body[key] !== undefined && typeof body[key] !== "boolean") return json(res, 400, { error: `${key} must be a boolean` });
      }
      if (body.requireAvailableModel === true && body.modelSelection === undefined) return json(res, 400, { error: "requireAvailableModel requires modelSelection" });
      if (body.updateBotDefault === true && body.modelSelection === undefined) return json(res, 400, { error: "updateBotDefault requires modelSelection" });
      // updateBotDefault writes the bot's own model (switchTaskModel), which
      // is an edit. A thread-only model change leaves the flag off.
      if (body.updateBotDefault === true && callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
      if (body.updateBotDefault === true) {
        const refusal = ownerSettingsForbidden(auth, store.bot(m[1]) ?? current, { model: true });
        if (refusal) return json(res, 403, refusal);
      }
      if (body.refreshPermissions !== undefined && body.refreshPermissions !== true) {
        return json(res, 400, { error: "refreshPermissions must be true" });
      }
      if (body.refreshPermissions === true) {
        const extra = Object.keys(body).filter((key) => key !== "refreshPermissions" && key !== "acknowledgeLocalAuto");
        if (extra.length) return json(res, 400, { error: "refreshPermissions cannot be combined with other thread settings" });
        const profile = store.bot(m[1]);
        if (!profile) return json(res, 404, { error: "no such bot" });
        if (profile.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        if (threadBusy(profile.id, m[2])) return json(res, 409, { error: "stop this thread before changing its approval mode" });
        const nextMode = approvalModeFor({ ...profile, approvalGrant: undefined });
        // Full and Custom never travel over the bot-reachable HTTP surface.
        // The desktop's private channel copies those levels, and it is also
        // the only way to leave Custom.
        // #1674: on an organization server Full comes back to this thread as
        // the bot's owner grants it (orgFullGrant below): the same rule, no
        // desktop channel there.
        const orgFullRefresh = nextMode === "full" && IDENTITY.kind === "perspicax";
        if (orgFullRefresh) {
          if (callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
          const refusal = orgFullAccessRefusalFor(auth, profile, false);
          if (refusal) return json(res, refusal.status, { error: refusal.error, code: refusal.code, ...(refusal.permission ? permissionRefusal(refusal.permission) : {}) });
        }
        if (!orgFullRefresh && (nextMode === "full" || nextMode === "custom")) {
          return json(res, 403, { error: "Full access and Custom approval are turned on in the Sagax desktop app on the computer that runs this server" });
        }
        if (approvalModeFor(current) === "custom") {
          return json(res, 403, { error: "Leaving Custom approval requires the packaged desktop app" });
        }
        if (!supportsApprovalMode(current.modelSelection, nextMode)) {
          return json(res, 400, { error: "This provider does not support the selected approval level" });
        }
        if (nextMode === "auto" && current.computer === "local" && approvalModeFor(current) !== "auto" && body.acknowledgeLocalAuto !== true) {
          return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
        }
        const widensMode = approvalModeWidens(approvalModeFor(current), nextMode);
        const nextAllow = profile.alwaysAllow ?? [];
        const widensAllow = nextAllow.some((key) => !(current.alwaysAllow ?? []).includes(key));
        if (memberAutoRefused(current, [approvalModeFor(current)], nextMode)) return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
        // a refresh that widens needs the person's key, like the desktop channel
        const refreshStepUp = approvalModeStepUpGate({
          person: ruleManager(auth), botId: profile.id, op: "refresh", thread: m[2]!, froms: [approvalModeFor(current)], to: nextMode, stepUp: taskStepUp, widensAllow,
        });
        if (refreshStepUp) return json(res, refreshStepUp.status, refreshStepUp.body);
        if ((widensMode || widensAllow) && auth.kind === "loopback" && !DESKTOP_MANAGED && !req.headers.origin && store.bots.some((bot) => bot.busy)) {
          return json(res, 409, { error: "Change approval mode from the app or a paired device while bots are working." });
        }
        const task = store.refreshTaskPermissions(profile.id, m[2]);
        if (!task) return json(res, 404, { error: "no such task" });
        return json(res, 200, { task: wireTask(task, store.bot(profile.id)!.modelSelection), bot: publicBot(store.bot(profile.id)!) });
      }
      // Archive, snooze, pin and folder: the same rules as a group thread
      // (server/threads/thread-folders.ts).
      const organization = parseThreadOrganization(body, (projectId) => Boolean(store.project(current.id, projectId)), "projectId must belong to this bot, or null to ungroup the thread");
      if (!organization.ok) return json(res, 400, { error: organization.error });
      const patch: Record<string, unknown> = { ...organization.patch };
      let orgFullGrant = false;
      if (body.title !== undefined) {
        if (typeof body.title !== "string") return json(res, 400, { error: "title must be a string" });
        patch.title = body.title;
      }
      if (body.link !== undefined) {
        const link = body.link === null ? undefined : threadLinkUrl(body.link);
        if (link === null) return json(res, 400, { error: "link must be an http(s) address of at most 2048 characters, or null to remove it" });
        patch.link = link;
        patch.linkAuto = link ? undefined : false;
      }
      if (body.surface !== undefined) {
        // Workspace is always Auto (2026-10-18): a conversation is never
        // pinned to a place any more. An older app that still sends one gets
        // no error and no pin; the bot keeps choosing per task.
        if (body.surface !== null && !parseSurface(body.surface)) {
          return json(res, 400, { error: "surface must be cloud, vm, local, browser, or null to follow the bot" });
        }
        if (FIXED_WORKSPACE_SEAM) {
          if (threadBusy(current.id, current.threadId)) return json(res, 409, { error: "Stop this thread before changing its computer destination." });
          computerSelectionMoves.delete(current.threadId);
          patch.surface = body.surface === null ? undefined : parseSurface(body.surface);
          patch.surfaceSource = body.surface === null ? undefined : "user";
        }
      }
      if (body.pinnedMessageId !== undefined) {
        if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
        else if (typeof body.pinnedMessageId === "string" && store.messagesFor(current.threadId).some((message) => message.id === body.pinnedMessageId)) patch.pinnedMessageId = body.pinnedMessageId;
        else return json(res, 400, { error: "pinnedMessageId must belong to this thread" });
      }
      if (body.modelSelection !== undefined) {
        if (current.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        const checked = checkedModelSelection(body.modelSelection, { selection: current.modelSelection, busy: threadBusy(current.id, current.threadId) }, body.requireAvailableModel === true, sessionPrincipal(auth));
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        patch.modelSelection = checked.selection;
      }
      if (body.approvalMode !== undefined || body.autoApprove !== undefined) {
        if (body.autoApprove !== undefined && typeof body.autoApprove !== "boolean") return json(res, 400, { error: "autoApprove must be a boolean" });
        const mode = body.approvalMode ?? (body.autoApprove ? "auto" : "ask");
        // Organization server: the bot's owner, signed in, turns Full on
        // over HTTP while the organization allows it (org-full-access.ts).
        if (mode === "full" && IDENTITY.kind === "perspicax") {
          // The grant also stores fullAccessConsent on the bot. thread.post
          // is enough to reach this handler, so the read-only cap is here.
          if (callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
          const refusal = orgFullAccessRefusalFor(auth, current, body.confirmFullAccess === true);
          if (refusal) return json(res, refusal.status, { error: refusal.error, code: refusal.code, ...(refusal.permission ? permissionRefusal(refusal.permission) : {}) });
          orgFullGrant = true;
        }
        if (!orgFullGrant && (mode === "full" || mode === "custom") && memberOwnedInOrg(current)) return json(res, 409, MEMBER_BOT_FULL_ACCESS);
        // Elevated modes still require the trusted desktop transition. A
        // thread settings PATCH cannot manufacture that grant.
        if (!orgFullGrant && mode !== "ask" && mode !== "auto" && mode !== "edits") return json(res, 403, { error: "Full access and Custom approval are turned on in the Sagax desktop app on the computer that runs this server" });
        if (approvalModeFor(current) === "custom") return json(res, 403, { error: "Leaving Custom approval requires confirmation in the packaged desktop app" });
        if (!supportsApprovalMode((patch.modelSelection as ModelSelection | undefined) ?? current.modelSelection, mode as ApprovalMode)) {
          return json(res, 400, { error: "This provider does not support the selected approval level" });
        }
        if (threadBusy(current.id, current.threadId) && !primaryAskedReplay() && !liveApprovalChange(approvalModeFor(current), mode)) return json(res, 409, { error: "stop this thread before changing its approval mode" });
        if (current.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        if (mode === "auto" && approvalModeFor(current) !== "auto" && auth.kind === "loopback" && !DESKTOP_MANAGED && !req.headers.origin && store.bots.some((bot) => bot.busy)) {
          return json(res, 409, { error: "Change approval mode from the app or a paired device while bots are working." });
        }
        if (mode === "auto" && current.computer === "local" && approvalModeFor(current) !== "auto" && body.acknowledgeLocalAuto !== true) {
          return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
        }
        if (memberAutoRefused(current, [approvalModeFor(current)], mode)) return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
        const modeStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: current.id, op: "thread", thread: m[2]!, froms: [approvalModeFor(current)], to: mode, stepUp: taskStepUp });
        if (modeStepUp) return json(res, modeStepUp.status, modeStepUp.body);
        patch.approvalMode = mode;
        patch.autoApprove = mode === "auto";
        if (orgFullGrant) patch.alwaysAllow = [];
      }
      if (patch.modelSelection) {
        const checked = checkedTaskModelSwitch({ ...current,
          ...(patch.approvalMode ? { approvalMode: patch.approvalMode, autoApprove: patch.autoApprove } : {}),
        }, patch.modelSelection, body.updateBotDefault === true, body.requireAvailableModel === true);
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
      }
      const modeBefore = approvalModeFor(current);
      // #1373: what each running turn answers at before this change
      const liveApprovalBefore = patch.approvalMode && patch.approvalMode !== modeBefore
        && liveApprovalChange(modeBefore, patch.approvalMode as ApprovalMode) && threadBusy(current.id, current.threadId)
        ? runningTurnLevels(m[1]) : null;
      if (orgFullGrant) store.patchBot(m[1], { fullAccessConsent: { principalId: sessionPrincipal(auth)!, at: Date.now() } });
      const task = patch.modelSelection
        ? store.switchTaskModel(m[1], m[2], patch.modelSelection as ModelSelection, body.updateBotDefault === true,
          { ...patch, ...hostedModels?.resetTask?.(current.modelSelection, patch.modelSelection as ModelSelection) })!
        : store.patchTask(m[1], m[2], patch)!;
      if (patch.approvalMode) auditApprovalModeChange(auth, m[1], modeBefore, patch.approvalMode as ApprovalMode, m[2]);
      if (liveApprovalBefore) {
        try {
          await applyStricterApprovalLive(m[1], liveApprovalBefore);
        } catch (error) {
          return json(res, 409, { error: stricterApprovalStopError(error) });
        }
      }
      return json(res, 200, { task: wireTask(task, store.bot(m[1])!.modelSelection), bot: projectBotTranscript(publicBot(store.bot(m[1])!), viewerForApproval(auth)) });
    }
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot || !store.taskByThread(bot.id, m[2])) {
        return json(res, 404, { error: "no such task" });
      }
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      if (phoneSecretSubmissions.hasThread(m[2])) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      if (threadBusy(bot.id, m[2]) || routines.isActiveThread(m[2])) {
        return json(res, 409, { error: "this task is running — stop it first" });
      }
      const stagedSkillCleanups = stagedSkillCleanupsForThread(m[2]);
      coordinator.cancelDirect(m[2], THREAD_DELETED);
      cancelTeamSetupResumesForThread(m[2]);
      // A confidential thread leaves nothing behind (server/threads/confidential-threads.ts):
      // its files are listed before its messages go.
      const confidentialFiles = store.isConfidentialThread(m[2]) ? confidentialThreadAttachments(m[1], m[2]) : null;
      // and the keys of its engine transcripts, before its record and logs go
      const confidentialEngineKeys = confidentialFiles ? threadEngineKeys(m[1], m[2]) : [];
      const updated = store.deleteTask(m[1], m[2]);
      if (!updated) return json(res, 404, { error: "no such task" });
      if (confidentialFiles) wipeConfidentialThread(m[1], m[2], confidentialFiles, confidentialEngineKeys);
      clearTurnDigestState(m[2]);
      revokeInternalCapabilitiesForThread(m[2]);
      handoffs.forget(m[2]);
      routableSteers.forgetThread(m[2]);
      settleDirectFollowup(directTurnGenerationByThread.get(m[2]));
      rejectDeletedThreadSkillStages(stagedSkillCleanups);
      return json(res, 200, { bot: projectBotTranscript(publicBot(updated), viewerForApproval(auth)) });
    }
    // Regenerate title (#1858): name the thread again from its conversation
    // as it is now. The person asked, so the result replaces any title, but
    // only the one this started from: a rename that lands while the one-shot
    // runs wins, and the late result is dropped.
    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)\/title$/);
    if (m && method === "POST") {
      const current = store.projectBotForTask(m[1], m[2]);
      if (!current) return json(res, 404, { error: "no such task" });
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      const gate = threadTitleGate(current, sessionPrincipal(auth));
      if (!gate.ok) return json(res, 409, { error: gate.refusal });
      if (titleRegenerations.has(m[2])) return json(res, 409, { error: "a new title is already being generated for this thread" });
      const excerpt = titleConversationExcerpt(store.messagesTail(m[2], 200).messages);
      if (!excerpt) return json(res, 409, { error: "this thread has no messages to take a title from yet" });
      const startedFrom = store.taskByThread(m[1], m[2])!.title;
      titleRegenerations.add(m[2]);
      try {
        const title = await generateThreadTitle(gate.instance, excerpt, "conversation");
        if (!title) return json(res, 502, { error: "couldn't generate a title — try again, or rename the thread" });
        const task = store.retitleTask(m[1], m[2], startedFrom, title) ?? store.taskByThread(m[1], m[2]);
        if (!task) return json(res, 404, { error: "no such task" });
        return json(res, 200, { task: wireTask(task, store.bot(m[1])!.modelSelection) });
      } finally {
        titleRegenerations.delete(m[2]);
      }
    }

    return PASS;
  };
}
