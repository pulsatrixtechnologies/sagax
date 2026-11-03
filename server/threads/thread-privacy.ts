// Private conversations with a bot on an organization server.
//
// Decision: "When talking to a shared bot, we should not be able to use the same
// thread. Being multiple in the same chat should be reserved for group
// chats." So every thread of a bot (a task, a 1:1 conversation) belongs to
// one person, its owner principal:
//
//   - the person who started it (a signed-in session);
//   - for a thread a bot opened while working on someone's request, the
//     owner of the thread that request came from;
//   - for a routine's thread, the person the routine runs as (runAs), else
//     the bot owner;
//   - for anything else (the bot's first thread, a webhook, a peer bot's
//     pair conversation, a record from before this rule), the bot owner.
//
// Only that person reads, posts, streams, searches, exports, answers cards
// in and fetches the files of that thread, and only while they still hold
// bot.use. Sharing a bot (grants, teams, a section) lets each person talk to
// it in their own threads; it never opens anyone else's. Edit and manage
// change the bot's settings, never its conversations. Organization admins
// and team managers get no exception (spec section 3, T7: an admin never
// reads a private Direct without a right; Decision: a manager never reads a Direct
// unasked); they see audit metadata only.
//
// Group chats (rooms: their people and their bots) are the only
// conversations several people share: room threads are judged by the room
// (server/authz.ts canInChannel), never here.
//
// The operator at this computer (loopback, no viewer) sees everything, as
// everywhere in server/authz.ts. A solo server never calls this.
//
// Pure: no store, no request. server/index.ts supplies the records.
import { isAgentConversation } from "../../shared/agent-conversation.ts";
import { conversationThreadId, type StreamTaskFacts } from "../../shared/single-stream.ts";
import { canOnBot, type BotFacts, type Viewer } from "../authz.ts";

export type ThreadAction =
  | "thread.list"
  | "thread.read"
  | "thread.post"
  | "thread.stream"
  | "thread.search"
  | "thread.attachments"
  | "thread.answer";

export interface ThreadRecord {
  threadId: string;
  ownerPrincipalId?: unknown;
  routineRunId?: unknown;
  /** An AI client's hidden conversation (#291). */
  hidden?: unknown;
  archivedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  // read by the one-conversation rule (shared/single-stream.ts)
  routineResults?: unknown;
  confidential?: unknown;
  openedBy?: unknown;
  parallelOf?: unknown;
  closedBy?: unknown;
}

/** The viewer's one conversation among the threads they see
 * (shared/single-stream.ts); threads without a creation time are not
 * conversations the rule can order. */
function viewerConversation(tasks: readonly ThreadRecord[]): string | undefined {
  const facts = tasks.filter((task): task is ThreadRecord & { createdAt: number } => typeof task.createdAt === "number");
  return conversationThreadId(facts as StreamTaskFacts[]);
}

const key = (value: string) => value.trim().toLowerCase();

/** The person a bot's thread belongs to: its recorded owner, else the bot
 * owner (a thread from before the rule, the first thread, a webhook). */
export function threadOwner(task: Pick<ThreadRecord, "ownerPrincipalId"> | undefined | null, botOwnerPrincipalId: string): string {
  const recorded = typeof task?.ownerPrincipalId === "string" ? task.ownerPrincipalId.trim() : "";
  return key(recorded || botOwnerPrincipalId);
}

/** Whether `viewerId` owns this thread. */
export function ownsThread(viewerId: string, task: Pick<ThreadRecord, "ownerPrincipalId"> | undefined | null, botOwnerPrincipalId: string): boolean {
  return Boolean(viewerId.trim()) && threadOwner(task, botOwnerPrincipalId) === key(viewerId);
}

/** May this viewer act on this bot thread? Every action has the same rule:
 * the thread's owner, while they still hold bot.use. Undefined viewer: the
 * operator at this computer. The action names what the caller is doing,
 * for the record and the tests. */
export function canOnThread(
  viewer: Viewer | undefined,
  _action: ThreadAction,
  input: { bot: BotFacts; task: Pick<ThreadRecord, "ownerPrincipalId"> | undefined | null },
): boolean {
  if (!viewer) return true;
  if (viewer.disabled) return false;
  if (!canOnBot(viewer, "bot.use", input.bot)) return false;
  return ownsThread(viewer.principalId, input.task, input.bot.ownerPrincipalId);
}

/** The threads of a bot this viewer lists: their own. */
export function ownThreads<T extends Pick<ThreadRecord, "ownerPrincipalId">>(tasks: readonly T[], viewerId: string, botOwnerPrincipalId: string): T[] {
  return tasks.filter((task) => ownsThread(viewerId, task, botOwnerPrincipalId));
}

