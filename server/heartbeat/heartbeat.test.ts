import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseMemoryPath } from "../memory/memory-store.ts";
import { docPath } from "../workspace/workspace-tools.ts";
import type { Routine, RoutineInput } from "../routines/routines.ts";
import { HEARTBEAT_CHECK, HeartbeatManager, parseHeartbeat, type HeartbeatProbes } from "./heartbeat.ts";

const CHECKLIST = `# Heartbeat
<!-- every line below is checked without the model -->
every: 15m
- page https://status.example.com contains "All systems operational"
- [ ] file ~/inbox/report.csv exists
- process Backup running
- at 08:30 send the morning summary
- [x] an item already done
- keep an eye on the invoices
`;

describe("HEARTBEAT.md path", () => {
  it("is a root file docs_update and the editor accept", () => {
    expect(docPath("HEARTBEAT.md")).toBe("HEARTBEAT.md");
    expect(docPath("./HEARTBEAT.md")).toBe("HEARTBEAT.md");
    expect(parseMemoryPath("HEARTBEAT.md")).toMatchObject({ kind: "heartbeat" });
    expect(docPath("notes.md")).toBe("docs/notes.md");
  });
});

describe("parseHeartbeat", () => {
  it("reads the interval, the probes and the notes", () => {
    const list = parseHeartbeat(CHECKLIST);
    expect(list.everyMs).toBe(15 * 60_000);
    expect(list.items.map((item) => item.probe.kind)).toEqual(["page", "file", "process", "at"]);
    expect(list.items[0].probe).toEqual({ kind: "page", url: "https://status.example.com", text: "All systems operational", want: "contains" });
    expect(list.items[3].probe).toEqual({ kind: "at", hour: 8, minute: 30, task: "send the morning summary" });
    expect(list.notes).toEqual(["keep an eye on the invoices"]);
  });

  it("is empty for a blank or heading-only file", () => {
    expect(parseHeartbeat("")).toMatchObject({ items: [], notes: [] });
    expect(parseHeartbeat("# Heartbeat\n\n<!-- nothing yet -->\n")).toMatchObject({ items: [], notes: [] });
  });

  it("keeps the interval between 5 minutes and a day", () => {
    expect(parseHeartbeat("every: 1m\n- x").everyMs).toBe(5 * 60_000);
    expect(parseHeartbeat("every 48h\n- x").everyMs).toBe(24 * 3_600_000);
  });
});

