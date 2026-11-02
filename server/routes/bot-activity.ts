// GET /api/bots/:id/activity: what the bot is doing and did lately, for its
// side panel (Details > Coding), and GET /api/bots/:id/activity/item for one
// entry's detail (its tool steps, files, sub-agents, engine and payer).
// Read-only; built from the bot's threads, the work bots hand each other
// (room handoffs, delegations) and its routine runs.
//
// Each thread entry is read for its newest turn: the turn the person's
// newest line started (a Regenerate forks that line beside the first try).
// It says whether that turn is coding work (`coding`,
// server/activity-coding.ts: read off its tool calls and folder, never its
// title; a conversation whose folder is a repository is a coding job as a
// whole), so the panel lists coding jobs under Coding and everything else
// under Activity. An ordinary conversation is never Coding for what an
// earlier turn did (2026-10-29: a Retry in a bot's main chat, a routine
// listing, showed under Coding with its old git work). Its title is that
// turn's request once the conversation has more than one; its detail lists
// that turn's steps, files and sub-agents only (older steps stay in the
// conversation, older sub-agents in the list's `subagents`). An entry with
// code work anywhere in its window also carries it (`code`,
// server/activity-code-work.ts: repository, branch, and the pull requests,
// branches and commits its calls produced). `?filter=coding|other` narrows
// the list the same way, and the list also carries `subagents`: the
// sub-agents its listed threads started, running or recent.
//
// Authorization (shared/bot-activity.ts): the gate in index.ts already hides
// a bot the viewer cannot see. Here every thread passes `threadReadable`
// (on an organization server: the viewer's own threads only), every routine
// run `runSeen` (routineSeenBy: the person it runs as, the bot's owner, or
// anyone holding the run level), and a sub-agent's conversation on another
// bot is linked only when that thread is readable too. A run seen without
// its thread lists no steps and no thread. A failed run's access card
// (`runAccessCard`) reaches the card's audience only: the bot's owner reads
// the card of a run refused on their credentials even when the run's thread
// is another person's private one, and nothing else of that thread.
import type { RequestAuth } from "../request-auth.ts";
import type { WireAccessCard } from "../../shared/wire.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import {
  BOT_ACTIVITY_LIMIT,
  BOT_ACTIVITY_STEPS,
  BOT_ACTIVITY_WINDOW_MS,
  activityStatusActive,
  type BotActivityActor,
  type BotActivityDetail,
  type BotActivityItem,
  type BotActivityStatus,
  type BotActivityStep,
  type BotCodeWork,
} from "../../shared/bot-activity.ts";
import type { BotLaunchedAgentItem } from "../../shared/bot-launched-agents.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { addCodingSignal, isCodingWork, type CodingSignals } from "../activity-coding.ts";
import { CodeWorkCollector, type RepositoryInfo } from "../activity-code-work.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import { cloudAgentActivityItem } from "../cloud-agents/activity.ts";
import { cloudAgentStatusActive, type CloudAgentRecord } from "../../shared/cloud-agents.ts";

export interface ActivityBot {
  id: string;
  name: string;
  modelSelection?: { instanceId: string; model: string } | null;
}

export interface ActivityTask {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  busy?: boolean;
  activity?: string;
  waitingForTeammates?: boolean;
  turnStartedAt?: number;
  routineRunId?: string;
  archivedAt?: number;
  ownerPrincipalId?: string;
  openedBy?: { botId: string; name: string; at: number; delegationId?: string; kind?: string };
  modelSelection?: { instanceId: string; model: string } | null;
  /** The folder its turns run in, pinned on its first turn. */
  cwd?: string | null;
  /** A parallel task of a conversation (shared/parallel-tasks.ts). */
  parallelOf?: { threadId: string };
}

