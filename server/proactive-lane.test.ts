// 2026-11-01: wakes use their own lane (one active per bot); dry runs are
// recorded on the wake; runAs carries person isolation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutineManager } from "./routines.ts";

describe("proactive wake lane and dry runs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sagax-proactive-lane-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("enqueueProactive sets triggerSource proactive and optional runAs", () => {
    const mgr = new RoutineManager({
      file: join(dir, "routines.json"),
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    const run = mgr.enqueueProactive({
      botId: "nova",
      name: "Proactive: mail",
      prompt: "wake",
      proactive: { mode: "proactive", hops: 0, sources: ["mail"] },
      runAs: "person_alice",
    });
    expect(run.triggerSource).toBe("proactive");
    expect(run.runAs).toBe("person_alice");
    expect(run.proactive).toMatchObject({ mode: "proactive", hops: 0, sources: ["mail"] });
  });

  it("records dry runs on an active wake", () => {
    const mgr = new RoutineManager({
      file: join(dir, "routines.json"),
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    const run = mgr.enqueueProactive({
      botId: "nova",
      name: "Proactive: mail",
      prompt: "wake",
      proactive: { mode: "proactive", hops: 0, sources: ["mail"] },
    });
    expect(mgr.noteProactiveDryRun(run.id, { tool: "GMAIL_SEND_EMAIL", summary: "GMAIL_SEND_EMAIL" })).toBe(true);
    expect(mgr.noteProactiveDryRun(run.id, { tool: "Bash", summary: "Bash: rm -rf /" })).toBe(true);
    const live = mgr.listRuns().find((candidate) => candidate.id === run.id);
    expect(live?.proactive?.dryRuns).toHaveLength(2);
    expect(live?.proactive?.dryRuns?.[0]).toMatchObject({ tool: "GMAIL_SEND_EMAIL", summary: "GMAIL_SEND_EMAIL" });
    expect(mgr.noteProactiveDryRun("missing", { tool: "x", summary: "x" })).toBe(false);
  });

  it("one active wake per bot: a second queued wake waits while the first runs", async () => {
    const held = new Map<string, () => void>();
    const mgr = new RoutineManager({
      file: join(dir, "routines-lane.json"),
      botState: () => "ready",
      createTask: (_botId, _title, _activate, run) => ({ threadId: `t-${run?.id ?? "x"}` }),
      startTurn: async (_botId, _threadId, _prompt, _runOn, _trigger, _onError, run) => {
        await new Promise<void>((resolve) => {
          if (run) held.set(run.id, resolve);
          else resolve();
        });
      },
    });
    const first = mgr.enqueueProactive({
      botId: "nova", name: "Proactive: a", prompt: "a",
      proactive: { mode: "proactive", hops: 0, sources: ["mail"] },
    });
    await vi.waitFor(() => expect(mgr.listRuns().find((r) => r.id === first.id)?.status).toBe("running"), { timeout: 5_000 });
    const second = mgr.enqueueProactive({
      botId: "nova", name: "Proactive: b", prompt: "b",
      proactive: { mode: "proactive", hops: 0, sources: ["webhook"] },
    });
    const secondLive = mgr.listRuns().find((r) => r.id === second.id);
    expect(secondLive?.status).toBe("queued");
    expect(secondLive?.deferredAt).toBeTypeOf("number");
    expect(secondLive?.attention).toMatch(/other proactive wake/);
    expect(mgr.activeProactiveWake("nova")?.id).toBe(first.id);
    // release the held turn so the manager can settle (no assertion on
    // completion: startTurn alone does not finish a run without more hooks)
    held.get(first.id)?.();
  });
});
