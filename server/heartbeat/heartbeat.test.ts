import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseMemoryPath } from "../memory/memory-store.ts";
import { docPath } from "../workspace/workspace-tools.ts";
import { HeartbeatManager, parseHeartbeat, type HeartbeatEnqueue, type HeartbeatProbes } from "./heartbeat.ts";

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

  function harness(text: string, probes: Partial<HeartbeatProbes>, start = new Date(2026, 10, 8, 9, 0).getTime()) {
    dir = mkdtempSync(join(tmpdir(), "heartbeat-"));
    let now = start;
    let checklist = text;
    const runs: HeartbeatEnqueue[] = [];
    const manager = new HeartbeatManager({
      bots: () => [{ id: "osprey", name: "Osprey" }],
      mainThread: () => "thread-main",
      read: () => checklist,
      enqueue: (input) => runs.push(input),
      probes: { page: async () => ({ ok: true, text: "" }), stamp: async () => null, processes: async () => [], ...probes },
      file: join(dir, "heartbeat.json"),
      now: () => now,
    });
    return {
      manager,
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
    expect(h.runs[0]).toMatchObject({ botId: "osprey", resultsThreadId: "thread-main", eventSource: "wait", runOn: "maus" });
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