export interface ActivityMessage {
  id: string;
  role: string;
  kind: string;
  at: number;
  text?: string;
  status?: string;
  turnSucceeded?: boolean;
  requestCancelled?: boolean;
  tool?: { name: string; ok?: boolean; summary?: string; itemId?: string; files?: string[]; setup?: boolean; input?: unknown; output?: unknown; parentItemId?: string };
  digest?: { access?: { via: BotActivityDetail["via"] & string; payer: BotActivityDetail["payer"] & string } };
  sender?: { name?: string } | null;
  /** The message it answers (null at the top); a Regenerate's fork shares
   * its first try's. */
  parentId?: string | null;
}

/** A sub-agent or hop this thread started: another bot's conversation. */
export interface ActivityChildRef {
  botId: string;
  threadId?: string;
  title: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  startedAt: number;
  /** A parallel task of this conversation, not another bot's work. */
  parallel?: boolean;
}

export interface BotActivityRouteDeps {
  bot(id: string): ActivityBot | null | undefined;
  tasks(botId: string): ActivityTask[];
  /** Who is asking (channelFilterViewerId): undefined for the operator or
   * a solo server, who see everything. */
  viewerId(auth: RequestAuth): string | undefined;
  threadReadable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  /** The viewer may stop a turn there (thread.post). */
  threadWritable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  runs(botId: string): RoutineRun[];
  runSeen(run: RoutineRun, viewerId: string | undefined): boolean;
  messages(threadId: string, limit: number): { messages: ActivityMessage[]; hasMore: boolean };
  children(botId: string, threadId: string): ActivityChildRef[];
  personName(principalId: string): string;
  organization(): boolean;
  /** The access card a failed run left, as this viewer may see it (in the
   * card's audience only); undefined when there is none for them. */
  runAccessCard?(run: RoutineRun, viewerId: string | undefined): WireAccessCard | undefined;
  /** The folder is inside a git repository (or worktree) on this server. */
  inRepository?(cwd: string): boolean;
  /** That repository's root, checked-out branch and origin remote. */
  repository?(cwd: string): RepositoryInfo | undefined;
  /** Agent API launches: hidden threads on peers this bot opened. */
  launchedAgents?(botId: string, viewerId: string | undefined): BotLaunchedAgentItem[];
  now?: () => number;
  cloudAgents?: CloudAgentManager;
}

/** How far back a thread's tool calls are read to tell coding work. */
const CODING_SCAN = 500;
/** A running thread's coding scan is reused this long. */
const CODING_RESCAN_MS = 3_000;
/** What a running entry is doing now is read off its newest messages. */
const CURRENT_SCAN = 30;
const SUBAGENT_LIMIT = 20;
const LIST_MAX = 50;

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);
/** Claude's sub-agent tool (Task before it was renamed Agent). */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const STEP_INPUT_CHARS = 2_000;
const SUBAGENT_RESULT_CHARS = 4_000;

/** A sub-agent call's request and report, from the call's arguments (JSON
 * as the chat previews it) and its result. */
export function subagentOf(input: string | undefined, output: unknown): BotActivityStep["subagent"] {
  let args: Record<string, unknown> = {};
  try {
    const parsed = input ? JSON.parse(input) : undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    // a preview cut short is not JSON: show it as the prompt
    if (input) args = { prompt: input };
  }
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const description = text(args.description);
  const prompt = text(args.prompt);
  const type = text(args.subagent_type);
  const result = text(output)?.slice(0, SUBAGENT_RESULT_CHARS);
  return { ...(description ? { description } : {}), ...(prompt ? { prompt } : {}), ...(type ? { type } : {}), ...(result ? { result } : {}) };
}

function newestRunningFirst(a: BotActivityItem, b: BotActivityItem): number {
  return Number(activityStatusActive(b.status)) - Number(activityStatusActive(a.status)) || b.updatedAt - a.updatedAt;
}