/** The thread a viewer lands on when they open a bot: the one they last
 * chose, else the bot's selected thread when it is theirs, else their
 * newest open conversation (not a routine's execution, not archived), else
 * any of theirs. Undefined: they have none yet (the caller starts one).
 * An AI client's hidden conversation (#291) is never landed on unless the
 * person chose it themselves: with only hidden ones they have none yet. */
export function viewerThread(input: {
  tasks: readonly ThreadRecord[];
  viewerId: string;
  botOwnerPrincipalId: string;
  selected?: string;
  current?: string;
}): string | undefined {
  // One pass over the bot's threads: filter, pick selected/current, and keep
  // the newest open conversation. A full sort on every call (GET /api/bots,
  // SSE bot frames) blocked the event loop for ~1-2 s on large orgs (#1750).
  let selectedOwned = false;
  let firstMine: ThreadRecord | undefined;
  let currentMine = false;
  let newestOpen: ThreadRecord | undefined;
  let newestOpenAt = -Infinity;
  for (const task of input.tasks) {
    if (!ownsThread(input.viewerId, task, input.botOwnerPrincipalId)) continue;
    if (input.selected !== undefined && task.threadId === input.selected) selectedOwned = true;
    // nor an outside agent's conversation with the bot (2026-10-29): the
    // person reads it from the bot-to-bot line, it is never where they land
    if (task.hidden === true || isAgentConversation(task as { openedBy?: { botId?: unknown; kind?: unknown } })) continue;
    if (!firstMine) firstMine = task;
    if (input.current !== undefined && task.threadId === input.current) currentMine = true;
    if (task.routineRunId || task.archivedAt !== undefined) continue;
    const when = typeof task.updatedAt === "number" ? task.updatedAt : typeof task.createdAt === "number" ? task.createdAt : 0;
    if (!newestOpen || when > newestOpenAt) {
      newestOpen = task;
      newestOpenAt = when;
    }
  }
  if (selectedOwned) return input.selected;
  if (!firstMine) return undefined;
  if (currentMine) return input.current;
  return (newestOpen ?? firstMine).threadId;
}

/** The task fields a bot record mirrors from its selected thread
 * (store.projectBotForTask): a viewer's copy of the bot reads them from
 * their own thread, never from someone else's. */
export const MIRRORED_TASK_FIELDS = ["modelSelection", "approvalMode", "autoApprove", "alwaysAllow", "unread", "rewound", "pinnedMessageId", "activity", "busy"] as const;

/** Transcript fields a bot record may carry for its selected thread. */
export const TRANSCRIPT_FIELDS = ["messages", "activeLeafId", "hasMore"] as const;

/** A bot as one viewer receives it on an organization server: only their
 * threads in `tasks`; `threadId` is their thread; a transcript or mirrored
 * settings that came from someone else's thread are dropped or replaced by
 * theirs. `mine` is the viewer's thread (viewerThread), if they have one.
 * The original object comes back when nothing changes. */
