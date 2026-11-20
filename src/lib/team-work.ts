// The words and the client-side reading of an orchestrator bot's work
// (#3451, lot 2 #3462, #3575): what the Coding section of its panel says
// about each piece of work and its steps, and the meta line of a step's
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
import { activeLocale, t } from "@/lib/i18n";

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

/** When something happened, short: its time today, else its day ("Nov 12"). */
export function teamWhen(at: number, now: number): string {
  const day = new Date(at);
  const today = new Date(now);
  const same = day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth() && day.getDate() === today.getDate();
  try {
    return new Intl.DateTimeFormat(activeLocale(), same ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(day);
  } catch {
    return day.toISOString().slice(0, same ? 16 : 10).replace("T", " ");
  }
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
export function livePhrase(live: TeamLive, now: number): string {
  switch (live.state) {
    case "working":
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

/** The header's count: "3 working now · 1 silent", only the parts above zero. */
export function teamCount(team: readonly TeamWorkBot[]): string {
  const working = team.filter((bot) => bot.live.state === "working").length;
  const silent = team.filter((bot) => bot.live.state === "silent").length;
  const parts: string[] = [];
  if (working > 0) parts.push(t("teamWork.count.working", { count: working }));
  if (silent > 0) parts.push(t("teamWork.count.silent", { count: silent }));
  return parts.join(" · ");
}

/** The grey line of a row (#3575): the bot (its small mascot and its name),
 * then what it says, joined by " · ". Too long for the row (#3613), the name
 * gives way first, then the part at `action` (the last action, free words);
 * every other part (the progress, a state and its time) stays whole, and
 * the one at `spare` (the progress, a step's duration) steps aside whole
 * only when even the rest is too wide. */
export interface TeamLine {
  /** The bot whose mascot leads the line, when there is one. */
  botId?: string;
  who?: string;
  parts: string[];
  /** The index in `parts` of the last action, the one part that may be cut. */
  action?: number;
  /** The index in `parts` of the part that may step aside, whole, last. */
  spare?: number;
  /** The last action gives way before the name (a closed piece of work). */
  keepWho?: boolean;
}

/** The line as one string (tooltips, accessible names, tests). */
export function teamLineText(line: TeamLine): string {
  return [line.who, ...line.parts].filter(Boolean).join(" · ");
}

/** What a piece of work spent, in its unfolded detail: "12 min · 38k tokens". */
export function teamWorkSpend(item: Pick<TeamWorkItem, "durationMs" | "tokens">): string {
  const parts = [teamAge(item.durationMs)];
  if (item.tokens > 0) parts.push(t("teamWork.meta.tokens", { count: formatTokens(item.tokens) }));
  return parts.join(" · ");
}

/** The step of a piece of work its current bot holds. */
function currentStep(item: TeamWorkItem): TeamWorkStep | undefined {
  return item.current ? item.steps.find((step) => step.id === item.current!.stepId) : undefined;
}

/** A working bot's last action: "20 s ago", or what its tool call does and
 * for how long (two parts, the first one the action); any other state in its
 * own words. */
function lastAction(live: TeamLive, now: number, doing?: string): string[] {
  if (live.state !== "working") return [livePhrase(live, now)];
  if (live.toolSince !== undefined && doing) return [doing, teamAge(now - live.toolSince)];
  return [live.lastActionAt !== undefined ? t("teamWork.phrase.ago", { age: teamAge(now - live.lastActionAt) }) : t("teamWork.phrase.working")];
}

/** A work row's grey line: "<bot> · 2/5 · 20 s ago", "<bot> · 3/3 · merged 8 min ago". */
export function teamWorkLine(item: TeamWorkItem, nameOf: (botId: string) => TeamName | undefined, now: number, orchestrator?: TeamName & { botId?: string }): TeamLine {
  const progress = `${item.done}/${item.total}`;
  const last = [...item.steps].sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))[0];
  if (item.closed) {
    // closed as done by the orchestrator (#4421): its line and its words why
    const phrase = endPhrase("completed", item.merged, item.endedAt, now);
    const why = item.closed.why?.trim();
    const parts = why ? [progress, phrase, why] : [progress, phrase];
    const who = orchestrator ? { ...(orchestrator.botId ? { botId: orchestrator.botId } : {}), who: teamBotName(orchestrator) } : {};
    return { ...who, parts, ...(why ? { action: 2, keepWho: true } : {}), spare: 0 };
  }
  if (item.finished) {
    const phrase = endPhrase(last?.status ?? "completed", item.merged, item.endedAt, now);
    return last ? { botId: last.botId, who: teamBotName(nameOf(last.botId)), parts: [progress, phrase], spare: 0 } : { parts: [progress, phrase], spare: 0 };
  }
  const step = currentStep(item);
  const next = !step && item.toCome.length > 0 && orchestrator;
  if (item.staleSince !== undefined) {
    // nothing runs and nothing touched it for long (#4421): it says so
    const stale = t("teamWork.phrase.stale", { when: teamWhen(item.staleSince, now) });
    if (next) return { ...(next.botId ? { botId: next.botId } : {}), who: teamBotName(next), parts: [progress, stale], spare: 0 };
    const by = step ?? last;
    return { ...(by ? { botId: by.botId } : {}), who: teamBotName(by ? nameOf(by.botId) : undefined), parts: [progress, stale], spare: 0 };
  }
  if (next) {
    return { ...(next.botId ? { botId: next.botId } : {}), who: teamBotName(next), parts: [progress, t("teamWork.phrase.nextStep")], spare: 0 };
  }
  const said = lastAction(item.live, now, step?.doing);
  return { ...(step ? { botId: step.botId } : {}), who: teamBotName(step ? nameOf(step.botId) : undefined), parts: [progress, ...said], ...(said.length > 1 ? { action: 1 } : {}), spare: 0 };
}

/** A step's grey line: "<bot> · 14 tests, red before · 9 min". */
export function teamStepLine(step: TeamWorkStep, nameOf: (botId: string) => TeamName | undefined, now: number): TeamLine {
  const who = teamBotName(nameOf(step.botId));
  // what the step said or does is its last action, in its own words: it may
  // be cut; a state phrase and the times stay whole
  let note: string[];
  let action = false;
  if (teamStepEnded(step.status)) {
    const said = (step.status === "completed" ? step.did : step.status === "failed" ? step.failure : undefined)?.trim();
    note = [said || endPhrase(step.status, step.merged, step.finishedAt, now)];
    action = Boolean(said);
  } else if (step.live.state === "working" && step.doing) {
    const since = step.live.lastActionAt;
    note = since !== undefined && step.live.toolSince === undefined ? [step.doing, t("teamWork.phrase.ago", { age: teamAge(now - since) })] : [step.doing];
    action = true;
  } else {
    note = [livePhrase(step.live, now)];
  }
  const time = step.startedAt !== undefined ? teamAge(step.durationMs) : "";
  return { botId: step.botId, who, parts: time ? [...note, time] : note, ...(action ? { action: 0 } : {}), ...(time ? { spare: note.length } : {}) };
}

/** A step of the plan that was not handed out yet: "<bot> · to come". */
export function teamToComeLine(planned: { botId?: string }, nameOf: (botId: string) => TeamName | undefined): TeamLine {
  const named = planned.botId ? nameOf(planned.botId) : undefined;
  const toCome = t("teamWork.phrase.toCome");
  return planned.botId ? { botId: planned.botId, who: teamBotName(named), parts: [toCome] } : { parts: [toCome] };
}

/** Everything the Coding section draws that moves with the clock or the
 * live events (each row's grey line, what it spent, its state), as one
 * string: a tick whose face is the same draws nothing (#3624). */
export function teamWorkFace(work: TeamWork, now: number): string {
  const nameless = () => undefined;
  const parts: string[] = [];
  for (const item of [...work.live, ...work.doneToday]) {
    parts.push(item.key, item.live.state, teamLineText(teamWorkLine(item, nameless, now)), teamWorkSpend(item));
    for (const step of item.steps) parts.push(step.id, step.live.state, teamLineText(teamStepLine(step, nameless, now)));
  }
  for (const bot of work.team) parts.push(bot.botId, bot.live.state, bot.live.wait ?? "");
  return parts.join("\n");
}

/** The Done today row, said as a sentence (M-20261119-083, the owner: not
 * "Done today · 1"): "1 done today", "6 merged today", "6 done today, 2 merged". */
export function teamDoneLabel(items: readonly Pick<TeamWorkItem, "merged">[]): string {
  const count = items.length;
  const merged = items.filter((item) => item.merged).length;
  if (merged === 0) return count === 1 ? t("teamWork.done.one") : t("teamWork.done.other", { count });
  if (merged === count) return count === 1 ? t("teamWork.done.mergedAll.one") : t("teamWork.done.mergedAll.other", { count });
  return merged === 1 ? t("teamWork.done.mixed.one", { count }) : t("teamWork.done.mixed.other", { count, merged });
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
