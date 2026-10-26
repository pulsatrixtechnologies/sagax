// Care of the bot's computer (Settings > Computer): a scheduled update in a
// maintenance window, and a disk saver that previews what it would free
// before it frees anything.
//
// The computer is the one /api/computer/status manages
// (server/routes/computer-status.ts): the signed-in person's own server
// environment on an organization server ("person:<principalId>"), this
// computer's shared Local VM on a personal one ("local").
//
// Update = the existing "update" action (rebuild from the current image,
// keeping the workspace). It never runs while the computer is in use: the
// scheduler waits inside the window and reports a postponement once the
// window has passed.
//
// Disk saver: every path is fixed here; nothing a person or a model sends
// reaches a cleaning command (categories are an enum). The workspace is
// never a category. The only category that holds a person's own files (the
// trash of the bot's computer) is off by default and needs an explicit
// confirmation on the request.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { folderBytes } from "./disk-usage.ts";

// ── schedule ────────────────────────────────────────────────────────────

export const MAINTENANCE_WINDOW_HOURS = [1, 2, 3, 4, 6] as const;

export const maintenanceScheduleSchema = z.object({
  enabled: z.boolean(),
  /** 0 = Sunday … 6 = Saturday, in `timeZone`. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  /** Start of the window, local hour 0-23 in `timeZone`. */
  hour: z.number().int().min(0).max(23),
  windowHours: z.number().int().min(1).max(6),
  /** IANA zone of the person who set it (their browser's). */
  timeZone: z.string().min(1).max(64),
}).strict();

export type MaintenanceSchedule = z.infer<typeof maintenanceScheduleSchema>;

export type MaintenanceOutcome = "updated" | "postponed" | "failed";

export interface MaintenanceResult {
  at: number;
  outcome: MaintenanceOutcome;
  /** Short reason for a failure (never a secret: an error message). */
  detail?: string;
}

export interface MaintenanceEntry {
  schedule: MaintenanceSchedule;
  /** When the schedule was last saved: a window that ended before it is
   * never reported as postponed. */
  savedAt?: number;
  /** Start of the window the last attempt belonged to (one run per window). */
  lastWindowStart?: number;
  lastResult?: MaintenanceResult;
}

export const DEFAULT_SCHEDULE: MaintenanceSchedule = {
  enabled: false,
  days: [0],
  hour: 3,
  windowHours: 2,
  timeZone: "UTC",
};

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Weekday (0 = Sunday) and hour of `at` in `zone`. */
function zonedParts(at: number, zone: string): { day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

/** The start of the window `at` falls in, or null outside every window.
 * Rounded down to the minute; a window that starts on an allowed day may
 * run past midnight. */
export function windowStartAt(schedule: MaintenanceSchedule, at: number): number | null {
  const zone = validTimeZone(schedule.timeZone) ? schedule.timeZone : "UTC";
  // Walk back hour by hour (at most the window's length) looking for the
  // window's start hour on an allowed day.
  for (let back = 0; back < schedule.windowHours; back++) {
    const probe = at - back * 3_600_000;
    const { day, hour, minute } = zonedParts(probe, zone);
    if (hour === schedule.hour && schedule.days.includes(day)) {
      const start = probe - minute * 60_000;
      return Math.floor(start / 60_000) * 60_000;
    }
  }
  return null;
}

/** The next window start strictly after `after` (searched hour by hour over
 * eight days), or null when the schedule is off. */
export function nextWindowStart(schedule: MaintenanceSchedule, after: number): number | null {
  if (!schedule.enabled) return null;
  const zone = validTimeZone(schedule.timeZone) ? schedule.timeZone : "UTC";
  let probe = Math.floor(after / 60_000) * 60_000 + 60_000;
  // Align to the next whole hour in the zone.
  const first = zonedParts(probe, zone);
  if (first.minute !== 0) probe += (60 - first.minute) * 60_000;
  for (let i = 0; i < 24 * 8; i++, probe += 3_600_000) {
    const { day, hour } = zonedParts(probe, zone);
    if (hour === schedule.hour && schedule.days.includes(day)) return probe;
  }
  return null;
}

interface CareFile {
  version: 1;
  computers: Record<string, MaintenanceEntry>;
}

/** The schedules, one per computer key, in one 0600 JSON file. */
export class MaintenanceStore {
  private data: CareFile = { version: 1, computers: {} };
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as CareFile;
      if (parsed?.version === 1 && parsed.computers && typeof parsed.computers === "object") {
        for (const [key, entry] of Object.entries(parsed.computers)) {
          const schedule = maintenanceScheduleSchema.safeParse(entry?.schedule);
          if (!schedule.success) continue;
          this.data.computers[key] = {
            schedule: schedule.data,
            ...(typeof entry.savedAt === "number" ? { savedAt: entry.savedAt } : {}),
            ...(typeof entry.lastWindowStart === "number" ? { lastWindowStart: entry.lastWindowStart } : {}),
            ...(entry.lastResult && typeof entry.lastResult.at === "number" ? { lastResult: entry.lastResult } : {}),
          };
        }
      }
    } catch {
      /* no file yet, or unreadable: start empty */
    }
  }

  get(key: string): MaintenanceEntry | undefined {
    return this.data.computers[key];
  }

  entries(): Array<[string, MaintenanceEntry]> {
    return Object.entries(this.data.computers);
  }

  setSchedule(key: string, schedule: MaintenanceSchedule, savedAt = Date.now()): MaintenanceEntry {
    const current = this.data.computers[key];
    const next: MaintenanceEntry = { ...current, schedule, savedAt };
    this.data.computers[key] = next;
    this.persist();
    return next;
  }

  record(key: string, windowStart: number, result: MaintenanceResult): void {
    const current = this.data.computers[key];
    if (!current) return;
    this.data.computers[key] = { ...current, lastWindowStart: windowStart, lastResult: result };
    this.persist();
  }

  remove(key: string): void {
    if (!(key in this.data.computers)) return;
    delete this.data.computers[key];
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}

