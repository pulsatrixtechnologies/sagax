// The Automations list grouped (2026-11-03, JC): by bot (the default), each
// bot with its own routine folders inside; by folder, across bots; or none,
// the flat list it always was. Which way and which bot sections are folded
// are per-person conveniences kept on this device (keyed by the signed-in
// person), so a blocked storage only means Bot and everything open.
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { orderedRoutineFolders, routineFolderKey } from "../../shared/routine-folders";

export type RoutineGroupBy = "bot" | "folder" | "none";

export const ROUTINE_GROUP_BY_KEY = "sagax.routines.groupBy.v1";
export const ROUTINE_GROUPS_COLLAPSED_KEY = "sagax.routines.groupsCollapsed.v1";

const LOCAL_PERSON = "local";

function read(key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a private window: kept for this page only
  }
}

const person = (viewerId: string | null | undefined) => viewerId?.toLowerCase() || LOCAL_PERSON;

export function routineGroupBy(viewerId: string | null | undefined): RoutineGroupBy {
  const saved = read(ROUTINE_GROUP_BY_KEY)[person(viewerId)];
  return saved === "folder" || saved === "none" ? saved : "bot";
}

export function saveRoutineGroupBy(viewerId: string | null | undefined, value: RoutineGroupBy): void {
  const all = read(ROUTINE_GROUP_BY_KEY);
  if (value === "bot") delete all[person(viewerId)];
  else all[person(viewerId)] = value;
  write(ROUTINE_GROUP_BY_KEY, all);
}

/** The folded sections of the grouped list: "bot:<id>" and "folder:<key>". */
export function collapsedRoutineGroups(viewerId: string | null | undefined): Set<string> {
  const saved = read(ROUTINE_GROUPS_COLLAPSED_KEY)[person(viewerId)];
  return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
}

export function saveCollapsedRoutineGroups(viewerId: string | null | undefined, keys: ReadonlySet<string>): void {
  const all = read(ROUTINE_GROUPS_COLLAPSED_KEY);
  if (keys.size) all[person(viewerId)] = [...keys];
  else delete all[person(viewerId)];
  write(ROUTINE_GROUPS_COLLAPSED_KEY, all);
}

export const botGroupKey = (botId: string) => `bot:${botId}`;
export const folderGroupKey = (folder: string | null) => folder === null ? "folder:" : `folder:${routineFolderKey(folder)}`;

interface GroupBot { id: string; pinned?: boolean; chiefOfStaff?: boolean; ownerUserId?: string }
interface GroupRoutine { id: string; botId: string; folder?: string }

/** The bots in the sidebar's order: the person's Primary Bot, then the
 * pinned bots, then the others as the sidebar keeps them. */
export function sidebarBotOrder<B extends GroupBot>(bots: readonly B[], viewerId: string | null | undefined): B[] {
  const rank = (bot: B) => viewerId && isViewersPrimaryBot(bot, viewerId) ? 0 : bot.pinned ? 1 : 2;
  return bots.map((bot, index) => ({ bot, index })).sort((a, b) => rank(a.bot) - rank(b.bot) || a.index - b.index).map(({ bot }) => bot);
}

export interface RoutineBotGroup<R> {
  botId: string;
  routines: R[];
}

/** One section per bot that has a routine here, in the sidebar's order; a
 * bot the list does not know (someone else's, a wider scope) after them, in
 * the order its routines come. Routines keep their order inside. */
export function groupRoutinesByBot<R extends GroupRoutine, B extends GroupBot>(routines: readonly R[], bots: readonly B[], viewerId: string | null | undefined): RoutineBotGroup<R>[] {
  const byBot = new Map<string, R[]>();
  for (const routine of routines) {
    const bucket = byBot.get(routine.botId);
    if (bucket) bucket.push(routine);
    else byBot.set(routine.botId, [routine]);
  }
  const out: RoutineBotGroup<R>[] = [];
  for (const bot of sidebarBotOrder(bots, viewerId)) {
    const items = byBot.get(bot.id);
    if (!items) continue;
    out.push({ botId: bot.id, routines: items });
    byBot.delete(bot.id);
  }
  for (const [botId, items] of byBot) out.push({ botId, routines: items });
  return out;
}

export interface RoutineFolderAcrossGroup<R> {
  /** null: the routines in no folder. */
  folder: string | null;
  routines: R[];
}

/** Group by Folder: one section per folder name (whatever its case) across
 * the bots, the bots in the sidebar's order and each bot's folders in its
 * saved order; the routines in no folder first. Only folders with a routine
 * here show. */
export function groupRoutinesAcrossFolders<R extends GroupRoutine, B extends GroupBot>(routines: readonly R[], bots: readonly B[], folderOrders: Readonly<Record<string, readonly string[]>> | undefined, viewerId: string | null | undefined): RoutineFolderAcrossGroup<R>[] {
  const botIds = groupRoutinesByBot(routines, bots, viewerId).map((group) => group.botId);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const botId of botIds) {
    const own = routines.filter((routine) => routine.botId === botId);
    for (const name of orderedRoutineFolders(folderOrders?.[botId] ?? [], own)) {
      const key = routineFolderKey(name);
      if (!seen.has(key)) { seen.add(key); names.push(name); }
    }
  }
  const byKey = new Map<string, R[]>(names.map((name) => [routineFolderKey(name), []]));
  const loose: R[] = [];
  for (const routine of routines) {
    const bucket = routine.folder ? byKey.get(routineFolderKey(routine.folder)) : undefined;
    if (bucket) bucket.push(routine);
    else loose.push(routine);
  }
  return [
    ...(loose.length ? [{ folder: null, routines: loose }] : []),
    ...names.flatMap((name) => {
      const items = byKey.get(routineFolderKey(name))!;
      return items.length ? [{ folder: name, routines: items }] : [];
    }),
  ];
}

/** A bot section's live summary: how many of its routines run right now and
 * how many are failing (a failure streak, or paused after failures). */
export function routineGroupHealth(routines: readonly { id: string; failureStreak?: number; autoPaused?: unknown; enabled: boolean }[], runs: readonly { routineId: string; status: string }[]): { running: number; failing: number } {
  let running = 0;
  let failing = 0;
  for (const routine of routines) {
    if (runs.some((run) => run.routineId === routine.id && run.status === "running")) running += 1;
    else if ((routine.failureStreak ?? 0) > 0 || (!routine.enabled && routine.autoPaused)) failing += 1;
  }
  return { running, failing };
}
