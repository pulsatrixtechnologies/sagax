// The words and the client-side reading of an orchestrator bot's work
// (#3451, lot 2 #3462): what the Coding section of its panel says about the
// team row, each piece of work and its steps, and the meta line of a step's
// coding chat. The read model and the one live rule are shared
// (shared/team-work.ts); this file only words them, re-ages them on the
// person's clock and folds the live events the app already receives. Labels
// only: an id is a key, never a word on screen.
import {
  strongestLive,
  TEAM_NOTE_BURST_MS,
  teamLive,
  teamStepEnded,
  type TeamLive,
  type TeamNote,
  type TeamOpenTurn,
  type TeamWork,
  type TeamWorkBot,
  type TeamWorkItem,
  type TeamWorkStep,
} from "../../shared/team-work";
import { formatTokens } from "@/lib/usage";
import { t } from "@/lib/i18n";

export type { TeamLive, TeamNote, TeamWork, TeamWorkBot, TeamWorkItem, TeamWorkStep };

/** A name a bot shows: its title, else its name. */
export interface TeamName {
  name: string;
  title?: string;
}

/** A short age: "40 s", "6 min", "1 h 52". */
export function teamAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t("teamWork.age.seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("teamWork.age.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("teamWork.age.hours", { hours }) : t("teamWork.age.hoursMinutes", { hours, minutes: String(rest).padStart(2, "0") });
}

/** A live state read again at `now`: an open turn turns silent once its
 * last action is TEAM_SILENT_MS old, with no request (the shared rule). */
export function liveAt(live: TeamLive, now: number): TeamLive {
  if ((live.state !== "working" && live.state !== "silent") || live.lastActionAt === undefined) return live;
  return teamLive({ turn: { startedAt: 0, lastActionAt: live.lastActionAt, ...(live.toolSince !== undefined ? { toolSince: live.toolSince } : {}) } }, now);
}

/** What the live events of a step's thread said since the read. */
export interface TeamOverlay {
  lastActionAt: number;
  /** Tool calls in flight, and since when the oldest one runs. */
  tools: number;
  toolSince?: number;
  computer?: boolean;
}

/** The overlay after one runtime event of the step's thread, or null for
 * an event that says nothing about it. Pure, one object per event. */
export function foldTeamEvent(current: TeamOverlay | undefined, event: { type: string; itemType?: string; createdAt?: string }, at: number): TeamOverlay | null {
  const base: TeamOverlay = current ?? { lastActionAt: at, tools: 0 };
  switch (event.type) {
    case "item.started":
      if (event.itemType !== "tool") return { ...base, lastActionAt: at };
      return { ...base, lastActionAt: at, tools: base.tools + 1, toolSince: base.toolSince ?? at };
    case "item.completed":
      if (event.itemType !== "tool") return { ...base, lastActionAt: at };
      {
        const tools = Math.max(0, base.tools - 1);
        const { toolSince: _since, ...rest } = base;
        return tools > 0 ? { ...base, lastActionAt: at, tools } : { ...rest, lastActionAt: at, tools };
      }
    case "content.delta":
    case "item.updated":
    case "turn.started":
      return { ...base, lastActionAt: at };
    case "turn.wait_started":
      return { ...base, lastActionAt: at, computer: true };
    case "turn.wait_ended":
      return { ...base, lastActionAt: at, computer: false };
    default:
      return null;
  }
}

function stepLiveNow(step: TeamWorkStep, overlay: TeamOverlay | undefined, now: number): TeamLive {
  if (!overlay || teamStepEnded(step.status)) return liveAt(step.live, now);
  // the step's turn is open: what the stream saw wins over the read
  const turn: TeamOpenTurn = {
    startedAt: step.startedAt ?? overlay.lastActionAt,
    lastActionAt: Math.max(overlay.lastActionAt, step.live.lastActionAt ?? 0),
    ...(overlay.tools > 0 && overlay.toolSince !== undefined ? { toolSince: overlay.toolSince } : {}),
    ...(step.live.wait === "answer" && step.status !== "needs_input" ? { waitingOnHuman: true } : {}),
    ...(overlay.computer ?? step.live.wait === "computer" ? { waitingOnComputer: true } : {}),
  };
  return teamLive({ status: step.status === "queued" ? "running" : step.status, turn }, now);
}

