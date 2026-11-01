// A bot reads every routine of a bot, page by page (2026-10-29).
//
// Why: a bot with 23 routines read back only 3. list_routines answered every
// routine at once as indented JSON, each with up to 2,000 characters of
// instructions and 1,000 of its last output (about 4 to 5 KB a routine).
// Above 24,000 characters an agents result is cut to its first 16,000
// (server/drivers/agents-result.ts boundedAgentResult), the rest only through
// tool_result_read: the model saw the first 3 routines and stopped there.
//
// Now a listing is a page of short rows (one line each, the instructions'
// first words), sized to stay well under that cut, with where the next page
// starts; one routine's full instructions and last run are read by its id.

/** A routine as list_routines and sagax_settings routine.list show it in a
 * page: what tells routines apart, never the whole instructions. */
export type RoutineRow = {
  id: string;
  name: string;
  folder?: string;
  enabled: boolean;
  schedule: unknown;
  nextRunAt: string | null;
  instructions: string;
  failureStreak?: number;
  autoPaused?: unknown;
  latestRun?: { status: unknown; at: unknown; error?: string } | null;
  /** Owned webhook id when this routine starts from a delivery (#1891). */
  webhookId?: string;
};

export const ROUTINE_PAGE_DEFAULT = 25;
export const ROUTINE_PAGE_MAX = 100;
/** A page's rows stay under this many characters: far below the 16,000 a
 * long agents result is cut to, and below sagax_settings' 8,000 read cap. */
export const ROUTINE_PAGE_BUDGET = 6_500;
const PREVIEW = 140;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function preview(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW)}…` : flat;
}

/** A row from a routine as the internal listing (agentRoutine) or the
 * Automations route (routineOnWire) gives it. */
export function routineRow(raw: unknown): RoutineRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const run = (r.latestRun ?? null) as Record<string, unknown> | null;
  const next = r.nextRunAt;
  return {
    id: r.id,
    name: text(r.name),
    ...(typeof r.folder === "string" && r.folder ? { folder: r.folder } : {}),
    enabled: r.enabled !== false,
    schedule: r.schedule ?? null,
    nextRunAt: typeof next === "string" ? next : typeof next === "number" && Number.isFinite(next) ? new Date(next).toISOString() : null,
    instructions: preview(text(r.instructions ?? r.prompt)),
    ...(typeof r.failureStreak === "number" && r.failureStreak > 0 ? { failureStreak: r.failureStreak } : {}),
    ...(r.autoPaused ? { autoPaused: r.autoPaused } : {}),
    ...(typeof r.webhookId === "string" && r.webhookId ? { webhookId: r.webhookId } : {}),
    ...(run && typeof run === "object"
      ? { latestRun: { status: run.status, at: run.finishedAt ?? run.startedAt ?? null, ...(typeof run.error === "string" && run.error ? { error: preview(run.error) } : {}) } }
      : {}),
  };
}

export type RoutinePage = {
  total: number;
  offset: number;
  /** Where the next page starts, or null when this page is the last. */
  nextOffset: number | null;
  routines: RoutineRow[];
};

/** Clamp a page request: offset from 0, limit 1 to ROUTINE_PAGE_MAX. */
export function routinePageRequest(raw: unknown): { offset: number; limit: number; folder?: string } {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const whole = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  const offset = whole(r.offset);
  const limit = whole(r.limit);
  return {
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(ROUTINE_PAGE_MAX, Math.trunc(limit)) : ROUTINE_PAGE_DEFAULT,
    ...(typeof r.folder === "string" && r.folder.trim() ? { folder: r.folder.trim() } : {}),
  };
}

/** One page of rows: at most `limit`, and only as many as fit the budget
 * (always at least one), so a page is never cut. */
export function pageRoutines(rows: readonly unknown[], request: unknown, budget = ROUTINE_PAGE_BUDGET): RoutinePage {
  const { offset, limit, folder } = routinePageRequest(request);
  const all = rows.map(routineRow).filter((row): row is RoutineRow => row !== null)
    .filter((row) => folder === undefined || row.folder === folder);
  const out: RoutineRow[] = [];
  let used = 0;
  for (let at = offset; at < all.length && out.length < limit; at += 1) {
    const size = JSON.stringify(all[at]).length + 1;
    if (out.length > 0 && used + size > budget) break;
    out.push(all[at]!);
    used += size;
  }
  const end = offset + out.length;
  return { total: all.length, offset, nextOffset: end < all.length ? end : null, routines: out };
}

/** A page as the bot reads it: what it holds, then one routine per line. */
export function formatRoutinePage(page: RoutinePage, context: { now: string; timeZone: string; who?: string; readOne: string; next: string }): string {
  const who = context.who ?? "This bot";
  if (!page.total) return `${who} has no routines. Current time: ${context.now}. Timezone: ${context.timeZone}.`;
  if (!page.routines.length) return `${who} has ${page.total} routines; none from offset ${page.offset}. Current time: ${context.now}. Timezone: ${context.timeZone}.`;
  const first = page.offset + 1;
  const last = page.offset + page.routines.length;
  const more = page.nextOffset === null
    ? "That is all of them."
    : `${page.total - last} more: ${context.next.replace("{offset}", String(page.nextOffset))}.`;
  return [
    `${who}'s routines ${first} to ${last} of ${page.total} (current time: ${context.now}; timezone: ${context.timeZone}). ${more} Instructions are shortened: ${context.readOne}.`,
    ...page.routines.map((row) => JSON.stringify(row)),
  ].join("\n");
}
