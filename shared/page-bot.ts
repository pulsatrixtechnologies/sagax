// The `bot` page data (#5461): what a published page may show of its own
// bot. Built from plain inputs. Never a secret, a token, a working
// directory, a saved allow list, or another person's id: only the fields
// below are copied, and anything else on the input is dropped.
import { isApprovalMode, type ApprovalMode } from "./approval-mode.ts";

/** What the harness reports a bot is doing (shared/wire.ts BotActivity). */
export const PAGE_BOT_ACTIVITIES = ["working", "waiting-on-you", "idle", "no-signal", "dead", "parked.computer"] as const;
export type PageBotActivity = (typeof PAGE_BOT_ACTIVITIES)[number];

export interface PageBotRoutineView {
  id: string;
  name: string;
  enabled: boolean;
  lastRun?: { status: string; at: number };
}

export interface PageBotView {
  name: string;
  approvalMode: ApprovalMode;
  activity: PageBotActivity;
  routines: PageBotRoutineView[];
}

export interface PageBotRoutineInput {
  id: string;
  name: string;
  enabled: boolean;
}

export interface PageBotRunInput {
  routineId: string;
  status: string;
  /** When the run counts: finished, else started, else scheduled. */
  at: number;
  /** The run started or finished. A schedule that has not started loses to one that did. */
  happened?: boolean;
}

export interface PageBotViewInput {
  name: unknown;
  approvalMode: unknown;
  activity: unknown;
  routines?: readonly PageBotRoutineInput[] | null;
  runs?: readonly PageBotRunInput[] | null;
}

const ACTIVITIES = new Set<string>(PAGE_BOT_ACTIVITIES);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const STATUS = /^[a-z0-9_-]{1,40}$/i;

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    out += char;
  }
  return out.replace(/\s+/g, " ").trim();
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string" || !ID.test(value)) return null;
  return value;
}

function betterRun(next: { status: string; at: number; happened: boolean }, prior: { status: string; at: number; happened: boolean } | undefined): boolean {
  if (!prior) return true;
  if (next.happened !== prior.happened) return next.happened;
  return next.at >= prior.at;
}

/** The view a page receives. Unknown approval mode fails closed to ask.
 * Unknown activity fails closed to idle. Pure. */
export function pageBotView(input: PageBotViewInput): PageBotView {
  const latest = new Map<string, { status: string; at: number; happened: boolean }>();
  const runs = Array.isArray(input.runs) ? input.runs : [];
  for (const run of runs) {
    if (!run) continue;
    const routineId = cleanId(run.routineId);
    if (!routineId || typeof run.status !== "string" || !STATUS.test(run.status)) continue;
    if (typeof run.at !== "number" || !Number.isFinite(run.at) || run.at < 0) continue;
    const next = { status: run.status, at: run.at, happened: run.happened === true };
    if (betterRun(next, latest.get(routineId))) latest.set(routineId, next);
  }
  const routines: PageBotRoutineView[] = [];
  const seen = new Set<string>();
  const listed = Array.isArray(input.routines) ? input.routines : [];
  for (const routine of listed) {
    if (!routine) continue;
    const id = cleanId(routine.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const last = latest.get(id);
    routines.push({
      id,
      name: cleanName(routine.name),
      enabled: routine.enabled === true,
      ...(last ? { lastRun: { status: last.status, at: last.at } } : {}),
    });
  }
  routines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const activity = typeof input.activity === "string" && ACTIVITIES.has(input.activity) ? input.activity as PageBotActivity : "idle";
  return {
    name: cleanName(input.name),
    approvalMode: isApprovalMode(input.approvalMode) ? input.approvalMode : "ask",
    activity,
    routines,
  };
}