function runStatus(status: RoutineRun["status"]): BotActivityStatus {
  switch (status) {
    case "queued": return "queued";
    case "running": return "running";
    case "waiting": return "waiting";
    case "completed": return "finished";
    case "cancelled": return "stopped";
    // A quiet pre-check did no work. It is not a failure if a client opens the run.
    case "nothing_to_report": return "finished";
    default: return "failed";
  }
}

/** A settled thread's outcome, read off its newest turn. */
function settledStatus(messages: readonly ActivityMessage[]): BotActivityStatus {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return "finished";
    if (message.requestCancelled) return "stopped";
    if (message.status === "failed" || message.turnSucceeded === false) return "failed";
    if (message.turnSucceeded === true || message.kind === "digest") return "finished";
  }
  return "finished";
}

/** Where a thread's newest turn starts in a page of its messages: the
 * person's newest line (a Regenerate appends its fork last). -1 when the
 * page holds none (the turn is longer than the page, or no person wrote). */
export function turnStartIndex(messages: readonly ActivityMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.role === "user") return index;
  return -1;
}

export interface TurnRequest {
  /** The person's words, as sent. */
  text: string;
  at: number;
  /** The same words sent again beside an earlier try (Regenerate, Retry). */
  retry: boolean;
  /** No earlier request of the conversation precedes it. */
  first: boolean;
}

/** The request the newest turn answers, read off a page of messages. */
export function newestRequest(messages: readonly ActivityMessage[]): TurnRequest | undefined {
  const index = turnStartIndex(messages);
  if (index < 0) return undefined;
  const newest = messages[index]!;
  const text = (newest.text ?? "").trim();
  const known = newest.parentId !== undefined;
  let retry = false;
  let first = true;
  for (let at = 0; at < index; at++) {
    const message = messages[at]!;
    if (message.role !== "user") continue;
    const sibling = known && message.parentId !== undefined && (message.parentId ?? null) === (newest.parentId ?? null);
    if (sibling) {
      if ((message.text ?? "").trim() === text) retry = true;
    } else first = false;
  }
  return { text, at: newest.at, retry, first };
}

const TITLE_CHARS = 120;

