// The work an orchestrator bot runs through its team (#3451, lot 1 #3461):
// what the Coding section of its panel reads, and the one live-state rule
// the server, the desktop and the phone share (team-work.vectors.json).
//
// A step is one hand-over: a runtime row (server/runtime/) whose requester
// is a turn of the orchestrator and whose assignee is another of the
// person's bots, in a direct thread, to do work (mode work or notify).
// Nothing new is stored for it. A piece of work is the steps that carry
// the same name; with no name, each hand-over is a piece of work of one
// step, named by its own title. A consultation, work inside a room and a
// hand-over a team bot makes further down are not steps.
//
// The live state of a team bot comes from its open turn's last event (the
// stall watchdog's clock, server/turns/turn-watchdog.ts), never from a
// plan: working (a tool call in flight, or an action less than
// TEAM_SILENT_MS old), silent for N min, waiting (to start, on the
// person's answer, on the computer, on another bot), idle.
//
// Every figure comes from a record: steps done over steps handed out (or
// over the plan the orchestrator declared, #3463), the time the steps
// ran, the tokens of their settled turns. Ids ride for keys
// and for opening a step's chat, never for the screen.

/** An open turn with no event and no tool call in flight for this long reads silent. */
export const TEAM_SILENT_MS = 3 * 60_000;
/** How far back hand-overs are listed (the activity window). */
export const TEAM_WORK_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Steps a piece of work shows before "N more". */
export const TEAM_WORK_STEPS_SHOWN = 8;
/** The words of a team note, at most. */
export const TEAM_NOTE_CHARS = 280;
/** Writes to the same step's thread within this long fold into one note. */
export const TEAM_NOTE_BURST_MS = 2 * 60_000;
/** The name of a piece of work the orchestrator gives, at most (#3463). */
export const TEAM_WORK_NAME_CHARS = 80;
/** The name of a step, at most. */
export const TEAM_STEP_NAME_CHARS = 40;
/** The steps of a declared plan, at most. */
export const TEAM_PLAN_STEPS = 12;

/** What the orchestrator says of a hand-over when it makes it (#3463,
 * optional fields of coordinate_bots and send_to_bot), stored on the
 * runtime row for display only: the piece of work it is a step of, the
 * step, and the plan of that work (its steps in order, with the bot of
 * each when known). One line each, secrets redacted. */
export interface TeamWorkLabel {
  name?: string;
  step?: string;
  plan?: TeamWorkPlanned[];
}

/** The runtime's own status of a hand-over (server/runtime/types.ts Status). */
export type TeamStepStatus =
  | "queued" | "running" | "needs_input" | "waiting" | "resume"
  | "completed" | "failed" | "cancelled" | "expired";

const TERMINAL: ReadonlySet<TeamStepStatus> = new Set(["completed", "failed", "cancelled", "expired"]);

export function teamStepEnded(status: TeamStepStatus): boolean {
  return TERMINAL.has(status);
}

export type TeamLiveState = "working" | "silent" | "waiting" | "idle";
/** start: not started yet. answer: the person's answer (a card, a question).
 * computer: the shared computer. bot: work it handed out itself. */
export type TeamWaitReason = "start" | "answer" | "computer" | "bot";

/** One open turn as the stall watchdog reads it (TurnWatchdog.peek). */
export interface TeamOpenTurn {
  startedAt: number;
  /** The last engine event of the turn: output, a tool call's start or end. */
  lastActionAt: number;
  /** A tool call is in flight since then (the oldest one still running). */
  toolSince?: number;
  waitingOnHuman?: boolean;
  waitingOnComputer?: boolean;
}

export interface TeamLive {
  state: TeamLiveState;
  /** waiting: on what. */
  wait?: TeamWaitReason;
  /** working, silent: the open turn's last action. */
  lastActionAt?: number;
  /** working: a tool call in flight since then. */
  toolSince?: number;
  /** silent: for how long, at the time of the read. */
  silentMs?: number;
}

/** The one live rule. `status` is the hand-over's, absent for a turn that
 * is no hand-over; `turn` is its open turn, when there is one. */
export function teamLive(input: { status?: TeamStepStatus; turn?: TeamOpenTurn | null }, now: number): TeamLive {
  const { status, turn } = input;
  if (status === "queued") return { state: "waiting", wait: "start" };
  if (status === "needs_input") return { state: "waiting", wait: "answer" };
  if (turn) {
    if (turn.waitingOnHuman) return { state: "waiting", wait: "answer" };
    if (turn.waitingOnComputer) return { state: "waiting", wait: "computer" };
    if (turn.toolSince !== undefined) return { state: "working", lastActionAt: turn.lastActionAt, toolSince: turn.toolSince };
    const quiet = Math.max(0, now - turn.lastActionAt);
    if (quiet < TEAM_SILENT_MS) return { state: "working", lastActionAt: turn.lastActionAt };
    return { state: "silent", lastActionAt: turn.lastActionAt, silentMs: quiet };
  }
  if (status === "waiting") return { state: "waiting", wait: "bot" };
  // owes its follow-up turn, which has not started yet
  if (status === "resume") return { state: "waiting", wait: "start" };
  // the runtime says a turn runs; the watchdog has not seen it yet
  if (status === "running") return { state: "working" };
  return { state: "idle" };
}

