import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SCHEDULE,
  DiskSaverRefusal,
  MaintenanceScheduler,
  MaintenanceStore,
  insideCleanScript,
  insideMeasureScript,
  nextWindowStart,
  oldCheckpointRepos,
  parseInsideMeasure,
  previewDiskSaver,
  runDiskSaver,
  windowStartAt,
  type DiskSaverTarget,
  type MaintenanceSchedule,
} from "./computer-care.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "computer-care-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Sunday 2026-10-18, 03:00 UTC.
const SUNDAY_3AM = Date.UTC(2026, 9, 18, 3, 0);
const H = 3_600_000;
const schedule = (over: Partial<MaintenanceSchedule> = {}): MaintenanceSchedule => ({
  ...DEFAULT_SCHEDULE, enabled: true, days: [0], hour: 3, windowHours: 2, timeZone: "UTC", ...over,
});

describe("maintenance window", () => {
  it("finds the window a moment falls in, and nothing outside it", () => {
    expect(windowStartAt(schedule(), SUNDAY_3AM)).toBe(SUNDAY_3AM);
    expect(windowStartAt(schedule(), SUNDAY_3AM + 90 * 60_000)).toBe(SUNDAY_3AM);
    expect(windowStartAt(schedule(), SUNDAY_3AM + 2 * H)).toBeNull();
    expect(windowStartAt(schedule(), SUNDAY_3AM - 60_000)).toBeNull();
    // Monday at 3 is not an allowed day.
    expect(windowStartAt(schedule(), SUNDAY_3AM + 24 * H)).toBeNull();
  });

  it("reads the hour and day in the schedule's time zone", () => {
    // 03:00 in Montréal (EDT, UTC-4) is 07:00 UTC.
    const montreal = schedule({ timeZone: "America/Toronto" });
    expect(windowStartAt(montreal, SUNDAY_3AM)).toBeNull();
    expect(windowStartAt(montreal, SUNDAY_3AM + 4 * H)).toBe(SUNDAY_3AM + 4 * H);
  });

  it("gives the next window start, or none when off", () => {
    expect(nextWindowStart(schedule(), SUNDAY_3AM - H)).toBe(SUNDAY_3AM);
    expect(nextWindowStart(schedule(), SUNDAY_3AM)).toBe(SUNDAY_3AM + 7 * 24 * H);
    expect(nextWindowStart(schedule({ enabled: false }), SUNDAY_3AM)).toBeNull();
  });
});

describe("MaintenanceStore", () => {
  it("persists schedules in a private file and drops invalid ones", () => {
    const file = join(tempDir(), "care.json");
    const store = new MaintenanceStore(file);
    store.setSchedule("local", schedule(), 5);
    store.record("local", SUNDAY_3AM, { at: SUNDAY_3AM + 1, outcome: "updated" });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.computers.bad = { schedule: { enabled: true, days: [9], hour: 3, windowHours: 2, timeZone: "UTC" } };
    writeFileSync(file, JSON.stringify(raw));
    const again = new MaintenanceStore(file);
    expect(again.get("local")).toMatchObject({ savedAt: 5, lastWindowStart: SUNDAY_3AM, lastResult: { outcome: "updated" } });
    expect(again.get("bad")).toBeUndefined();
  });
});

describe("MaintenanceScheduler", () => {
  const setup = (busy: () => Promise<boolean>, update: () => Promise<void>) => {
    let now = SUNDAY_3AM - H;
    const store = new MaintenanceStore(join(tempDir(), "care.json"));
    store.setSchedule("local", schedule(), now);
    const scheduler = new MaintenanceScheduler({ store, computer: () => ({ busy, update }), now: () => now });
    return { store, scheduler, at: (value: number) => { now = value; } };
  };

  it("updates once inside the window when the computer is idle", async () => {
    const update = vi.fn(async () => {});
    const { store, scheduler, at } = setup(async () => false, update);
    await scheduler.tick();
    expect(update).not.toHaveBeenCalled();
    at(SUNDAY_3AM + 5 * 60_000);
    await scheduler.tick();
    await scheduler.tick();
    expect(update).toHaveBeenCalledTimes(1);
    expect(store.get("local")?.lastResult?.outcome).toBe("updated");
  });

  it("waits while busy, then reports a postponement once the window passed", async () => {
    const update = vi.fn(async () => {});
    const { store, scheduler, at } = setup(async () => true, update);
    at(SUNDAY_3AM + 10 * 60_000);
    await scheduler.tick();
    expect(store.get("local")?.lastResult).toBeUndefined();
    at(SUNDAY_3AM + 2 * H + 60_000);
    await scheduler.tick();
    expect(update).not.toHaveBeenCalled();
    expect(store.get("local")?.lastResult).toMatchObject({ outcome: "postponed", detail: "busy" });
  });

  it("does not report a window that ended before the schedule was saved", async () => {
    const { store, scheduler, at } = setup(async () => true, async () => {});
    store.setSchedule("local", schedule(), SUNDAY_3AM + 2 * H + 30_000);
    at(SUNDAY_3AM + 2 * H + 60_000);
    await scheduler.tick();
    expect(store.get("local")?.lastResult).toBeUndefined();
  });

  it("records a failure with its reason, and does not retry in the same window", async () => {
    const update = vi.fn(async () => { throw new Error("pull failed"); });
    const { store, scheduler, at } = setup(async () => false, update);
    at(SUNDAY_3AM + 60_000);
    await scheduler.tick();
    await scheduler.tick();
    expect(update).toHaveBeenCalledTimes(1);
    expect(store.get("local")?.lastResult).toMatchObject({ outcome: "failed", detail: "pull failed" });
  });
});