/** A request as a one-line title: its first line, spaces collapsed, cut. */
export function requestTitle(text: string): string {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  const flat = line.replace(/\s+/g, " ");
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1).trimEnd()}…` : flat;
}

function stepWhere(name: string, organization: boolean): BotActivityStep["where"] {
  if (!organization) return undefined;
  return /sagax-desktop|shared_computer/.test(name) ? "computer" : "server";
}

interface ThreadScan {
  /** The newest turn is coding work (or the thread is a repository's job). */
  coding: boolean;
  /** Some turn in the page did coding work. */
  everCoding: boolean;
  code?: BotCodeWork;
  request?: TurnRequest;
  /** When the newest turn started, when known. */
  turnAt?: number;
}

/** The sub-agents of the newest turn: those it started, never a teammate an
 * earlier turn handed work to (that one stays in the list's `subagents`,
 * where it opens its own conversation). Unknown turn start: all of them. */
export function turnChildren<T extends { startedAt: number }>(children: readonly T[], turnAt: number | undefined): T[] {
  return turnAt === undefined ? [...children] : children.filter((child) => child.startedAt >= turnAt);
}

export function createBotActivityRoutes(deps: BotActivityRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;

  function startedBy(task: ActivityTask, run: RoutineRun | undefined): BotActivityActor | undefined {
    if (run || task.routineRunId) return { kind: "routine", name: run?.routineName ?? "" };
    if (task.openedBy) return { kind: "bot", name: task.openedBy.name };
    if (task.ownerPrincipalId) {
      const name = deps.personName(task.ownerPrincipalId);
      if (name) return { kind: "person", name };
    }
    return undefined;
  }

  function threadItem(bot: ActivityBot, task: ActivityTask, runs: Map<string, RoutineRun>, viewerId: string | undefined): BotActivityItem {
    const run = task.routineRunId ? runs.get(task.routineRunId) : undefined;
    let status: BotActivityStatus;
    if (run && ACTIVE_RUN.has(run.status)) status = runStatus(run.status);
    else if (task.busy) status = task.activity === "waiting-on-you" ? "waiting" : "running";
    else if (run) status = runStatus(run.status);
    else status = settledStatus(deps.messages(task.threadId, 12).messages);
    const updatedAt = Math.max(task.updatedAt ?? task.createdAt, run?.finishedAt ?? 0);
    const startedAt = activityStatusActive(status)
      ? task.turnStartedAt ?? run?.startedAt ?? task.createdAt
      : run?.startedAt ?? task.createdAt;
    const scan = threadScan(task);
    const children = turnChildren(deps.children(bot.id, task.threadId), scan.turnAt);
    const active = activityStatusActive(status);
    const current = active ? currentStep(task.threadId, run) : undefined;
    const selection = task.modelSelection ?? bot.modelSelection ?? undefined;
    const kind: BotActivityItem["kind"] = run || task.routineRunId ? "routine" : task.openedBy && task.openedBy.botId !== bot.id ? "hop" : "session";
    const threadTitle = task.title.trim() || run?.routineName || bot.name;
    // A conversation's entry is its newest turn: the request that started
    // it, once there were others before (the first one is the thread's own
    // title). The thread's title rides along.
    const request = kind === "session" ? scan.request : undefined;
    const asked = request && !request.first ? requestTitle(request.text) : "";
    const title = asked || threadTitle;
    return {
      id: `thread:${task.threadId}`,
      kind,
      botId: bot.id,
      botName: bot.name,
      title,
      ...(title !== threadTitle ? { threadTitle } : {}),
      ...(request?.retry ? { retry: true } : {}),
      ...(selection ? { engine: { instanceId: selection.instanceId, model: selection.model } } : {}),
      status,
      startedAt,
      ...(activityStatusActive(status) ? {} : { endedAt: run?.finishedAt ?? updatedAt }),
      updatedAt,
      ...(deps.threadReadable(bot.id, task.threadId, viewerId) ? { threadId: task.threadId } : {}),
      ...(startedBy(task, run) ? { startedBy: startedBy(task, run) } : {}),
      ...(children.length ? { childCount: children.length } : {}),
      ...(scan.coding ? { coding: true } : {}),
      ...(scan.code ? { code: scan.code } : {}),
      ...(current ? { currentStep: current } : {}),
      ...(active && deps.threadWritable(bot.id, task.threadId, viewerId) ? { canStop: true } : {}),
      ...(task.parallelOf ? { parallel: true } : {}),
    };
  }

  /** One read of a thread's newest messages: whether its newest turn is
   * coding work, its code work, and the request that turn answers.
   *
   * Coding is read off the newest turn's tool calls (from the person's
   * newest line on), so an ordinary conversation is a coding job only while
   * its turn does code work. A conversation whose folder is a repository on
   * this server is a coding job as a whole: once it committed or edited
   * code it stays coding. A settled thread is read once per change, a
   * running one at most every CODING_RESCAN_MS. Code work (server/activity-code-work.ts:
   * its repository folder and branch, and the pull requests, branches and
   * commits its calls produced) is read off every turn of the page and
   * carried whenever the thread did coding work, so the Coding section's
   * code work keeps what earlier turns produced. */
  const scanCache = new Map<string, { at: number; scannedAt: number; scan: ThreadScan }>();
  function threadScan(task: ActivityTask): ThreadScan {
    const at = task.updatedAt ?? task.createdAt;
    const cached = scanCache.get(task.threadId);
    if (cached && cached.at === at && (!task.busy || now() - cached.scannedAt < CODING_RESCAN_MS)) return cached.scan;
    const all: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
    const turn: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
    const repository = task.cwd ? deps.repository?.(task.cwd) : undefined;
    const collector = new CodeWorkCollector(repository?.origin);
    const messages = deps.messages(task.threadId, CODING_SCAN).messages;
    const start = turnStartIndex(messages);
    messages.forEach((message, index) => {
      if (!message.tool) return;
      addCodingSignal(all, message.tool);
      if (index > start) addCodingSignal(turn, message.tool);
      collector.add(message.tool, message.at);
    });
    const inRepository = Boolean(task.cwd && (all.edits > 0 || turn.edits > 0) && deps.inRepository?.(task.cwd));
    const everCoding = Boolean(cached?.scan.everCoding) || isCodingWork(all, inRepository);
    const coding = isCodingWork(turn, inRepository) || (inRepository && everCoding);
    const code: BotCodeWork | undefined = everCoding
      ? {
        ...(repository ? { folder: repository.root } : {}),
        ...(repository?.branch ? { branch: repository.branch } : {}),
        ...(repository?.origin ? { repo: repository.origin.repo, ...(repository.origin.url ? { repoUrl: repository.origin.url } : {}) } : {}),
        ...collector.result(),
      }
      : undefined;
    const request = newestRequest(messages);
    const scan: ThreadScan = {
      coding,
      everCoding,
      ...(code ? { code } : {}),
      ...(request ? { request } : {}),
      ...(request ? { turnAt: request.at } : task.busy && task.turnStartedAt ? { turnAt: task.turnStartedAt } : {}),
    };
    if (scanCache.size > 2_000) scanCache.clear();
    scanCache.set(task.threadId, { at, scannedAt: now(), scan });
    return scan;
  }

  /** A running entry's current step: the tool call in flight, else the
   * newest one, else what a waiting run asks. */
  function currentStep(threadId: string, run: RoutineRun | undefined): string | undefined {
    if (run?.status === "waiting" && run.attention) return run.attention.slice(0, 160);
    const tail = deps.messages(threadId, CURRENT_SCAN).messages;
    let latest: string | undefined;
    for (let index = tail.length - 1; index >= 0; index--) {
      const message = tail[index]!;
      if (message.role === "user") break;
      const tool = message.tool;
      if (!tool || tool.setup) continue;
      const label = (tool.summary?.trim() || tool.name).slice(0, 160);
      if (tool.ok === undefined) return label;
      latest ??= label;
    }
    return latest;
  }

  function runItem(bot: ActivityBot, run: RoutineRun): BotActivityItem {
    const status = runStatus(run.status);
    const updatedAt = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    const selection = bot.modelSelection ?? undefined;
    return {
      id: `run:${run.id}`,
      kind: "routine",
      botId: bot.id,
      botName: bot.name,
      title: run.routineName,
      ...(selection ? { engine: { instanceId: selection.instanceId, model: selection.model } } : {}),
      status,
      startedAt: run.startedAt ?? run.scheduledFor,
      ...(activityStatusActive(status) ? {} : { endedAt: updatedAt }),
      updatedAt,
      startedBy: { kind: "routine", name: run.routineName },
    };
  }

  function untouched(threadId: string): boolean {
    const page = deps.messages(threadId, 3);
    return !page.hasMore && page.messages.every((message) => message.role !== "user" && !message.tool);
  }

  function cloudVisible(record: CloudAgentRecord, viewerId: string | undefined): boolean {
    if (!viewerId) return true;
    if (record.principalId === viewerId) return true;
    return Boolean(record.botId && record.threadId) && deps.threadReadable(record.botId!, record.threadId!, viewerId);
  }

  function cloudItems(bot: ActivityBot, viewerId: string | undefined): BotActivityItem[] {
    if (!deps.cloudAgents) return [];
    const since = now() - BOT_ACTIVITY_WINDOW_MS;
    return deps.cloudAgents.list(bot.id)
      .filter((record) => cloudVisible(record, viewerId))
      .filter((record) => record.archived === false && (cloudAgentStatusActive(record.status) || (record.updatedAt >= since)))
      .map((record) => cloudAgentActivityItem(bot.name, record));
  }

  /** The list, newest first with running work on top. */
  function list(bot: ActivityBot, viewerId: string | undefined, limit: number): BotActivityItem[] {
    const since = now() - BOT_ACTIVITY_WINDOW_MS;
    const runs = deps.runs(bot.id).filter((run) => deps.runSeen(run, viewerId));
    const runById = new Map(runs.map((run) => [run.id, run]));
    const items: BotActivityItem[] = [];
    const listedRuns = new Set<string>();
    const listedThreads = new Set<string>();
    for (const task of deps.tasks(bot.id)) {
      if (task.archivedAt) continue;
      if (!deps.threadReadable(bot.id, task.threadId, viewerId)) continue;
      const recent = task.busy || (task.updatedAt ?? task.createdAt) >= since;
      if (!recent) continue;
      // A conversation nobody wrote in yet (at most the bot's greeting) did no work.
      if (!task.busy && !task.routineRunId && !task.openedBy && untouched(task.threadId)) continue;
      if (task.routineRunId) listedRuns.add(task.routineRunId);
      listedThreads.add(task.threadId);
      items.push(threadItem(bot, task, runById, viewerId));
    }
    for (const run of runs) {
      // Quiet pre-checks stay in the routine logs. Listing them would fill
      // this window with fake failures on every poll.
      if (listedRuns.has(run.id) || run.status === "missed" || run.status === "nothing_to_report") continue;
      if (run.threadId && listedThreads.has(run.threadId)) continue;
      const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
      if (!ACTIVE_RUN.has(run.status) && at < since) continue;
      if (run.status === "queued" && !run.startedAt) continue;
      items.push(runItem(bot, run));
    }
    for (const cloud of cloudItems(bot, viewerId)) items.push(cloud);
    return items
      .sort(newestRunningFirst)
      .slice(0, limit);
  }

  async function cloudDetail(bot: ActivityBot, cloudId: string, viewerId: string | undefined): Promise<BotActivityDetail | null> {
    if (!deps.cloudAgents) return null;
    const record = deps.cloudAgents.get(cloudId);
    if (!record || record.botId !== bot.id || !cloudVisible(record, viewerId)) return null;
    await deps.cloudAgents.refresh(cloudId);
    const fresh = deps.cloudAgents.get(cloudId);
    if (!fresh) return null;
    const item = cloudAgentActivityItem(bot.name, fresh);
    let lines: { at: number; role: string; text: string }[] = [];
    try {
      lines = await deps.cloudAgents.transcript(cloudId, fresh.principalId);
    } catch {
      // credentials may be missing for another viewer
    }
    const steps: BotActivityStep[] = lines.map((line, index) => ({
      id: `cloud-line-${index}`,
      name: line.role,
      summary: line.text.slice(0, 500),
      ok: line.role !== "system",
      at: line.at,
    }));
    const note = fresh.error?.trim() || fresh.lastResult?.trim();
    return {
      ...item,
      steps,
      stepsTruncated: false,
      files: [],
      children: [],
      canStop: activityStatusActive(item.status),
      ...(note ? { note } : {}),
    };
  }

  /** The sub-agents the listed threads started: running ones, and those
   * started within the window. Their parents passed threadReadable; an
   * unreadable child still shows no request text (childItems). */
  function subagents(bot: ActivityBot, threads: readonly BotActivityItem[], viewerId: string | undefined): BotActivityItem[] {
    const since = now() - BOT_ACTIVITY_WINDOW_MS;
    const out: BotActivityItem[] = [];
    for (const parent of threads) {
      if (!parent.threadId || parent.kind === "subagent") continue;
      for (const child of childItems(bot, parent.threadId, viewerId)) {
        // a parallel task is listed as its own entry already
        if (child.parallel) continue;
        if (activityStatusActive(child.status) || child.startedAt >= since) out.push({ ...child, parentId: parent.id });
      }
    }
    return out.sort(newestRunningFirst).slice(0, SUBAGENT_LIMIT);
  }

  function childItems(bot: ActivityBot, threadId: string, viewerId: string | undefined): BotActivityItem[] {
    return deps.children(bot.id, threadId).map((child, index) => {
      const other = deps.bot(child.botId);
      const readable = child.threadId ? deps.threadReadable(child.botId, child.threadId, viewerId) : false;
      const settled: BotActivityStatus = child.status === "completed" ? "finished" : child.status === "cancelled" ? "stopped" : child.status;
      // Waiting on the person means a place to answer: the teammate's own
      // conversation and its card. One this viewer cannot open is not their
      // wait; it reads as work in progress.
      const status: BotActivityStatus = settled === "waiting" && !readable ? "running" : settled;
      return {
        id: child.threadId ? `thread:${child.threadId}` : `child:${threadId}:${index}`,
        kind: "subagent",
        botId: child.botId,
        ...(other ? { botName: other.name } : {}),
        // Another person's request text stays theirs: an unreadable
        // sub-agent shows only which bot works and how it goes.
        title: readable ? child.title : other?.name ?? "",
        status,
        startedAt: child.startedAt,
        updatedAt: child.startedAt,
        ...(readable && child.threadId ? { threadId: child.threadId } : {}),
        ...(readable && child.threadId && activityStatusActive(status) && deps.threadWritable(child.botId, child.threadId, viewerId) ? { canStop: true } : {}),
        startedBy: { kind: "bot", name: bot.name },
        ...(child.parallel ? { parallel: true } : {}),
      } satisfies BotActivityItem;
    });
  }

  function threadDetail(bot: ActivityBot, task: ActivityTask, viewerId: string | undefined, askedRun?: RoutineRun): BotActivityDetail {
    const runs = deps.runs(bot.id).filter((run) => deps.runSeen(run, viewerId));
    const item = threadItem(bot, task, new Map(runs.map((run) => [run.id, run])), viewerId);
    const page = deps.messages(task.threadId, BOT_ACTIVITY_STEPS);
    const organization = deps.organization();
    const steps: BotActivityStep[] = [];
    const files = new Set<string>();
    let access: NonNullable<ActivityMessage["digest"]>["access"];
    const stepByItem = new Map<string, string>();
    // The newest turn's steps only: an earlier turn's (an earlier try, a
    // limit error, another request) stay in the conversation, which the
    // sheet links ("Older steps are in the conversation").
    const start = turnStartIndex(page.messages);
    page.messages.forEach((message, index) => {
      if (message.digest?.access) access = message.digest.access;
      if (index <= start) return;
      const tool = message.tool;
      if (!tool || tool.setup) return;
      for (const file of tool.files ?? []) files.add(file);
      const where = stepWhere(tool.name, organization);
      if (tool.itemId) stepByItem.set(tool.itemId, message.id);
      const parentId = tool.parentItemId ? stepByItem.get(tool.parentItemId) : undefined;
      const input = typeof tool.input === "string" && tool.input.trim() ? tool.input.slice(0, STEP_INPUT_CHARS) : undefined;
      const subagent = SUBAGENT_TOOLS.has(tool.name) ? subagentOf(input, tool.output) : undefined;
      steps.push({
        id: message.id,
        name: tool.name,
        ...(tool.summary ? { summary: tool.summary } : {}),
        ...(typeof tool.ok === "boolean" ? { ok: tool.ok } : {}),
        at: message.at,
        ...(where ? { where } : {}),
        ...(tool.files?.length ? { files: tool.files } : {}),
        ...(input ? { input } : {}),
        ...(parentId ? { parentId } : {}),
        ...(subagent ? { subagent } : {}),
      });
    });
    // the run asked for by id: its thread no longer names it once it ended
    const run = askedRun ?? (task.routineRunId ? runs.find((entry) => entry.id === task.routineRunId) : undefined);
    const selection = task.modelSelection ?? bot.modelSelection ?? undefined;
    const note = run?.status === "waiting" ? run.attention : run?.status === "failed" || run?.status === "blocked" ? run.error : undefined;
    const card = run ? runCard(run, viewerId) : undefined;
    return {
      ...item,
      ...(selection ? { engine: { instanceId: selection.instanceId, model: selection.model } } : {}),
      ...(access ? { via: access.via, payer: access.payer } : {}),
      steps,
      stepsTruncated: page.hasMore || start > 0,
      files: [...files],
      children: turnChildren(childItems(bot, task.threadId, viewerId), threadScan(task).turnAt),
      ...(note ? { note } : {}),
      canStop: activityStatusActive(item.status) && deps.threadWritable(bot.id, task.threadId, viewerId),
      ...(card ? { access: card } : {}),
    };
  }

  function runCard(run: RoutineRun, viewerId: string | undefined): WireAccessCard | undefined {
    return run.status === "failed" ? deps.runAccessCard?.(run, viewerId) : undefined;
  }

  function runDetail(bot: ActivityBot, run: RoutineRun, viewerId: string | undefined): BotActivityDetail {
    const note = run.status === "waiting" ? run.attention : run.status === "failed" || run.status === "blocked" ? run.error : undefined;
    const card = runCard(run, viewerId);
    return {
      ...runItem(bot, run),
      steps: [],
      stepsTruncated: false,
      files: [],
      children: [],
      ...(note ? { note } : {}),
      canStop: false,
      ...(card ? { access: card } : {}),
    };
  }

  return async ({ res, url, path, method, auth, json }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/activity(\/item)?$/);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const bot = deps.bot(match[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const viewerId = deps.viewerId(auth);
    if (!match[2]) {
      const requested = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, LIST_MAX) : BOT_ACTIVITY_LIMIT;
      const asked = url.searchParams.get("filter");
      const filter = asked === "coding" || asked === "other" ? asked : undefined;
      const all = list(bot, viewerId, LIST_MAX);
      const items = all.filter((item) => !filter || (filter === "coding") === Boolean(item.coding)).slice(0, limit);
      const launchedAgents = filter === "other" ? [] : (deps.launchedAgents?.(bot.id, viewerId) ?? []);
      return json(res, 200, { items, subagents: filter === "coding" ? [] : subagents(bot, all, viewerId), launchedAgents });
    }
    const threadId = url.searchParams.get("threadId");
    const runId = url.searchParams.get("runId");
    const cloudId = url.searchParams.get("cloudId");
    if (cloudId) {
      const item = await cloudDetail(bot, cloudId, viewerId);
      if (!item) return json(res, 404, { error: "no such activity" });
      return json(res, 200, { item });
    }
    if (threadId) {
      const task = deps.tasks(bot.id).find((entry) => entry.threadId === threadId);
      // Not theirs reads exactly like not there.
      if (!task || !deps.threadReadable(bot.id, threadId, viewerId)) return json(res, 404, { error: "no such activity" });
      return json(res, 200, { item: threadDetail(bot, task, viewerId) });
    }
    if (runId) {
      const run = deps.runs(bot.id).find((entry) => entry.id === runId);
      if (!run || !deps.runSeen(run, viewerId)) return json(res, 404, { error: "no such activity" });
      const thread = run.threadId ?? run.executionThreadId;
      const task = thread ? deps.tasks(bot.id).find((entry) => entry.threadId === thread) : undefined;
      if (task && deps.threadReadable(bot.id, task.threadId, viewerId)) return json(res, 200, { item: threadDetail(bot, task, viewerId, run) });
      return json(res, 200, { item: runDetail(bot, run, viewerId) });
    }
    return json(res, 400, { error: "threadId or runId is required" });
  };
}