export function narrowBotForViewer<T extends Record<string, unknown>>(
  bot: T,
  input: {
    viewerId: string;
    botOwnerPrincipalId: string;
    mine?: string;
    mineTask?: Record<string, unknown>;
    /** The viewer's thread as a wire task, nothing more: the record added to
     * `tasks` when the wire list left it out. Never `mineTask`, which also
     * carries the projected bot (every person's threads). */
    mineWireTask?: Record<string, unknown>;
    /** The bot's activity over this viewer's own threads (store.activityOf):
     * a bot reads busy while any of their threads works, as on a solo
     * server, and never because of someone else's. */
    activity?: { activity: string; busy: boolean };
  },
): T {
  const tasks = Array.isArray(bot.tasks) ? (bot.tasks as ThreadRecord[]) : undefined;
  const shownTasks = tasks ? ownThreads(tasks, input.viewerId, input.botOwnerPrincipalId) : undefined;
  const threadId = typeof bot.threadId === "string" ? bot.threadId : undefined;
  const threadIsMine = threadId !== undefined && (shownTasks
    ? shownTasks.some((task) => task.threadId === threadId)
    : threadId === input.mine);
  // The bot's main thread (WireBot.mainThreadId) is the viewer's own one
  // conversation (shared/single-stream.ts, the same rule the server applies
  // for its owner): worked out over the threads they see, so a shared bot
  // tells each person their own conversation, never someone else's.
  const main = typeof bot.mainThreadId === "string" ? bot.mainThreadId : undefined;
  const viewerMain = shownTasks ? viewerConversation(shownTasks) : (main === input.mine ? main : undefined);
  const mainHidden = main !== viewerMain;
  if (threadIsMine && !mainHidden && (!tasks || shownTasks!.length === tasks.length)) return bot;
  const out: Record<string, unknown> = { ...bot };
  if (mainHidden) {
    if (viewerMain !== undefined) out.mainThreadId = viewerMain;
    else delete out.mainThreadId;
  }
  if (shownTasks) out.tasks = shownTasks;
  if (!threadIsMine && threadId !== undefined) {
    for (const field of TRANSCRIPT_FIELDS) delete out[field];
    out.threadId = input.mine ?? "";
    const task = input.mineTask ?? shownTasks?.find((candidate) => candidate.threadId === input.mine);
    for (const field of MIRRORED_TASK_FIELDS) {
      if (task && field in task) out[field] = (task as Record<string, unknown>)[field];
      else if (field === "busy") out.busy = false;
      else if (field === "activity") out.activity = "idle";
      else if (field === "unread") out.unread = false;
    }
  }
  // 2026-10-17 (follow-up of #698): the thread a viewer is given is always
  // in their `tasks` (an AI client's hidden thread they opened, a thread the
  // wire list left out), so web, Android and older iOS clients never see a
  // selected thread their list does not hold. Only a record of the viewer's
  // own thread is added (ownThreads), never anyone else's.
  const selected = typeof out.threadId === "string" ? out.threadId : "";
  const listed = Array.isArray(out.tasks) ? (out.tasks as ThreadRecord[]) : undefined;
  if (selected && listed && !listed.some((task) => task.threadId === selected)) {
    const record = input.mineWireTask && input.mineWireTask.threadId === selected && !("tasks" in input.mineWireTask)
      ? (input.mineWireTask as unknown as ThreadRecord) : undefined;
    if (record && ownThreads([record], input.viewerId, input.botOwnerPrincipalId).length === 1) out.tasks = [...listed, record];
  }
  if (input.activity) {
    out.activity = input.activity.activity;
    out.busy = input.activity.busy;
  }
  return out as T;
}

// ── one-time migration ─────────────────────────────────────────────────
// Threads written before this rule carry no owner, and an organization
// server may hold conversations several people wrote in. Each gets one
// owner, once: the first person who wrote in it (its creator); a routine's
// execution or a thread no person wrote in goes to the bot owner. Nobody
// else keeps access: a mixed thread is never exposed to its other writers.

export interface MigrationBot {
  id: string;
  ownerPrincipalId: string;
  tasks: readonly ThreadRecord[];
}

export interface OwnerAssignment {
  botId: string;
  threadId: string;
  ownerPrincipalId: string;
  source: "creator" | "bot_owner";
}

export interface MigrationReport {
  threads: number;
  toCreator: number;
  toBotOwner: number;
  /** Threads in which more than one person wrote: now their creator's only. */
  mixed: number;
  /** Threads that already had an owner and were left as they were. */
  alreadyOwned: number;
}

/** Decide every unowned thread's owner. `senders` lists, in order, who wrote
 * the person lines of a thread (sender ids as stored; non-principal ids are
 * skipped). `isPrincipal` says which ids are organization people. */
export function planThreadOwners(
  bots: readonly MigrationBot[],
  senders: (threadId: string) => readonly string[],
  isPrincipal: (id: string) => boolean,
): { assignments: OwnerAssignment[]; report: MigrationReport } {
  const assignments: OwnerAssignment[] = [];
  const report: MigrationReport = { threads: 0, toCreator: 0, toBotOwner: 0, mixed: 0, alreadyOwned: 0 };
  for (const bot of bots) {
    for (const task of bot.tasks) {
      report.threads += 1;
      if (typeof task.ownerPrincipalId === "string" && task.ownerPrincipalId.trim()) {
        report.alreadyOwned += 1;
        continue;
      }
      const people = task.routineRunId ? [] : [...new Set(senders(task.threadId).map(key).filter((id) => id && isPrincipal(id)))];
      if (people.length > 1) report.mixed += 1;
      const creator = people[0];
      if (creator) {
        assignments.push({ botId: bot.id, threadId: task.threadId, ownerPrincipalId: creator, source: "creator" });
        report.toCreator += 1;
      } else {
        assignments.push({ botId: bot.id, threadId: task.threadId, ownerPrincipalId: key(bot.ownerPrincipalId), source: "bot_owner" });
        report.toBotOwner += 1;
      }
    }
  }
  return { assignments, report };
}

/** The one log line the migration writes: counts only, never an id. */
export function migrationLogLine(report: MigrationReport): string {
  return `[private-threads] migration: ${report.threads} bot thread(s), ${report.toCreator} assigned to their creator, ${report.toBotOwner} to the bot owner, ${report.mixed} mixed thread(s) now private to their creator, ${report.alreadyOwned} already owned`;
}
