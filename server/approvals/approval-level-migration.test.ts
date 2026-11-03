import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { migratedApprovalLevel, planPermissionModeMigration, runPermissionModeMigration, type MigrationBot } from "./approval-level-migration.ts";

describe("migratedApprovalLevel (permission mode -> the one approval level)", () => {
  it("Approval keeps every level", () => {
    for (const level of ["ask", "edits", "auto", "full", "custom"] as const) expect(migratedApprovalLevel(level, "approval", true)).toBeNull();
  });
  it("Automatic approval lifts Ask and Auto-accept edits to Approve for me, never lowers", () => {
    expect(migratedApprovalLevel("ask", "auto", true)).toBe("auto");
    expect(migratedApprovalLevel("edits", "auto", true)).toBe("auto");
    expect(migratedApprovalLevel("auto", "auto", true)).toBeNull();
    expect(migratedApprovalLevel("full", "auto", true)).toBeNull();
  });
  it("Bypass becomes Full access where the engine runs it, else Approve for me", () => {
    expect(migratedApprovalLevel("ask", "bypass", true)).toBe("full");
    expect(migratedApprovalLevel("auto", "bypass", true)).toBe("full");
    expect(migratedApprovalLevel("full", "bypass", true)).toBeNull();
    expect(migratedApprovalLevel("ask", "bypass", false)).toBe("auto");
    expect(migratedApprovalLevel("auto", "bypass", false)).toBeNull();
  });
  it("never touches Custom (Codex config.toml)", () => {
    expect(migratedApprovalLevel("custom", "bypass", true)).toBeNull();
    expect(migratedApprovalLevel("custom", "auto", true)).toBeNull();
  });
});

describe("planPermissionModeMigration", () => {
  const bot = (over: Partial<MigrationBot> = {}): MigrationBot => ({ id: "b1", ownerId: "pr_alice", level: "ask", fullSupported: true, tasks: [], ...over });

  it("changes the bot and its conversations that have a level of their own", () => {
    const plan = planPermissionModeMigration({ b1: { mode: "bypass", ownerId: "PR_Alice" } }, [bot({
      tasks: [
        { threadId: "t1", level: "ask", fullSupported: true },
        { threadId: "t2", level: undefined, fullSupported: true },
        { threadId: "t3", level: "full", fullSupported: true },
        { threadId: "t4", level: "edits", fullSupported: false },
      ],
    })]);
    expect(plan).toEqual([{ botId: "b1", level: "full", tasks: [{ threadId: "t1", level: "full" }, { threadId: "t4", level: "auto" }] }]);
  });

  it("drops a mode chosen by a previous owner, or for a bot that is gone, without a change", () => {
    expect(planPermissionModeMigration({ b1: { mode: "auto", ownerId: "pr_bob" } }, [bot()])).toEqual([]);
    expect(planPermissionModeMigration({ gone: { mode: "auto", ownerId: "pr_alice" } }, [bot()])).toEqual([]);
    expect(planPermissionModeMigration({ b1: { mode: "approval", ownerId: "pr_alice" } }, [bot()])).toEqual([]);
  });
});

describe("runPermissionModeMigration (old formats that failed at start, #1236)", () => {
  const run = (modes: Record<string, { mode: "approval" | "auto" | "bypass"; ownerId: string }>, bots: MigrationBot[]) => {
    const calls: string[] = [];
    let dropped = 0;
    runPermissionModeMigration({
      legacyModes: modes,
      bots: () => bots,
      patchBot: (id, level) => calls.push(`bot:${id}:${level}`),
      patchTask: (id, thread, level) => calls.push(`task:${id}:${thread}:${level}`),
      dropLegacyModes: () => { dropped += 1; },
      log: () => {},
    });
    return { calls, dropped };
  };
  const bot = (over: Partial<MigrationBot> = {}): MigrationBot => ({ id: "b1", ownerId: "pr_alice", level: "ask", fullSupported: true, tasks: [], ...over });

  it("reads nothing and drops nothing when no mode is stored", () => {
    let read = 0;
    runPermissionModeMigration({ legacyModes: {}, bots: () => { read += 1; return []; }, patchBot: () => {}, patchTask: () => {}, dropLegacyModes: () => { read += 100; }, log: () => {} });
    expect(read).toBe(0);
  });
  it("carries a mode for a bot with no recorded owner (resolved to the operator) and finishes", () => {
    const { calls, dropped } = run({ b1: { mode: "bypass", ownerId: "pr_local" } }, [bot({ ownerId: "pr_local", tasks: [{ threadId: "t1", level: "edits", fullSupported: true }] })]);
    expect(calls).toEqual(["bot:b1:full", "task:b1:t1:full"]);
    expect(dropped).toBe(1);
  });
  it("a row saved without an owner still applies to the bot's current owner", () => {
    const { calls, dropped } = run({ b1: { mode: "auto" } as never }, [bot()]);
    expect(calls).toEqual(["bot:b1:auto"]);
    expect(dropped).toBe(1);
  });
  it("a row for a deleted bot is dropped with the rest", () => {
    const { calls, dropped } = run({ gone: { mode: "bypass", ownerId: "pr_alice" } }, [bot()]);
    expect(calls).toEqual([]);
    expect(dropped).toBe(1);
  });
  it("a failing patch keeps the modes for the next start", () => {
    let dropped = 0;
    expect(() => runPermissionModeMigration({
      legacyModes: { b1: { mode: "bypass", ownerId: "pr_alice" } },
      bots: () => [bot()],
      patchBot: () => { throw new Error("disk"); },
      patchTask: () => {},
      dropLegacyModes: () => { dropped += 1; },
      log: () => {},
    })).toThrow("disk");
    expect(dropped).toBe(0);
  });
  it("server/index.ts runs it after the principal registry is built", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const built = source.indexOf("principals.localOperator(cfg.profile?.email)");
    const migration = source.indexOf("runPermissionModeMigration({");
    expect(built).toBeGreaterThan(0);
    expect(migration).toBeGreaterThan(built);
  });
});
