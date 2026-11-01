// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, mkdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic, writeFileAtomicIfChanged } from "./atomic.ts";
import { PROACTIVE_MODE_DEFAULT, normalizeProactiveMode } from "../shared/proactive-mode.ts";
import { commitBotChange, keptRevocation, saveBotsFor } from "./bots-save.ts";
import { applyHumanIds } from "./channel-membership.ts";
import { parseToolScope, toolScopeWidens } from "../shared/tool-scope.ts";
import { ensureSections, readSections, changeEmptySection } from "./section-context.ts";
import type { TeamComputers } from "./team-computers.ts";
import { removeBotFolder, soulFile, soulHash, writeSoulMirror } from "./bot-folder.ts";
import { cleanTemporaryAgent, type TemporaryAgent } from "./temporary-agents.ts";
import { createdByBotMark, type BotCreatedBy } from "./bot-creation.ts";
import type { BotProfilePatch } from "./bot-profile.ts";
import { peerAllowKey, type PeerAction } from "./peer-approval-key.ts";
import { DATA_DIR, EVENTS_DIR, NATIVE_DIR, loadBrowserProfileIdAliases } from "./config.ts";
import * as mdb from "./message-db.ts";
import { ThreadCache, type ThreadState } from "./thread-cache.ts";
import { forgetBotMemoryJournal, journalFile } from "./memory-journal.ts";
import { forgetLogMemory } from "./content-at-rest.ts";
import { forgetWorkspaceUsage } from "./workspace-usage.ts";
import { nextContext } from "./context-reading.ts";
import { runCommand, type Command } from "./commands.ts";
import { workspaceDir } from "./workspace.ts";
import { autoOnlyDestination, type Destination } from "./surface.ts";
import { newId, type ModelSelection } from "./contracts.ts";
import { pickBotName } from "./names.ts";
import { redactSecretsInText } from "./redact.ts";
import { AVATAR_FOCUS_CENTER, AVATAR_ZOOM_MIN, botAvatarProfile, clampAvatarFocus, clampAvatarZoom } from "../shared/bot-avatar.ts";
import { approvalModeFor, isApprovalException, isApprovalMode, modelSwitchNeedsAsk, threadApprovalFields, type ApprovalException } from "../shared/approval-mode.ts";
import { lastChangeRequestUrl } from "../shared/thread-link.ts";
import { REMOVED_COMPUTER_DRIVER, type ComputerEngineMove } from "./computer-engine-removal.ts";
import type { ProfileRequestChanges } from "../shared/profile-request.ts";
import type { TaskParallelOf } from "../shared/parallel-tasks.ts";
import type { SelectedComputer } from "../shared/execution-target.ts";
import type { SegmentDigest } from "./single-stream.ts";
import type { TeamSetupRequest, TeamSetupResult } from "../shared/team-setup.ts";
import type { GroupGoalRunCardData } from "../shared/group-goal-run.ts";
import { isMentionBoundary, isMentionNameContinuation } from "../shared/mention-boundary.ts";
import type { HandedState } from "./delta-context.ts";
import type { AgentPart, PartPair, RoomPart } from "./package-parts.ts";
import type { BotHost } from "./turn-route.ts";
import { advancesPosition, type ReadMap, type ReadPosition } from "./read-receipts.ts";
import { applyReaction, normalizeReactions, type ReactionActor, type ReactionMode } from "../shared/reactions.ts";
import { migratePeopleDmToThreads, PEOPLE_DM_GENERAL_TITLE } from "./people-dms.ts";
import type {
  BotActivity, GroupDefaultResponder, GroupTask as GroupTaskRecord, MausColor,
  OptionCardData, TaskClosedBy, TaskOpenedBy, TaskUsage, WireBot, WireGroup,
  WireMessage, WireTask, BotProject as BotProjectRecord,
} from "../shared/wire.ts";
import type { WireBotGrant } from "../shared/wire.ts";
import { sameModelSelection } from "../shared/thread-model.ts";
import { nextOpenThread } from "../shared/wire.ts";
import { namesEngine } from "./bot-engine.ts";
import { introTaskCard } from "./intro-tour.ts";
import { newBotGreeting } from "./new-bot-greeting.ts";
// Re-exported under their historical names so server-side importers keep working.
export type {
  BotActivity, GroupDefaultResponder, OptionCardData,
  SecretRequestCardData, Surface, TaskClosedBy, TaskOpenedBy, TaskUsage,
} from "../shared/wire.ts";
export type { GroupTask as GroupTaskRecord, BotProject as BotProjectRecord } from "../shared/wire.ts";
export type { InstalledPlaybook, InstalledPackageMetadata, MausColor, MausExpression } from "../shared/wire.ts";


/** One transcript line, serialized as stored — the shared wire shape. */
export type Message = WireMessage;

/** Server-private: a group chat added from the organization's library, with
 * its package key, member keys and per-part hashes (server/package-parts.ts). */
export interface GroupPackageStamp {
  installId: string;
  key: string;
  memberKeys: string[];
  parts: Record<RoomPart, PartPair>;
}

/** A room record excludes working state and ledger usage, both computed by
 * publicGroupState at projection time. */
export type GroupRecord = Omit<WireGroup, "working" | "usage"> & {
  installedPackage?: GroupPackageStamp;
  /** A person conversation went through the threads migration once
   * (server/people-dms.ts migratePeopleDmToThreads). */
  personThreads?: 1;
  /** The last person left (server/group-leave.ts, #1480): the group is kept
   * and listed to no one. */
  archivedAt?: number;
};
/** The private fields are stripped; projection adds computed display fields. */
export type GroupWirePrivateKeys = "installedPackage" | "personThreads" | "archivedAt";
export type GroupWireProjection = Omit<GroupRecord, GroupWirePrivateKeys> & Pick<WireGroup, "usage"> & { working: boolean };
export type GroupWireProjectionIsExact = AssertExact<WireGroup, GroupWireProjection> & AssertSameKeys<WireGroup, GroupWireProjection>;
export const groupWireProjectionIsExact: GroupWireProjectionIsExact = true;

// Unicode's complete emoji sequences include flags, skin tones and ZWJ
// combinations. Also allow unqualified single symbols (e.g. ♥), but not
// standalone components such as a digit, skin tone or regional indicator.
// Compiled on first use: building this set-notation pattern took about 12 ms
// of every server start (interaction bench, 2026-10-16), whether or not a
// project has an emoji.
let projectEmojiPattern: RegExp | null = null;
export function isProjectEmoji(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  projectEmojiPattern ??= new RegExp("^(?!\\p{Emoji_Component}$)(?:\\p{RGI_Emoji}|[\\p{Emoji}--\\p{Emoji_Component}])$", "v");
  return projectEmojiPattern.exec(value)?.[0] === value;
}

/** One task = one conversation with its own context. Extends the shared
 * wire shape, less the fields the wire projection (toWireTask) derives; the
 * extras below are server-private bookkeeping that projection strips. */
export interface TaskRecord extends Omit<WireTask, TaskWireDerivedKeys> {
  /** provider-native continuation per instance, for THIS task only */
  resumeCursors: Record<string, unknown>;
  /** which instance dispatched the most recent turn. A cursor alone can't
   * say whether an engine's session is current, so this is what decides an
   * inline replay. Absent on tasks from before the field existed. */
  lastInstanceId?: string;
  /** per instance: the stored messages that instance's current native
   * session has been handed on this task (server/delta-context.ts) */
  handedMessages?: Record<string, HandedState>;
  /** Last compaction represented by a dispatched session on this task. */
  appliedCompactionId?: string;
  /** Summaries Sagax wrote when it folded this thread on its own, newest
   * last (server/context-rebuild.ts CompactionRecord with an anchorId). They
   * are the thread's memory of its older turns and stay off the chat: the
   * person never sees a fold, only the bot's next session reads it. */
  /** stale: written (or re-applied) for a stale engine session
   * (server/stale-session.ts): the new session reads it as a pause. */
  contextSummaries?: Array<{ id: string; at: number; summary: string; firstKeptId: string; foldedThroughId: string; anchorId: string; tokensBefore: number; stale?: true }>;
  contextFloor?: number;
  lastContextModel?: string;
  /** Who pinned this conversation's surface: "user" when a person chose it
   * (composer chip or thread setting), "auto" when a turn recorded where
   * it landed. Absent means legacy/unknown: it may be a person's choice,
   * so only positively identified auto pins yield to Works on changes.
   * Clients see only whether a pin is an auto pin (WireTask.surfaceAuto). */
  surfaceSource?: "user" | "auto";
  /** Where an Auto turn of this thread starts: the workspace the bot opened
   * it with (start_thread `workspace`, server/auto-computer.ts). Checked
   * against what is allowed at every turn; never a pin. */
  autoWorkspace?: SelectedComputer;
  /** Epoch ms a person last wrote here: never a teammate, a routine, a
   * webhook, the bot itself or a line relayed from Slack. The newest open
   * one is the bot's main thread (server/main-thread.ts), which clients get
   * worked out (WireBot.mainThreadId). Absent until someone writes. */
  askedAt?: number;
  /** Single stream (thread mode off, server/single-stream.ts): a person
   * wrote here from a client showing one continuous conversation, so a
   * person's turn here carries the digest of their earlier topics and may
   * call recall_topic. Only `true` is stored; a send from a client showing
   * threads clears it. Never set on a confidential thread. */
  streamSegment?: true;
  /** The digest other stream turns read about this thread, anchored to the
   * newest message it saw. Server-private, dropped when the thread turns
   * confidential. */
  segmentDigest?: SegmentDigest;
  /** Every native session id an engine announced on this thread
   * (session.started), newest last, at most ENGINE_SESSIONS_KEPT: what
   * finds the engine's own files of the thread again when it turns
   * confidential or a confidential one is deleted, after a reset replaced
   * the cursor (server/engine-transcripts.ts). Ids only. */
  engineSessions?: string[];
}

/** How many native session ids a task keeps (TaskRecord.engineSessions). */
export const ENGINE_SESSIONS_KEPT = 64;

/** TaskRecord fields no client may see. Everything else must be on WireTask:
 * the exactness assertion below fails to compile when either side drifts,
 * so a new server field forces a decision — wire-visible or private here. */
export type TaskWirePrivateKeys = "resumeCursors" | "lastInstanceId" | "handedMessages" | "appliedCompactionId" | "contextSummaries" | "contextFloor" | "lastContextModel" | "surfaceSource" | "askedAt" | "autoWorkspace" | "streamSegment" | "segmentDigest" | "engineSessions";
/** WireTask fields computed by toWireTask and never stored on a TaskRecord. */
export type TaskWireDerivedKeys = "surfaceAuto" | "followsBotModel";
export type TaskWireProjection = Pick<TaskRecord, Exclude<keyof TaskRecord, TaskWirePrivateKeys>> & Pick<WireTask, TaskWireDerivedKeys>;
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type AssertSameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
/** Structural exactness alone lets an optional extra field through (a type
 * without the field still extends {field?: T}), so keys are checked too. */
export type TaskWireProjectionIsExact = AssertExact<WireTask, TaskWireProjection> & AssertSameKeys<WireTask, TaskWireProjection>;
export const taskWireProjectionIsExact: TaskWireProjectionIsExact = true;

/** The typed wire projection for one task. Pairs with the assertion above:
 * returning WireTask means an undeclared server field cannot ride silently.
 * A thread with no model of its own follows its bot: the wire carries the
 * model it runs on either way, so every client reads one effective model. */
export function toWireTask(task: TaskRecord, botModel: ModelSelection): WireTask {
  const { resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, handedMessages: _handedMessages,
    appliedCompactionId: _appliedCompactionId, contextSummaries: _contextSummaries, contextFloor: _contextFloor, lastContextModel: _lastContextModel,
    surfaceSource, askedAt: _askedAt, autoWorkspace: _autoWorkspace, streamSegment: _streamSegment, segmentDigest: _segmentDigest,
    engineSessions: _engineSessions, ...stored } = task;
  const wire: WireTask = { ...stored, modelSelection: structuredClone(task.modelSelection ?? botModel), followsBotModel: task.modelSelection === undefined };
  // Who pinned stays private. A client learns only whether the pin is the
  // machine's own record, so it never presents one as the person's choice.
  return surfaceSource === "auto" && wire.surface !== undefined ? { ...wire, surfaceAuto: true } : wire;
}

const TASK_PATCH_FIELDS = [
  "title", "projectId", "modelSelection", "approvalMode", "autoApprove", "alwaysAllow", "approvalOwn",
  "unread", "lastReadMessageId", "rewound", "archivedAt", "pinned", "pinnedMessageId", "resumeCursors", "lastInstanceId", "cwd",
  "routineRunId", "routineResults", "surface", "surfaceSource", "snoozedUntil", "link", "linkAuto", "appliedCompactionId", "contextSummaries", "contextFloor", "lastContextModel",
  "autoModel", "autoWorkspace", "streamSegment", "segmentDigest", "turnTiming", "connectors",
] as const satisfies readonly (keyof TaskRecord)[];
export type TaskPatch = Partial<Pick<TaskRecord, typeof TASK_PATCH_FIELDS[number]>>;

/** A thread with no approval level of its own: it follows its bot, live
 * (#1169/#1170). Its standing approvals stay. */
function followingBot<T extends Pick<TaskRecord, "approvalMode" | "autoApprove" | "approvalOwn">>(task: T): T {
  const { approvalMode: _mode, autoApprove: _auto, approvalOwn: _own, ...rest } = task;
  return rest as T;
}

/** Only `true` is a pin. false/undefined must not land in bots.json or groups.json. */
function persistedPin<T extends { pinned?: boolean }>(task: T): T {
  if (task.pinned === true) return task;
  if (!("pinned" in task)) return task;
  const { pinned: _pinned, ...rest } = task;
  return rest as T;
}

/** Everything the BOT authored is scrubbed of content-shaped secrets before
 * it is stored: its reply text, a tool title (an ACP engine's title can be
 * the whole command line) and the command beside it, a permission card's
 * summary. What the user typed
 * is theirs and stays as typed. Stored, not just displayed: the transcript
 * is replayed into every rebuild, and a leaked key would otherwise be
 * permanent. */
function redactBotAuthored<T extends Omit<Message, "id" | "at"> & { at?: number }>(message: T): T {
  if (message.role !== "bot") return message;
  const out = { ...message };
  if (out.dataResult) out.dataResult = {
    ...out.dataResult,
    title: redactSecretsInText(out.dataResult.title),
    ...(out.dataResult.sql === undefined ? {} : { sql: redactSecretsInText(out.dataResult.sql) }),
  };
  if (typeof out.text === "string") out.text = redactSecretsInText(out.text);
  if (out.compaction) out.compaction = { ...out.compaction, summary: redactSecretsInText(out.compaction.summary) };
  if (out.tool?.name) {
    out.tool = { ...out.tool, name: redactSecretsInText(out.tool.name) };
    if (out.tool.summary) out.tool.summary = redactSecretsInText(out.tool.summary);
  }
  if (out.routineRun) {
    const routineRun = { ...out.routineRun };
    routineRun.routineName = redactSecretsInText(routineRun.routineName);
    if (routineRun.summary) routineRun.summary = redactSecretsInText(routineRun.summary);
    if (routineRun.error) routineRun.error = redactSecretsInText(routineRun.error);
    out.routineRun = routineRun;
  }
  if (out.goalRun) {
    out.goalRun = {
      ...out.goalRun,
      goal: redactSecretsInText(out.goalRun.goal),
      coordinatorName: redactSecretsInText(out.goalRun.coordinatorName),
      detail: out.goalRun.detail ? redactSecretsInText(out.goalRun.detail) : undefined,
    };
  }
  // A Live call's title is the bot engine's own words about the call.
  if (out.call?.title) out.call = { ...out.call, title: redactSecretsInText(out.call.title) };
  if (out.card) {
    const card = { ...out.card } as OptionCardData & { summary?: string };
    card.title = redactSecretsInText(card.title);
    if (typeof card.subtitle === "string") card.subtitle = redactSecretsInText(card.subtitle);
    if (typeof card.summary === "string") card.summary = redactSecretsInText(card.summary);
    if (typeof card.held === "string") card.held = redactSecretsInText(card.held);
    if (typeof card.answeredText === "string") card.answeredText = redactSecretsInText(card.answeredText);
    if (card.commandAllowlist && (
      redactSecretsInText(card.commandAllowlist.command) !== card.commandAllowlist.command ||
      redactSecretsInText(card.commandAllowlist.cwd) !== card.commandAllowlist.cwd
    )) delete card.commandAllowlist;
    // Bot-authored question text sits behind the subtitle the same way a
    // routine's instructions do, so it is scrubbed on the same boundary.
    if (card.questionRequest) {
      card.questionRequest = {
        ...card.questionRequest,
        questions: card.questionRequest.questions.map((question) => ({
          ...question,
          question: redactSecretsInText(question.question),
          ...(question.header ? { header: redactSecretsInText(question.header) } : {}),
          options: question.options.map((option) => ({
            ...option,
            label: redactSecretsInText(option.label),
            ...(option.description ? { description: redactSecretsInText(option.description) } : {}),
          })),
        })),
      };
    }
    // Routine definitions are executable bot-authored text stored behind the
    // visible summary. Scrub the durable payload too so nesting it on a card
    // cannot bypass the transcript's secret-redaction boundary.
    if (card.routineRequest) {
      const operation = card.routineRequest.operation;
      card.routineRequest = {
        ...card.routineRequest,
        operation: operation.action === "create"
          ? {
              ...operation,
              routine: {
                ...operation.routine,
                name: redactSecretsInText(operation.routine.name),
                instructions: redactSecretsInText(operation.routine.instructions),
              },
            }
          : operation.action === "update"
            ? {
                ...operation,
                changes: {
                  ...operation.changes,
                  ...(typeof operation.changes.name === "string"
                    ? { name: redactSecretsInText(operation.changes.name) }
                    : {}),
                  ...(typeof operation.changes.instructions === "string"
                    ? { instructions: redactSecretsInText(operation.changes.instructions) }
                    : {}),
                },
              }
            : { ...operation },
      };
    }
    if (card.skillRequest) {
      const originalPreview = card.skillRequest.preview;
      const preview = originalPreview === undefined
        ? undefined
        : redactSecretsInText(originalPreview);
      // Current skill proposals are scrubbed before staging and their digest
      // binds the card to the exact SKILL.md bytes that apply will install.
      // Keep that binding only when this store-wide safety pass is a no-op and
      // the supplied digest already matches the persisted preview. A caller
      // that bypassed staging (or an older malformed card) is therefore
      // safely deny-only instead of showing one document and approving
      // another.
      const previewSha256 = preview !== undefined && preview === originalPreview
        ? createHash("sha256").update(preview).digest("hex")
        : undefined;
      const sha256 = card.skillRequest.sha256 !== undefined
        && card.skillRequest.sha256 === previewSha256
        ? card.skillRequest.sha256
        : undefined;
      card.skillRequest = {
        ...card.skillRequest,
        gist: redactSecretsInText(card.skillRequest.gist),
        source: card.skillRequest.source === undefined
          ? undefined
          : redactSecretsInText(card.skillRequest.source),
        preview,
        sha256,
        warnings: card.skillRequest.warnings.map((warning) => redactSecretsInText(warning)),
      };
    }
    // A profile proposal's before/after text (and its reason) is hidden
    // under the card's visible summary the same way a routine's or skill's
    // is — scrub it too so nesting it on a card cannot bypass the
    // transcript's secret-redaction boundary.
    if (card.profileRequest) {
      const scrubChanges = (changes: ProfileRequestChanges): ProfileRequestChanges => {
        const out = { ...changes };
        for (const [key, value] of Object.entries(changes)) {
          // Booleans carry no text to scrub; only string fields pass through redaction.
          if (typeof value === "string") (out as Record<string, string | boolean>)[key] = redactSecretsInText(value);
        }
        return out;
      };
      card.profileRequest = {
        ...card.profileRequest,
        targetName: redactSecretsInText(card.profileRequest.targetName),
        reason: redactSecretsInText(card.profileRequest.reason),
        before: scrubChanges(card.profileRequest.before),
        changes: scrubChanges(card.profileRequest.changes),
      };
    }
    out.card = card;
  }
  if (out.secret) {
    out.secret = {
      ...out.secret,
      label: redactSecretsInText(out.secret.label),
      description: redactSecretsInText(out.secret.description),
      error: out.secret.error ? redactSecretsInText(out.secret.error) : undefined,
    };
  }
  return out;
}

/** What changed, emitted by the store itself right after each write. The
 * server maps these onto its SSE frames in ONE place, so no mutation path
 * can persist without the app hearing about it — the two-write-paths bug
 * (persist without emit → UI drifts; emit without persist → a restart
 * loses what the user just watched) is closed by construction. Bot and
 * group changes carry only the id: the wire shape (cursor stripping) is
 * the caller's business. */
/** The states in which the bot cannot take a new message. */
export const ACTIVITY_BUSY: ReadonlySet<BotActivity> = new Set(["working", "waiting-on-you", "no-signal"]);

export type StoreChange =
  | { type: "sections" }
  | { type: "message"; threadId: string; message: Message }
  | { type: "message.patch"; threadId: string; message: Message }
  | { type: "thread"; threadId: string; activeLeafId: string }
  /** A participant's read position moved (server/read-receipts.ts). */
  | { type: "thread.read"; threadId: string; participantId: string; read: ReadPosition }
  | { type: "thread.deleted"; threadId: string }
  | { type: "bot"; botId: string }
  | { type: "bot.deleted"; botId: string }
  | { type: "group"; groupId: string }
  | { type: "group.deleted"; groupId: string };

/** What a task is called before its first message names it. */
export const UNTITLED_TASK = "New task";
export const UNTITLED_THREAD = "New thread";

/** How a thread title is stored: one trim, one cut. Every title arrives
 * through this — the name a bot passes to createTask and the name a person
 * types in the sidebar alike — which is what makes "is this title still
 * the one the machine made?" a question you can answer by comparing. */