/** The read, re-aged at `now` with what the stream said since. Pure. */
export function teamWorkAt(work: TeamWork, overlays: ReadonlyMap<string, TeamOverlay>, now: number): TeamWork {
  const lives = new Map<string, TeamLive>();
  const step = (entry: TeamWorkStep): TeamWorkStep => {
    const live = stepLiveNow(entry, entry.threadId ? overlays.get(entry.threadId) : undefined, now);
    lives.set(entry.id, live);
    const durationMs = !teamStepEnded(entry.status) && entry.startedAt !== undefined ? Math.max(entry.durationMs, now - entry.startedAt) : entry.durationMs;
    return live === entry.live && durationMs === entry.durationMs ? entry : { ...entry, live, durationMs };
  };
  const item = (entry: TeamWorkItem): TeamWorkItem => {
    const steps = entry.steps.map(step);
    const current = entry.current ? lives.get(entry.current.stepId) : undefined;
    const durationMs = steps.reduce((sum, one) => sum + one.durationMs, 0);
    return { ...entry, steps, live: current ?? liveAt(entry.live, now), durationMs };
  };
  const live = work.live.map(item);
  const doneToday = work.doneToday.map(item);
  const stepsOf = new Map<string, TeamLive[]>();
  for (const entry of [...live, ...doneToday]) for (const one of entry.steps) {
    const list = stepsOf.get(one.botId) ?? [];
    list.push(lives.get(one.id) ?? one.live);
    stepsOf.set(one.botId, list);
  }
  const team = work.team.map((bot) => ({ ...bot, live: strongestLive([liveAt(bot.live, now), ...(stepsOf.get(bot.botId) ?? [])]) }));
  return { ...work, team, live, doneToday };
}

/** The threads whose live events move the section: the steps still open. */
export function teamLiveThreads(work: TeamWork | null): ReadonlySet<string> {
  const threads = new Set<string>();
  for (const item of work?.live ?? []) for (const step of item.steps) if (step.threadId && !teamStepEnded(step.status)) threads.add(step.threadId);
  return threads;
}

/** Something is open: the ages need a clock. */
export function teamWorkTicking(work: TeamWork | null): boolean {
  return Boolean(work?.live.some((item) => item.steps.some((step) => !teamStepEnded(step.status))));
}

// ── words ─────────────────────────────────────────────────────────────

function waitPhrase(live: TeamLive): string {
  switch (live.wait) {
    case "answer": return t("teamWork.wait.answer");
    case "computer": return t("teamWork.wait.computer");
    case "bot": return t("teamWork.wait.bot");
    default: return t("teamWork.wait.start");
  }
}

/** The state in a few words, without the bot: "last action 40 s ago",
 * "silent for 6 min", "waiting for your answer", "idle". */
export function livePhrase(live: TeamLive, now: number, options: { doing?: string } = {}): string {
  switch (live.state) {
    case "working":
      if (live.toolSince !== undefined && options.doing) return `${options.doing} · ${teamAge(now - live.toolSince)}`;
      return live.lastActionAt !== undefined ? t("teamWork.phrase.lastAction", { age: teamAge(now - live.lastActionAt) }) : t("teamWork.phrase.working");
    case "silent":
      return t("teamWork.phrase.silent", { age: teamAge(live.silentMs ?? (live.lastActionAt !== undefined ? now - live.lastActionAt : 0)) });
    case "waiting":
      return waitPhrase(live);
    default:
      return t("teamWork.phrase.idle");
  }
}

