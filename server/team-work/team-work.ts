// The work an orchestrator bot runs through its team, as one reader may
// see it (#3461, lot 1 of #3451): the facts of each hand-over its turns
// made, gathered with the reader's rights, then shared/team-work.ts builds
// the steps, the pieces of work and the team row. One builder for steps
// and live state: the panel's route reads it now, the Team board's cards
// may read it later (by thread), and neither parses coordination text.
//
// Sources, all existing: the runtime rows (RuntimeStore.handedOutBy), the
// thread records (archived ones included), the step thread's digests (the
// tokens and the first sentence of each settled turn), the bot activity
// reader (coding work, code work, the tool call in flight) and the stall
// watchdog (the open turn's start, last event, tool call, parks).
//
// Rights: the caller's gate already hides a bot the reader cannot see.
// Here a step is listed only when the reader may read its thread and the
// requester's conversation, so a shared orchestrator shows each person
// their own work; a confidential thread yields nothing. A team bot is
// named only when the orchestrator can still reach it.
import type { HandedOver } from "../runtime/coordinator-types.ts";
import type { TurnPeek } from "../turns/turn-watchdog.ts";
import type { BotActivityItem } from "../../shared/bot-activity.ts";
import {
  TEAM_WORK_WINDOW_MS,
  buildTeamWork,
  teamStepEnded,
  type TeamOpenTurn,
  type TeamStepFacts,
  type TeamWork,
} from "../../shared/team-work.ts";

export interface TeamWorkThread {
  title: string;
  confidential?: boolean;
  archivedAt?: number;
  openedBy?: { botId: string; kind?: string; delegationId?: string };
  /** The folder its turns run in, pinned on its first turn. */
  cwd?: string | null;
}

export interface TeamWorkMessage {
  kind: string;
  at: number;
  digest?: { at?: number; reply?: string; usage?: { input?: number; output?: number } };
}

export interface TeamWorkDeps {
  handedOutBy(botId: string, since: number): HandedOver[];
  /** A bot's thread record, archived ones included. */
  thread(botId: string, threadId: string): TeamWorkThread | undefined;
  threadReadable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  /** The newest messages of a thread, oldest first. */
  messages(threadId: string, limit: number): TeamWorkMessage[];
  /** The thread's entry as the bot activity reader builds it. */
  activity(botId: string, threadId: string, viewerId: string | undefined): BotActivityItem | undefined;
  /** The cause a failed turn left in its thread, first line, redacted. */
  failureCause(threadId: string): string | undefined;
  /** The folder is inside a git repository on this server. */
  inRepository?(cwd: string): boolean;
  peek(threadId: string): TurnPeek | undefined;
  openTurns(botId: string): TurnPeek[];
  /** A team bot's name and title, only while the orchestrator can reach it. */
  name(orchestratorId: string, botId: string): { name: string; title?: string } | undefined;
  now?: () => number;
}

/** How many of a step thread's newest messages are read for its digests. */
const DIGEST_SCAN = 200;
/** Settled steps are computed once: their facts no longer change. */
const SETTLED_CACHE_MAX = 2_000;
const TITLE_CHARS = 80;