/** What the scheduler needs from one computer. */
export interface MaintainedComputer {
  /** Whether anything uses the computer now (a command, a turn, a lease). */
  busy(): Promise<boolean>;
  /** The update action; throws on failure. */
  update(): Promise<void>;
}

export interface MaintenanceSchedulerOptions {
  store: MaintenanceStore;
  /** The computer behind a key, or null when it no longer exists here. */
  computer(key: string): MaintainedComputer | null;
  now?: () => number;
  log?: (line: string) => void;
}

/** One pass per minute: a computer inside its window that has not run in
 * this window updates when idle; one whose window passed while it was busy
 * records a postponement. Never two updates of the same computer at once. */
export class MaintenanceScheduler {
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly options: MaintenanceSchedulerOptions;

  constructor(options: MaintenanceSchedulerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  /** Hold a computer for an update asked by hand (Update now, Recover):
   * false while the scheduled one or another hand update holds it. */
  claim(key: string): boolean {
    if (this.running.has(key)) return false;
    this.running.add(key);
    return true;
  }

  release(key: string): void {
    this.running.delete(key);
  }

  /** A bot works on this computer (the same check the scheduled update uses). */
  async busy(key: string): Promise<boolean> {
    const computer = this.options.computer(key);
    return computer ? await computer.busy() : false;
  }

  async tick(): Promise<void> {
    const now = this.now();
    await Promise.all(this.options.store.entries().map(([key, entry]) => this.consider(key, entry, now)));
  }

  private async consider(key: string, entry: MaintenanceEntry, now: number): Promise<void> {
    if (!entry.schedule.enabled || this.running.has(key)) return;
    const start = windowStartAt(entry.schedule, now);
    if (start === null) {
      // The window passed without an update: say so once.
      const previous = this.previousWindowStart(entry, now);
      if (previous !== null && (entry.lastWindowStart ?? 0) < previous && (entry.savedAt ?? 0) <= previous) {
        this.options.store.record(key, previous, { at: now, outcome: "postponed", detail: "busy" });
      }
      return;
    }
    if ((entry.lastWindowStart ?? 0) >= start) return;
    const computer = this.options.computer(key);
    if (!computer) return;
    this.running.add(key);
    try {
      if (await computer.busy()) return;
      try {
        await computer.update();
        this.options.store.record(key, start, { at: this.now(), outcome: "updated" });
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
        this.options.log?.(`computer-care: scheduled update of ${key.startsWith("person:") ? "a server environment" : "the Local VM"} failed: ${detail}`);
        this.options.store.record(key, start, { at: this.now(), outcome: "failed", detail });
      }
    } catch {
      /* busy() failed: try again on the next pass */
    } finally {
      this.running.delete(key);
    }
  }

  /** The start of the most recent window that already ended, within the
   * last day, or null. */
  private previousWindowStart(entry: MaintenanceEntry, now: number): number | null {
    const hours = entry.schedule.windowHours;
    // The window that ended within the last hour (one pass per minute
    // catches it; a server that was off longer just runs the next one).
    const probe = now - hours * 3_600_000;
    const start = windowStartAt(entry.schedule, probe);
    if (start === null) return null;
    return start + hours * 3_600_000 <= now && now - (start + hours * 3_600_000) < 3_600_000 ? start : null;
  }
}

// ── disk saver ──────────────────────────────────────────────────────────

/** Categories measured inside the bot's computer (paths under its HOME). */
export const INSIDE_CATEGORIES = ["packageCaches", "browserCache", "thumbnails", "tempFiles", "trash"] as const;
/** Categories on this server (a personal server only). */
export const HOST_CATEGORIES = ["oldCheckpoints"] as const;
export const DISK_SAVER_CATEGORIES = [...INSIDE_CATEGORIES, ...HOST_CATEGORIES] as const;
export type DiskSaverCategory = (typeof DISK_SAVER_CATEGORIES)[number];
type InsideCategory = (typeof INSIDE_CATEGORIES)[number];

/** Holds the person's own files: off by default, needs confirmation. */
export const USER_FILE_CATEGORIES: ReadonlySet<DiskSaverCategory> = new Set(["trash"]);

export interface DiskSaverItem {
  id: DiskSaverCategory;
  bytes: number;
  /** A person's own files: cleaned only with an explicit confirmation. */
  userFiles: boolean;
}

/** Fixed paths per category, relative to HOME unless absolute. */
const INSIDE_PATHS: Record<Exclude<InsideCategory, "tempFiles">, string[]> = {
  packageCaches: [".cache/pip", ".npm/_cacache", ".cache/yarn", ".cache/pnpm", ".local/share/pnpm/store", ".cache/go-build", ".cargo/registry/cache"],
  browserCache: [".cache/google-chrome", ".cache/chromium", ".cache/mozilla"],
  thumbnails: [".cache/thumbnails"],
  trash: [".local/share/Trash"],
};

/** Files in /tmp owned by the computer's user, untouched for a day. */
const TEMP_FIND = `find /tmp -xdev -type f -user "$(id -u)" -mtime +0`;

const shellPath = (path: string) => path.startsWith("/") ? `'${path}'` : `"$HOME"/'${path}'`;

/** The fixed script that measures every inside category, one line each:
 * `<id> <kilobytes>`. Read-only. */
export function insideMeasureScript(): string {
  const lines = ["set +e"];
  for (const [id, paths] of Object.entries(INSIDE_PATHS)) {
    lines.push(`k=$(du -sk ${paths.map(shellPath).join(" ")} 2>/dev/null | awk '{s+=$1} END {print s+0}'); echo "${id} $k"`);
  }
  lines.push(`k=$(${TEMP_FIND} -print0 2>/dev/null | du -ck --files0-from=- 2>/dev/null | tail -n 1 | awk '{print $1+0}'); echo "tempFiles \${k:-0}"`);
  return lines.join("\n");
}

/** The fixed script that empties the chosen inside categories. Only ids from
 * the enum reach it; anything else is dropped. */
export function insideCleanScript(categories: readonly DiskSaverCategory[]): string | null {
  const lines = ["set +e"];
  for (const id of categories) {
    if (id === "tempFiles") lines.push(`${TEMP_FIND} -delete 2>/dev/null`);
    else if (id in INSIDE_PATHS) {
      // Empty each folder, keep the folder itself (apps expect it).
      for (const path of INSIDE_PATHS[id as Exclude<InsideCategory, "tempFiles">]) {
        lines.push(`[ -d ${shellPath(path)} ] && find ${shellPath(path)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null`);
      }
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

/** Parse the measure script's output into bytes per inside category. */
export function parseInsideMeasure(stdout: string): Map<InsideCategory, number> {
  const out = new Map<InsideCategory, number>();
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\w+) (\d+)$/);
    if (!match) continue;
    const id = match[1] as InsideCategory;
    if (!(INSIDE_CATEGORIES as readonly string[]).includes(id)) continue;
    out.set(id, Number(match[2]) * 1024);
  }
  return out;
}

export const CHECKPOINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Shadow checkpoint repositories (DATA_DIR/checkpoints/<bot>/<folder>)
 * untouched for 30 days: their last write is the repository's index. */
export async function oldCheckpointRepos(root: string, now = Date.now(), maxAgeMs = CHECKPOINT_MAX_AGE_MS): Promise<string[]> {
  const old: string[] = [];
  if (!existsSync(root)) return old;
  for (const bot of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!bot.isDirectory()) continue;
    const botDir = join(root, bot.name);
    for (const repo of await readdir(botDir, { withFileTypes: true }).catch(() => [])) {
      if (!repo.isDirectory()) continue;
      const dir = join(botDir, repo.name);
      const touched = await Promise.all([dir, join(dir, ".git"), join(dir, ".git", "index")].map((path) =>
        stat(path).then((info) => info.mtimeMs).catch(() => 0)));
      if (now - Math.max(...touched) > maxAgeMs) old.push(dir);
    }
  }
  return old;
}