/** How a step or a piece of work ended, with its age. */
function endPhrase(status: TeamWorkStep["status"], merged: boolean, endedAt: number | undefined, now: number): string {
  const age = teamAge(now - (endedAt ?? now));
  if (merged) return t("teamWork.phrase.merged", { age });
  if (status === "failed") return t("teamWork.phrase.failed", { age });
  if (status === "cancelled" || status === "expired") return t("teamWork.phrase.stopped", { age });
  return t("teamWork.phrase.finished", { age });
}

/** A bot's label: its name, else a neutral word (never its id). */
export function teamBotName(names: TeamName | undefined): string {
  return names?.name?.trim() || t("teamWork.unnamed");
}

/** The tile's label: the bot's name, as its rows name it. */
export function teamTileLabel(names: TeamName | undefined): string {
  return teamBotName(names);
}

/** The title under the tile's name, when it says more than the name. */
export function teamTileTitle(names: TeamName | undefined): string | undefined {
  const title = names?.title?.trim();
  return title && title !== teamBotName(names) ? title : undefined;
}

/** The tile's accessible name: "<bot>, silent for 6 min". */
export function teamTileAria(names: TeamName | undefined, live: TeamLive, now: number): string {
  const state = live.state === "working" ? t("teamWork.phrase.workingNow") : livePhrase(live, now);
  return t("teamWork.tile.aria", { name: teamBotName(names), state });
}

/** The header's count: "3 working now · 1 silent", only the parts above zero. */
export function teamCount(team: readonly TeamWorkBot[]): string {
  const working = team.filter((bot) => bot.live.state === "working").length;
  const silent = team.filter((bot) => bot.live.state === "silent").length;
  const parts: string[] = [];
  if (working > 0) parts.push(t("teamWork.count.working", { count: working }));
  if (silent > 0) parts.push(t("teamWork.count.silent", { count: silent }));
  return parts.join(" · ");
}

/** A work row's figures: "3/5 · 12 min · 38k tokens". */
export function teamWorkMeta(item: Pick<TeamWorkItem, "done" | "total" | "durationMs" | "tokens">): string {
  const parts = [`${item.done}/${item.total}`, teamAge(item.durationMs)];
  if (item.tokens > 0) parts.push(t("teamWork.meta.tokens", { count: formatTokens(item.tokens) }));
  return parts.join(" · ");
}

/** The share of the bar: steps done over the total. */
export function teamWorkShare(item: Pick<TeamWorkItem, "done" | "total">): number {
  return item.total > 0 ? Math.min(1, Math.max(0, item.done / item.total)) : 0;
}

/** The step of a piece of work its current bot holds. */
function currentStep(item: TeamWorkItem): TeamWorkStep | undefined {
  return item.current ? item.steps.find((step) => step.id === item.current!.stepId) : undefined;
}

/** A work row's state line: "<bot> · last action 40 s ago". */
export function teamWorkStateLine(item: TeamWorkItem, nameOf: (botId: string) => TeamName | undefined, now: number, orchestrator?: TeamName): string {
  if (item.finished) {
    const last = [...item.steps].sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))[0];
    const who = last ? teamBotName(nameOf(last.botId)) : undefined;
    const phrase = endPhrase(last?.status ?? "completed", item.merged, item.endedAt, now);
    return who ? `${who} · ${phrase}` : phrase;
  }
  const step = currentStep(item);
  if (!step && item.toCome.length > 0 && orchestrator) return `${teamBotName(orchestrator)} · ${t("teamWork.phrase.nextStep")}`;
  const who = teamBotName(step ? nameOf(step.botId) : undefined);
  return `${who} · ${livePhrase(item.live, now, { doing: step?.doing })}`;
}

/** What a step does or did, after its bot: "<bot> · 14 tests, red before". */
export function teamStepNote(step: TeamWorkStep, nameOf: (botId: string) => TeamName | undefined, now: number): string {
  const who = teamBotName(nameOf(step.botId));
  if (teamStepEnded(step.status)) {
    const said = step.status === "completed" ? step.did : step.status === "failed" ? step.failure : undefined;
    return `${who} · ${said?.trim() || endPhrase(step.status, step.merged, step.finishedAt, now)}`;
  }
  if (step.live.state === "working" && step.doing) {
    const since = step.live.lastActionAt;
    return since !== undefined && step.live.toolSince === undefined
      ? `${who} · ${step.doing} · ${t("teamWork.phrase.ago", { age: teamAge(now - since) })}`
      : `${who} · ${step.doing}`;
  }
  return `${who} · ${livePhrase(step.live, now)}`;
}