/** A request's first line, without markdown marks, cut (briefTitle's rule). */
export function stepTitle(brief: string): string {
  const line = brief.split("\n").map((part) => part.replace(/^[\s#>*\-_`]+/, "").replace(/[*_`]+/g, "").trim()).find(Boolean) ?? "";
  const flat = line.replace(/\s+/g, " ");
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1).trimEnd()}…` : flat;
}

function openTurn(peek: TurnPeek): TeamOpenTurn {
  return {
    startedAt: peek.startedAt, lastActionAt: peek.lastEventAt,
    ...(peek.toolSince !== undefined ? { toolSince: peek.toolSince } : {}),
    ...(peek.waitingOnHuman ? { waitingOnHuman: true } : {}),
    ...(peek.waitingOnComputer ? { waitingOnComputer: true } : {}),
  };
}

type Settled = Pick<TeamStepFacts, "tokens" | "did" | "failure" | "merged" | "coding">;

/** The orchestrator's names for a hand-over (#3463), as the builder reads them. */
function labelFacts(row: HandedOver): Pick<TeamStepFacts, "work" | "step" | "plan"> {
  const label = row.work;
  if (!label) return {};
  return {
    ...(label.name ? { work: label.name } : {}),
    ...(label.step ? { step: label.step } : {}),
    ...(label.name && label.plan?.length ? { plan: label.plan } : {}),
  };
}

/** The names of the open pieces of work this orchestrator's turns handed
 * out for one person (a step still live, or plan steps not handed out
 * yet), newest first: the answer of the next hand-over lists them, so the
 * orchestrator can reuse a name instead of wording it anew (#3463).
 * `keep` drops rows the caller may not echo (a confidential conversation). */
export function openWorkNames(rows: readonly HandedOver[], orchestratorId: string, person: string | undefined, now: number,
  keep: (row: HandedOver) => boolean = () => true): string[] {
  const steps: TeamStepFacts[] = [];
  for (const row of rows) {
    if (!row.work?.name || row.person !== person || !keep(row)) continue;
    steps.push({
      id: row.id, botId: row.botId, requesterBotId: row.requesterBotId ?? "", title: stepTitle(row.brief), ...labelFacts(row),
      mode: row.mode, ...(row.groupId !== undefined ? { room: true } : {}), status: row.status, createdAt: row.createdAt,
      ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
      ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
      // every named piece of work counts here, code work or not
      coding: true,
    });
  }
  return buildTeamWork({ orchestratorId, steps, now, since: now }).live.map((item) => item.name);
}

/** The `openWork` field of a hand-over route's answer: the open names of
 * this bot's work for that person, none from a confidential conversation.
 * Absent when there is none. */
export function openWorkEcho(handedOutBy: ((botId: string, since: number) => HandedOver[]) | undefined, botId: string,
  person: string | undefined, confidential?: (threadId: string) => boolean, now = Date.now()): { openWork?: string[] } {
  if (!handedOutBy) return {};
  const names = openWorkNames(handedOutBy(botId, now - TEAM_WORK_WINDOW_MS), botId, person, now,
    (row) => !row.requesterThreadId || !confidential?.(row.requesterThreadId));
  return names.length ? { openWork: names } : {};
}

export interface TeamWorkReader {
  /** `since`: the reader's local midnight ("Done today"). */
  read(orchestratorId: string, viewerId: string | undefined, since: number): TeamWork;
}

export function createTeamWorkReader(deps: TeamWorkDeps): TeamWorkReader {
  const now = deps.now ?? Date.now;
  const settled = new Map<string, Settled>();

  /** What the step's own turns left in its thread: their tokens and the
   * newest first sentence, within the step's own time (a standing thread
   * holds other requests too). */
  function digests(row: HandedOver, at: number): { tokens: number; reply?: string } {
    const from = row.startedAt ?? row.createdAt;
    const until = teamStepEnded(row.status) ? (row.finishedAt ?? at) : at;
    let tokens = 0;
    let reply: string | undefined;
    for (const message of deps.messages(row.threadId, DIGEST_SCAN)) {
      if (message.kind !== "digest" || !message.digest) continue;
      const when = message.digest.at ?? message.at;
      if (when < from || when > until + 5_000) continue;
      const usage = message.digest.usage;
      if (usage) tokens += (usage.input ?? 0) + (usage.output ?? 0);
      if (message.digest.reply?.trim()) reply = message.digest.reply.trim();
    }
    return { tokens, ...(reply ? { reply } : {}) };
  }

  function facts(row: HandedOver, thread: TeamWorkThread, activity: BotActivityItem | undefined, at: number): Settled {
    const ended = teamStepEnded(row.status);
    const cached = ended ? settled.get(row.id) : undefined;
    if (cached) return cached;
    const from = row.startedAt ?? row.createdAt;
    const { tokens, reply } = digests(row, at);
    const merged = Boolean(activity?.code?.pullRequests.some((pull) => pull.action === "merged" && pull.at >= from - 1_000));
    // code work, or a step that runs in a repository folder on the server
    const coding = Boolean(activity?.coding || activity?.code || (thread.cwd && deps.inRepository?.(thread.cwd)));
    const failure = row.status === "failed" ? (deps.failureCause(row.threadId) ?? (row.outcomeDetail?.split(/\r?\n/).find((line) => line.trim())?.trim())) : undefined;
    const out: Settled = {
      tokens, merged, coding,
      ...(row.status === "completed" && reply ? { did: reply } : {}),
      ...(failure ? { failure } : {}),
    };
    if (ended) {
      if (settled.size >= SETTLED_CACHE_MAX) settled.delete(settled.keys().next().value!);
      settled.set(row.id, out);
    }
    return out;
  }

  function read(orchestratorId: string, viewerId: string | undefined, since: number): TeamWork {
    const at = now();
    const steps: TeamStepFacts[] = [];
    const teamBots = new Set<string>();
    for (const row of deps.handedOutBy(orchestratorId, at - TEAM_WORK_WINDOW_MS)) {
      if (row.requesterBotId !== orchestratorId || row.botId === orchestratorId) continue;
      if (row.mode === "consult" || row.groupId !== undefined || !row.threadId) continue;
      // the requester's conversation is the reader's own
      if (!row.requesterThreadId || !deps.threadReadable(orchestratorId, row.requesterThreadId, viewerId)) continue;
      if (deps.thread(orchestratorId, row.requesterThreadId)?.confidential) continue;
      const thread = deps.thread(row.botId, row.threadId);
      if (!thread || thread.confidential) continue;
      if (!deps.threadReadable(row.botId, row.threadId, viewerId)) continue;
      const activity = deps.activity(row.botId, row.threadId, viewerId);
      const peek = teamStepEnded(row.status) || row.status === "queued" ? undefined : deps.peek(row.threadId);
      const known = facts(row, thread, activity, at);
      const ended = teamStepEnded(row.status);
      // the send's title is the title of the thread this hand-over opened
      const opened = thread.openedBy?.delegationId === row.id && thread.title.trim();
      const title = (opened ? thread.title.trim() : stepTitle(row.brief)) || thread.title.trim();
      steps.push({
        id: row.id, botId: row.botId, requesterBotId: orchestratorId, threadId: row.threadId,
        title, ...labelFacts(row), mode: row.mode, status: row.status, createdAt: row.createdAt,
        ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
        ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
        ...(peek ? { turn: openTurn(peek) } : {}),
        ...(!ended && activity?.currentStep ? { doing: activity.currentStep } : {}),
        ...known,
      });
      teamBots.add(row.botId);
    }
    const names = new Map<string, { name: string; title?: string }>();
    const openTurns = new Map<string, TeamOpenTurn[]>();
    for (const botId of teamBots) {
      const named = deps.name(orchestratorId, botId);
      if (named) names.set(botId, named);
      const open = deps.openTurns(botId)
        .filter((peek) => !deps.thread(botId, peek.threadId)?.confidential && deps.threadReadable(botId, peek.threadId, viewerId))
        .map(openTurn);
      if (open.length) openTurns.set(botId, open);
    }
    return buildTeamWork({ orchestratorId, steps, now: at, since, names, openTurns });
  }

  return { read };
}