const TASK_TITLE_MAX = 80;
export function threadTitleFrom(title?: string): string {
  return title?.trim().slice(0, TASK_TITLE_MAX) || UNTITLED_THREAD;
}

/** A task's name, taken from the first thing you asked it to do. */
export function titleFromMessage(text: string): string {
  // Redact before cutting: a key cut short no longer looks like a key, and
  // its start would stay in the title (and in every copy of it).
  const line = redactSecretsInText(text.trim().split("\n")[0]!.trim());
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || UNTITLED_TASK;
}

/** One usable line out of a model's title reply: the first line, no
 * surrounding quotes, code fences, or markdown decoration, no trailing
 * period, single spaces — or null when what came back is empty, too long
 * to be a title, or otherwise not a plain name. The caller keeps its
 * fallback then. */
export function titleFromLlm(raw: string): string | null {
  const line = raw
    .trim()
    .split("\n")[0]!
    .replace(/^[#*\-\u2022]+/, "")
    .replace(/^["'\u201C\u201D\u2018\u2019\u0060]+/, "")
    .replace(/["'\u201C\u201D\u2018\u2019\u0060]+$/, "")
    // decoration the quotes were hiding: "## Deploy app" keeps its
    // markers through the strips above, which never reach past a quote
    .replace(/^[#*\-\u2022]+/, "")
    .replace(/[#*]+$/, "")
    .replace(/[.\u3002]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length >= 1 && line.length <= 48 ? line : null;
}

/** A bot record. Extends the shared wire shape; the extras below are
 * server-private (stripped by wireBot). avatarUrl is optional in the record
 * but always present (string | null) on the wire, so the record widens it. */
export interface BotRecord extends Omit<WireBot, "avatarUrl" | "tasks"> {
  /** every task this bot has, newest first */
  tasks?: TaskRecord[];
  /** App-owned attachment served as this bot's custom profile image. */
  avatarUrl?: string;
  /** provider-native continuation per instance (e.g. claude session id) */
  resumeCursors: Record<string, unknown>;
  /** Server-private elevation journal. Full/Custom executes as Ask until
   * Electron confirms the exact prepared reply and then activates it over
   * the utility-process channel. Any marker surviving a restart is revoked
   * during Store load. */
  approvalGrant?: {
    requestId: string;
    mode: "full" | "custom";
    phase: "prepared" | "confirmed" | "activated" | "committed";
    /** Optional existing thread receiving this already-approved bot default. */
    threadId?: string;
    /** Composer grant: leave the bot default and other threads unchanged. */
    threadOnly?: true;
    /** Copy the saved bot default onto threadId, including standing approvals. */
    refreshPermissions?: true;
    /** Explicit bot-wide grant, including existing threads. */
    allThreads?: true;
  };
  /** Receipt committed with a confirmed profile, for retrying card settlement. */
  lastProfileRequestId?: string;
  /** Receipt committed with a reviewed team batch; prevents replay after a lost response. */
  lastTeamSetupReceipt?: { requestId: string; result: TeamSetupResult };
  /** Organization library only: each part's release and written hashes
   * (server/package-parts.ts), for the later automatic update. */
  packageBase?: Partial<Record<AgentPart, PartPair>>;
  /** Skills library (features.skillsLibrary): names of library skills
   * assigned to this bot. Server-private until the Skills UI ships. */
  assignedSkills?: string[];
  /** Slice 5 (organization server): the Perspicax MCP profiles this bot
   * mounts, by profile id. Each person who speaks uses their own access;
   * changed only through /api/bots/:id/perspicax, never PATCH, never in a
   * package or an export. */
  perspicax?: BotPerspicax;
  /** Perspicax #321: made by create_agent (server/temporary-agents.ts).
   * Never on the wire: the Sagax app does not list such a bot. */
  temporary?: TemporaryAgent;
  /** 2026-10-17: made by a bot (create_bot, team setup), server/bot-creation.ts.
   * Never on the wire, never set by a PATCH: it caps how deep bots make bots. */
  createdByBot?: BotCreatedBy;
}

/** Slice 5: at most 8 profile ids per bot. */
export const MAX_BOT_PERSPICAX_PROFILES = 8;
const PERSPICAX_PROFILE_ID = /^[0-9A-Za-z_.:-]{1,64}$/;
export const botPerspicaxSchema = z.object({
  profiles: z.array(z.string().regex(PERSPICAX_PROFILE_ID)).max(MAX_BOT_PERSPICAX_PROFILES).transform((ids) => [...new Set(ids)]),
});
export type BotPerspicax = z.infer<typeof botPerspicaxSchema>;

/** A stored `perspicax` value as a valid one, or undefined (dropped). */
export function cleanBotPerspicax(value: unknown): BotPerspicax | undefined {
  const parsed = botPerspicaxSchema.safeParse(value);
  return parsed.success && parsed.data.profiles.length ? parsed.data : undefined;
}

/** BotRecord fields no client may see, plus the two the projection
 * re-derives rather than passes through (tasks are re-projected as
 * WireTask[], avatarUrl is coerced to always-present). The exactness
 * assertion fails to compile when either side drifts, so a new server
 * field forces a decision — wire-visible or private here. */
export type BotWirePrivateKeys = "resumeCursors" | "tasks" | "avatarUrl" | "approvalGrant" | "lastProfileRequestId" | "lastTeamSetupReceipt" | "packageBase" | "perspicax" | "assignedSkills" | "temporary" | "createdByBot";
export type BotWireProjection = Pick<BotRecord, Exclude<keyof BotRecord, BotWirePrivateKeys>>;
export type BotWireProjectionIsExact = AssertExact<Omit<WireBot, "avatarUrl" | "tasks">, BotWireProjection> & AssertSameKeys<Omit<WireBot, "avatarUrl" | "tasks">, BotWireProjection>;
export const botWireProjectionIsExact: BotWireProjectionIsExact = true;


const BOTS_FILE = join(DATA_DIR, "bots.json");
const GROUPS_FILE = join(DATA_DIR, "groups.json");
/** Written once the copies older builds made of a bot's model on its threads
 * are cleared (Store load), so that cleanup runs once per data directory. */
const THREAD_MODEL_COPIES_CLEARED = join(DATA_DIR, "thread-model-copies-cleared");
/** Written once threads from before builds kept askedAt have it from their
 * transcripts (Store load); since then each person's line stamps it. */
const ASKED_AT_FILLED = join(DATA_DIR, "asked-at-filled");

/** The registries carry souls, project paths and per-bot settings, so they are
 * owner-only like the other data-dir stores. A file written by an older
 * release (or loosened by hand) is tightened on load. Best effort: failing to
 * tighten must never stop the fleet from loading, and the next save replaces
 * the file with a 0600 one anyway. Windows has no POSIX mode bits. */
function tightenRegistryFile(file: string): void {
  if (process.platform === "win32") return;
  try {
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
  } catch {
    /* absent, or not ours to change */
  }
}
const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

const COLORS: MausColor[] = [
  "green",
  "blue",
  "red",
  "orange",
  "purple",
  "cyan",
  "pink",
  "yellow",
  "teal",
  "coral",
];

/** Sections are persisted as display labels, so exact trimmed labels are
 * their identity. Missing/blank means the unsectioned (General) team. */
export const sectionKey = (section?: string | null): string => section?.trim() || "";

/** Bots saved before host existed run on the fleet. A machine host must
 * name both the member and the device; anything else is fleet. */
function recordedBotHost(value: BotRecord["host"]): BotHost {
  if (value?.kind === "machine" && value.userId && value.deviceId) {
    return { kind: "machine", userId: value.userId, deviceId: value.deviceId };
  }
  return { kind: "fleet" };
}

/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, the name must end on a word boundary (so "@New Bottle" never matches
 * "New Bot"), names match case-insensitively, longest name wins (so
 * "@New Bot 2" never half-matches "New Bot"), hidden bots skipped, results
 * deduped. Callers pre-filter the sender out of `peers`. */
export function mentionedBots<T extends { name: string; hidden?: boolean }>(text: string, peers: T[]): T[] {
  const candidates = peers
    .filter((p) => !p.hidden && p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const found: T[] = [];
  let at = -1;
  while ((at = lower.indexOf("@", at + 1)) !== -1) {
    if (!isMentionBoundary(text, at)) continue; // user@host, not a tag
    const rest = lower.slice(at + 1);
    const hit = candidates.find((p) => {
      const name = p.name.toLowerCase();
      if (!rest.startsWith(name)) return false;
      const after = rest.slice(name.length); // must not run into a longer word
      return !isMentionNameContinuation(after);
    });
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

/** Normalize persisted or API-provided routing. Old rooms did not have this
 * field; giving them their first member as lead fixes the old silent-send
 * behavior without making every prompt fan out to every model. A kind this
 * build does not know degrades the same way. */
export function normalizeGroupDefaultResponder(
  value: unknown,
  memberIds: string[],
  dm = false,
): GroupDefaultResponder {
  if (dm) return { kind: "mentions" };
  if (value && typeof value === "object") {
    const candidate = value as { kind?: unknown; botId?: unknown; fallbackBotId?: unknown };
    if (candidate.kind === "everyone") return { kind: "everyone" };
    if (candidate.kind === "mentions") return { kind: "mentions" };
    if (candidate.kind === "auto") {
      // A fallback who left the room reverts to "the first member".
      return typeof candidate.fallbackBotId === "string" && memberIds.includes(candidate.fallbackBotId)
        ? { kind: "auto", fallbackBotId: candidate.fallbackBotId }
        : { kind: "auto" };
    }
    if (
      candidate.kind === "member" &&
      typeof candidate.botId === "string" &&
      memberIds.includes(candidate.botId)
    ) {
      return { kind: "member", botId: candidate.botId };
    }
  }
  if (memberIds.length === 0) return { kind: "mentions" };
  return { kind: "member", botId: memberIds[0] };
}

/** Resolve the bots invoked by a human room message. Explicit targets win;
 * otherwise the room policy chooses one member, everyone, or nobody. */
export function roomResponders<T extends { id: string; name: string; hidden?: boolean }>(
  text: string,
  members: T[],
  defaultResponder: GroupDefaultResponder,
): T[] {
  const available = members.filter((member) => !member.hidden);
  const everyone = "everyone";
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const candidate = text.slice(at + 1, at + 1 + everyone.length);
    if (
      isMentionBoundary(text, at) &&
      candidate.toLocaleLowerCase() === everyone &&
      !isMentionNameContinuation(text.slice(at + 1 + everyone.length))
    ) {
      return available;
    }
  }
  const mentioned = mentionedBots(text, available);
  if (mentioned.length) return mentioned;
  if (defaultResponder.kind === "everyone") return available;
  if (defaultResponder.kind === "member") {
    const lead = available.find((member) => member.id === defaultResponder.botId);
    return lead ? [lead] : [];
  }
  // Auto without a decision (the decision model off, unsure or failing) is
  // lead mode: its fallback member, else the first active member. The
  // decision itself is asked asynchronously by the room turn.
  if (defaultResponder.kind === "auto") {
    const fallback = available.find((member) => member.id === defaultResponder.fallbackBotId) ?? available[0];
    return fallback ? [fallback] : [];
  }
  return [];
}

/** A hidden routine execution is not a conversation the person can open,
 * and an AI client's hidden conversation (`hidden`, #291) is not one they
 * read: neither lights the bot's dot. */
function taskCountsAsBotUnread(task: { unread?: boolean; routineRunId?: string; routineResults?: true; hidden?: true; openedBy?: { botId?: string } }): boolean {
  return Boolean(task.unread) && !task.routineRunId && task.routineResults !== true && task.hidden !== true;
}

/** A thread another bot opened on this one (pair, work or an agent ask):
 * bot-to-bot, never shown to the person. Bots still find and use it. */
export function isInterBotThread(botId: string, task: { openedBy?: { botId?: string } }): boolean {
  return Boolean(task.openedBy?.botId) && task.openedBy!.botId !== botId;
}

/** The bot's dot: an unread thread the person can read (never bot-to-bot). */
function botHasPersonUnread(bot: { id: string; tasks?: Array<{ unread?: boolean; routineRunId?: string; hidden?: true; openedBy?: { botId?: string } }> }): boolean {
  return (bot.tasks ?? []).some((task) => taskCountsAsBotUnread(task) && !isInterBotThread(bot.id, task));
}

/** A conversation the person never sees in the sidebar: a routine's detached
 * execution or an AI client's hidden conversation (#291). */
export function taskHiddenFromPerson(task: { routineRunId?: string; hidden?: true }): boolean {
  return Boolean(task.routineRunId) || task.hidden === true;
}


/** A stored grant (slice 4); see server/authz.ts. */
export type BotGrant = WireBotGrant;
const GRANT_TARGET = /^(?:user:pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|team:[0-9A-Za-z]{1,64})$/;
const GRANT_LEVELS = new Set(["use", "run", "edit", "manage"]);
export const MAX_BOT_GRANTS = 1000;

/** Valid grants only, one per target (the last wins), at most 1000. */
export function cleanBotGrants(grants: unknown): BotGrant[] {
  if (!Array.isArray(grants)) return [];
  const byTarget = new Map<string, BotGrant>();
  for (const grant of grants) {
    if (!grant || typeof grant !== "object") continue;
    const { target, level, by, at } = grant as Record<string, unknown>;
    if (typeof target !== "string" || !GRANT_TARGET.test(target) || typeof level !== "string" || !GRANT_LEVELS.has(level)) continue;
    byTarget.set(target, { target, level: level as BotGrant["level"], by: typeof by === "string" ? by.slice(0, 64) : "", at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
  }
  return [...byTarget.values()].slice(0, MAX_BOT_GRANTS);
}

export function grantsFromDirect(directGrants: readonly unknown[], owner: string | undefined, at: number | undefined): BotGrant[] {
  return cleanBotGrants(directGrants.filter((id): id is string => typeof id === "string").map((id) => ({ target: `user:${id.trim().toLowerCase()}`, level: "use", by: owner ?? "", at: at ?? 0 })));
}

export function directFromGrants(grants: readonly BotGrant[]): string[] {
  return grants.filter((grant) => grant.target.startsWith("user:")).map((grant) => grant.target.slice(5));
}

function wholeMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

export class Store {
  bots: BotRecord[] = [];
  groups: GroupRecord[] = [];
  /** Names of bots that carried Composio connected-app grants in an older
   * release, found and dropped at load. The server reads this once at start
   * to notify admins that those grants are gone and the apps must be
   * reconnected through an engine connector. */
  readonly legacyComposioBots: string[] = [];
  private threads = new ThreadCache(() => this.busyThreadIds());
  private defaultSelection: () => ModelSelection;
  private completeNewBotSelection: (selection: ModelSelection) => ModelSelection;
  /** The approval level every new bot and its first thread start on. */
  private newBotApprovalMode: () => "ask" | "auto";
  private greetingLanguage: (ownerUserId: string | undefined) => "fr" | "en";
  private listeners = new Set<(change: StoreChange) => void>();
  /** A broken team registry must not prevent loading independent chat data. */
  private registeringInitialSections = true;
  /** bots.json existed but could not be read or was not an array. Saves and
   * first-run seed refuse while set so an empty in-memory list never replaces
   * whatever is still on disk (#1712). Missing means a first run. */
  private botsUnreadable = false;
  /** Same guard for groups.json (#1712). */
  private groupsUnreadable = false;
  /** Room turns and old callers have their own activity slot. Clearing
   * that slot must not clear a concurrently running independent task. */
  private legacyActivities = new Map<string, BotActivity>();

  constructor(
    defaultSelection: () => ModelSelection,
    /** Template effort applied to every new bot's selection, whichever path
     * created it. */
    completeNewBotSelection: (selection: ModelSelection) => ModelSelection = (selection) => selection,
    /** Approve for me on a solo server; on an organization server the
     * organization's policy decides (2026-10-11, orgNewBotApprovalMode). */
    newBotApprovalMode: () => "ask" | "auto" = () => "auto",
    /** The language a new bot's greeting uses for the person who will own
     * it (#1075, server/new-bot-greeting.ts). English when not given. */
    greetingLanguage: (ownerUserId: string | undefined) => "fr" | "en" = () => "en",
  ) {
    this.defaultSelection = defaultSelection;
    this.completeNewBotSelection = completeNewBotSelection;
    this.newBotApprovalMode = newBotApprovalMode;
    this.greetingLanguage = greetingLanguage;
    mkdirSync(DATA_DIR, { recursive: true });
    for (const file of [BOTS_FILE, GROUPS_FILE]) tightenRegistryFile(file);
    // Whether the bot list is the real one. Room repair below trusts it to
    // say which members no longer exist; an unreadable file must never read
    // as "every member was deleted".
    let botsLoaded = false;
    try {
      const raw: unknown = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
      if (!Array.isArray(raw)) throw new Error("bots.json must be an array");
      this.bots = raw;
      botsLoaded = true;
    } catch (error) {
      this.bots = [];
      // Missing means no bots yet. Any other read/parse failure disables
      // overwriting the file and first-run seed (#1712).
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.botsUnreadable = true;
        const reason = error instanceof SyntaxError ? "invalid JSON"
          : error instanceof Error ? error.message : "unable to read bots";
        console.error(`store: ignoring unreadable ${BOTS_FILE}: ${reason}`);
      }
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
      if (!Array.isArray(raw)) throw new Error("groups.json must be an array");
      this.groups = raw;
    } catch (error) {
      this.groups = [];
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.groupsUnreadable = true;
        const reason = error instanceof SyntaxError ? "invalid JSON"
          : error instanceof Error ? error.message : "unable to read groups";
        console.error(`store: ignoring unreadable ${GROUPS_FILE}: ${reason}`);
      }
    }
    this.rememberSections([...this.bots, ...this.groups].map((record) => record.section));
    // busy never survives a restart — no turn does either. Rooms saved
    // before default responders existed adopt their first member as lead.
    let botsMigrated = false;
    const browserProfileAliases = loadBrowserProfileIdAliases();
    let groupsMigrated = false;
    // An unconfirmed elevation revoked below must stay Ask. The one-time
    // default below must not turn that revocation into Approve for me.
    const keepAskBot = new Set<string>();
    const keepAskTask = new Set<string>();
    for (const b of this.bots) {
      // transient state never survives a restart — and if a previous
      // process died mid-turn, bots.json still says busy/working; persist
      // the reset so the next load does not read it again
      if (b.busy || (b.activity !== undefined && b.activity !== "idle")) botsMigrated = true;
      b.busy = false;
      b.activity = "idle";
      if (typeof b.soul !== "string") {
        b.soul = "";
        botsMigrated = true;
      }
      if (b.soulHash !== soulHash(b.soul)) {
        b.soulHash = soulHash(b.soul);
        botsMigrated = true;
      }
      // Existing bots predate their folders. Create missing mirrors before
      // their first history write, but preserve any edits already on disk.
      if (!existsSync(soulFile(b.id))) {
        try { writeSoulMirror(b.id, b.soul); } catch (e) {
          console.warn(`[bot-folder] could not create SOUL.md for ${b.id}: ${(e as Error).message}`);
        }
      }
      if (b.browserProfile) {
        const browserProfile = browserProfileAliases.get(b.browserProfile);
        if (browserProfile && browserProfile !== b.browserProfile) {
          b.browserProfile = browserProfile;
          botsMigrated = true;
        }
      }
      if (b.cloudBackend !== undefined && b.cloudBackend !== "box" && b.cloudBackend !== "vps") {
        delete b.cloudBackend;
        botsMigrated = true;
      }
      if (b.autoStartVps !== undefined && b.autoStartVps !== true && b.autoStartVps !== false) {
        delete b.autoStartVps;
        botsMigrated = true;
      }
      if (b.managedSections !== undefined && (!b.chiefOfStaff || !Array.isArray(b.managedSections) ||
          b.managedSections.length > 100 || b.managedSections.some(section => typeof section !== "string" || section.length > 60))) {
        delete b.managedSections;
        botsMigrated = true;
      }
      if (b.approvalMode !== undefined && !isApprovalMode(b.approvalMode)) {
        delete b.approvalMode;
        botsMigrated = true;
      }
      // A trusted elevation is a prepare/confirm/activate commit. If the
      // desktop process or its private reply path died before activation,
      // the durable marker survives beside the mode in the same atomic
      // bots.json write. Revoke it before schedulers, listeners, or HTTP can
      // start any new work.
      if (b.approvalGrant !== undefined) {
        const threadOnly = b.approvalGrant.threadOnly === true;
        if (threadOnly) {
          // A crash may land between saving the target and clearing its
          // journal. Revoke that target only, never unrelated threads.
          const target = b.tasks?.find(task => task.threadId === b.approvalGrant?.threadId);
          if (target) {
            target.approvalMode = "ask";
            target.autoApprove = false;
            target.approvalOwn = "safety";
            keepAskTask.add(target.threadId);
          }
        }
        if (!threadOnly) {
        b.approvalMode = "ask";
        b.autoApprove = false;
        keepAskBot.add(b.id);
        for (const task of b.tasks ?? []) {
          if (task.approvalMode === "full" || task.approvalMode === "custom") {
            task.approvalMode = "ask";
            task.autoApprove = false;
            keepAskTask.add(task.threadId);
          }
        }
        }
        delete b.approvalGrant;
        botsMigrated = true;
      }
      const avatar = botAvatarProfile(b);
      if (b.avatarUrl !== undefined && avatar.avatarUrl !== b.avatarUrl) {
        delete b.avatarUrl;
        botsMigrated = true;
      }
      if (b.avatarCrop !== undefined && avatar.avatarCrop !== b.avatarCrop) {
        delete b.avatarCrop;
        botsMigrated = true;
      }
      if (b.avatarZoom !== undefined) {
        const zoom = clampAvatarZoom(b.avatarZoom);
        if (zoom === AVATAR_ZOOM_MIN) {
          delete b.avatarZoom;
          botsMigrated = true;
        } else if (b.avatarZoom !== zoom) {
          b.avatarZoom = zoom;
          botsMigrated = true;
        }
      }
      for (const key of ["avatarFocusX", "avatarFocusY"] as const) {
        if (b[key] === undefined) continue;
        const focus = clampAvatarFocus(b[key]);
        if (focus === AVATAR_FOCUS_CENTER) {
          delete b[key];
          botsMigrated = true;
        } else if (b[key] !== focus) {
          b[key] = focus;
          botsMigrated = true;
        }
      }
      const host = recordedBotHost(b.host);
      if (JSON.stringify(host) !== JSON.stringify(b.host)) {
        b.host = host;
        botsMigrated = true;
      }
    }
    // 0.8.19: every bot is proactive by default. 2026-11-01: only off |
    // proactive remain; propose / read-auto / follow-rules all become
    // proactive; a chosen off stays off; a garbled value fails closed to off.
    for (const b of this.bots) {
      const next = normalizeProactiveMode(b.proactiveMode);
      if (b.proactiveMode !== next) {
        b.proactiveMode = next;
        botsMigrated = true;
      }
    }
    // A Primary Bot stays reachable in the sidebar. One per person is
    // enforced by enforceOnePrimaryPerOwner once the server knows who owns
    // which bot (index.ts runs it at boot).
    for (const b of this.bots) {
      if (b.chiefOfStaff && b.hidden) {
        b.hidden = false;
        botsMigrated = true;
      }
    }
    // Peer grants originally used mutable display names (ask_bot:@Helper).
    // Convert only when exactly one bot has that name; ambiguous legacy
    // entries remain inert rather than granting access to the wrong bot.
    for (const b of this.bots) {
      if (!b.alwaysAllow?.length) continue;
      let changed = false;
      const migrated = b.alwaysAllow.map((key) => {
        const match = key.match(/^(ask_bot|delegate_bot):@(.+)$/);
        if (!match) return key;
        const candidates = this.bots.filter((candidate) => candidate.name === match[2]);
        if (candidates.length !== 1) return key;
        changed = true;
        return peerAllowKey(match[1] as PeerAction, candidates[0]!.id);
      });
      if (changed) {
        b.alwaysAllow = [...new Set(migrated)];
        botsMigrated = true;
      }
    }
    // Composio was removed. A bot record from an older release may still
    // carry the connected-apps switch (`composio`) or per-service grants
    // (`connectorTools`, `connectorScopes`). Drop them so they never persist
    // or travel in an export; a bot that actually had grants is remembered
    // so admins can be told its apps need reconnecting via an engine
    // connector (index.ts, at start).
    for (const b of this.bots) {
      const legacy = b as unknown as Record<string, unknown>;
      const hadGrants = legacy.connectorTools && typeof legacy.connectorTools === "object" && Object.keys(legacy.connectorTools as object).length > 0;
      if ("composio" in legacy || "connectorTools" in legacy || "connectorScopes" in legacy) {
        if (hadGrants) this.legacyComposioBots.push(b.name);
        delete legacy.composio;
        delete legacy.connectorTools;
        delete legacy.connectorScopes;
        botsMigrated = true;
      }
    }
    const botIds = new Set(this.bots.map((b) => b.id));
    for (const g of this.groups) {
      g.busyBotId = null;
      delete g.turnStartedAt;
      // A deleted bot used to stay a member for good: counted on the room's
      // Save button and refused by the roster check on every save.
      // Bot-to-bot channels keep their pair; they are not edited as rooms.
      if (botsLoaded && !g.dm && g.memberIds.some((id) => !botIds.has(id))) {
        g.memberIds = g.memberIds.filter((id) => botIds.has(id));
        groupsMigrated = true;
      }
      const normalized = normalizeGroupDefaultResponder(g.defaultResponder, g.memberIds, Boolean(g.dm));
      if (JSON.stringify(normalized) !== JSON.stringify(g.defaultResponder)) groupsMigrated = true;
      g.defaultResponder = normalized;
      // Bot-to-bot channels intentionally remain one canonical thread.
      if (g.dm) {
        if (g.tasks !== undefined) {
          delete g.tasks;
          groupsMigrated = true;
        }
        continue;
      }
      // A room left with setup pending by an older build counts as set up.
      if (g.setupCompletedAt === null && g.setupSkippedAt == null) {
        g.setupCompletedAt = g.createdAt;
        groupsMigrated = true;
      }
      if (!g.tasks?.length) {
        const initialTask: GroupTaskRecord = {
          threadId: g.threadId,
          title: this.firstUserLine(g.threadId) ?? UNTITLED_TASK,
          createdAt: g.createdAt,
          updatedAt: g.createdAt,
        };
        if (g.pinnedCwd !== undefined) initialTask.pinnedCwd = g.pinnedCwd;
        if (g.pinnedMessageId) initialTask.pinnedMessageId = g.pinnedMessageId;
        g.tasks = [initialTask];
        groupsMigrated = true;
      }
      // Repair a malformed/stale active pointer conservatively. Every task
      // transcript is retained; the newest known task becomes active.
      let active = g.tasks.find((task) => task.threadId === g.threadId);
      if (!active) {
        active = g.tasks[0]!;
        g.threadId = active.threadId;
        groupsMigrated = true;
      }
      // A person conversation becomes threads once: what it was is its
      // first thread, "General", and stays its default (server/people-dms.ts).
      if (migratePeopleDmToThreads(g)) groupsMigrated = true;
      g.pinnedCwd = active.pinnedCwd;
      g.pinnedMessageId = active.pinnedMessageId;
    }
    if (groupsMigrated) this.saveGroups();
    // Older builds copied a bot's model onto every thread it made, so a
    // thread on exactly its bot's model is a copy, not a person's pick: once
    // per data directory it is cleared and the thread follows its bot. A
    // different model can't be told apart from a pick and stays. Only over a
    // bot list this load could read, so an unreadable file is not skipped.
    const clearModelCopies = !existsSync(THREAD_MODEL_COPIES_CLEARED) && (botsLoaded || !existsSync(BOTS_FILE));
    const fillAskedAts = !existsSync(ASKED_AT_FILLED) && (botsLoaded || !existsSync(BOTS_FILE));
    // bots saved before tasks existed have one endless thread; adopt it as
    // their first task so nothing is lost and nothing special-cases it
    for (const b of this.bots) {
      // Folders are organizational only. Preserve threads' own models while
      // discarding the unshipped folder-default setting.
      if (b.projects?.some((project) => "modelSelection" in project)) {
        b.projects = b.projects.map(({ id, name, emoji }) => ({ id, name, ...(isProjectEmoji(emoji) ? { emoji } : {}) }));
        botsMigrated = true;
      }
      if (!b.tasks?.length) {
        b.tasks = [{
          threadId: b.threadId,
          title: this.firstUserLine(b.threadId) ?? UNTITLED_TASK,
          createdAt: b.createdAt,
          updatedAt: b.createdAt,
          resumeCursors: b.resumeCursors ?? {},
        }];
        botsMigrated = true;
      }
      // Retain an old active transcript even if a stale tasks array omitted
      // it. Repairing the pointer by selecting another task would hide it.
      let active = b.tasks.find((task) => task.threadId === b.threadId);
      if (!active) {
        active = {
          threadId: b.threadId,
          title: this.firstUserLine(b.threadId) ?? UNTITLED_TASK,
          createdAt: b.createdAt,
          updatedAt: b.createdAt,
          resumeCursors: b.resumeCursors ?? {},
        };
        b.tasks.unshift(active);
        botsMigrated = true;
      }
      for (const task of b.tasks) {
        if (clearModelCopies && task.modelSelection !== undefined && sameModelSelection(task.modelSelection, b.modelSelection)) {
          delete task.modelSelection;
          botsMigrated = true;
        }
        if (!task.resumeCursors) {
          task.resumeCursors = task === active ? (b.resumeCursors ?? {}) : {};
          botsMigrated = true;
        }
        if (task.unread === undefined) {
          task.unread = task === active && b.unread;
          botsMigrated = true;
        }
        // Older builds left a failed hidden run unread, which kept the bot
        // dot on after every visible chat was read. Clear it before the
        // recompute below so the saved roster heals.
        if ((task.routineRunId || task.hidden === true) && task.unread) {
          task.unread = false;
          botsMigrated = true;
        }
        if (task.confidential !== undefined && task.confidential !== true) {
          delete task.confidential;
        }
        if (task.hidden !== undefined && task.hidden !== true) {
          delete task.hidden;
          botsMigrated = true;
        }
        // #1170: no hidden conversation any more. Work sent over the agent
        // API lands in the bot's single chat; the hidden threads it made
        // before come back, nothing deleted: an AI client's joins the
        // person's conversations (a segment of their stream), one another
        // bot opened is listed with threads shown, where its person can
        // close or archive it. Not the person's main thread: they did not
        // write there themselves.
        if (task.hidden === true) {
          delete task.hidden;
          if (!task.openedBy) delete task.askedAt;
          botsMigrated = true;
        }
        if (task === active) {
          if (task.rewound === undefined && b.rewound !== undefined) {
            task.rewound = b.rewound;
            botsMigrated = true;
          }
          if (task.pinnedMessageId === undefined && b.pinnedMessageId !== undefined) {
            task.pinnedMessageId = b.pinnedMessageId;
            botsMigrated = true;
          }
        }
        if (task.approvalMode !== undefined && !isApprovalMode(task.approvalMode)) {
          delete task.approvalMode;
          botsMigrated = true;
        }
        if (task.approvalOwn !== undefined && !isApprovalException(task.approvalOwn)) {
          delete task.approvalOwn;
          botsMigrated = true;
        }
        // #1169/#1170: a thread's level is its bot's, read live at each turn.
        // Before, every thread kept a copy of the bot's level from the day it
        // was made (a hidden send_prompt thread made on Ask stayed on Ask
        // after the bot went Full). A level with no stated exception is such
        // a copy: it goes, and the thread follows its bot. Idempotent.
        if (task.approvalOwn === undefined && (task.approvalMode !== undefined || task.autoApprove !== undefined)) {
          delete task.approvalMode;
          delete task.autoApprove;
          botsMigrated = true;
        }
        if (task.busy !== undefined || task.activity !== undefined || task.turnStartedAt !== undefined) botsMigrated = true;
        task.busy = false;
        task.activity = "idle";
        task.turnStartedAt = undefined;
      }
      this.mirrorActiveTask(b, active);
      b.unread = botHasPersonUnread(b);
    }
    // Slice 4: grants with levels replace directGrants (each becomes a
    // `user:` grant at level use, given by the owner), once; malformed
    // grants are dropped.
    for (const b of this.bots) {
      if (b.grants === undefined && Array.isArray(b.directGrants) && b.directGrants.length) {
        b.grants = grantsFromDirect(b.directGrants, b.ownerUserId, b.createdAt);
        botsMigrated = true;
      } else if (b.grants !== undefined) {
        const clean = cleanBotGrants(b.grants);
        if (clean.length !== (Array.isArray(b.grants) ? b.grants.length : -1)) {
          b.grants = clean;
          b.directGrants = directFromGrants(clean);
          botsMigrated = true;
        }
      }
    }
    // Slice 5: a malformed Perspicax profile list is dropped.
    for (const b of this.bots) {
      if (b.perspicax === undefined) continue;
      const clean = cleanBotPerspicax(b.perspicax);
      if (JSON.stringify(clean) !== JSON.stringify(b.perspicax)) {
        if (clean) b.perspicax = clean;
        else delete b.perspicax;
        botsMigrated = true;
      }
    }
    // Perspicax #321: a malformed temporary mark is dropped.
    for (const b of this.bots) {
      if (b.temporary === undefined) continue;
      const clean = cleanTemporaryAgent(b.temporary);
      if (JSON.stringify(clean) !== JSON.stringify(b.temporary)) {
        if (clean) b.temporary = clean;
        else delete b.temporary;
        botsMigrated = true;
      }
    }
    // Approve for me is the default. The first start on this data directory
    // moves bots and threads still on Ask (or with no mode) onto it. A later
    // choice of Ask, Edits, Full or Custom stays. This computer keeps Ask
    // until its own warning. A grant revoked above stays Ask, threads included.
    // The marker is written after the save so a crash before the write retries.
    // Where new bots start on Ask (an organization whose policy does not say
    // Approve for me, 2026-10-11) nothing moves, and the marker is written so
    // a later change of that policy never moves existing bots either.
    const approvalDefaultMarker = join(DATA_DIR, "approval-default-auto.v1");
    const approvalDefaultPending = !existsSync(approvalDefaultMarker);
    if (approvalDefaultPending && this.newBotApprovalMode() === "auto") {
      for (const b of this.bots) {
        if (b.computer === "local" || keepAskBot.has(b.id)) continue;
        if (b.approvalMode === undefined || b.approvalMode === "ask") {
          b.approvalMode = "auto";
          b.autoApprove = true;
          botsMigrated = true;
        }
        for (const task of b.tasks ?? []) {
          // a thread that follows its bot moved with it above
          if (keepAskTask.has(task.threadId) || task.approvalOwn === undefined) continue;
          if (task.approvalMode === undefined || task.approvalMode === "ask") {
            task.approvalMode = "auto";
            task.autoApprove = true;
            botsMigrated = true;
          }
        }
      }
    }
    if (botsMigrated) this.saveBots();
    if (approvalDefaultPending) {
      try { writeFileAtomic(approvalDefaultMarker, "auto\n", { mode: 0o600 }); }
      catch (error) { console.warn("store: approval default marker was not saved", error); }
    }
    if (clearModelCopies) writeFileAtomic(THREAD_MODEL_COPIES_CLEARED, "Threads follow their bot's model; the copies older builds made are cleared.\n", { mode: 0o600 });
    // Search reads SQLite directly, so migrate every known legacy transcript
    // at startup rather than waiting until the user happens to open it. Only
    // pending JSON files are touched; already-migrated threads stay lazy.
    const knownThreads = new Set([
      ...this.bots.flatMap((b) => [b.threadId, ...(b.tasks ?? []).map((task) => task.threadId)]),
      ...this.groups.flatMap((group) => [group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]),
    ]);
    for (const threadId of knownThreads) {
      const legacyFile = messagesFile(threadId);
      if (existsSync(legacyFile)) mdb.readThread(threadId, legacyFile);
    }
    // After legacy transcripts are in SQLite, so the first boot sees their
    // newest message instead of stamping createdAt and jumping next launch.
    this.repairThreadUpdatedAts();
    if (fillAskedAts) this.fillTaskAskedAts();
    // After the roster is loaded, so identity resolution sees which opener
    // ids are still live.
    this.repairDuplicatePairConversations();
    this.registeringInitialSections = false;
  }

  /** Advance a task's update stamp in memory only. Message writes must not
   * rewrite bots.json; the next snapshot and the startup repair read this. */
  private noteThreadActivity(threadId: string, at: number): void {
    if (!Number.isFinite(at)) return;
    const advance = (current: number | undefined) => Math.max(current ?? 0, at);
    for (const bot of this.bots) {
      const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
      if (!task) continue;
      const next = advance(task.updatedAt);
      if (task.updatedAt !== next) task.updatedAt = next;
    }
    for (const group of this.groups) {
      const task = group.tasks?.find((candidate) => candidate.threadId === threadId);
      if (!task) continue;
      const next = advance(task.updatedAt);
      if (task.updatedAt !== next) task.updatedAt = next;
      // New activity is what an until-activity snooze waits for, as on a
      // bot thread (setTaskActivity).
      if (task.snoozedUntil === 0) {
        delete task.snoozedUntil;
        this.saveGroups();
        this.emit({ type: "group", groupId: group.id });
      }
    }
  }

  /** Fill missing stamps, and raise a stamp that is older than the newest
   * stored message. Never moves a stamp backwards: there is no per-message
   * delete, and a clock skew must not reshuffle the list on every boot. */
  private repairThreadUpdatedAts(): void {
    const botTasks = this.bots.flatMap((bot) => bot.tasks ?? []);
    const groupTasks = this.groups.flatMap((group) => group.tasks ?? []);
    const latest = mdb.latestMessageAts([...botTasks, ...groupTasks].map((task) => task.threadId));
    let botsDirty = false;
    let groupsDirty = false;
    const repair = (task: { threadId: string; createdAt: number; updatedAt?: number }) => {
      const fromMessages = latest.get(task.threadId);
      const next = fromMessages !== undefined && (task.updatedAt === undefined || fromMessages > task.updatedAt)
        ? fromMessages
        : task.updatedAt ?? task.createdAt;
      if (task.updatedAt === next) return false;
      task.updatedAt = next;
      return true;
    };
    for (const task of botTasks) if (repair(task)) botsDirty = true;
    for (const task of groupTasks) if (repair(task)) groupsDirty = true;
    if (botsDirty) this.saveBots();
    if (groupsDirty) this.saveGroups();
  }

  /** Where a person last wrote in a thread from before builds kept it
   * (TaskRecord.askedAt) is only in its transcript: once, a thread without
   * the stamp takes its newest line a person sent from an app. Without it a
   * bot's main thread (server/main-thread.ts) is whichever thread is
   * selected until someone writes again: often the oldest one, where
   * v0.1.98 to v0.1.107 reported, left selected by its activity row. */
  private fillTaskAskedAts(): void {
    const tasks = this.bots.flatMap((bot) => bot.tasks ?? []).filter((task) => task.askedAt === undefined && !task.routineRunId);
    const asked = mdb.latestPersonLineAts(tasks.map((task) => task.threadId));
    for (const task of tasks) {
      const at = asked.get(task.threadId);
      if (at !== undefined) task.askedAt = at;
    }
    if (asked.size) this.saveBots();
    writeFileAtomic(ASKED_AT_FILLED, "Threads from before askedAt have it from the lines people wrote there.\n", { mode: 0o600 });
  }

  /** Resolve the identity of a historical pair row, including a sender
   * recreated with the same unique name. */
  private openerIdentity(openedBy: TaskOpenedBy): string {
    if (this.bot(openedBy.botId)) return openedBy.botId;
    const named = this.bots.filter((bot) => bot.name === openedBy.name);
    return named.length === 1 ? named[0].id : openedBy.botId;
  }

  /** At most one live pair row per (recipient, sender identity). Servers
   * before identity-stable matching minted a second live pair row for a
   * deleted-and-recreated sender while the predecessor's row dangled live
   * forever; collapse those on load by keeping the first row in the task
   * list (the newest, actively used one) and demoting
   * the rest to closed plain threads. History is kept, never deleted. Runs on
   * every load and touches nothing in a store that already holds the
   * invariant. */
  private repairDuplicatePairConversations(): void {
    let botsDirty = false;
    type SweepTask = { openedBy?: TaskOpenedBy; closedBy?: TaskClosedBy };
    const sweep = (tasks: SweepTask[] | undefined, repaired: () => void) => {
      const pairs = new Map<string, SweepTask[]>();
      for (const task of tasks ?? []) {
        const by = task.openedBy;
        if (by?.kind !== "pair" || task.closedBy) continue;
        const identity = this.openerIdentity(by);
        pairs.set(identity, [...(pairs.get(identity) ?? []), task]);
      }
      for (const rows of pairs.values()) {
        // Rows are in task-list order; keep the newest.
        for (const duplicate of rows.slice(1)) {
          const by = duplicate.openedBy!;
          const identity = this.openerIdentity(by);
          const { kind: _kind, ...opened } = by;
          duplicate.openedBy = opened;
          duplicate.closedBy = {
            botId: identity,
            name: this.bot(identity)?.name ?? by.name,
            at: Date.now(),
          };
          repaired();
        }
      }
    };
    // Historical pair rows lived only on bots; group tasks have no peer stamps.
    for (const bot of this.bots) sweep(bot.tasks, () => { botsDirty = true; });
    if (botsDirty) this.saveBots();
  }

  // Many saves repeat what is already on disk (the same resume cursor, an
  // unchanged task field), so both registries skip a byte-identical write.
  // Events are still emitted by the callers either way.
  /** Memory changes only once bots.json holds them: a failed save puts the bot back as it was. */
  private commitBotChange(bot: BotRecord, action: string, change: () => void, onRollback?: () => void) {
    commitBotChange(bot, action, () => this.saveBots(), change, onRollback);
  }

  private saveBots(bots: BotRecord[] = this.bots, registerSections = true) {
    if (this.botsUnreadable) {
      throw Object.assign(new Error("Saved bots could not be read. Repair bots.json before changing them."), { status: 503 });
    }
    if (registerSections) this.rememberSections([...this.bots, ...bots].map((bot) => bot.section));
    writeFileAtomicIfChanged(BOTS_FILE, JSON.stringify(bots.map(({ busy: _busy, activity: _activity, ...bot }) => ({
      ...bot,
      tasks: bot.tasks?.map(({ busy: _taskBusy, activity: _taskActivity, turnStartedAt: _taskTurnStarted, ...task }) => persistedPin(task)),
    })), null, 2), { mode: 0o600 });
  }

  private saveGroups(groups: GroupRecord[] = this.groups, registerSections = true) {
    if (this.groupsUnreadable) {
      throw Object.assign(new Error("Saved rooms could not be read. Repair groups.json before changing them."), { status: 503 });
    }
    if (registerSections) this.rememberSections(groups.map((group) => group.section));
    writeFileAtomicIfChanged(GROUPS_FILE, JSON.stringify(groups.map(({ busyBotId: _busyBotId, turnStartedAt: _turnStartedAt, ...g }) => ({
      ...g,
      ...(g.tasks ? { tasks: g.tasks.map((task) => persistedPin(task)) } : {}),
    })), null, 2), { mode: 0o600 });
  }

  get sections(): string[] { return readSections(); }

  private rememberSections(names: (string | undefined)[]) {
    try {
      if (ensureSections(names)) this.emit({ type: "sections" });
    } catch (error) {
      if (!this.registeringInitialSections) throw error;
      console.warn(`[teams] Startup could not register team names; saved teams and shared instructions were left unchanged: ${(error as Error).message}`);
    }
  }

  /** Rename the same team, preserving its members and existing access grants. */
  renameSection(name: string, nextName: string, computers?: TeamComputers): string | undefined {
    if (!name || !this.sections.includes(name)) return "No such team";
    nextName = nextName.trim();
    if (!nextName || nextName.length > 60 || [...nextName].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return "Team name must be 1 to 60 characters without control characters";
    if (name === nextName) return undefined;
    if (this.sections.includes(nextName) || computers?.forSection(nextName)) return "A team with that name already exists";
    const members = this.bots.filter(bot => sectionKey(bot.section) === name);
    const rooms = this.groups.filter(group => sectionKey(group.section) === name);
    const affected = this.bots.filter(bot => members.includes(bot) || bot.managedSections?.some(section => sectionKey(section) === name));
    if (affected.some(bot => bot.busy || bot.tasks?.some(task => task.busy)) || rooms.some(group => group.busyBotId)) {
      return "Stop this team's active work before renaming the team";
    }
    // Keep the established empty-team lifecycle: old grants are revoked when
    // an empty identity is removed, so recreating it cannot restore access.
    if (!members.length && !rooms.length && !computers?.forSection(name)) return this.changeEmptySection(name, nextName);
    const nextBots = this.bots.map(bot => ({ ...bot,
      ...(members.includes(bot) ? { section: nextName } : {}),
      ...(bot.managedSections ? { managedSections: [...new Set(bot.managedSections.map(section => sectionKey(section) === name ? nextName : section))] } : {}),
    }));
    const nextGroups = this.groups.map(group => rooms.includes(group) ? { ...group, section: nextName } : group);
    let computerChanged = false;
    try {
      // Register the new name only after saving the records; otherwise the
      // registry's duplicate-name check would reject this same rename.
      this.saveBots(nextBots, false);
      this.saveGroups(nextGroups, false);
      computerChanged = computers?.renameSection(name, nextName) ?? false;
      changeEmptySection(name, nextName);
    } catch (error) {
      this.saveBots(this.bots, false);
      this.saveGroups(this.groups, false);
      if (computerChanged) computers!.renameSection(nextName, name);
      throw error;
    }
    // Preserve identities held by the schedulers and other store consumers.
    for (let i = 0; i < nextBots.length; i++) Object.assign(this.bots[i], nextBots[i]);
    for (let i = 0; i < nextGroups.length; i++) Object.assign(this.groups[i], nextGroups[i]);
    for (const bot of affected) this.emit({ type: "bot", botId: bot.id });
    for (const room of rooms) this.emit({ type: "group", groupId: room.id });
    this.emit({ type: "sections" });
    return undefined;
  }

  /** Empty-only changes cannot merge teams or silently change anybody's access. */
  changeEmptySection(name: string, nextName: string | null): string | undefined {
    if (!this.sections.includes(name)) return "No such team";
    if ([...this.bots, ...this.groups].some((record) => sectionKey(record.section) === name)) {
      return "Move all bots (including archived bots) and group chats out of this team first";
    }
    if (nextName !== null && nextName !== name && this.sections.includes(nextName)) {
      return "A team with that name already exists";
    }
    if (nextName === name) return undefined;
    const revoked = this.bots.filter((bot) => bot.managedSections?.some((section) => sectionKey(section) === name));
    if (revoked.length) {
      const grants = new Map(revoked.map((bot) => [bot.id, bot.managedSections!.filter((section) => sectionKey(section) !== name)]));
      // Revoke durably before freeing the name. If the registry write then
      // fails, authority stays narrowed; recreating a name can never revive
      // its old grants. Update existing objects so in-flight checks see it.
      this.saveBots(this.bots.map((bot) => grants.has(bot.id) ? { ...bot, managedSections: grants.get(bot.id)! } : bot));
      for (const bot of revoked) bot.managedSections = grants.get(bot.id)!;
      for (const bot of revoked) this.emit({ type: "bot", botId: bot.id });
    }
    changeEmptySection(name, nextName);
    this.emit({ type: "sections" });
    return undefined;
  }

  /** Remove the team, keeping its bots, rooms and conversations in General. */
  deleteSection(name: string): string | undefined {
    if (!name || !this.sections.includes(name)) return "No such team";
    const members = this.bots.filter(bot => sectionKey(bot.section) === name);
    const rooms = this.groups.filter(group => sectionKey(group.section) === name);
    if (members.some(bot => bot.busy || bot.tasks?.some(task => task.busy)) || rooms.some(group => group.busyBotId)) {
      return "Stop this team's active work before deleting the team";
    }
    const nextBots = this.bots.map(bot => ({ ...bot,
      ...(sectionKey(bot.section) === name ? { section: undefined } : {}),
      ...(bot.managedSections ? { managedSections: bot.managedSections.filter(section => sectionKey(section) !== name) } : {}),
    }));
    const nextGroups = this.groups.map(group => sectionKey(group.section) === name ? { ...group, section: undefined } : group);
    try {
      this.saveBots(nextBots);
      this.saveGroups(nextGroups);
      changeEmptySection(name, null);
    } catch (error) {
      this.saveBots();
      this.saveGroups();
      throw error;
    }
    for (let i = 0; i < nextBots.length; i++) Object.assign(this.bots[i], nextBots[i]);
    for (let i = 0; i < nextGroups.length; i++) Object.assign(this.groups[i], nextGroups[i]);
    for (const bot of this.bots) this.emit({ type: "bot", botId: bot.id });
    for (const group of rooms) this.emit({ type: "group", groupId: group.id });
    this.emit({ type: "sections" });
    return undefined;
  }

  // ── groups ────────────────────────────────────────────────────────────
  /** Subscribe to every write. Listeners run after the write and after
   * save; a throwing listener never breaks the write. */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: StoreChange) {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(change);
      } catch (error) {
        console.error("store: change listener threw", error);
      }
    }
  }

  group(id: string): GroupRecord | undefined {
    return this.groups.find((g) => g.id === id);
  }

  groupByThread(threadId: string): GroupRecord | undefined {
    return this.groups.find(
      (group) => group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId),
    );
  }

  createGroup(
    name: string,
    memberIds: string[],
    dm = false,
    section?: string,
    setup?: {
      bulletin?: string;
      defaultResponder?: GroupDefaultResponder;
    },
    humanIds?: string[],
    /** A direct conversation between two people (server/people-dms.ts),
     * set before the record is first emitted. */
    extra?: { peopleDm?: true; createdBy?: string },
  ): GroupRecord {
    let acceptedHumans: string[] | undefined;
    if (humanIds !== undefined) {
      const applied = applyHumanIds({ dm, humanIds });
      if (!applied.ok) throw Object.assign(new Error(applied.error), { status: 400 });
      acceptedHumans = applied.humanIds;
    }
    this.rememberSections([section]);
    const threadId = newId();
    const createdAt = Date.now();
    const group: GroupRecord = {
      id: newId(),
      threadId,
      name,
      memberIds,
      defaultResponder: dm
        ? { kind: "mentions" }
        : normalizeGroupDefaultResponder(setup?.defaultResponder, memberIds, false),
      bulletin: setup?.bulletin ?? "",
      unread: false,
      createdAt,
      dm: dm || undefined,
      busyBotId: null,
      section,
    };
    if (acceptedHumans !== undefined) group.humanIds = acceptedHumans;
    if (extra?.peopleDm) group.peopleDm = true;
    if (extra?.createdBy) group.createdBy = extra.createdBy;
    if (!dm) {
      group.tasks = [{ threadId, title: UNTITLED_TASK, createdAt, updatedAt: createdAt }];
      // A person conversation starts on its "General" thread, already migrated.
      if (extra?.peopleDm) {
        group.tasks = [{ threadId, title: PEOPLE_DM_GENERAL_TITLE, createdAt, updatedAt: createdAt, general: true }];
        group.personThreads = 1;
      }
      // Rooms are usable from creation: there is no pending setup step.
      // Folder, responder and instructions are edited in the side panel.
      group.setupCompletedAt = createdAt;
      group.setupSkippedAt = null;
    }
    this.groups.unshift(group);
    this.saveGroups();
    this.emit({ type: "group", groupId: group.id });
    return group;
  }

  /** The bot⇄bot channel for a pair, if it exists (order-insensitive). */
  dmGroup(a: string, b: string): GroupRecord | undefined {
    return this.groups.find(
      (g) => g.dm && g.memberIds.length === 2 && g.memberIds.includes(a) && g.memberIds.includes(b),
    );
  }

  patchGroup(id: string, patch: Partial<Pick<GroupRecord, "name" | "memberIds" | "humanIds" | "defaultResponder" | "bulletin" | "unread" | "lastReadMessageId" | "pinned" | "busyBotId" | "cwd" | "pinnedMessageId" | "section" | "setupCompletedAt" | "setupSkippedAt" | "audienceFloor" | "installedPackage" | "createdBy" | "peopleDm" | "unreadFor" | "memoryEnabled" | "turnTimeoutMinutes" | "tasks" | "mentionAll" | "botPayers" | "archivedAt">>): GroupRecord | null {
    const group = this.group(id);
    if (!group) return null;
    if (Object.prototype.hasOwnProperty.call(patch, "humanIds")) {
      if (!Array.isArray(patch.humanIds) || patch.humanIds.some((id) => typeof id !== "string")) {
        throw Object.assign(new Error("humanIds must be a list of user ids"), { status: 400 });
      }
      const applied = applyHumanIds({ dm: group.dm, humanIds: patch.humanIds });
      if (!applied.ok) throw Object.assign(new Error(applied.error), { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "section")) {
      this.rememberSections([patch.section]);
    }
    const previousBusyBotId = group.busyBotId;
    Object.assign(group, patch);
    // The group's elapsed readout counts the busy member's turn from the
    // claim time — the group-side twin of a task's turnStartedAt. Derived,
    // never patched directly: stamp it on every transition into a busy
    // speaker and clear it when the group goes idle, so each member's turn
    // counts from its own start.
    if (Object.prototype.hasOwnProperty.call(patch, "busyBotId")) {
      if (patch.busyBotId && patch.busyBotId !== previousBusyBotId) group.turnStartedAt = Date.now();
      else if (!patch.busyBotId) delete group.turnStartedAt;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "turnTimeoutMinutes") && patch.turnTimeoutMinutes == null) {
      delete group.turnTimeoutMinutes;
    }
    if (!group.dm && Object.prototype.hasOwnProperty.call(patch, "pinnedMessageId")) {
      const active = this.activeGroupTask(group.id);
      if (active) active.pinnedMessageId = patch.pinnedMessageId;
    }
    group.defaultResponder = normalizeGroupDefaultResponder(
      group.defaultResponder,
      group.memberIds,
      Boolean(group.dm),
    );
    this.saveGroups();
    this.emit({ type: "group", groupId: group.id });
    return group;
  }

  /** A thread's durable record: DB rows, legacy JSON leftovers, and the
   * per-thread event logs. Every delete path funnels here — task, group,
   * and bot deletion — so the logs cannot outlive the thread anywhere. */
  private deleteThreadRecord(threadId: string, beforeCommit?: () => void) {
    mdb.deleteThread(threadId, beforeCommit);
    this.threads.delete(threadId);
    for (const file of [
      messagesFile(threadId),
      `${messagesFile(threadId)}.imported`,
      join(EVENTS_DIR, `${threadId}.ndjson`),
      join(NATIVE_DIR, `${threadId}.ndjson`),
    ]) {
      // what a view kept of it in memory goes too (server/content-at-rest.ts)
      forgetLogMemory(file);
      try {
        unlinkSync(file);
      } catch {}
    }
    this.emit({ type: "thread.deleted", threadId });
  }

  deleteGroup(id: string): boolean {
    const group = this.group(id);
    if (!group) return false;
    this.groups = this.groups.filter((g) => g.id !== id);
    this.saveGroups();
    for (const threadId of new Set([group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)])) {
      this.deleteThreadRecord(threadId);
    }
    this.emit({ type: "group.deleted", groupId: id });
    return true;
  }

  /** A process restart cannot preserve an in-flight room orchestrator. Close
   * every durable working receipt before clients load it, including manual
   * goals that do not have a RoutineRun record to reconcile separately. */
  reconcileInterruptedGroupGoals(
    resolve?: (
      runId: string,
      threadId: string,
    ) => {
      status: Exclude<GroupGoalRunCardData["status"], "working">;
      detail: string;
      finishedAt: number;
    } | null,
    fallbackDetail = "Sagax restarted before this goal finished.",
    fallbackFinishedAt = Date.now(),
  ): number {
    const ownedThreadIds = new Set<string>();
    for (const group of this.groups) {
      ownedThreadIds.add(group.threadId);
      for (const task of group.tasks ?? []) ownedThreadIds.add(task.threadId);
    }
    // load() already migrated every legacy transcript file into SQLite, so
    // this recovery query is proportional to unfinished goals, not history.
    let recovered = 0;
    for (const hit of mdb.workingGoalRunMessages()) {
      if (!ownedThreadIds.has(hit.threadId) || !hit.message.goalRun) continue;
      const resolution = resolve?.(hit.message.goalRun.runId, hit.threadId) ?? {
        status: "failed" as const,
        detail: fallbackDetail,
        finishedAt: fallbackFinishedAt,
      };
      const state = resolution.status === "needs-input"
        ? "needs your input"
        : resolution.status === "limit-reached"
          ? "reached its turn limit"
          : resolution.status;
      this.patchMessage(hit.threadId, hit.message.id, {
        text: `Goal ${state}: ${resolution.detail}`,
        goalRun: {
          ...hit.message.goalRun,
          status: resolution.status,
          detail: resolution.detail,
          finishedAt: resolution.finishedAt,
        },
      });
      recovered += 1;
    }
    return recovered;
  }

  // ── channel tasks ────────────────────────────────────────────────────
  groupTasks(groupId: string): GroupTaskRecord[] {
    const group = this.group(groupId);
    return group?.dm ? [] : (group?.tasks ?? []);
  }

  activeGroupTask(groupId: string): GroupTaskRecord | undefined {
    const group = this.group(groupId);
    return group?.tasks?.find((task) => task.threadId === group.threadId);
  }

  groupTaskByThread(groupId: string, threadId: string): GroupTaskRecord | undefined {
    const group = this.group(groupId);
    if (!group || group.dm) return undefined;
    return group.tasks?.find((task) => task.threadId === threadId);
  }

  createGroupTask(groupId: string, title?: string, activate = true, projectId?: string): GroupTaskRecord | null {
    const group = this.group(groupId);
    if (!group || group.dm) return null;
    const createdAt = Date.now();
    const task: GroupTaskRecord = {
      threadId: newId(),
      title: title?.trim().slice(0, 80) || UNTITLED_TASK,
      createdAt,
      updatedAt: createdAt,
      ...(projectId && group.projects?.some((project) => project.id === projectId) ? { projectId } : {}),
    };
    group.tasks = [task, ...(group.tasks ?? [])];
    if (activate) {
      group.threadId = task.threadId;
      group.pinnedCwd = undefined;
      group.pinnedMessageId = undefined;
    }
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  switchGroupTask(groupId: string, threadId: string): GroupRecord | null {
    const group = this.group(groupId);
    const task = group?.tasks?.find((candidate) => candidate.threadId === threadId);
    if (!group || group.dm || !task) return null;
    group.threadId = task.threadId;
    group.pinnedCwd = task.pinnedCwd;
    group.pinnedMessageId = task.pinnedMessageId;
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return group;
  }

  setGroupTaskPinned(groupId: string, threadId: string, pinned: boolean): GroupTaskRecord | null {
    const task = this.groupTaskByThread(groupId, threadId);
    if (!task) return null;
    if (pinned) task.pinned = true;
    else delete task.pinned;
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  /** A thread's organization state, the same fields a bot thread takes:
   * archive, snooze, folder and pin. `undefined` clears a field. A folder
   * must be one of this group's. */
  patchGroupTask(groupId: string, threadId: string, patch: Partial<Pick<GroupTaskRecord, "archivedAt" | "snoozedUntil" | "projectId" | "pinned" | "turnTiming">>): GroupTaskRecord | null {
    const group = this.group(groupId);
    const task = this.groupTaskByThread(groupId, threadId);
    if (!group || !task) return null;
    if (patch.projectId !== undefined && !group.projects?.some((project) => project.id === patch.projectId)) return null;
    for (const field of ["archivedAt", "snoozedUntil", "projectId", "pinned", "turnTiming"] as const) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const value = patch[field];
      if (value === undefined || (field === "pinned" && value !== true)) delete task[field];
      else Object.assign(task, { [field]: value });
    }
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  /** Null removes the conversation's own ceiling so the next turn uses the
   * global group limit. A sibling conversation is left alone. */
  setGroupTaskTurnTimeout(groupId: string, threadId: string, minutes: number | null): GroupTaskRecord | null {
    const task = this.groupTaskByThread(groupId, threadId);
    if (!task) return null;
    if (minutes == null) delete task.turnTimeoutMinutes;
    else task.turnTimeoutMinutes = minutes;
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  renameGroupTask(groupId: string, threadId: string, title: string): GroupTaskRecord | null {
    const task = this.groupTaskByThread(groupId, threadId);
    if (!task) return null;
    task.title = title.trim().slice(0, 80) || UNTITLED_TASK;
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  /** Name a channel task after its first message, once. Returns the task
   * it named so a caller can later replace exactly that machine-made
   * title. */
  titleGroupTaskFromFirstMessage(groupId: string, text: string, threadId?: string): GroupTaskRecord | null {
    const task = threadId ? this.groupTaskByThread(groupId, threadId) : this.activeGroupTask(groupId);
    if (!task || task.titleFromFirstMessage || task.title !== UNTITLED_TASK) return null;
    task.title = titleFromMessage(text);
    task.titleFromFirstMessage = true;
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return task;
  }

  /** Swap a machine-made first-message channel title for a generated one,
   * once, on the same snippet-equality contract as bot tasks: any rename
   * by the person breaks that equality first and always wins. */
  retitleGroupTask(groupId: string, threadId: string, machineTitle: string, title: string): GroupTaskRecord | null {
    const task = this.groupTaskByThread(groupId, threadId);
    if (!task || task.title !== machineTitle) return null;
    return this.renameGroupTask(groupId, threadId, threadTitleFrom(title));
  }

  deleteGroupTask(groupId: string, threadId: string): GroupRecord | null {
    const group = this.group(groupId);
    if (!group || group.dm || !group.tasks || group.tasks.length < 2) return null;
    if (!group.tasks.some((task) => task.threadId === threadId)) return null;
    group.tasks = group.tasks.filter((task) => task.threadId !== threadId);
    this.deleteThreadRecord(threadId);
    if (group.threadId === threadId) {
      const next = group.tasks[0]!;
      group.threadId = next.threadId;
      group.pinnedCwd = next.pinnedCwd;
      group.pinnedMessageId = next.pinnedMessageId;
    }
    this.saveGroups();
    this.emit({ type: "group", groupId });
    return group;
  }

  /** Every participant's read position on this thread (server/read-receipts.ts). */
  threadReads(threadId: string): ReadMap {
    return mdb.readThreadReads(threadId);
  }

  /** Move a participant's read position to `messageId`, forward only. The
   * message must be in this thread. Returns the new position, or null when
   * nothing moved. Never touches the transcript. */
  markRead(threadId: string, participantId: string, messageId: string, at: number = Date.now()): ReadPosition | null {
    if (!participantId) return null;
    const messages = this.thread(threadId).messages;
    const order = new Map(messages.map((message, index) => [message.id, index]));
    const current = mdb.readThreadReads(threadId)[participantId];
    if (!advancesPosition(current, messageId, (id) => order.get(id))) return null;
    const read = { messageId, at };
    mdb.writeThreadRead(threadId, participantId, messageId, at);
    this.emit({ type: "thread.read", threadId, participantId, read });
    return read;
  }

  /** One actor's emoji reaction on a message (shared/reactions.ts): toggle,
   * add or remove. The stored list is normalized on the way (an older
   * `{ emoji, by }` list is rewritten; `legacyUser` is who its "user" was).
   * A change is a message patch, persisted and emitted like any other; a
   * no-op writes nothing. Null when the message is not in this thread. */
  reactToMessage(
    threadId: string,
    messageId: string,
    emoji: string,
    actor: ReactionActor,
    options: { mode?: ReactionMode; legacyUser?: ReactionActor; now?: number } = {},
  ): { message: Message; changed: boolean; added: boolean; full?: true } | null {
    const existing = this.messagesFor(threadId).find((m) => m.id === messageId);
    if (!existing) return null;
    const current = normalizeReactions(existing.reactions, options.legacyUser);
    const result = applyReaction(current, emoji, actor, options.mode ?? "toggle", options.now ?? Date.now());
    if (!result.changed) return { message: existing, changed: false, added: false, ...(result.full ? { full: true as const } : {}) };
    const message = this.patchMessage(threadId, messageId, { reactions: result.reactions.length ? result.reactions : undefined });
    return message ? { message, changed: true, added: result.added } : null;
  }

  private thread(threadId: string): ThreadState {
    // SQLite is the source of truth; a thread with no rows imports its
    // legacy messages-<threadId>.json once, inside readThread
    return this.threads.get(threadId) ?? this.threads.load(threadId, mdb.readThread(threadId, messagesFile(threadId)));
  }

  /** The conversations with a turn running, whose cached transcript stays
   * however long ago it was read (server/thread-cache.ts). */
  private busyThreadIds(): Set<string> {
    const busy = new Set<string>();
    for (const bot of this.bots) {
      if (bot.busy) busy.add(bot.threadId);
      for (const task of bot.tasks ?? []) if (task.busy) busy.add(task.threadId);
    }
    for (const group of this.groups) {
      if (!group.busyBotId) continue;
      busy.add(group.threadId);
      for (const task of group.tasks ?? []) busy.add(task.threadId);
    }
    return busy;
  }

  messagesFor(threadId: string): Message[] {
    return this.thread(threadId).messages;
  }

  /** A bounded page of a thread's newest messages, for callers that only
   * need a display page — the startup/reconnect hydrate and a fresh
   * scrollback view. Reads just `limit` rows at the SQL boundary instead of
   * the whole transcript, unless the thread is already cached from other
   * work (then it's a plain in-memory slice, no extra SQL) or the bounded
   * read comes back as the complete thread anyway (short thread, or a
   * one-time legacy import) — that gets cached like any other full load so
   * a later messagesFor() doesn't re-read it. Legacy rows that predate
   * per-message parentId are only chained correctly on a full load, so a
   * bounded page missing that context falls back to one rather than
   * returning messages with a broken parent chain. */
  messagesTail(threadId: string, limit: number): { messages: Message[]; hasMore: boolean; activeLeafId: string | null } {
    let state = this.threads.get(threadId);
    if (!state) {
      const tail = mdb.readThreadTail(threadId, messagesFile(threadId), limit);
      const legacyRows = tail.hasMore !== undefined && tail.messages.some((m) => m.parentId === undefined);
      if (tail.hasMore !== true || legacyRows) {
        state = this.threads.load(threadId, legacyRows ? mdb.readThread(threadId, messagesFile(threadId)) : tail);
      } else {
        return {
          messages: tail.messages,
          hasMore: tail.hasMore,
          activeLeafId: tail.activeLeafId ?? tail.messages.at(-1)?.id ?? null,
        };
      }
    }
    const { messages, activeLeafId } = state;
    const start = Math.max(0, messages.length - limit);
    return { messages: messages.slice(start), hasMore: start > 0, activeLeafId };
  }

  /** Used only with newly allocated import threads. No live actions are
   * replayed: the importer supplies inert text and freshly remapped IDs. */
  importTranscript(threadId: string, messages: Message[], activeLeafId: string | null): void {
    if (this.messagesFor(threadId).length) throw new Error("Cannot import over an existing conversation");
    mdb.importThread(threadId, messages, activeLeafId);
    this.threads.delete(threadId);
    const newest = messages.reduce((max, message) => Math.max(max, message.at), Number.NEGATIVE_INFINITY);
    if (Number.isFinite(newest)) this.noteThreadActivity(threadId, newest);
  }

  activeLeaf(threadId: string): string | null {
    return this.thread(threadId).activeLeafId;
  }

  /** The visible conversation: root → activeLeafId. */
  activePath(threadId: string): Message[] {
    const t = this.thread(threadId);
    const byId = new Map(t.messages.map((m) => [m.id, m]));
    const path: Message[] = [];
    let cur = t.activeLeafId ? byId.get(t.activeLeafId) : undefined;
    while (cur) {
      path.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return path.reverse();
  }

  /** Mark the last assistant text on the active branch as this turn's final
   * visible answer. If a provider ends after commentary without emitting a
   * separate answer, that commentary remains visible as the safe fallback. */
  markTerminalAssistantMessage(threadId: string, turnId: string): Message | null {
    const path = this.activePath(threadId);
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const message = path[i];
      if (message.role === "bot" && message.kind === "text" && message.turnId === turnId) {
        if (message.turnTerminal) return message;
        return this.patchMessage(threadId, message.id, { turnTerminal: true });
      }
    }
    return null;
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }, command?: Command): Message {
    const t = this.thread(threadId);
    const full: Message = { id: newId(), at: Date.now(), parentId: t.activeLeafId, ...redactBotAuthored(message) };
    const persist = () => { mdb.appendMessage(threadId, full); return full; };
    const committed = command ? runCommand(command, persist) : persist();
    if (committed.id !== full.id) return committed;
    // Only publish the committed write. A failed receipt must leave both
    // the in-memory branch and subscribers unchanged, just like SQLite.
    t.messages.push(full);
    t.activeLeafId = full.id;
    if (full.kind === "screen") {
      for (const pruned of this.pruneScreenFrames(t)) {
        mdb.updateMessage(threadId, pruned);
        this.emit({ type: "message.patch", threadId, message: pruned });
      }
    }
    this.noteThreadActivity(threadId, full.at);
    this.emit({ type: "message", threadId, message: full });
    // The first-run quiz is not a live ask. Talking past it hides it so the
    // transcript is just the greeting plus what they said. Cards with a
    // requestId are permission/question prompts and stay until answered.
    if (full.role === "user" && full.kind === "text") this.dismissOnboardingCard(threadId);
    return full;
  }

  /** Insert a message into the active chain directly after `anchorId` — the
   * home for turn artifacts that finish AFTER the world moved on (the
   * settle-time screen capture races a fast follow-up send, which used to
   * leave the user's message stranded above the screenshot). When the anchor
   * is still the leaf this is a plain append; otherwise the anchor's
   * children are re-parented onto the inserted message, so the transcript
   * reads turn → artifact → follow-up and the leaf stays where it was. */
  insertMessageAfter(threadId: string, anchorId: string | undefined, message: Omit<Message, "id" | "at">): Message {
    const t = this.thread(threadId);
    const anchorExists = anchorId !== undefined && t.messages.some((m) => m.id === anchorId);
    if (!anchorExists || t.activeLeafId === anchorId) return this.appendMessage(threadId, message);
    const full: Message = { id: newId(), at: Date.now(), ...redactBotAuthored(message), parentId: anchorId };
    const children = t.messages.filter((m) => m.parentId === anchorId);
    t.messages.push(full);
    mdb.insertMessage(threadId, full); // the leaf stays where it was, in SQLite too
    if (full.kind === "screen") {
      for (const pruned of this.pruneScreenFrames(t)) {
        mdb.updateMessage(threadId, pruned);
        this.emit({ type: "message.patch", threadId, message: pruned });
      }
    }
    this.noteThreadActivity(threadId, full.at);
    this.emit({ type: "message", threadId, message: full });
    // announced after the insert so no client ever sees two siblings
    // claiming the same parent
    for (const child of children) this.patchMessage(threadId, child.id, { parentId: full.id });
    return full;
  }

  /** Hide the first-run quiz on this thread, if it is still open. */
  dismissOnboardingCard(threadId: string): Message | null {
    const t = this.thread(threadId);
    const card = t.messages.find(
      (message) => message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed,
    );
    if (!card?.card) return null;
    return this.patchMessage(threadId, card.id, { card: { ...card.card, dismissed: true } });
  }

  /** Screen frames are ~100-500KB of base64 each; keeping every frame of a
   * long computer session bloats the transcript for nothing the client
   * would ever show. The newest few keep their pixels; older ones stay in
   * the transcript as placeholders.
   * Returns the messages whose pixels were dropped so the caller can
   * persist exactly those. */
  private pruneScreenFrames(t: { messages: Message[] }, keep = 4): Message[] {
    const pruned: Message[] = [];
    let seen = 0;
    for (let i = t.messages.length - 1; i >= 0 && seen < t.messages.length; i--) {
      const m = t.messages[i];
      if (m.kind !== "screen" || !m.png) continue;
      seen += 1;
      if (seen > keep) {
        m.png = undefined;
        pruned.push(m);
      }
    }
    return pruned;
  }

  /** Fork the conversation: a new user message that replaces `sourceId`
   * (same parent, new text) and becomes the active leaf. `sendId` is the
   * client's identity for this edit, so its instant bubble reconciles onto
   * the canonical message and a network retry cannot fork twice. */
  branchMessage(threadId: string, sourceId: string, text: string, sendId?: string, sender?: Message["sender"], dataContext?: Message["dataContext"]): Message | null {
    const t = this.thread(threadId);
    const source = t.messages.find((m) => m.id === sourceId);
    if (!source) return null;
    const full: Message = {
      id: newId(),
      at: Date.now(),
      role: "user",
      kind: "text",
      text,
      parentId: source.parentId ?? null,
      replyToId: source.replyToId,
      ...(sendId ? { sendId } : {}),
      ...(sender ? { sender } : {}),
      ...(dataContext ? { dataContext } : {}),
    };
    t.messages.push(full);
    t.activeLeafId = full.id;
    mdb.appendMessage(threadId, full);
    this.noteThreadActivity(threadId, full.at);
    this.emit({ type: "message", threadId, message: full });
    // The message frame alone leaves every client on the OLD branch: a
    // client adopts a new message as its leaf only when it chains onto the
    // current leaf, and this one is a sibling of the edited message, not a
    // child of the reply. Say where the conversation now points, as
    // setActiveLeaf does, or the edit shows only after the next full bot
    // snapshot — in practice, once the reply has arrived.
    this.emit({ type: "thread", threadId, activeLeafId: full.id });
    return full;
  }

  /** Point the visible conversation at the branch containing `messageId`,
   * descending to that branch's most recently active leaf. */
  setActiveLeaf(threadId: string, messageId: string): string | null {
    const t = this.thread(threadId);
    if (!t.messages.some((m) => m.id === messageId)) return null;
    let cur = messageId;
    for (;;) {
      const children = t.messages.filter((m) => m.parentId === cur);
      if (!children.length) break;
      cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
    }
    t.activeLeafId = cur;
    mdb.setActiveLeaf(threadId, cur);
    this.emit({ type: "thread", threadId, activeLeafId: cur });
    return cur;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>, command?: Command): Message | null {
    const t = this.thread(threadId);
    const idx = t.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    const next = { ...t.messages[idx], ...patch, card: patch.card ?? t.messages[idx].card };
    // SQLite is the durable source of truth. Persist before changing memory so
    // a failed write cannot make this process believe a card was answered
    // while a restart would still show it as pending.
    let applied = false;
    const persist = () => { mdb.updateMessage(threadId, next); applied = true; return next; };
    const committed = command ? runCommand(command, persist) : persist();
    if (!applied) return committed;
    t.messages[idx] = next;
    this.emit({ type: "message.patch", threadId, message: next });
    return next;
  }

  bot(id: string) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  botByThread(threadId: string) {
    return this.bots.find((b) => b.threadId === threadId || b.tasks?.some((t) => t.threadId === threadId)) ?? null;
  }

  /** A confidential thread (server/confidential-threads.ts): a bot thread
   * whose record carries `confidential: true`. Rooms never are. */
  isConfidentialThread(threadId: string): boolean {
    if (!threadId) return false;
    for (const bot of this.bots) {
      const task = bot.tasks?.find((t) => t.threadId === threadId);
      if (task) return task.confidential === true;
    }
    return false;
  }

  /** Make a thread confidential. One way only: nothing turns it back (the
   * person opens a new thread to work normally, or deletes this one). Never
   * reachable from the HTTP task PATCH: confidential is not a
   * TASK_PATCH_FIELD. */
  makeTaskConfidential(botId: string, threadId: string): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    if (task.confidential === true) return task;
    task.confidential = true;
    // its own key from now on, everything so far re-sealed under it now
    mdb.contentOwnerChanged([threadId]);
    // Nothing of a confidential thread feeds the single stream: its digest
    // goes, and it stops being a stream segment (server/single-stream.ts).
    delete task.streamSegment;
    delete task.segmentDigest;
    if (bot.threadId === threadId) this.mirrorActiveTask(bot, task);
    this.saveBots();
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Forget a thread's native engine sessions (server/engine-transcripts.ts):
   * its cursors, the bot's mirror of them and the ids it kept go, and the
   * next turn starts a new session with the thread's own transcript
   * replayed (`rewound`), never a resume of a session whose files are gone.
   * Returns the session ids it held. */
  forgetEngineSessions(botId: string, threadId: string): string[] {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return [];
    const held = [...new Set([...Object.values(task.resumeCursors ?? {}), ...(task.engineSessions ?? [])].filter((value): value is string => typeof value === "string" && value.length > 0))];
    const hadAny = held.length > 0 || Object.keys(task.resumeCursors ?? {}).length > 0;
    task.resumeCursors = {};
    delete task.handedMessages;
    delete task.engineSessions;
    if (hadAny) task.rewound = true;
    for (const [instanceId, cursor] of Object.entries(bot.resumeCursors ?? {})) {
      if (bot.threadId === threadId || (typeof cursor === "string" && held.includes(cursor))) delete bot.resumeCursors[instanceId];
    }
    this.saveBots();
    this.emit({ type: "bot", botId });
    return held;
  }

  /** The one place a new bot's selection is decided: the caller's choice, or
   * the workspace default, completed with the workspace's new-bot defaults. */
  private newBotSelection(requested?: ModelSelection): ModelSelection {
    // A choice with no engine (create_bot, an import, Auto before any engine
    // was ready) is no choice: the workspace default, never an empty id.
    return this.completeNewBotSelection(requested && namesEngine(requested) ? requested : this.defaultSelection());
  }

  createBot(
    profile: Partial<
      Pick<
        BotRecord,
        "name" | "title" | "description" | "soul" | "color" | "mascotExpression" | "mascotBody" | "mascotSkin" | "modelSelection" | "section" | "cwd" | "visibility" | "ownerUserId" | "toolScope" | "temporary" | "createdByBot"
      >
    > = {},
    opts: {
      /** false = no greeting/onboarding seed. Imported bots must not open
       * with a first-person greeting the user never asked for. */
      seedMessages?: boolean;
    } = {},
  ): BotRecord {
    const toolScope = parseToolScope(profile.toolScope);
    if (!toolScope.ok) throw new Error(toolScope.error);
    this.rememberSections([profile.section]);
    const name = profile.name?.trim() || pickBotName(this.bots.map((b) => b.name));
    const section = sectionKey(profile.section);
    const startMode = this.newBotApprovalMode();
    const bot: BotRecord = {
      id: newId(),
      threadId: newId(),
      name,
      title: profile.title ?? "",
      description: profile.description ?? "",
      soul: profile.soul ?? "",
      soulHash: soulHash(profile.soul ?? ""),
      notifications: true,
      color: profile.color ?? COLORS[this.bots.length % COLORS.length],
      ...(profile.mascotExpression ? { mascotExpression: profile.mascotExpression } : {}),
      ...(profile.mascotBody ? { mascotBody: profile.mascotBody } : {}),
      ...(profile.mascotSkin && profile.mascotSkin !== "none" ? { mascotSkin: profile.mascotSkin } : {}),
      // Restricted from its first frame: no one else is ever told it exists.
      ...(profile.visibility && profile.visibility !== "everyone" ? { visibility: structuredClone(profile.visibility) } : {}),
      ...(toolScope.scope ? { toolScope: toolScope.scope } : {}),
      unread: false,
      modelSelection: this.newBotSelection(profile.modelSelection),
      approvalMode: startMode,
      autoApprove: startMode === "auto",
      // 0.8.19: proactive by default (shared/proactive-mode.ts)
      proactiveMode: PROACTIVE_MODE_DEFAULT,
      resumeCursors: {},
      createdAt: Date.now(),
      host: { kind: "fleet" },
      ...(profile.ownerUserId?.trim() ? { ownerUserId: profile.ownerUserId.trim().toLowerCase() } : {}),
      // Marked before its first announcement, so the app never lists it.
      ...(profile.temporary ? { temporary: structuredClone(profile.temporary) } : {}),
      ...(profile.createdByBot ? { createdByBot: { ...profile.createdByBot } } : {}),
    };
    if (section) bot.section = section;
    if (profile.cwd) bot.cwd = profile.cwd;
    bot.tasks = [{
      threadId: bot.threadId,
      title: UNTITLED_THREAD,
      createdAt: bot.createdAt,
      updatedAt: bot.createdAt,
      resumeCursors: {},
      // follows the bot's level (#1169/#1170)
      unread: false,
      activity: "idle",
      busy: false,
    }];
    // Persist the selection in the first record, before publishing the bot
    // or starting its greeting. An interrupted creation cannot inherit tools.
    // A temporary agent goes last: whatever takes the newest bot as the one
    // to show never lands on a bot the app does not list.
    if (bot.temporary) {
      this.saveBots([...this.bots, bot]);
      this.bots.push(bot);
    } else {
      this.saveBots([bot, ...this.bots]);
      this.bots.unshift(bot);
    }
    // The folder exists from the first moment, so the user can open
    // SOUL.md before the bot has said a word. The record is canonical: a
    // mirror-write failure must never fail bot creation.
    try {
      writeSoulMirror(bot.id, bot.soul ?? "");
    } catch (e) {
      console.warn(`[bot-folder] could not write SOUL.md mirror for ${bot.id}: ${(e as Error).message}`);
    }
    // Announce the owner before its onboarding transcript. SSE clients need
    // the bot/thread mapping before they can place either message.
    this.emit({ type: "bot", botId: bot.id });
    // Keep the greeting valid for configured bots and every engine.
    if (opts.seedMessages !== false) {
      const language = this.greetingLanguage(bot.ownerUserId);
      this.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: newBotGreeting(name, language),
      });
      // The first real question, not only the greeting line.
      this.appendMessage(bot.threadId, introTaskCard(language));
    }
    return bot;
  }

  /** All setup fields and the Primary Bot's receipt commit before publishing any
   * mutation. A new model moves the threads that follow the bot, never a
   * thread's own model. */
  applyTeamSetup(request: TeamSetupRequest): TeamSetupResult {
    const chief = this.bot(request.botId);
    if (!chief) throw new Error("The requesting Primary Bot no longer exists");
    if (chief.lastTeamSetupReceipt?.requestId === request.requestId) return chief.lastTeamSetupReceipt.result;
    const managedSections = [...new Set([...(chief.managedSections ?? []), ...request.newTeams])];
    if (managedSections.length > 100 || managedSections.some((name) => name.trim() !== name || name.length > 60) ||
        request.newTeams.some((name) => !name) || (request.newTeams.length && !chief.chiefOfStaff)) throw new Error("Invalid reviewed Primary Bot team scope");
    const nextBots = [...this.bots];
    const changed: BotRecord[] = [];
    for (const operation of request.operations) {
      const at = nextBots.findIndex((bot) => bot.id === operation.botId);
      let next: BotRecord;
      if (operation.action === "create") {
        if (at >= 0 || !operation.threadId || !operation.fields.name || !operation.fields.modelSelection) throw new Error("Invalid new bot in team setup");
        const createdAt = Date.now();
        const modelSelection = this.newBotSelection(operation.fields.modelSelection);
        next = { id: operation.botId, threadId: operation.threadId, name: operation.fields.name,
          title: "", description: "", soul: "", notifications: true, color: COLORS[nextBots.length % COLORS.length], unread: false,
          resumeCursors: {}, createdAt, ...operation.fields, modelSelection,
          approvalMode: "auto", autoApprove: true, approvePeerComms: false,
          // A Primary Bot's new teammate is seen by exactly the Primary Bot's audience:
          // a restricted Primary Bot never creates a bot everyone sees.
          ...(chief.visibility && chief.visibility !== "everyone" ? { visibility: structuredClone(chief.visibility) } : {}),
          // ...and belongs to the Primary Bot's own person.
          ...(chief.ownerUserId ? { ownerUserId: chief.ownerUserId } : {}),
          // ...and remembers a bot made it (server/bot-creation.ts depth).
          createdByBot: createdByBotMark(chief, createdAt),
          tasks: [{ threadId: operation.threadId, title: UNTITLED_THREAD, createdAt, updatedAt: createdAt, resumeCursors: {},
            unread: false, activity: "idle", busy: false }],
        };
        // "" is the private-workspace spelling on proposal; the record
        // stays clean with the field absent, exactly like the PATCH path.
        if (!next.cwd) delete next.cwd;
        nextBots.unshift(next);
      } else {
        if (at < 0) throw new Error("A setup target no longer exists");
        const previous = nextBots[at];
        next = { ...previous, ...operation.fields };
        if (operation.fields.modelSelection) next.tasks = this.withDefaultModel(previous);
        nextBots[at] = next;
      }
      if (operation.fields.chiefOfStaff === false) delete next.managedSections;
      next.section = sectionKey(next.section) || undefined;
      if (operation.fields.soul !== undefined) { next.soulHash = soulHash(operation.fields.soul); next.soulDrift = false; }
      changed.push(next);
    }
    const result: TeamSetupResult = { state: "applied", newTeams: request.newTeams, bots: changed.map((bot, index) => ({
      id: bot.id, name: bot.name, section: bot.section, modelSelection: structuredClone(bot.modelSelection), chiefOfStaff: Boolean(bot.chiefOfStaff),
      action: request.operations[index].action === "create" ? "created" : "updated",
    })) };
    const chiefAt = nextBots.findIndex((bot) => bot.id === chief.id);
    const nextChief = { ...nextBots[chiefAt], lastTeamSetupReceipt: { requestId: request.requestId, result } };
    // Only the newly-created teams explicitly named in the human review may
    // extend this Primary Bot's reach. Existing teams require owner settings.
    if (request.newTeams.length && nextChief.chiefOfStaff) {
      nextChief.managedSections = managedSections;
    }
    nextBots[chiefAt] = nextChief;
    this.saveBots(nextBots);
    this.bots = nextBots;
    for (const bot of changed) {
      try { writeSoulMirror(bot.id, bot.soul ?? ""); } catch (error) {
        console.warn(`[bot-folder] could not refresh reviewed setup mirror for ${bot.id}: ${(error as Error).message}`);
      }
      this.emit({ type: "bot", botId: bot.id });
    }
    this.emit({ type: "bot", botId: chief.id });
    return result;
  }

  /** Every bot-default model change clears old thread pins silently. Each
   * conversation keeps its own permission level and other settings. */
  private withDefaultModel(bot: BotRecord): TaskRecord[] | undefined {
    return bot.tasks?.map(withoutModel);
  }

  /** A reviewed default-model change reaches all conversations in one save. */
  applyModelDefault(id: string, modelSelection: ModelSelection): BotRecord | null {
    const previous = this.bot(id);
    if (!previous) return null;
    const next: BotRecord = { ...previous, modelSelection: structuredClone(modelSelection), tasks: this.withDefaultModel(previous) };
    this.saveBots(this.bots.map((candidate) => candidate.id === id ? next : candidate));
    this.bots = this.bots.map((candidate) => candidate.id === id ? next : candidate);
    this.emit({ type: "bot", botId: id });
    return next;
  }

  deleteBot(id: string, setupRequest?: TeamSetupRequest): boolean {
    const bot = this.bot(id);
    if (!bot) return false;
    let nextBots = this.bots.filter((b) => b.id !== id);
    if (setupRequest) {
      const chief = this.bot(setupRequest.botId);
      if (!chief || chief.id === id || setupRequest.deletion?.botId !== id) throw new Error("The reviewed deletion no longer has a valid owner");
      const lastTeamSetupReceipt: NonNullable<BotRecord["lastTeamSetupReceipt"]> = { requestId: setupRequest.requestId, result: { state: "applied", newTeams: [], bots: [
        { id: bot.id, name: bot.name, action: "deleted" },
      ] } };
      nextBots = nextBots.map((candidate) => candidate.id === chief.id ? { ...candidate, lastTeamSetupReceipt } : candidate);
    }
    // Persist removal and the review receipt before deleting conversation or
    // workspace data. A failed save must leave the bot recoverable in place.
    this.saveBots(nextBots);
    this.bots = nextBots;
    this.legacyActivities.delete(id);
    // A deleted bot leaves every room it was in, and a room it led falls back
    // to its next member. Bot-to-bot channels keep their pair.
    const rooms = this.groups.filter((g) => !g.dm && g.memberIds.includes(id));
    for (const g of rooms) {
      g.memberIds = g.memberIds.filter((member) => member !== id);
      if (g.busyBotId === id) { g.busyBotId = null; delete g.turnStartedAt; }
      g.defaultResponder = normalizeGroupDefaultResponder(g.defaultResponder, g.memberIds, false);
    }
    if (rooms.length) {
      // Bot removal is already durable. Finish erasing its data even if this
      // write fails; startup repair removes these stale memberships later.
      try { this.saveGroups(); } catch (error) { console.warn("store: room cleanup will retry on restart", error); }
    }
    // every task's transcript goes with the bot, not just the open one
    for (const threadId of new Set([bot.threadId, ...(bot.tasks ?? []).map((t) => t.threadId)])) {
      this.deleteThreadRecord(threadId);
    }
    // the bot's workspace (files + memory) goes with it — same rule as its
    // transcripts: deleting a bot deletes what it knew
    try {
      rmSync(workspaceDir(id), { recursive: true, force: true });
    } catch {}
    // The journal lives outside the workspace, so removing the workspace
    // does not take it. It is this bot's record of what its memory used to
    // say, and it goes with the bot — the same rule as a thread's event log.
    try {
      rmSync(journalFile(id), { force: true });
    } catch {}
    mdb.deleteBotMemoryFiles(id);
    forgetBotMemoryJournal(id);
    // the Files list's usage record (server/workspace-usage.ts) is outside too
    forgetWorkspaceUsage(id);
    // Generated task-workspaces are project files, not bot memory. Keep
    // them (and user-selected cwd folders) when deleting conversations.
    // Approval state deliberately lives outside the bot-writable workspace.
    // It still belongs to the bot, so deleting the bot must remove staged
    // proposals, manifests, and native-link ownership records with it.
    try {
      rmSync(join(DATA_DIR, "skill-state", id), { recursive: true, force: true });
    } catch {}
    // The bot folder (SOUL.md mirror) is the bot's too.
    removeBotFolder(id);
    this.emit({ type: "bot.deleted", botId: id });
    for (const g of rooms) this.emit({ type: "group", groupId: g.id });
    return true;
  }

  /** Slice 4: replace a bot's grants; `directGrants` follows as the list of
   * `user:` targets (older clients, identity-migration.ts). */
  setBotGrants(id: string, grants: BotGrant[]): BotRecord | null {
    const clean = cleanBotGrants(grants);
    return this.patchBot(id, { grants: clean, directGrants: directFromGrants(clean) });
  }

  /** Perspicax #321: replace a bot's temporary mark (undefined removes it). */
  setBotTemporary(id: string, temporary: TemporaryAgent | undefined): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const clean = temporary === undefined ? undefined : cleanTemporaryAgent(temporary);
    if (temporary !== undefined && !clean) throw new Error("invalid temporary agent record");
    if (clean) bot.temporary = clean;
    else delete bot.temporary;
    this.saveBots();
    this.emit({ type: "bot", botId: id });
    return bot;
  }

  /** Slice 5: replace a bot's Perspicax profiles ([] removes the field). */
  setBotPerspicax(id: string, profiles: readonly string[]): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const clean = cleanBotPerspicax({ profiles: [...profiles] });
    if (clean) bot.perspicax = clean;
    else delete bot.perspicax;
    this.saveBots();
    this.emit({ type: "bot", botId: id });
    return bot;
  }

  /** `actorPrincipalId`: the person changing the bot. A level another
   * person chose for their own conversation on this bot stays theirs. */
  patchBot(id: string, patch: Partial<BotRecord>, options: { actorPrincipalId?: string | null } = {}): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    if (Object.hasOwn(patch, "toolScope")) {
      const parsed = parseToolScope(patch.toolScope);
      if (!parsed.ok) throw new Error(parsed.error);
      patch = { ...patch, toolScope: parsed.scope };
    }
    if (patch.modelSelection !== undefined) {
      patch = { ...patch, tasks: (patch.tasks ?? bot.tasks)?.map(withoutModel) };
    }
    const wideningToolScope = Object.hasOwn(patch, "toolScope") && toolScopeWidens(bot.toolScope, patch.toolScope);
    const nextToolScope = patch.toolScope;
    if (wideningToolScope) {
      patch = { ...patch };
      delete patch.toolScope;
    }
    // #1169/#1170: the approval level belongs to the bot. Setting it
    // reaches every thread at once, hidden ones included: each thread's own
    // exception ends with it, and nothing is copied.
    // Saving the same level again also brings every thread back to it: that
    // is what "apply to every thread" used to do, and now always does.
    const levelChanged = Object.hasOwn(patch, "approvalMode") || Object.hasOwn(patch, "autoApprove");
    // Runtime revocations must become effective in memory even when disk is
    // unavailable. Profile edits use the separate atomic path below.
    Object.assign(bot, patch);
    if (levelChanged) {
      const actor = options.actorPrincipalId?.trim().toLowerCase();
      for (const task of bot.tasks ?? []) {
        // Isolation between people (#934 review): the bot's new level never
        // ends the level another person chose for their own conversation.
        const threadOwner = task.ownerPrincipalId?.trim().toLowerCase();
        if (actor && task.approvalOwn === "thread" && threadOwner && threadOwner !== actor) continue;
        delete task.approvalMode;
        delete task.autoApprove;
        delete task.approvalOwn;
      }
    }
    const task = this.activeTask(id);
    if (task) {
      for (const key of ["resumeCursors", "rewound", "pinnedMessageId", "unread"] as const) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          Object.assign(task, { [key]: structuredClone(patch[key]) });
        }
      }
      bot.unread = botHasPersonUnread(bot);
    }
    if (wideningToolScope) {
      // New authority becomes live only after its durable save succeeds.
      // Other runtime revocations above still take effect on a failed write.
      this.saveBots(this.bots.map((candidate) => candidate === bot ? { ...bot, toolScope: nextToolScope } : candidate));
      bot.toolScope = nextToolScope;
    } else this.saveBots();
    this.emit({ type: "bot", botId: id });
    return bot;
  }

  /** Voice ids belong to one provider's catalog. Changing the workspace
   * provider invalidates every per-agent selection as one durable mutation,
   * before clients are told to pick replacement voices. */
  clearVoiceSelections(): BotRecord[] {
    const changed = this.bots.filter((bot) => bot.voice !== undefined && bot.voice !== "");
    if (!changed.length) return [];
    const next = this.bots.map((bot) =>
      bot.voice === undefined || bot.voice === "" ? bot : { ...bot, voice: undefined });
    this.saveBots(next);
    for (const bot of changed) {
      delete bot.voice;
      this.emit({ type: "bot", botId: bot.id });
    }
    return changed;
  }

  /** Commit a validated profile change before publishing its fields. Unlike
   * runtime revocation, a failed user edit must leave the old profile intact. */
  patchBotProfile(id: string, patch: BotProfilePatch & Partial<Pick<BotRecord, "cwd" | "lastProfileRequestId">>): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const next = { ...bot, ...patch };
    if (patch.soul !== undefined) {
      next.soulHash = soulHash(patch.soul);
      next.soulDrift = false;
    }
    // Persist all fields together before publishing anything to the live
    // record. A failed write leaves both memory and disk at the old profile.
    this.saveBots(this.bots.map((candidate) => candidate.id === id ? next : candidate));
    Object.assign(bot, next);
    if (patch.soul !== undefined) {
      try { writeSoulMirror(id, patch.soul); } catch (e) {
        console.warn(`[bot-folder] could not write SOUL.md mirror for ${id}: ${(e as Error).message}`);
      }
    }
    this.emit({ type: "bot", botId: id });
    return bot;
  }

  /** Convenience for a soul-only change. The record is canonical; a failed
   * mirror write is reported in logs and can be retried by discarding drift. */
  setSoul(id: string, soul: string): BotRecord | null {
    return this.patchBotProfile(id, { soul });
  }

  /** File visible bots into one sidebar section as a single durable write.
   *
   * This deliberately stages the complete next file before touching the
   * live records. A missing/hidden target therefore changes nothing, and a
   * failed atomic write cannot leave memory ahead of disk. A Primary Bot is
   * one per person, not per section, so any bot may move anywhere. */
  setBotsSection(
    botIds: string[],
    section: string,
  ): { ok: true; bots: BotRecord[] } | { ok: false; reason: "unavailable" } {
    const ids = [...new Set(botIds)];
    const targets = ids.map((id) => this.bot(id));
    if (targets.some((bot) => !bot || bot.hidden)) return { ok: false, reason: "unavailable" };

    const targetSection = sectionKey(section);
    const selected = targets as BotRecord[];

    const patches = new Map<string, Partial<BotRecord>>();
    for (const bot of selected) {
      patches.set(bot.id, { section: targetSection || undefined });
    }

    const changedIds = new Set<string>();
    const nextBots = this.bots.map((bot) => {
      const patch = patches.get(bot.id);
      if (!patch) return bot;
      const next = { ...bot, ...patch };
      if (JSON.stringify(next) !== JSON.stringify(bot)) changedIds.add(bot.id);
      return next;
    });
    if (changedIds.size) {
      this.saveBots(nextBots);
      for (const bot of this.bots) {
        const patch = patches.get(bot.id);
        if (patch) Object.assign(bot, patch);
      }
      for (const botId of changedIds) this.emit({ type: "bot", botId });
    }
    this.rememberSections([targetSection]);
    return { ok: true, bots: ids.map((id) => this.bot(id)!) };
  }

  /** Apply only the membership edits the user made, in one bots-file write. */
  updateTeamMembers(section: string, addIds: string[], removeIds: string[]):
    { ok: true; bots: BotRecord[] } | { ok: false; reason: "unavailable" | "membership-changed" } {
    const key = sectionKey(section);
    if (!key || !this.sections.includes(key)) return { ok: false, reason: "unavailable" };
    const adds = new Set(addIds), removes = new Set(removeIds);
    const ids = new Set([...adds, ...removes]);
    for (const id of ids) {
      const bot = this.bot(id);
      if (!bot || bot.hidden) return { ok: false, reason: "unavailable" };
      if (adds.has(id) && removes.has(id)) return { ok: false, reason: "membership-changed" };
      if (removes.has(id) && sectionKey(bot.section) !== key) return { ok: false, reason: "membership-changed" };
    }
    const next = this.bots.map(bot => ids.has(bot.id)
      ? { ...bot, section: adds.has(bot.id) ? key : undefined } : bot);
    if (ids.size) {
      this.saveBots(next);
      for (let i = 0; i < next.length; i++) if (ids.has(next[i].id)) Object.assign(this.bots[i], next[i]);
      for (const botId of ids) this.emit({ type: "bot", botId });
    }
    return { ok: true, bots: this.bots.filter(bot => ids.has(bot.id)) };
  }

  /** Legacy bot/room activity occupies its own slot; direct conversations
   * use setTaskActivity so settling one thread cannot clear another. */
  setActivity(botId: string, activity: BotActivity): BotRecord | null {
    const bot = this.bot(botId);
    if (!bot) return null;
    if ((this.legacyActivities.get(botId) ?? "idle") === activity) return bot;
    this.legacyActivities.set(botId, activity);
    this.refreshBotActivity(bot);
    this.emit({ type: "bot", botId });
    return bot;
  }

  setTaskActivity(botId: string, threadId: string, activity: BotActivity): BotRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    const busy = ACTIVITY_BUSY.has(activity);
    if ((task.activity ?? "idle") === activity && Boolean(task.busy) === busy) return bot;
    const wasBusy = Boolean(task.busy);
    task.activity = activity;
    task.busy = busy;
    if (busy && !wasBusy) task.turnStartedAt = Date.now();
    else if (!busy) delete task.turnStartedAt;
    // Reaching here means the thread just did something — exactly the
    // "activity" an until-activity snooze waits for, including settling
    // back to idle after a turn. Persist the wake like any task change.
    if (task.snoozedUntil === 0) {
      task.snoozedUntil = undefined;
      this.saveBots();
    }
    this.refreshBotActivity(bot);
    this.emit({ type: "bot", botId });
    return bot;
  }

  private refreshBotActivity(bot: BotRecord) {
    const { activity, busy } = this.activityOf(bot.id, () => true);
    bot.activity = activity;
    bot.busy = busy;
  }

  /** The bot-wide activity (the same fold as `bot.activity`/`bot.busy`)
   * over the threads `include` keeps, plus the bot's room activity. An
   * organization viewer gets it over their own threads only
   * (server/thread-privacy.ts), never over someone else's. */
  activityOf(botId: string, include: (task: TaskRecord) => boolean): { activity: BotActivity; busy: boolean } {
    const bot = this.bot(botId);
    const activities = [
      this.legacyActivities.get(botId),
      ...(bot?.tasks ?? [])
        .filter((task) => include(task) && !task.routineRunId)
        .map((task) => task.activity),
    ];
    const activity = (["waiting-on-you", "no-signal", "working", "dead"] as const)
      .find((candidate) => activities.includes(candidate)) ?? "idle";
    return { activity, busy: ACTIVITY_BUSY.has(activity) };
  }

  /** Who owns a bot, as one key per person. index.ts sets the server's own
   * rule (an unrecorded owner is the local operator); the default keeps a
   * bare store usable in tests: the recorded owner, else the operator. */
  botOwnerKey: (bot: BotRecord) => string = (bot) =>
    typeof bot.ownerUserId === "string" && bot.ownerUserId.trim() ? bot.ownerUserId.trim().toLowerCase() : "";

  /** The Primary Bot of the person who owns `id`, if any. */
  primaryBotOf(ownerKey: string): BotRecord | undefined {
    return this.bots.find((bot) => bot.chiefOfStaff && this.botOwnerKey(bot) === ownerKey);
  }

  /** Make one bot its owner's Primary Bot as one persisted change: every
   * other bot of the same person gives the role up (one per person, one on a
   * solo server). The changed records are returned so the server can update
   * every open window, including the bot that just handed the role over. */
  setPrimaryBot(id: string): BotRecord[] | null {
    const selected = this.bot(id);
    if (!selected) return null;
    const owner = this.botOwnerKey(selected);
    const changed: BotRecord[] = [];
    for (const bot of this.bots) {
      if (this.botOwnerKey(bot) !== owner) continue;
      const next = bot.id === id;
      if (Boolean(bot.chiefOfStaff) === next && !(next && bot.hidden)) continue;
      if (next) {
        bot.chiefOfStaff = true;
        // A person's main contact must stay reachable in the sidebar.
        bot.hidden = false;
      } else {
        bot.chiefOfStaff = false;
        delete bot.managedSections;
      }
      changed.push(bot);
    }
    if (changed.length) this.saveBots();
    for (const bot of changed) this.emit({ type: "bot", botId: bot.id });
    return changed;
  }

  /** Step this bot down from Primary Bot. The role is not handed to anyone
   * else. Managed teams belonged to the role, so they go with it. */
  clearPrimaryBot(id: string): BotRecord[] | null {
    const selected = this.bot(id);
    if (!selected) return null;
    if (!selected.chiefOfStaff) return [];
    selected.chiefOfStaff = false;
    delete selected.managedSections;
    this.saveBots();
    this.emit({ type: "bot", botId: selected.id });
    return [selected];
  }

  /** Leaders of an imported team (a package's leader, a backup's former
   * Chiefs of Staff). An import is additive: a person who has a Primary Bot
   * keeps it unchanged, and the leaders arrive as ordinary bots (the person
   * may make one primary, or give theirs the new team, in settings). A
   * person without one gets the first leader (General first) as Primary
   * Bot, with the teams the other imported leaders led as its managed teams. */
  adoptImportedLeaders(ids: readonly string[]): void {
    const leaders = ids.map((id) => this.bot(id)).filter((bot): bot is BotRecord => Boolean(bot));
    if (!leaders.length || this.primaryBotOf(this.botOwnerKey(leaders[0]!))) return;
    const keeper = leaders.find((bot) => !sectionKey(bot.section)) ?? leaders[0]!;
    this.setPrimaryBot(keeper.id);
    const reach = new Set<string>();
    for (const bot of leaders) {
      if (bot.id !== keeper.id && sectionKey(bot.section) !== sectionKey(keeper.section)) reach.add(sectionKey(bot.section));
    }
    if (reach.size) this.patchBot(keeper.id, { managedSections: [...reach].slice(0, 100) });
  }

  /** One-time migration from Chiefs of Staff (one per section) to Primary
   * Bots (one per person), idempotent so it can run at every boot. Each
   * person keeps one: their General (unsectioned) Primary Bot, else the first one.
   * The others step down, and the teams they led join the kept bot's
   * managed teams so coordination still reaches them. Returns the ids that
   * stepped down. */
  enforceOnePrimaryPerOwner(): string[] {
    const byOwner = new Map<string, BotRecord[]>();
    for (const bot of this.bots) {
      if (!bot.chiefOfStaff) continue;
      const owner = this.botOwnerKey(bot);
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), bot]);
    }
    const demoted: string[] = [];
    for (const chiefs of byOwner.values()) {
      if (chiefs.length < 2) continue;
      const kept = chiefs.find((bot) => !sectionKey(bot.section)) ??
        chiefs.reduce((oldest, bot) => ((bot.createdAt ?? 0) <= (oldest.createdAt ?? 0) ? bot : oldest)); // newest bots come first: ties go to the later (older) record
      const reach = new Set(kept.managedSections ?? []);
      for (const bot of chiefs) {
        if (bot === kept) continue;
        const led = sectionKey(bot.section);
        if (led !== sectionKey(kept.section)) reach.add(led);
        for (const section of bot.managedSections ?? []) if (sectionKey(section) !== sectionKey(kept.section)) reach.add(section);
        bot.chiefOfStaff = false;
        delete bot.managedSections;
        demoted.push(bot.id);
      }
      if (reach.size) kept.managedSections = [...reach].slice(0, 100);
    }
    if (demoted.length) {
      this.saveBots();
      for (const bot of this.bots) if (bot.chiefOfStaff || demoted.includes(bot.id)) this.emit({ type: "bot", botId: bot.id });
    }
    return demoted;
  }

  /** Company instance ids became stable across re-enrolment. Moves every
   * saved reference to an old id onto its replacement in one save: model
   * choices, native resume cursors and handed-message records. An entry that
   * already exists under the new id wins over the old one. */
  renameInstances(ids: ReadonlyMap<string, string>): number {
    const touches = (record?: Record<string, unknown>) => Boolean(record && Object.keys(record).some(key => ids.has(key)));
    const rename = <T>(record: Record<string, T>): Record<string, T> => {
      const next: Record<string, T> = {};
      for (const [key, value] of Object.entries(record)) {
        const target = ids.get(key);
        if (!target) next[key] = value;
        else if (!Object.prototype.hasOwnProperty.call(record, target)) next[target] = value;
      }
      return next;
    };
    const movedSelection = (selection: ModelSelection): ModelSelection | undefined => {
      const selected = ids.get(selection.instanceId);
      const fast = selection.fast && ids.get(selection.fast.instanceId);
      return selected || fast ? {
        ...selection,
        ...(selected ? { instanceId: selected } : {}),
        ...(fast && selection.fast ? { fast: { ...selection.fast, instanceId: fast } } : {}),
      } : undefined;
    };
    const changed: BotRecord[] = [];
    for (const bot of this.bots) {
      let dirty = false;
      const selected = movedSelection(bot.modelSelection);
      if (selected) { bot.modelSelection = selected; dirty = true; }
      if (touches(bot.resumeCursors)) { bot.resumeCursors = rename(bot.resumeCursors); dirty = true; }
      for (const task of bot.tasks ?? []) {
        const taskSelected = task.modelSelection && movedSelection(task.modelSelection);
        if (taskSelected) { task.modelSelection = taskSelected; dirty = true; }
        if (touches(task.resumeCursors)) { task.resumeCursors = rename(task.resumeCursors); dirty = true; }
        if (task.handedMessages && touches(task.handedMessages)) { task.handedMessages = rename(task.handedMessages); dirty = true; }
        const last = task.lastInstanceId && ids.get(task.lastInstanceId);
        if (last) { task.lastInstanceId = last; dirty = true; }
      }
      if (dirty) changed.push(bot);
    }
    if (changed.length) this.saveBots();
    for (const bot of changed) this.emit({ type: "bot", botId: bot.id });
    return changed.length;
  }

  /** The removed Computer engine's saved choices move to `replacement` in one
   * save: each bot's model, each conversation's own model, and its backups.
   * Native resume cursors and handed-message records of the removed engine go
   * too; the conversations stay, and the new engine reads them from the
   * transcript. Each conversation keeps working where it did: on Auto the
   * removed engine always ran on the bot's own cloud computer; no place is
   * written for that any more (Workspace is always Auto, 2026-10-18), and
   * Auto reaches that computer by itself where `keepCloud` says it is still
   * there. Where the new engine can't use a computer, an Auto-recorded cloud pin on
   * a moved conversation gives way, as on a Works on change
   * (clearAutoSurfacePins); a place the person chose stays chosen.
   * A level the new engine would have to confirm goes back to Ask, as on
   * every engine switch (modelSwitchNeedsAsk); a conversation that followed
   * the bot's level keeps the level it had. Every other setting is kept.
   * Nothing changes in memory until the save succeeds, so a failed save can
   * be tried again. Returns one entry per moved conversation, plus one for
   * the bot's open conversation when only the bot's own engine moved.
   * Idempotent: nothing left names the engine. */
  retireInstances(ids: ReadonlySet<string>, replacement: ModelSelection, options: {
    /** The replacement's driver kind, for the approval check. */
    driverKind?: string;
    /** The replacement can use a computer (canWorkOnCloud). Without one, a
     * bot on Auto stays on Auto: Works on Cloud would refuse every turn. */
    canWorkOnCloud: boolean;
    /** This bot, on Auto, reached its own cloud computer through the removed
     * engine and still can: a Boat account is set, its cloud backend is Boat,
     * and no team computer serves its section. */
    keepCloud: (bot: BotRecord) => boolean;
  }): ComputerEngineMove[] {
    const retired = (selection?: { instanceId: string }) => Boolean(selection && ids.has(selection.instanceId));
    const without = <T>(record: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !ids.has(key)));
    const touches = (record?: Record<string, unknown>) => Boolean(record && Object.keys(record).some(key => ids.has(key)));
    const needsAsk = (target: Parameters<typeof approvalModeFor>[0]) =>
      modelSwitchNeedsAsk(approvalModeFor(target), REMOVED_COMPUTER_DRIVER, options.driverKind);
    const askNow = { approvalMode: "ask" as const, autoApprove: false, alwaysAllow: [] as string[] };
    const changes: Array<{ bot: BotRecord; patch: Partial<BotRecord>; tasks: Partial<TaskRecord>[] }> = [];
    const moves: ComputerEngineMove[] = [];
    for (const bot of this.bots) {
      const patch: Partial<BotRecord> = {};
      const tasks = (bot.tasks ?? []).map((): Partial<TaskRecord> => ({}));
      const botMoved = retired(bot.modelSelection);
      let botAsk = false;
      if (botMoved) {
        if (needsAsk(bot)) { Object.assign(patch, structuredClone(askNow)); botAsk = true; }
        patch.modelSelection = structuredClone(replacement);
      }
      if (bot.fallback?.some(retired)) {
        const kept = bot.fallback.filter(candidate => !retired(candidate));
        patch.fallback = kept.length ? kept : undefined;
      }
      if (touches(bot.resumeCursors)) patch.resumeCursors = without(bot.resumeCursors);
      /** Where a conversation worked before the move (its own place, else
       * the bot's Works on, and on Auto the bot's own cloud computer where
       * keepCloud says so), and what the move did to that. */
      const cloudAfterMove = (pin: TaskRecord["surface"], pinSource: TaskRecord["surfaceSource"]): Pick<ComputerEngineMove, "cloud" | "noComputer"> => {
        const place = pin ?? bot.computer;
        const wasCloud = place === "cloud" || (place === undefined && options.keepCloud(bot));
        if (!wasCloud || options.canWorkOnCloud) return { cloud: wasCloud, noComputer: false };
        // An Auto-recorded pin gives way (below): only the person's place
        // or the bot's Works on can still send it to the cloud computer.
        const personPin = pin !== undefined && pinSource !== "auto";
        const still = personPin ? pin : bot.computer;
        return { cloud: false, noComputer: still !== "cloud" ? "auto" : personPin ? "pin" : "works-on" };
      };
      (bot.tasks ?? []).forEach((task, index) => {
        const taskPatch = tasks[index]!;
        // Read before anything changes: a conversation that follows the bot's
        // level has the bot's level here.
        const before = this.projectBotForTask(bot.id, task.threadId)!;
        // The bot's own level goes back to Ask, so a conversation that
        // followed it keeps the level it had (as switchTaskModel does).
        if (botAsk) {
          Object.assign(taskPatch, {
            approvalMode: before.approvalMode, autoApprove: before.autoApprove, alwaysAllow: structuredClone(before.alwaysAllow ?? []),
            approvalOwn: "engine" as const,
          });
        }
        // The engine this conversation ran on: its own, else the bot's.
        const moved = task.modelSelection ? retired(task.modelSelection) : botMoved;
        if (moved) {
          // No place is written for it: Workspace is always Auto
          // (2026-10-18), and Auto reaches the cloud computer by itself.
          // The machine's memory of where Auto landed: with no computer on
          // the new engine, the next turn would be refused there once.
          if (!options.canWorkOnCloud && task.surface === "cloud" && task.surfaceSource === "auto") {
            taskPatch.surface = undefined;
            taskPatch.surfaceSource = undefined;
          }
          const ask = needsAsk(before);
          if (ask) Object.assign(taskPatch, structuredClone(askNow), { approvalOwn: "engine" as const });
          if (task.modelSelection) taskPatch.modelSelection = structuredClone(replacement);
          const scope = botMoved && task.threadId === bot.threadId ? "bot" : "conversation";
          moves.push({ botId: bot.id, threadId: task.threadId, scope, ...cloudAfterMove(task.surface, task.surfaceSource),
            askNow: ask || (scope === "bot" && botAsk) });
        } else if (botMoved && task.threadId === bot.threadId) {
          // The bot's own engine and level moved, but its open conversation
          // has an engine of its own: it is still told, about the bot.
          moves.push({ botId: bot.id, threadId: task.threadId, scope: "bot-only", ...cloudAfterMove(undefined, undefined), askNow: botAsk });
        }
        if (touches(task.resumeCursors)) taskPatch.resumeCursors = without(task.resumeCursors);
        if (task.handedMessages && touches(task.handedMessages)) taskPatch.handedMessages = without(task.handedMessages);
      });
      if (Object.keys(patch).length || tasks.some(taskPatch => Object.keys(taskPatch).length)) changes.push({ bot, patch, tasks });
    }
    if (!changes.length) return moves;
    const next = new Map(changes.map(({ bot, patch, tasks }) => [bot, {
      ...bot, ...patch, tasks: bot.tasks?.map((task, index) => ({ ...task, ...tasks[index] })),
    }]));
    this.saveBots(this.bots.map(bot => next.get(bot) ?? bot));
    for (const { bot, patch, tasks } of changes) {
      bot.tasks?.forEach((task, index) => Object.assign(task, tasks[index]));
      Object.assign(bot, patch);
      this.emit({ type: "bot", botId: bot.id });
    }
    return moves;
  }

  setResumeCursor(botId: string, instanceId: string, cursor: unknown, threadId?: string) {
    const bot = this.bot(botId);
    if (!bot) return;
    // the cursor belongs to the task that produced it, not to the bot
    const task = threadId ? this.taskByThread(botId, threadId) : this.activeTask(botId);
    if (task) {
      task.resumeCursors[instanceId] = cursor;
      if (typeof cursor === "string" && cursor && !task.engineSessions?.includes(cursor)) {
        task.engineSessions = [...(task.engineSessions ?? []), cursor].slice(-ENGINE_SESSIONS_KEPT);
      }
    }
    // The legacy mirror follows the task visible in chat, never a detached
    // routine task working in the background.
    if (!threadId || bot.threadId === threadId) bot.resumeCursors[instanceId] = cursor;
    saveBotsFor("the conversation's engine session", () => this.saveBots());
    this.emit({ type: "bot", botId });
  }

  /** Record which instance just took a turn on this task. Called at
   * dispatch, not at cursor time — transcript-replay engines never
   * produce a cursor, and they still count as having run last. */
  markTaskDispatched(botId: string, threadId: string, instanceId: string) {
    const task = this.taskByThread(botId, threadId);
    if (!task || task.lastInstanceId === instanceId) return;
    task.lastInstanceId = instanceId;
    saveBotsFor("which engine has this conversation", () => this.saveBots());
  }

  setHandedMessages(botId: string, threadId: string, instanceId: string, state: HandedState) {
    const task = this.taskByThread(botId, threadId);
    if (!task || JSON.stringify(task.handedMessages?.[instanceId]) === JSON.stringify(state)) return;
    // Other instances keep a record only while it still describes their session.
    const live = Object.entries(task.handedMessages ?? {})
      .filter(([id, record]) => id !== instanceId && record.session !== undefined && record.session === task.resumeCursors[id]);
    task.handedMessages = { ...Object.fromEntries(live), [instanceId]: state };
    saveBotsFor("what this conversation handed its engine", () => this.saveBots());
  }

  /** Bank one settled turn onto its task. Called once per turn.completed;
   * the running per-driver token indicator is deliberately not used here
   * because its meaning differs by driver. */
  addTaskUsage(
    botId: string,
    threadId: string,
    turn: {
      input?: number; output?: number; cachedInput?: number; costUsd: number | null;
      context?: { tokens?: number; window?: number; promptBytes?: number; buckets?: NonNullable<TaskUsage["context"]>["buckets"] };
    },
  ): TaskUsage | null {
    const task = this.taskByThread(botId, threadId);
    if (!task) return null;
    const prev: TaskUsage = { input: 0, output: 0, costUsd: null, turns: 0, ...task.usage };
    const cost = typeof turn.costUsd === "number" && Number.isFinite(turn.costUsd) ? turn.costUsd : null;
    const prevCost = typeof prev.costUsd === "number" ? prev.costUsd : null;
    // providers occasionally report NaN or a negative on a partial turn —
    // never let that poison a running tally
    const clean = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
    // the cached share exists on a record only once a driver has reported
    // it — a driver that never does leaves the record shaped as before
    const cachedKnown = typeof prev.cachedInput === "number" || typeof turn.cachedInput === "number";
    const prevInput = clean(prev.input);
    const turnInput = clean(turn.input);
    const nextCachedInput = Math.min(clean(prev.cachedInput), prevInput)
      + Math.min(clean(turn.cachedInput), turnInput);
    const context = nextContext(prev.context, turn.context ?? {});
    task.usage = {
      input: prevInput + turnInput,
      output: prev.output + clean(turn.output),
      ...(cachedKnown ? { cachedInput: nextCachedInput } : {}),
      costUsd: cost === null ? prevCost : (prevCost ?? 0) + cost,
      turns: prev.turns + 1,
      lastTurn: {
        input: turnInput, output: clean(turn.output),
        ...(typeof turn.cachedInput === "number" ? { cachedInput: Math.min(clean(turn.cachedInput), turnInput) } : {}),
        costUsd: cost,
      },
      // a turn that reported no context keeps the previous reading rather
      // than pretending the window emptied. The prompt size, when this turn
      // measured one, rides on that reading.
      ...(context ? { context } : {}),
    };
    saveBotsFor("the thread's usage", () => this.saveBots());
    this.emit({ type: "bot", botId });
    return task.usage;
  }

  /** The folder a task's turn runs in. Pins on first call from the bot's
   * current folder — unless the task already has a session (a thread from
   * before folders existed), which pins to the default so the folder can't
   * move under it. Returns the pinned value: a path, or null for default. */
  /** Forget where a conversation works: its next turn pins it again
   * (pinTaskCwd). For a Cloud home's conversation a revoked session opened,
   * whose next turn must work in its own folder (server/cloud-owner.ts). */
  unpinTaskCwd(threadId: string): boolean {
    const bot = this.botByThread(threadId);
    const task = bot ? this.taskByThread(bot.id, threadId) : undefined;
    if (!bot || !task || task.cwd === undefined) return false;
    this.commitBotChange(bot, "the thread's folder", () => { delete task.cwd; });
    this.emit({ type: "bot", botId: bot.id });
    return true;
  }

  pinTaskCwd(botId: string, threadId: string, fallbackCwd?: string, opts: { none?: boolean; privateOnly?: boolean } = {}): string | null {
    const bot = this.bot(botId);
    const task = bot ? this.taskByThread(botId, threadId) : undefined;
    if (!bot || !task) return null;
    // Its own folder, never the bot's project folder (a Cloud home's guest
    // conversation), pinned when it first runs. A conversation that already
    // ran elsewhere keeps its pin: it was not opened that way, and moving it
    // would lose its work and its session.
    if (opts.privateOnly && task.cwd === undefined) {
      const cwd = fallbackCwd ?? null;
      this.commitBotChange(bot, "the thread's folder", () => { task.cwd = cwd; });
      this.emit({ type: "bot", botId });
      return cwd;
    }
    if (opts.none) {
      if (task.cwd !== null) {
        this.commitBotChange(bot, "the thread's folder", () => { task.cwd = null; });
        this.emit({ type: "bot", botId });
      }
      return null;
    }
    if (task.cwd !== undefined) return task.cwd;
    const cwd = Object.keys(task.resumeCursors).length === 0 ? (bot.cwd ?? fallbackCwd ?? null) : null;
    this.commitBotChange(bot, "the thread's folder", () => { task.cwd = cwd; });
    this.emit({ type: "bot", botId });
    return cwd;
  }

  /** The folder a room's member turns run in. Pins on the first turn that
   * dispatches, from the room's `cwd` at that moment. Pinned, not read
   * live, for the same reason tasks pin (see pinTaskCwd): engines key
   * their sessions and files to the folder a thread starts in, and a room
   * lives on ONE thread forever — so changing the room's folder applies to
   * future rooms, never under a room that already started working
   * somewhere. Returns the pinned value: a path, or null = each member's
   * own default. */
  pinGroupCwd(groupId: string, threadId?: string): string | null {
    const group = this.group(groupId);
    if (!group) return null;
    const task = threadId ? this.groupTaskByThread(groupId, threadId) : this.activeGroupTask(groupId);
    // Direct-message channels retain the original single-thread contract.
    if (!task) {
      if (!group.dm) return null;
      if (group.pinnedCwd === undefined) {
        group.pinnedCwd = group.cwd ?? null;
        this.saveGroups();
        this.emit({ type: "group", groupId: group.id });
      }
      return group.pinnedCwd;
    }
    if (task.pinnedCwd === undefined) {
      task.pinnedCwd = group.cwd ?? null;
      if (group.threadId === task.threadId) group.pinnedCwd = task.pinnedCwd;
      this.saveGroups();
      this.emit({ type: "group", groupId: group.id });
    }
    return task.pinnedCwd;
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  // ── folders: a bot's or a group's ───────────────────────────────────
  // One implementation for both owners (a bot, or a group such as a person
  // conversation); the owner only decides where it is saved and announced.
  private folderOwner(owner: { botId: string } | { groupId: string }): {
    record: { projects?: BotProjectRecord[]; tasks?: Array<{ projectId?: string }> };
    commit: () => void;
  } | null {
    if ("botId" in owner) {
      const bot = this.bot(owner.botId);
      return bot ? { record: bot, commit: () => { this.saveBots(); this.emit({ type: "bot", botId: owner.botId }); } } : null;
    }
    const group = this.group(owner.groupId);
    if (!group || group.dm) return null;
    return { record: group, commit: () => { this.saveGroups(); this.emit({ type: "group", groupId: owner.groupId }); } };
  }

  private ownerFolder(owner: { botId: string } | { groupId: string }, projectId: string): BotProjectRecord | undefined {
    return this.folderOwner(owner)?.record.projects?.find((project) => project.id === projectId);
  }

  private createOwnerFolder(owner: { botId: string } | { groupId: string }, name: string, emoji?: string | null): BotProjectRecord | null {
    const found = this.folderOwner(owner);
    if (!found || !name.trim() || (emoji != null && !isProjectEmoji(emoji))) return null;
    const project: BotProjectRecord = {
      id: newId(), name: name.trim().slice(0, 80),
      ...(emoji == null ? {} : { emoji }),
    };
    found.record.projects = [...(found.record.projects ?? []), project];
    found.commit();
    return project;
  }

  private patchOwnerFolder(owner: { botId: string } | { groupId: string }, projectId: string, patch: { name?: string; emoji?: string | null }): BotProjectRecord | null {
    const found = this.folderOwner(owner);
    const project = this.ownerFolder(owner, projectId);
    if (!found || !project || (patch.name !== undefined && !patch.name.trim()) || (patch.emoji != null && !isProjectEmoji(patch.emoji))) return null;
    if (patch.name !== undefined) project.name = patch.name.trim().slice(0, 80);
    if (patch.emoji === null) delete project.emoji;
    else if (patch.emoji !== undefined) project.emoji = patch.emoji;
    found.commit();
    return project;
  }

  private reorderOwnerFolders(owner: { botId: string } | { groupId: string }, projectIds: string[]): BotProjectRecord[] | null {
    const found = this.folderOwner(owner);
    const projects = found?.record.projects ?? [];
    if (!found || projectIds.length !== projects.length || new Set(projectIds).size !== projects.length) return null;
    const byId = new Map(projects.map((project) => [project.id, project]));
    if (projectIds.some((id) => !byId.has(id))) return null;
    found.record.projects = projectIds.map((id) => byId.get(id)!);
    found.commit();
    return found.record.projects;
  }

  /** Removing an organizational label never removes its conversations. */
  private deleteOwnerFolder(owner: { botId: string } | { groupId: string }, projectId: string): boolean {
    const found = this.folderOwner(owner);
    if (!found || !this.ownerFolder(owner, projectId)) return false;
    found.record.projects = found.record.projects!.filter((project) => project.id !== projectId);
    for (const task of found.record.tasks ?? []) {
      if (task.projectId === projectId) delete task.projectId;
    }
    found.commit();
    return true;
  }

  project(botId: string, projectId: string): BotProjectRecord | undefined {
    return this.ownerFolder({ botId }, projectId);
  }

  createProject(botId: string, name: string, emoji?: string | null): BotProjectRecord | null {
    return this.createOwnerFolder({ botId }, name, emoji);
  }

  patchProject(botId: string, projectId: string, patch: { name?: string; emoji?: string | null }): BotProjectRecord | null {
    return this.patchOwnerFolder({ botId }, projectId, patch);
  }

  /** The stored array is the sidebar order; only a full owned permutation is valid. */
  reorderProjects(botId: string, projectIds: string[]): BotProjectRecord[] | null {
    return this.reorderOwnerFolders({ botId }, projectIds);
  }

  /** Removing an organizational label never removes its conversations. */
  deleteProject(botId: string, projectId: string): BotRecord | null {
    return this.deleteOwnerFolder({ botId }, projectId) ? this.bot(botId) ?? null : null;
  }

  /** A group's folders (a person conversation's): the same as a bot's. */
  groupProject(groupId: string, projectId: string): BotProjectRecord | undefined {
    return this.ownerFolder({ groupId }, projectId);
  }

  createGroupProject(groupId: string, name: string, emoji?: string | null): BotProjectRecord | null {
    return this.createOwnerFolder({ groupId }, name, emoji);
  }

  patchGroupProject(groupId: string, projectId: string, patch: { name?: string; emoji?: string | null }): BotProjectRecord | null {
    return this.patchOwnerFolder({ groupId }, projectId, patch);
  }

  reorderGroupProjects(groupId: string, projectIds: string[]): BotProjectRecord[] | null {
    return this.reorderOwnerFolders({ groupId }, projectIds);
  }

  deleteGroupProject(groupId: string, projectId: string): GroupRecord | null {
    return this.deleteOwnerFolder({ groupId }, projectId) ? this.group(groupId) ?? null : null;
  }

  /** The first thing the human asked in a thread — a task's natural name. */
  private firstUserLine(threadId: string): string | null {
    const first = this.messagesFor(threadId).find((m) => m.role === "user" && m.kind === "text" && m.text?.trim());
    return first?.text ? titleFromMessage(first.text) : null;
  }

  tasks(botId: string): TaskRecord[] {
    return this.bot(botId)?.tasks ?? [];
  }

  activeTask(botId: string): TaskRecord | undefined {
    const bot = this.bot(botId);
    return bot?.tasks?.find((t) => t.threadId === bot.threadId);
  }

  taskByThread(botId: string, threadId: string): TaskRecord | undefined {
    return this.bot(botId)?.tasks?.find((t) => t.threadId === threadId);
  }

  /** The thread `fromBotId` opened on this bot from its conversation
   * `fromThreadId` with coordinate_bots: one per conversation and teammate,
   * so whatever that conversation sends later continues it. A thread the
   * person archived is left alone. */
  workThread(botId: string, fromBotId: string, fromThreadId: string): TaskRecord | undefined {
    // A work thread its person made confidential takes no more work: the
    // next request opens a new one (docs/confidential-threads.md).
    return this.tasks(botId).find((t) => t.openedBy?.kind === "work" && t.openedBy.botId === fromBotId &&
      t.openedBy.threadId === fromThreadId && t.archivedAt === undefined && t.confidential !== true);
  }

  /** A turn gets an independent snapshot without changing the selected task
   * or mutating the bot's defaults while another turn is running. */
  projectBotForTask(botId: string, threadId: string): BotRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    return {
      ...bot,
      threadId: task.threadId,
      approvalGrant: bot.approvalGrant?.threadOnly && bot.approvalGrant.threadId !== threadId ? undefined : bot.approvalGrant,
      modelSelection: structuredClone(task.modelSelection ?? bot.modelSelection),
      resumeCursors: structuredClone(task.resumeCursors),
      // #1169/#1170: the bot's current level, live, unless this thread holds
      // a deliberate exception (approvalOwn). Nothing is copied at creation.
      ...threadApprovalFields(bot, task),
      unread: Boolean(task.unread),
      rewound: task.rewound,
      pinnedMessageId: task.pinnedMessageId,
      activity: task.activity ?? "idle",
      busy: Boolean(task.busy),
    };
  }

  patchTask(botId: string, threadId: string, patch: TaskPatch): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    if (patch.projectId !== undefined && !this.project(botId, patch.projectId)) return null;
    // A revocation (a narrower approval level, fewer always-allowed tools)
    // stays live when its save fails; a widening never does.
    // A level written on one thread is a deliberate exception to its bot's
    // (#1169/#1170): it says so, else the next load would make it follow the
    // bot again. `approvalOwn: undefined` makes the thread follow its bot.
    const setsLevel = Object.hasOwn(patch, "approvalMode") || Object.hasOwn(patch, "autoApprove");
    if (setsLevel && !Object.hasOwn(patch, "approvalOwn")) patch = { ...patch, approvalOwn: "thread" };
    const follows = Object.hasOwn(patch, "approvalOwn") && patch.approvalOwn === undefined;
    if (follows) patch = { ...patch, approvalMode: undefined, autoApprove: undefined };
    const revocation = keptRevocation(task, patch);
    this.commitBotChange(bot, "the thread change", () => {
      for (const key of TASK_PATCH_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          Object.assign(task, { [key]: structuredClone(patch[key]) });
        }
      }
      if (follows) {
        delete task.approvalMode;
        delete task.autoApprove;
        delete task.approvalOwn;
      }
      // "Until new activity" ends the moment the thread has something new for
      // the person, and every unread wake funnels through patchTask, so this
      // one hook is the whole activity alarm. A time-based snooze is left to
      // its clock: attention overrides it on screen without clearing it.
      if (task.snoozedUntil === 0 && patch.unread === true) task.snoozedUntil = undefined;
      if (typeof patch.title === "string") task.title = patch.title.trim().slice(0, 80) || UNTITLED_THREAD;
      if (Object.prototype.hasOwnProperty.call(patch, "pinned") && task.pinned !== true) delete task.pinned;
      // Still hidden: attention belongs on the source conversation. A same-call
      // clear of routineRunId (no-source promotion) may keep unread.
      if (task.routineRunId || task.hidden === true) task.unread = false;
      if (bot.threadId === threadId) this.mirrorActiveTask(bot, task);
      bot.unread = botHasPersonUnread(bot);
    }, revocation && (() => Object.assign(task, revocation)));
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Queue wait and time to first text, on the conversation. Not a message. */
  noteConversationTiming(threadId: string, timing: { queueMs?: number; firstResponseMs?: number }): void {
    const queueMs = wholeMs(timing.queueMs);
    const firstResponseMs = wholeMs(timing.firstResponseMs);
    if (queueMs === undefined && firstResponseMs === undefined) return;
    const merge = (current: { queueMs?: number; firstResponseMs?: number } | undefined) => {
      const next = {
        ...(current?.queueMs !== undefined ? { queueMs: current.queueMs } : {}),
        ...(current?.firstResponseMs !== undefined ? { firstResponseMs: current.firstResponseMs } : {}),
        ...(queueMs !== undefined ? { queueMs } : {}),
        ...(firstResponseMs !== undefined ? { firstResponseMs } : {}),
      };
      if (next.queueMs === current?.queueMs && next.firstResponseMs === current?.firstResponseMs) return null;
      return next;
    };
    const bot = this.botByThread(threadId);
    if (bot && this.taskByThread(bot.id, threadId)) {
      const next = merge(this.taskByThread(bot.id, threadId)?.turnTiming);
      if (next) this.patchTask(bot.id, threadId, { turnTiming: next });
      return;
    }
    const group = this.groupByThread(threadId);
    if (!group) return;
    if (this.groupTaskByThread(group.id, threadId)) {
      const next = merge(this.groupTaskByThread(group.id, threadId)?.turnTiming);
      if (next) this.patchGroupTask(group.id, threadId, { turnTiming: next });
      return;
    }
    const next = merge(group.turnTiming);
    if (!next) return;
    group.turnTiming = next;
    this.saveGroups();
    this.emit({ type: "group", groupId: group.id });
  }

  suggestTaskLink(botId: string, threadId: string, text: string): TaskRecord | null {
    const url = lastChangeRequestUrl(text);
    const task = this.taskByThread(botId, threadId);
    if (!url || !task || task.linkAuto === false || (task.link && !task.linkAuto) || task.link === url) return null;
    return this.patchTask(botId, threadId, { link: url, linkAuto: true });
  }

  /** A Local VM or the browser on Works on goes back to Auto, and every
   * conversation pin goes, whoever set it. This computer and the cloud
   * computer stay. Off stays: it withholds
   * every screen, and lifting it would widen what the bot may reach.
   * Levels are never touched (#1098, 2026-10-27): the one-time move of
   * 2026-10-18 that put a bot or a conversation kept off this computer back
   * on Ask, emptied its Always allow list and dropped its prepared grant has
   * run on every install that had such a place; it is not replayed, so a
   * place an older client or a restored file brings back never costs the
   * person the level and the list they chose. A new install has no place
   * to move. Idempotent; one save when anything changed. */
  retireFixedWorkspaces(): { bots: number; pins: number } {
    let bots = 0;
    let pins = 0;
    const touched = new Set<string>();
    for (const bot of this.bots) {
      for (const task of bot.tasks ?? []) {
        if (task.surface === undefined && task.surfaceSource === undefined) continue;
        if (task.surface !== undefined) pins++;
        delete task.surface;
        delete task.surfaceSource;
        touched.add(bot.id);
      }
      if (bot.computer !== undefined && autoOnlyDestination(bot.computer) === undefined) {
        delete bot.computer;
        bots++;
        touched.add(bot.id);
      }
    }
    if (!touched.size) return { bots, pins };
    this.saveBots();
    for (const botId of touched) this.emit({ type: "bot", botId });
    return { bots, pins };
  }

  /** A Works on change is the newest explicit choice, so this bot's
   * machine-recorded pins that now point somewhere else give way. A pin a
   * person set, a legacy pin with unknown provenance, and a pin that already
   * matches the new destination survive. Returns how many pins were cleared. */
  clearAutoSurfacePins(botId: string, destination: Destination): number {
    const bot = this.bot(botId);
    const stale = bot?.tasks?.filter((task) => task.surface !== undefined && task.surfaceSource === "auto" && task.surface !== destination) ?? [];
    if (!bot || !stale.length) return 0;
    this.commitBotChange(bot, "the threads' destinations", () => {
      for (const task of stale) {
        task.surface = undefined;
        task.surfaceSource = undefined;
      }
    });
    this.emit({ type: "bot", botId });
    return stale.length;
  }

  /** A person picks a model in one thread, and with updateBotDefault makes it
   * the bot's model too. A thread on its bot's model follows the bot: it
   * keeps no model of its own. Model/provider changes are one configuration
   * transaction: never publish a new provider before its confirmed approval
   * downgrade, or change the default while leaving the selected thread
   * behind after a write failure. */
  switchTaskModel(botId: string, threadId: string, selection: ModelSelection,
    updateBotDefault: boolean, taskPatch: TaskPatch = {}): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    const own = sameModelSelection(selection, updateBotDefault ? selection : bot.modelSelection) ? undefined : structuredClone(selection);
    // A level written with a model switch (Ask again on a new engine) is this
    // thread's exception to its bot's level (#1169/#1170).
    if ((Object.hasOwn(taskPatch, "approvalMode") || Object.hasOwn(taskPatch, "autoApprove")) && !Object.hasOwn(taskPatch, "approvalOwn")) {
      taskPatch = { ...taskPatch, approvalOwn: "engine" };
    }
    const nextTask = persistedPin({ ...task, ...taskPatch, modelSelection: own,
      ...(typeof taskPatch.title === "string" ? { title: taskPatch.title.trim().slice(0, 80) || UNTITLED_THREAD } : {}) });
    // 2026-10-30: a model picked for this bot applies to every thread,
    // including earlier thread-specific picks. Permission levels stay.
    const others = updateBotDefault ? bot.tasks!.map(withoutModel) : bot.tasks!;
    const nextTasks = bot.tasks!.map((candidate, index) => candidate === task ? nextTask : others[index]!);
    const botPatch = updateBotDefault ? { modelSelection: structuredClone(selection) } : {};
    this.saveBots(this.bots.map((candidate) => candidate === bot ? { ...bot, ...botPatch, tasks: nextTasks } : candidate));
    bot.tasks!.forEach((candidate, index) => {
      Object.assign(candidate, nextTasks[index]);
      // a copy of the old default was dropped (withDefaultModel): drop it here too
      if (!("modelSelection" in nextTasks[index]!)) delete candidate.modelSelection;
    });
    Object.assign(bot, botPatch);
    this.emit({ type: "bot", botId });
    return task;
  }

  /** These threads follow their bot's model again: each one's own model is
   * cleared ("Switch them too", "Use the bot's model", or a model that can't
   * run here). The level of each stays as it is, and `reset` adds what a changed model
   * needs (a hosted workspace's fresh session). One write. Returns the
   * threads that changed; a listed thread that already follows stays as it is. */
  followBotModel(botId: string, threadIds: readonly string[],
    reset: (from: ModelSelection, to: ModelSelection) => Partial<TaskRecord> = () => ({})): string[] {
    const bot = this.bot(botId);
    if (!bot?.tasks) return [];
    const listed = new Set(threadIds);
    const patches = bot.tasks.map((task): Partial<TaskRecord> | null => !listed.has(task.threadId) || task.modelSelection === undefined ? null : {
      ...reset(task.modelSelection, bot.modelSelection),
      modelSelection: undefined,
    });
    const moved = bot.tasks.filter((_, index) => patches[index]).map((task) => task.threadId);
    if (!moved.length) return [];
    const nextTasks = bot.tasks.map((task, index) => patches[index] ? { ...task, ...patches[index] } : task);
    this.saveBots(this.bots.map((candidate) => candidate === bot ? { ...bot, tasks: nextTasks } : candidate));
    bot.tasks.forEach((task, index) => { if (patches[index]) Object.assign(task, patches[index]); });
    const active = bot.tasks.find((task) => task.threadId === bot.threadId);
    if (active) this.mirrorActiveTask(bot, active);
    this.emit({ type: "bot", botId });
    return moved;
  }

  /** One durable write: never leave only part of a bot's threads updated. */
  setAllThreadApprovalMode(botId: string, mode: "full" | "ask"): BotRecord | null {
    const bot = this.bot(botId);
    if (!bot) return null;
    const patch = { approvalMode: mode, autoApprove: false, alwaysAllow: [] };
    // Every thread follows the bot again: no copy, no exception left.
    const tasks = (bot.tasks ?? []).map(task => followingBot({ ...task, alwaysAllow: [] }));
    const next = { ...bot, ...patch, approvalGrant: undefined, tasks };
    this.saveBots(this.bots.map(candidate => candidate === bot ? next : candidate));
    bot.tasks?.forEach((task, index) => {
      delete task.approvalMode;
      delete task.autoApprove;
      delete task.approvalOwn;
      Object.assign(task, tasks[index]);
    });
    Object.assign(bot, patch, { approvalGrant: undefined });
    this.emit({ type: "bot", botId });
    return bot;
  }

  /** Copy this bot's saved approval level and standing approvals onto one
   * thread. A new thread already gets them; this is how an existing
   * conversation catches up. Other threads, the transcript, and the bot
   * default stay put. A grant that has not committed yet is ignored, so a
   * refresh cannot copy the temporary Ask mask. */
  refreshTaskPermissions(botId: string, threadId: string): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    // #1169: a thread follows its bot, so catching up means dropping its
    // own exception and copied approvals, never copying the bot's level.
    if (!isApprovalException(task.approvalOwn) && task.approvalMode === undefined && task.autoApprove === undefined && !(task.alwaysAllow ?? []).length) return task;
    return this.patchTask(botId, threadId, { approvalOwn: undefined, alwaysAllow: [] });
  }

  private mirrorActiveTask(bot: BotRecord, task: TaskRecord) {
    bot.threadId = task.threadId;
    bot.resumeCursors = structuredClone(task.resumeCursors);
    bot.rewound = task.rewound;
    bot.pinnedMessageId = task.pinnedMessageId;
  }

  /** A fresh context on the same bot: new thread, new session, same
   * persona/tools/computer. Becomes the active task. It follows the bot's
   * model unless the caller hands it another one: a thread opened from
   * another of this bot's threads keeps the model a person picked there. */
  createTask(botId: string, title?: string, activate = true, projectId?: string, openedBy?: TaskOpenedBy, approvalMode?: "ask" | "full",
    ownerPrincipalId?: string, modelSelection?: ModelSelection, hidden = false, cwd?: string, confidential = false, approvalOwn?: ApprovalException): TaskRecord | null {
    const bot = this.bot(botId);
    if (!bot) return null;
    if (projectId !== undefined && !this.project(botId, projectId)) return null;
    // An AI client's hidden conversation (#291) is never selected.
    if (hidden) activate = false;
    const task = this.buildTask(bot, title, projectId, openedBy, approvalMode, ownerPrincipalId, modelSelection, hidden, cwd, confidential, approvalOwn);
    this.commitBotChange(bot, "the new thread", () => {
      bot.tasks = [task, ...(bot.tasks ?? [])];
      if (activate) this.mirrorActiveTask(bot, task);
    });
    this.emit({ type: "bot", botId });
    return task;
  }

  /** A new task record, not yet in the bot's list. */
  private buildTask(bot: BotRecord, title?: string, projectId?: string, openedBy?: TaskOpenedBy, approvalMode?: "ask" | "full",
    ownerPrincipalId?: string, modelSelection?: ModelSelection, hidden = false, cwd?: string, confidential = false, approvalOwn?: ApprovalException): TaskRecord {
    const createdAt = Date.now();
    return {
      threadId: newId(),
      title: threadTitleFrom(title),
      createdAt,
      updatedAt: createdAt,
      // Only a new task can receive an explicit working folder. The HTTP
      // caller validates it; subsequent turns use the existing pin unchanged.
      ...(cwd !== undefined ? { cwd } : {}),
      ...(projectId ? { projectId } : {}),
      ...(openedBy ? { openedBy: structuredClone(openedBy) } : {}),
      // Set with the task, never after: a thread is never briefly someone else's.
      ...(ownerPrincipalId?.trim() ? { ownerPrincipalId: ownerPrincipalId.trim().toLowerCase() } : {}),
      resumeCursors: {},
      ...(modelSelection && !sameModelSelection(modelSelection, bot.modelSelection) ? { modelSelection: structuredClone(modelSelection) } : {}),
      // #1169/#1170: a new thread follows its bot's level live; it stores a
      // level only when its creator chose one for it on purpose.
      ...(approvalMode ? { approvalMode, autoApprove: false, alwaysAllow: [], approvalOwn: approvalOwn ?? "thread" } : {}),
      unread: false,
      activity: "idle",
      busy: false,
      ...(hidden ? { hidden: true as const } : {}),
      // Set with the task, never after the first message: a confidential
      // thread is never briefly an ordinary one.
      ...(confidential ? { confidential: true as const } : {}),
    };
  }

  /** Hide (or show again) an AI client's conversation (#291). A hidden
   * thread is never unread, and never stays the bot's selected thread: the
   * newest visible one takes its place. Never reachable from the HTTP task
   * PATCH: hidden is not a TASK_PATCH_FIELD. */
  setTaskHidden(botId: string, threadId: string, hidden: boolean): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    this.commitBotChange(bot, "the thread's visibility", () => {
      if (hidden) {
        task.hidden = true;
        task.unread = false;
      } else {
        delete task.hidden;
      }
      if (hidden && bot.threadId === threadId) {
        const at = (candidate: TaskRecord) => candidate.updatedAt ?? candidate.createdAt;
        const next = (bot.tasks ?? [])
          .filter((candidate) => !taskHiddenFromPerson(candidate) && candidate.archivedAt === undefined)
          .sort((a, b) => at(b) - at(a))[0];
        if (next) this.mirrorActiveTask(bot, next);
      }
      bot.unread = botHasPersonUnread(bot);
      this.refreshBotActivity(bot);
    });
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Organization server, once (server/thread-privacy.ts migration): give
   * each listed thread its owner. Never reachable from the HTTP task PATCH:
   * ownerPrincipalId is not a TASK_PATCH_FIELD. Returns how many bots changed. */
  assignTaskOwners(assignments: readonly { botId: string; threadId: string; ownerPrincipalId: string }[]): number {
    const touched = new Set<string>();
    for (const entry of assignments) {
      const task = this.taskByThread(entry.botId, entry.threadId);
      const owner = entry.ownerPrincipalId.trim().toLowerCase();
      if (!task || !owner || task.ownerPrincipalId === owner) continue;
      task.ownerPrincipalId = owner;
      touched.add(entry.botId);
      // its content key follows its owner, everything re-sealed now
      // (docs/content-encryption.md): the old owner's erasure never takes it
      mdb.contentOwnerChanged([entry.threadId]);
    }
    if (!touched.size) return 0;
    this.saveBots();
    for (const botId of touched) this.emit({ type: "bot", botId });
    return touched.size;
  }

  /** Attach (or complete) the opener record after the thread exists — the
   * handoff id is only known once the thread it targets has an id, so a
   * peer-opened thread is created first and stamped second. Never reachable
   * from the HTTP task PATCH: openedBy is not a TASK_PATCH_FIELD. */
  setTaskOpenedBy(botId: string, threadId: string, openedBy: TaskOpenedBy): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    this.commitBotChange(bot, "who opened the thread", () => { task.openedBy = structuredClone(openedBy); });
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Link (or update the link of) a parallel task to the conversation it
   * answers (shared/parallel-tasks.ts). Never reachable from the HTTP task
   * PATCH: parallelOf is not a TASK_PATCH_FIELD. */
  setTaskParallelOf(botId: string, threadId: string, parallelOf: TaskParallelOf): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    this.commitBotChange(bot, "the thread's link to its conversation", () => { task.parallelOf = structuredClone(parallelOf); });
    this.emit({ type: "bot", botId });
    return task;
  }

  /** A person wrote in this thread at `at` (startTurn and a steer decide
   * who is one). Never moves back, and never reachable from the HTTP task
   * PATCH: askedAt is not a TASK_PATCH_FIELD. */
  setTaskAskedAt(botId: string, threadId: string, at: number): TaskRecord | null {
    const task = this.taskByThread(botId, threadId);
    if (!task || !Number.isFinite(at) || (task.askedAt ?? -1) >= at) return task ?? null;
    task.askedAt = at;
    saveBotsFor("when you last wrote in this thread", () => this.saveBots());
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Stamp or clear the closer record. `null` reopens: the next turn in a
   * closed thread calls this so the row comes back to the sidebar. Never
   * reachable from the HTTP task PATCH: closedBy is not a TASK_PATCH_FIELD. */
  setTaskClosedBy(botId: string, threadId: string, closedBy: TaskClosedBy | null): TaskRecord | null {
    const bot = this.bot(botId);
    const task = this.taskByThread(botId, threadId);
    if (!bot || !task) return null;
    if (!closedBy && !task.closedBy) return task;
    this.commitBotChange(bot, "who closed the thread", () => {
      if (closedBy) task.closedBy = structuredClone(closedBy);
      else delete task.closedBy;
    });
    this.emit({ type: "bot", botId });
    return task;
  }

  switchTask(botId: string, threadId: string): BotRecord | null {
    const bot = this.bot(botId);
    const task = bot?.tasks?.find((t) => t.threadId === threadId);
    if (!bot || !task) return null;
    this.commitBotChange(bot, "the thread switch", () => this.mirrorActiveTask(bot, task));
    this.emit({ type: "bot", botId });
    return bot;
  }

  renameTask(botId: string, threadId: string, title: string): TaskRecord | null {
    return this.patchTask(botId, threadId, { title });
  }

  /** Name a task after its first message, once. Returns the task it named
   * so a caller can later replace exactly that machine-made title — and
   * can see the peer provenance it must leave alone. */
  titleTaskFromFirstMessage(botId: string, text: string, threadId?: string): TaskRecord | null {
    const bot = this.bot(botId);
    const task = threadId ? this.taskByThread(botId, threadId) : this.activeTask(botId);
    if (!bot || !task || task.titleFromFirstMessage || (task.title !== UNTITLED_TASK && task.title !== UNTITLED_THREAD)) return null;
    this.commitBotChange(bot, "the thread's title", () => {
      task.title = titleFromMessage(text);
      task.titleFromFirstMessage = true;
    });
    this.emit({ type: "bot", botId });
    return task;
  }

  /** Swap a machine-made first-message title for a generated one, once.
   * Equality against the snippet is the whole contract: a rename by the
   * person, by pair adoption, or by an earlier generated title each break
   * it, so this never overwrites a name anyone chose. Regenerate title passes
   * the title it started from, so a rename made while it ran stands. */
  retitleTask(botId: string, threadId: string, machineTitle: string, title: string): TaskRecord | null {
    const task = this.taskByThread(botId, threadId);
    if (!task || task.title !== machineTitle) return null;
    return this.renameTask(botId, threadId, threadTitleFrom(title));
  }

  /** Delete a task and its transcript, retaining generated project files.
   * When no visible tasks remain, replace it with a fresh conversation. */
  deleteTask(botId: string, threadId: string): BotRecord | null {
    const bot = this.bot(botId);
    if (!bot?.tasks) return null;
    if (!bot.tasks.some((t) => t.threadId === threadId)) return null;
    // The transcript rows and bots.json commit together: either failing
    // leaves the task, its conversation and every subscriber as they were.
    this.deleteThreadRecord(threadId, () => this.commitBotChange(bot, "the thread deletion", () => {
      const kept = bot.tasks!.filter((t) => t.threadId !== threadId);
      const visible = nextOpenThread(kept) ?? this.buildTask(bot);
      bot.tasks = kept.includes(visible) ? kept : [visible, ...kept];
      if (bot.threadId === threadId || this.taskByThread(botId, bot.threadId)?.routineRunId) {
        this.mirrorActiveTask(bot, visible);
      }
      bot.unread = botHasPersonUnread(bot);
      this.refreshBotActivity(bot);
    }));
    this.emit({ type: "bot", botId });
    return bot;
  }

  /** A first run: no bot yet, so seedIfEmpty makes one. An unreadable
   * bots.json is not empty (#1712): refuse seed so the file stays intact. */
  needsSeed() {
    return !this.botsUnreadable && this.bots.length === 0;
  }

  /** First-run seed: one bot so the app never opens empty — it gets a
   * random friendly name like every other bot. */
  seedIfEmpty() {
    if (!this.needsSeed()) return;
    this.createBot();
  }
}

/** A thread without its own model: it follows its bot's. */
function withoutModel(task: TaskRecord): TaskRecord {
  const { modelSelection: _copy, ...rest } = task;
  return rest;
}