/** A step of the plan that was not handed out yet. */
export function teamToComeNote(name: TeamName | undefined): string {
  return name ? `${teamBotName(name)} · ${t("teamWork.phrase.toCome")}` : t("teamWork.phrase.toCome");
}

/** A step's duration on its row: none for a step that did not start. */
export function teamStepTime(step: TeamWorkStep): string {
  return step.startedAt !== undefined ? teamAge(step.durationMs) : "";
}

/** "Done today · 6 merged", "Done today · 6 done, 2 merged", "Done today · 6". */
export function teamDoneLabel(items: readonly Pick<TeamWorkItem, "merged">[]): string {
  const merged = items.filter((item) => item.merged).length;
  const title = t("teamWork.done.title");
  if (merged === 0) return `${title} · ${items.length}`;
  if (merged === items.length) return `${title} · ${t("teamWork.done.merged", { count: merged })}`;
  return `${title} · ${t("teamWork.done.mixed", { count: items.length, merged })}`;
}

/** Where a step sits in its piece of work, for the coding chat's meta line. */
export interface TeamStepPlace {
  item: TeamWorkItem;
  step: TeamWorkStep;
  index: number;
  total: number;
}

/** The step of the orchestrator's work that runs in this thread. */
export function teamStepOf(work: TeamWork | null, threadId: string | undefined): TeamStepPlace | null {
  if (!work || !threadId) return null;
  for (const item of [...work.live, ...work.doneToday]) {
    const index = item.steps.findIndex((step) => step.threadId === threadId);
    if (index >= 0) return { item, step: item.steps[index]!, index: index + 1, total: Math.max(item.total, index + 1) };
  }
  return null;
}

/** The step chat's meta line: "<work> · step 3 of 5 · last action 20 s ago",
 * "… · finished 4 min ago". The step's own name is the chat's title. */
export function teamStepMetaLine(place: TeamStepPlace, now: number): string {
  const { item, step } = place;
  const parts: string[] = [];
  if (item.name.trim() && item.steps.length + item.toCome.length > 1) parts.push(item.name.trim());
  if (place.total > 1) parts.push(t("teamWork.chat.step", { index: place.index, total: place.total }));
  parts.push(teamStepEnded(step.status) ? endPhrase(step.status, step.merged, step.finishedAt, now) : livePhrase(step.live, now));
  return parts.join(" · ");
}

/** When a step's open turn last did something: the working line's quiet age. */
export function teamQuietSince(place: TeamStepPlace | null): number | null {
  if (!place || teamStepEnded(place.step.status)) return null;
  const live = place.step.live;
  if (live.toolSince !== undefined) return null;
  return live.state === "working" || live.state === "silent" ? live.lastActionAt ?? null : null;
}

// ── the note in the orchestrator's chat ───────────────────────────────

/** A note row hidden because the next row is the same burst (the server
 * patches one row; two rows that still meet fold into the newer). */
export function teamNoteFolded(note: TeamNote, next: TeamNote | undefined): boolean {
  return Boolean(next && next.threadId === note.threadId && next.at - note.lastAt <= TEAM_NOTE_BURST_MS);
}

/** The writes a note stands for, with the earlier rows of its burst. */
export function teamNoteCount(note: TeamNote, before: readonly TeamNote[]): number {
  let count = Math.max(1, note.count);
  let edge = note;
  for (let index = before.length - 1; index >= 0; index--) {
    const prev = before[index]!;
    if (!teamNoteFolded(prev, edge)) break;
    count += Math.max(1, prev.count);
    edge = prev;
  }
  return count;
}