const RANK: Record<TeamLiveState, number> = { working: 3, silent: 2, waiting: 1, idle: 0 };

/** The strongest of several states: working, then silent, then waiting,
 * then idle. Between two working ones, the newest action. */
export function strongestLive(lives: readonly TeamLive[]): TeamLive {
  let best: TeamLive = { state: "idle" };
  for (const live of lives) {
    const ahead = RANK[live.state] - RANK[best.state];
    if (ahead > 0 || (ahead === 0 && live.state !== "idle" && (live.lastActionAt ?? -1) > (best.lastActionAt ?? -1))) best = live;
  }
  return best;
}

/** Names match after trim, single spaces and case folding. Nothing fuzzy. */
export function teamWorkName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** One hand-over as the builder reads it (the server gathers these facts
 * with the reader's rights; buildTeamWork decides nothing about rights). */
export interface TeamStepFacts {
  /** The hand-over (runtime row) id: a key, never shown. */
  id: string;
  /** The team bot that does it. */
  botId: string;
  /** The bot whose turn handed it out. */
  requesterBotId: string;
  /** Its thread, present only when the reader may open it. */
  threadId?: string;
  /** The step's name: the send's title, else the request's first line. */
  title: string;
  /** The name of the piece of work the orchestrator gave, when it gave one. */
  work?: string;
  /** The step's own name the orchestrator gave (#3463): shown, and matched
   * against the plan. Else the step is its title. */
  step?: string;
  /** The plan of the piece of work declared with this hand-over; the
   * latest declared wins. */
  plan?: readonly TeamWorkPlanned[];
  mode: "work" | "consult" | "notify";
  /** Work inside a room. */
  room?: boolean;
  status: TeamStepStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Its open turn, when one is open. */
  turn?: TeamOpenTurn;
  /** Running: the tool call in flight (or the newest), in words. */
  doing?: string;
  /** Finished: the first sentence of its answer. */
  did?: string;
  /** Failed: the first line of the cause the chat shows. */
  failure?: string;
  /** Input plus output tokens of its settled turns. */
  tokens?: number;
  /** One of its calls merged a pull request. */
  merged?: boolean;
  /** It did code work, or runs in a repository folder on the server. */
  coding?: boolean;
}

/** A hand-over is a step of this orchestrator's work. */
export function isTeamStep(step: Pick<TeamStepFacts, "botId" | "requesterBotId" | "mode" | "room">, orchestratorId: string): boolean {
  return step.mode !== "consult" && !step.room && step.requesterBotId === orchestratorId && step.botId !== orchestratorId;
}

export interface TeamWorkStep {
  id: string;
  botId: string;
  /** Present only when the reader may open the step's chat. */
  threadId?: string;
  name: string;
  status: TeamStepStatus;
  live: TeamLive;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** The time it ran: start to end, or to the read. */
  durationMs: number;
  tokens: number;
  doing?: string;
  did?: string;
  failure?: string;
  merged: boolean;
  done: boolean;
}

/** A step of a declared plan (#3463); in an item, one not handed out yet. */
export interface TeamWorkPlanned {
  name: string;
  botId?: string;
}

export interface TeamWorkItem {
  /** `work:<name>` for a named piece of work, `step:<id>` for one step. */
  key: string;
  name: string;
  /** Oldest first. */
  steps: TeamWorkStep[];
  /** Plan steps with no hand-over yet; empty with no declared plan. */
  toCome: TeamWorkPlanned[];
  /** Steps done, a step done again by the same bot counted once. */
  done: number;
  /** Steps handed out (plus the plan's steps to come). */
  total: number;
  durationMs: number;
  tokens: number;
  /** The bot working on it now, and its step. */
  current?: { botId: string; stepId: string };
  /** The live state of that step (idle when none is live). */
  live: TeamLive;
  finished: boolean;
  merged: boolean;
  startedAt: number;
  /** Finished: when its last step ended. */
  endedAt?: number;
  /** Its newest action, start or end: the live list's order. */
  updatedAt: number;
}

/** A bot of the team row: one that holds a step of the listed work. */
export interface TeamWorkBot {
  botId: string;
  /** Its name, read at the read, only for a bot the orchestrator can still
   * reach. Absent: the bot is not named. */
  name?: string;
  /** Its title (role), when it has one. */
  title?: string;
  live: TeamLive;
  /** The step a click opens: the one of its strongest state, else its newest. */
  stepId?: string;
  threadId?: string;
}

/** GET /api/bots/:id/team-work */
export interface TeamWork {
  botId: string;
  /** When it was read. */
  at: number;
  team: TeamWorkBot[];
  /** Pieces of work in progress, newest action first. */
  live: TeamWorkItem[];
  /** Pieces of work whose last step ended since the reader's midnight, newest first. */
  doneToday: TeamWorkItem[];
}

export interface TeamWorkInput {
  orchestratorId: string;
  steps: readonly TeamStepFacts[];
  now: number;
  /** The reader's local midnight: what "Done today" counts from. */
  since: number;
  /** The team bots' names and titles, for the bots the orchestrator can reach. */
  names?: ReadonlyMap<string, { name: string; title?: string }>;
  /** Other open turns of a team bot, in threads the reader may read. */
  openTurns?: ReadonlyMap<string, readonly TeamOpenTurn[]>;
}

const stepKey = (step: { botId: string; name: string }) => `${step.botId}\n${teamWorkName(step.name)}`;

function toStep(facts: TeamStepFacts, now: number): TeamWorkStep {
  const ended = teamStepEnded(facts.status);
  const end = ended ? (facts.finishedAt ?? now) : now;
  const durationMs = facts.startedAt !== undefined ? Math.max(0, end - facts.startedAt) : 0;
  return {
    id: facts.id, botId: facts.botId, ...(facts.threadId ? { threadId: facts.threadId } : {}),
    name: facts.step?.trim() || facts.title, status: facts.status, live: teamLive({ status: facts.status, ...(facts.turn ? { turn: facts.turn } : {}) }, now),
    createdAt: facts.createdAt,
    ...(facts.startedAt !== undefined ? { startedAt: facts.startedAt } : {}),
    ...(facts.finishedAt !== undefined && ended ? { finishedAt: facts.finishedAt } : {}),
    durationMs, tokens: Math.max(0, facts.tokens ?? 0),
    ...(!ended && facts.doing ? { doing: facts.doing } : {}),
    ...(facts.status === "completed" && facts.did ? { did: facts.did } : {}),
    ...(facts.status === "failed" && facts.failure ? { failure: facts.failure } : {}),
    merged: Boolean(facts.merged), done: facts.status === "completed",
  };
}

/** Steps done and the total: a step done again by the same bot counts
 * once. With a plan, each plan step counts once (done when one of its
 * hand-overs is), plus each hand-over outside it; the plan steps with no
 * hand-over yet are to come. */
function tally(steps: readonly TeamWorkStep[], plan: readonly TeamWorkPlanned[] | undefined): { done: number; total: number; toCome: TeamWorkPlanned[] } {
  const planned = new Map<string, { entry: TeamWorkPlanned; handed: boolean; done: boolean }>();
  for (const entry of plan ?? []) {
    const name = teamWorkName(entry.name);
    if (name && !planned.has(name)) planned.set(name, { entry, handed: false, done: false });
  }
  const outside = steps.filter((step) => {
    const slot = planned.get(teamWorkName(step.name));
    if (!slot) return true;
    slot.handed = true;
    if (step.done) slot.done = true;
    return false;
  });
  const slots = [...planned.values()];
  return {
    done: slots.filter((slot) => slot.done).length + new Set(outside.filter((step) => step.done).map(stepKey)).size,
    total: slots.length + new Set(outside.map(stepKey)).size,
    toCome: slots.filter((slot) => !slot.handed).map((slot) => ({ name: slot.entry.name, ...(slot.entry.botId ? { botId: slot.entry.botId } : {}) })),
  };
}

function toItem(key: string, name: string, steps: TeamWorkStep[], plan?: readonly TeamWorkPlanned[]): TeamWorkItem {
  steps.sort((a, b) => a.createdAt - b.createdAt);
  const { done, total, toCome } = tally(steps, plan);
  const live = steps.filter((step) => !teamStepEnded(step.status));
  const open = live.filter((step) => step.live.state === "working" || step.live.state === "silent");
  const current = open.sort((a, b) => (b.live.lastActionAt ?? 0) - (a.live.lastActionAt ?? 0))[0]
    ?? live.find((step) => step.status === "queued") ?? live[0];
  // no live step and no plan step left to hand out
  const finished = live.length === 0 && toCome.length === 0;
  const ends = steps.map((step) => step.finishedAt ?? step.createdAt);
  const endedAt = finished ? Math.max(...ends) : undefined;
  const updatedAt = Math.max(...steps.map((step) => Math.max(step.live.lastActionAt ?? 0, step.finishedAt ?? 0, step.startedAt ?? 0, step.createdAt)));
  return {
    key, name, steps, toCome, done, total,
    durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    tokens: steps.reduce((sum, step) => sum + step.tokens, 0),
    ...(current ? { current: { botId: current.botId, stepId: current.id } } : {}),
    live: current ? current.live : { state: "idle" },
    finished, merged: steps.some((step) => step.merged),
    startedAt: Math.min(...steps.map((step) => step.startedAt ?? step.createdAt)),
    ...(endedAt !== undefined ? { endedAt } : {}),
    updatedAt,
  };
}

/** The read model, from the hand-overs the server gathered. Pure. */
export function buildTeamWork(input: TeamWorkInput): TeamWork {
  const { orchestratorId, now, since } = input;
  const groups = new Map<string, { name: string; steps: TeamWorkStep[]; coding: boolean; plan?: { at: number; steps: readonly TeamWorkPlanned[] } }>();
  for (const facts of input.steps) {
    if (!isTeamStep(facts, orchestratorId)) continue;
    const named = facts.work ? teamWorkName(facts.work) : "";
    const key = named ? `work:${named}` : `step:${facts.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { name: (facts.work?.trim().replace(/\s+/g, " ")) || facts.title, steps: [], coding: false };
      groups.set(key, group);
    }
    group.steps.push(toStep(facts, now));
    if (facts.coding) group.coding = true;
    // the latest plan declared for a piece of work wins
    if (named && facts.plan?.length && (!group.plan || facts.createdAt >= group.plan.at)) group.plan = { at: facts.createdAt, steps: facts.plan };
  }
  const live: TeamWorkItem[] = [];
  const doneToday: TeamWorkItem[] = [];
  for (const [key, group] of groups) {
    // only code work is listed; other hand-overs stay in the chat
    if (!group.coding) continue;
    const item = toItem(key, group.name, group.steps, group.plan?.steps);
    if (!item.finished) live.push(item);
    else if ((item.endedAt ?? 0) >= since) doneToday.push(item);
  }
  live.sort((a, b) => b.updatedAt - a.updatedAt);
  doneToday.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { botId: orchestratorId, at: now, team: teamRow([...live, ...doneToday], input), live, doneToday };
}

function teamRow(items: readonly TeamWorkItem[], input: TeamWorkInput): TeamWorkBot[] {
  const byBot = new Map<string, TeamWorkStep[]>();
  for (const item of items) for (const step of item.steps) {
    const list = byBot.get(step.botId) ?? [];
    list.push(step);
    byBot.set(step.botId, list);
  }
  const team: TeamWorkBot[] = [];
  for (const [botId, steps] of byBot) {
    const extra = (input.openTurns?.get(botId) ?? []).map((turn) => teamLive({ turn }, input.now));
    const live = strongestLive([...steps.map((step) => step.live), ...extra]);
    const newest = [...steps].sort((a, b) => b.createdAt - a.createdAt);
    const open = newest.find((step) => step.live === live) ?? newest.find((step) => step.live.state === live.state) ?? newest[0];
    const named = input.names?.get(botId);
    team.push({
      botId,
      ...(named ? { name: named.name, ...(named.title ? { title: named.title } : {}) } : {}),
      live,
      ...(open ? { stepId: open.id, ...(open.threadId ? { threadId: open.threadId } : {}) } : {}),
    });
  }
  return team;
}

// ── the live frame ─────────────────────────────────────────────────────

/** Sent when a hand-over of that orchestrator is created, starts, parks or
 * settles. Ids only: the panel reads the list again with its own rights.
 * Never sent per tool call. */
export const TEAM_WORK_FRAME = "team.work";
export interface TeamWorkFrame {
  kind: typeof TEAM_WORK_FRAME;
  /** The orchestrator. */
  botId: string;
  /** The person whose work changed. Absent on a one-person server. */
  audience?: string;
}

/** A team work frame reaches the streams of the person it is for. A stream
 * with no viewer is this computer's operator. */
export function teamWorkFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== TEAM_WORK_FRAME) return true;
  if (typeof payload.audience !== "string" || !payload.audience) return true;
  const viewer = viewerId ?? localPersonId;
  return Boolean(viewer) && payload.audience.toLowerCase() === viewer.toLowerCase();
}

// ── the note to the orchestrator ───────────────────────────────────────

/** What the person wrote to a team bot in a step's chat, carried as one
 * quiet row (kind "text", `text` the readable fallback) into the person's
 * conversation with the bot that opened that thread. The orchestrator
 * reads it at its next turn; no turn is started for it. */
export interface TeamNote {
  /** The team bot written to. */
  botId: string;
  botName: string;
  /** The step's thread. */
  threadId: string;
  /** The step's title, when the thread has one. */
  title?: string;
  /** The words, secrets redacted, at most TEAM_NOTE_CHARS (the newest kept). */
  text: string;
  /** The first and the newest write of the burst. */
  at: number;
  lastAt: number;
  /** Writes folded into this row. */
  count: number;
}