describe("disk saver", () => {
  it("measures and cleans fixed paths only, never the workspace", () => {
    const measure = insideMeasureScript();
    const clean = insideCleanScript(["packageCaches", "browserCache", "thumbnails", "tempFiles", "trash"])!;
    for (const script of [measure, clean]) {
      expect(script).not.toMatch(/workspace/);
      expect(script).not.toMatch(/rm -rf -- "\$HOME"\s*$/m);
    }
    expect(measure).not.toMatch(/\brm\b|-delete/);
    expect(clean).toContain(`"$HOME"/'.cache/pip'`);
    expect(insideCleanScript(["oldCheckpoints"])).toBeNull();
  });

  it("parses the measure output into bytes", () => {
    const sizes = parseInsideMeasure("packageCaches 10\nbrowserCache 0\nnope 99\ntempFiles 2\n");
    expect(sizes.get("packageCaches")).toBe(10 * 1024);
    expect(sizes.get("tempFiles")).toBe(2048);
    expect(sizes.has("nope" as never)).toBe(false);
  });

  const target = (running = true): DiskSaverTarget & { scripts: string[] } => {
    const scripts: string[] = [];
    let cleaned = false;
    return {
      scripts,
      exec: async (script) => {
        if (!running) return null;
        scripts.push(script);
        if (script.includes("-delete") || script.includes("rm -rf")) { cleaned = true; return { exitCode: 0, stdout: "" }; }
        return { exitCode: 0, stdout: cleaned ? "packageCaches 0\ntrash 0\n" : "packageCaches 2048\ntrash 1024\nbrowserCache 1\n" };
      },
    };
  };

  it("previews without deleting anything", async () => {
    const t = target();
    const preview = await previewDiskSaver(t);
    expect(preview.computerRunning).toBe(true);
    expect(preview.items.find((item) => item.id === "trash")).toEqual({ id: "trash", bytes: 1024 * 1024, userFiles: true });
    expect(preview.totalBytes).toBe((2048 + 1024 + 1) * 1024);
    expect(t.scripts.every((script) => !/rm -rf|-delete/.test(script))).toBe(true);
  });

  it("refuses the trash without a confirmation, and deletes nothing", async () => {
    const t = target();
    await expect(runDiskSaver(t, ["packageCaches", "trash"], false)).rejects.toBeInstanceOf(DiskSaverRefusal);
    expect(t.scripts).toHaveLength(0);
  });

  it("cleans the chosen categories and reports what was freed", async () => {
    const t = target();
    const result = await runDiskSaver(t, ["packageCaches"], false);
    expect(result.freedBytes).toBe(2048 * 1024);
    const clean = t.scripts.find((script) => script.includes("rm -rf"))!;
    expect(clean).toContain(".cache/pip");
    expect(clean).not.toContain("Trash");
  });

  it("does not clean inside a stopped computer", async () => {
    await expect(runDiskSaver(target(false), ["packageCaches"], false)).rejects.toMatchObject({ code: "not_running" });
  });

  it("finds checkpoint repositories untouched for 30 days", async () => {
    const root = tempDir();
    const now = Date.now();
    const old = join(root, "bot1", "aaaa");
    const fresh = join(root, "bot1", "bbbb");
    for (const dir of [old, fresh]) {
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, ".git", "index"), "x");
    }
    const past = (now - 40 * 24 * H) / 1000;
    for (const path of [join(old, ".git", "index"), join(old, ".git"), old]) utimesSync(path, past, past);
    expect(await oldCheckpointRepos(root, now)).toEqual([old]);
    expect(await oldCheckpointRepos(join(root, "missing"), now)).toEqual([]);
  });
});

describe("maintenance scheduler lock (parity R7 review)", () => {
  it("lets one update hold a computer, the scheduler included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "care-lock-"));
    const store = new MaintenanceStore(join(dir, "m.json"));
    let busy = true;
    const scheduler = new MaintenanceScheduler({ store, computer: () => ({ busy: async () => busy, update: async () => {} }) });
    expect(scheduler.claim("local")).toBe(true);
    expect(scheduler.isRunning("local")).toBe(true);
    expect(scheduler.claim("local")).toBe(false);
    scheduler.release("local");
    expect(scheduler.claim("local")).toBe(true);
    scheduler.release("local");
    expect(await scheduler.busy("local")).toBe(true);
    busy = false;
    expect(await scheduler.busy("local")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