describe("HeartbeatManager", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** #4250: the checklist is a routine's pre-check. A tick is what the
   * scheduler does: the routine made from the checklist, then its code
   * check on each due time; a wake is the routine's run with the gaps. */
  function harness(text: string, probes: Partial<HeartbeatProbes>, start = new Date(2026, 10, 8, 9, 0).getTime(), muted?: (botId: string) => boolean) {
    dir = mkdtempSync(join(tmpdir(), "heartbeat-"));
    let now = start;
    let checklist = text;
    let nextId = 0;
    const routines: Routine[] = [];
    const runs: Array<{ botId: string; routineId: string; prompt: string; runAs?: string }> = [];
    const routineManager = {
      list: () => routines,
      create: (input: RoutineInput, runAs?: string): Routine => {
        const routine = { ...input, id: `r${++nextId}`, enabled: input.enabled !== false, ...(runAs ? { runAs } : {}) } as unknown as Routine;
        routines.push(routine);
        return routine;
      },
      update: (id: string, patch: Partial<RoutineInput>): Routine | null => {
        const routine = routines.find((row) => row.id === id);
        if (routine) Object.assign(routine, patch);
        return routine ?? null;
      },
    };
    const manager = new HeartbeatManager({
      bots: () => [{ id: "osprey", name: "Osprey" }],
      read: () => checklist,
      routines: () => routineManager,
      runAs: () => "person-1",
      probes: { page: async () => ({ ok: true, text: "" }), stamp: async () => null, processes: async () => [], ...probes },
      file: join(dir, "heartbeat.json"),
      now: () => now,
      ...(muted ? { muted } : {}),
    });
    /** The routine's next due time (its interval). */
    let dueAt = Number.NEGATIVE_INFINITY;
    const tick = async (): Promise<string[]> => {
      manager.syncAll();
      const woken: string[] = [];
      for (const routine of routines.filter((row) => row.enabled && (row.precheck as { check?: string } | undefined)?.check === HEARTBEAT_CHECK)) {
        if (now < dueAt) continue;
        dueAt = now + (routine.schedule.type === "interval" ? routine.schedule.everyMinutes * 60_000 : 0);
        const verdict = await manager.check(routine);
        if (verdict.wake) {
          // the run reads the routine's instructions and the gaps as its data
          runs.push({ botId: routine.botId, routineId: routine.id, prompt: `${routine.prompt}\n${verdict.note ?? ""}`, ...(routine.runAs ? { runAs: routine.runAs } : {}) });
          woken.push(routine.botId);
        }
      }
      return woken;
    };
    return {
      manager: { tick, stateOf: (botId: string) => manager.stateOf(botId) },
      checks: manager,
      routines,
      runs,
      advance: (ms: number) => { now += ms; },
      setText: (next: string) => { checklist = next; },
    };
  }

  it("does nothing with an empty checklist", async () => {
    const h = harness("", {});
    expect(await h.manager.tick()).toEqual([]);
    expect(h.runs).toEqual([]);
    expect(h.manager.stateOf("osprey")).toBeUndefined();
    // no routine either
    expect(h.routines).toEqual([]);
  });

  it("#4250: a checklist with a line to check is one routine of the bot, at its interval, with the code check", async () => {
    const h = harness(CHECKLIST, {});
    await h.manager.tick();
    await h.manager.tick();
    expect(h.routines).toHaveLength(1);
    expect(h.routines[0]).toMatchObject({
      name: "Checklist", botId: "osprey", runAs: "person-1", enabled: true, overlap: "skip",
      schedule: { type: "interval", everyMinutes: 15 }, precheck: { kind: "code", check: "heartbeat" },
    });
    // the every: line moves the routine's interval
    h.setText(CHECKLIST.replace("every: 15m", "every: 45m"));
    h.checks.sync("osprey");
    expect(h.routines[0]!.schedule).toMatchObject({ everyMinutes: 45 });
    // a routine the person paused stays paused
    h.routines[0]!.enabled = false;
    h.checks.syncAll();
    expect(h.routines[0]!.enabled).toBe(false);
  });

  it("#4250: notes alone make no routine (they never wake the model)", async () => {
    const h = harness("- look at the shared calendar", {});
    await h.manager.tick();
    expect(h.routines).toEqual([]);
  });

  it("never wakes the model while every probe is met", async () => {
    const h = harness("- process Backup running\n- file /data/x exists\n- note for the model", {
      processes: async () => [{ pid: 1, name: "Backup" }],
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
    });
    await h.manager.tick();
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toEqual([]);
  });

  it("wakes the model once per gap, in the main chat, with the notes", async () => {
    let running = true;
    const h = harness("- process Backup running\n- check the invoices too", {
      processes: async () => (running ? [{ pid: 1, name: "Backup" }] : []),
    });
    await h.manager.tick();
    running = false;
    h.advance(31 * 60_000);
    expect(await h.manager.tick()).toEqual(["osprey"]);
    expect(h.runs).toHaveLength(1);
    // the routine's run, as the bot's person; its results go to the bot's main chat like any routine's
    expect(h.runs[0]).toMatchObject({ botId: "osprey", runAs: "person-1" });
    expect(h.runs[0].prompt).toContain("Backup is not running");
    expect(h.runs[0].prompt).toContain("check the invoices too");
    // still in gap: no second wake
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(1);
    // recovered, then down again: a new gap wakes it again
    running = true;
    h.advance(31 * 60_000);
    await h.manager.tick();
    running = false;
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(2);
  });

  it("stays quiet while the person muted the heartbeat, and wakes once it fades (#2694)", async () => {
    let mute = true;
    const h = harness("- process Backup running", { processes: async () => [] }, undefined, () => mute);
    await h.manager.tick();
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toEqual([]);
    mute = false;
    h.advance(31 * 60_000);
    expect(await h.manager.tick()).toEqual(["osprey"]);
  });

  it("waits for the interval before probing again", async () => {
    let calls = 0;
    const h = harness("- process Backup running", { processes: async () => { calls += 1; return []; } });
    await h.manager.tick();
    h.advance(60_000);
    await h.manager.tick();
    expect(calls).toBe(1);
  });

  it("fires an at item once a day after its time", async () => {
    const h = harness("- at 08:30 send the summary", {}, new Date(2026, 10, 8, 8, 0).getTime());
    await h.manager.tick();
    expect(h.runs).toHaveLength(0);
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].prompt).toContain("send the summary");
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(1);
    h.advance(24 * 3_600_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(2);
  });

  it("reports a changed file after its baseline", async () => {
    let stamp = { size: 1, mtimeMs: 1 };
    const h = harness("- file /data/report.csv changed", { stamp: async () => stamp });
    await h.manager.tick();
    expect(h.runs).toHaveLength(0);
    stamp = { size: 2, mtimeMs: 2 };
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].prompt).toContain("/data/report.csv changed");
  });

  it("never wakes the model for notes alone (#2820)", async () => {
    const h = harness("- look at the shared calendar", {});
    await h.manager.tick();
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(0);
  });

  it("mixed list: notes stay quiet while the probes are fine, then ride along with a gap (#2820)", async () => {
    let running = true;
    const h = harness("- process Backup running\n- look at the shared calendar", {
      processes: async () => (running ? [{ pid: 1, name: "Backup" }] : []),
    });
    await h.manager.tick();
    expect(h.runs).toHaveLength(0);
    running = false;
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].prompt).toContain("Backup is not running");
    expect(h.runs[0].prompt).toContain("look at the shared calendar");
  });

  it("forgets a bot whose checklist was emptied", async () => {
    const h = harness("- process Backup running", {});
    await h.manager.tick();
    expect(h.manager.stateOf("osprey")).toBeDefined();
    h.setText("");
    h.advance(31 * 60_000);
    await h.manager.tick();
    expect(h.manager.stateOf("osprey")).toBeUndefined();
  });
});
