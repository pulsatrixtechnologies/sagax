import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResourceStreamEvent } from "../../shared/resource-usage.ts";
import { createResourceSamplers, type SampleSource } from "./sampler.ts";

const linux = readFileSync(new URL("./fixtures/linux.txt", import.meta.url), "utf8");
const [blockA, blockB] = linux.split(/(?=@@begin)/);

/** A source the test drives: `emit` sends text, `exit` ends the process. */
function fakeSource() {
  const runs: Array<{ iterations: number; stopped: boolean; emit(text: string): void; exit(error?: string): void }> = [];
  const source: SampleSource = {
    start(iterations, onText, onExit) {
      const run = {
        iterations,
        stopped: false,
        emit: (text: string) => onText(text),
        exit: (error?: string) => onExit(error),
      };
      runs.push(run);
      return { stop: () => { run.stopped = true; } };
    },
  };
  return { source, runs };
}

let clock = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
});

function samplers(overrides: Partial<Parameters<typeof createResourceSamplers>[0]> = {}) {
  return createResourceSamplers({ now: () => clock, runMs: 300_000, idleMs: 20_000, maxLive: 2, ...overrides });
}

const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

describe("resource samplers", () => {
  it("streams frames to the person who started it, and only to them", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in started) throw new Error(started.error);
    expect(manager.subscribe(started.id, "pr_b", () => {})).toBeNull();
    expect(manager.snapshot(started.id, "pr_b")).toBeNull();

    const events: ResourceStreamEvent[] = [];
    const stop = manager.subscribe(started.id, "pr_a", (event) => events.push(event));
    expect(stop).toBeTypeOf("function");
    expect(events[0]?.kind).toBe("snapshot");

    runs[0]!.emit(blockA!.slice(0, 40));
    runs[0]!.emit(blockA!.slice(40));
    advance(2000);
    runs[0]!.emit(blockB!);
    const frames = events.filter((event) => event.kind === "frame");
    expect(frames).toHaveLength(2);
    const last = frames[1] as Extract<ResourceStreamEvent, { kind: "frame" }>;
    expect(last.frame.cpu?.total).toBeCloseTo(25, 5);
    expect(manager.snapshot(started.id, "pr_a")!.state).toBe("live");
    expect(manager.snapshot(started.id, "pr_a")!.host.hostname).toBe("srv01");
    stop!();
  });

  it("bounds the remote loop and pauses itself when the run time is up", async () => {
    const manager = samplers({ runMs: 60_000 });
    const { source, runs } = fakeSource();
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in started) throw new Error(started.error);
    manager.subscribe(started.id, "pr_a", () => {});
    // the computer's own loop ends shortly after the run even if the server forgets it
    expect(runs[0]!.iterations).toBeLessThanOrEqual(60_000 / 2000 + 2);
    advance(60_000);
    expect(runs[0]!.stopped).toBe(true);
    const snapshot = manager.snapshot(started.id, "pr_a")!;
    expect(snapshot.state).toBe("paused");
    expect(snapshot.reason).toBe("time");
  });

  it("pauses when nobody watches (the card left the screen) and resumes on demand", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    let opens = 0;
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => { opens += 1; return source; } });
    if ("error" in started) throw new Error(started.error);
    const unsubscribe = manager.subscribe(started.id, "pr_a", () => {})!;
    advance(30_000);
    expect(manager.snapshot(started.id, "pr_a")!.state).toBe("starting");
    unsubscribe();
    advance(19_000);
    expect(runs[0]!.stopped).toBe(false);
    advance(1_000);
    expect(runs[0]!.stopped).toBe(true);
    expect(manager.snapshot(started.id, "pr_a")!.reason).toBe("idle");

    expect(await manager.resume(started.id, "pr_b")).toBeNull();
    const resumed = await manager.resume(started.id, "pr_a");
    expect(resumed && "state" in resumed ? resumed.state : null).toBe("starting");
    // resuming opens the target again, so its permission is checked again
    expect(opens).toBe(2);
    expect(runs).toHaveLength(2);
  });

  it("keeps at most two running per person: a third pauses the oldest", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      advance(10);
      const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
      if ("error" in started) throw new Error(started.error);
      ids.push(started.id);
    }
    expect(runs[0]!.stopped).toBe(true);
    expect(manager.snapshot(ids[0]!, "pr_a")!.reason).toBe("replaced");
    expect(runs[1]!.stopped).toBe(false);
    expect(runs[2]!.stopped).toBe(false);
    // another person is not limited by the first one's runs
    const other = await manager.start({ principalId: "pr_b", botId: "b1", threadId: "t2", open: async () => source });
    expect("id" in other).toBe(true);
    expect(runs[1]!.stopped).toBe(false);
  });

  it("reports a refused or unreachable target without a run", async () => {
    const manager = samplers();
    const refused = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => ({ error: "forbidden" }) });
    expect(refused).toEqual({ error: "forbidden" });

    const { source, runs } = fakeSource();
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in started) throw new Error(started.error);
    runs[0]!.exit("ssh: connect failed");
    const snapshot = manager.snapshot(started.id, "pr_a")!;
    expect(snapshot.state).toBe("error");
    // a code the card translates, never the transport's own text
    expect(snapshot.error).toBe("unreachable");
  });

  it("gives the tool its first full frame, or null after the wait", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in started) throw new Error(started.error);
    const waiting = manager.firstFrame(started.id, 8_000);
    runs[0]!.emit(blockA!);
    advance(2000);
    runs[0]!.emit(blockB!);
    const frame = await waiting;
    expect(frame?.cpu?.total).toBeCloseTo(25, 5);

    const quiet = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in quiet) throw new Error(quiet.error);
    const none = manager.firstFrame(quiet.id, 8_000);
    advance(8_000);
    expect(await none).toBeNull();
  });

  it("drops a runaway stream instead of buffering it", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    const started = await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    if ("error" in started) throw new Error(started.error);
    runs[0]!.emit(`@@begin\n${"x".repeat(600_000)}`);
    expect(runs[0]!.stopped).toBe(true);
    expect(manager.snapshot(started.id, "pr_a")!.error).toBe("no-data");
  });

  it("stops everything on close", async () => {
    const manager = samplers();
    const { source, runs } = fakeSource();
    await manager.start({ principalId: "pr_a", botId: "b1", threadId: "t1", open: async () => source });
    manager.close();
    expect(runs[0]!.stopped).toBe(true);
  });
});