export async function bytesOf(paths: readonly string[]): Promise<number> {
  let total = 0;
  for (const path of paths) total += (await folderBytes(path, { maxEntries: 200_000, budgetMs: 5_000 })) ?? 0;
  return total;
}

export async function removeAll(paths: readonly string[]): Promise<void> {
  for (const path of paths) await rm(path, { recursive: true, force: true });
}

/** Where the disk saver runs commands and what it cleans on this server. */
export interface DiskSaverTarget {
  /** Run a fixed script inside the bot's computer as its user; null when
   * the computer is not running (the disk saver never starts it). */
  exec(script: string): Promise<{ exitCode: number | null; stdout: string } | null>;
  /** Host categories (a personal server), or none. */
  host?: {
    oldCheckpoints(): Promise<string[]>;
  };
}

export interface DiskSaverPreview {
  /** False when the bot's computer is not running: inside categories were
   * not measured. */
  computerRunning: boolean;
  items: DiskSaverItem[];
  totalBytes: number;
}

export async function previewDiskSaver(target: DiskSaverTarget): Promise<DiskSaverPreview> {
  const items: DiskSaverItem[] = [];
  const measured = await target.exec(insideMeasureScript());
  if (measured) {
    const sizes = parseInsideMeasure(measured.stdout);
    for (const id of INSIDE_CATEGORIES) items.push({ id, bytes: sizes.get(id) ?? 0, userFiles: USER_FILE_CATEGORIES.has(id) });
  }
  if (target.host) {
    items.push({ id: "oldCheckpoints", bytes: await bytesOf(await target.host.oldCheckpoints()), userFiles: false });
  }
  return { computerRunning: measured !== null, items, totalBytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

export class DiskSaverRefusal extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Clean the chosen categories and answer the fresh preview. A user-file
 * category without `confirmUserFiles` refuses the whole request. */
export async function runDiskSaver(
  target: DiskSaverTarget,
  categories: readonly DiskSaverCategory[],
  confirmUserFiles: boolean,
): Promise<{ before: number; after: DiskSaverPreview; freedBytes: number }> {
  const chosen = [...new Set(categories)];
  if (chosen.some((id) => USER_FILE_CATEGORIES.has(id)) && !confirmUserFiles) {
    throw new DiskSaverRefusal("Emptying the trash deletes your own files. Confirm it first.", "confirm_user_files");
  }
  const before = await previewDiskSaver(target);
  const pick = (id: DiskSaverCategory) => before.items.find((item) => item.id === id)?.bytes ?? 0;
  const beforeBytes = chosen.reduce((sum, id) => sum + pick(id), 0);
  const inside = chosen.filter((id): id is InsideCategory => (INSIDE_CATEGORIES as readonly string[]).includes(id));
  if (inside.length) {
    if (!before.computerRunning) throw new DiskSaverRefusal("The bot's computer is not running. Start it, then try again.", "not_running");
    const script = insideCleanScript(inside);
    if (script) await target.exec(script);
  }
  if (chosen.includes("oldCheckpoints") && target.host) await removeAll(await target.host.oldCheckpoints());
  const after = await previewDiskSaver(target);
  const afterBytes = chosen.reduce((sum, id) => sum + (after.items.find((item) => item.id === id)?.bytes ?? 0), 0);
  return { before: beforeBytes, after, freedBytes: Math.max(0, beforeBytes - afterBytes) };
}
