import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AFTER_RESET_MS } from "../shared/limit-failover.ts";
import { LimitFailoverStore, limitBackupAllowed, MAX_RESENDS, pickLimitBackup, ROUTINE_RESUME_COOLDOWN_MS, type LimitCandidate } from "./limit-failover.ts";

const claude = { instanceId: "claude", driverKind: "claudeAgent" };
const codex = { instanceId: "codex", driverKind: "codex" };
const engine = (instanceId: string, driverKind: string, models = ["m1", "m2"], defaultModel = "m1"): LimitCandidate =>
  ({ instanceId, driverKind, models, defaultModel });

describe("limitBackupAllowed", () => {
  it("allows another engine, never the same one", () => {
    expect(limitBackupAllowed(claude, codex)).toBe(true);
    expect(limitBackupAllowed(claude, claude)).toBe(false);
  });

  it("never rotates to another sign-in of the same subscription, but takes a pay-per-use key", () => {
    const second = { instanceId: "claude-2", driverKind: "claudeAgent" };
    expect(limitBackupAllowed(claude, second)).toBe(false);
    expect(limitBackupAllowed(claude, second, { access: "api" })).toBe(true);
    expect(limitBackupAllowed(claude, second, { environment: { ANTHROPIC_API_KEY: "set" } })).toBe(true);
    // Two OpenAI-compatible endpoints are separate bills.
    expect(limitBackupAllowed({ instanceId: "a", driverKind: "openaiCompatible" }, { instanceId: "b", driverKind: "openaiCompatible" })).toBe(true);
  });
});

describe("pickLimitBackup", () => {
  const base = { from: claude, config: () => undefined };

  it("takes the bot's own backups first, in order, with their model", () => {
    const candidates = [engine("grok", "grokAgent"), engine("codex", "codex", ["gpt-a", "gpt-b"], "gpt-a")];
    expect(pickLimitBackup({ ...base, preferred: [{ instanceId: "codex", model: "gpt-b" }], candidates, blocked: () => false }))
      .toEqual({ instanceId: "codex", model: "gpt-b" });
  });

  it("falls back to the catalog order and the engine's default model", () => {
    const candidates = [engine("claude", "claudeAgent"), engine("grok", "grokAgent", ["grok-4.5", "grok-4"], "grok-4.5"), engine("codex", "codex")];
    expect(pickLimitBackup({ ...base, preferred: [], candidates, blocked: () => false })).toEqual({ instanceId: "grok", model: "grok-4.5" });
  });

  it("never takes an engine that is not a candidate (not allowed, not signed in)", () => {
    const candidates = [engine("codex", "codex")];
    expect(pickLimitBackup({ ...base, preferred: [{ instanceId: "forbidden", model: "x" }], candidates, blocked: () => false }))
      .toEqual({ instanceId: "codex", model: "m1" });
    expect(pickLimitBackup({ ...base, preferred: [{ instanceId: "forbidden" }], candidates: [], blocked: () => false })).toBeNull();
  });

  it("skips engines at their own limit, so two spent engines never trade a turn", () => {
    const candidates = [engine("codex", "codex"), engine("grok", "grokAgent")];
    expect(pickLimitBackup({ ...base, preferred: [], candidates, blocked: (id) => id === "codex" })).toEqual({ instanceId: "grok", model: "m1" });
    expect(pickLimitBackup({ ...base, preferred: [], candidates, blocked: () => true })).toBeNull();
  });

  it("keeps a preferred model the payer may not use off the pick", () => {
    const candidates = [engine("codex", "codex", ["gpt-a"], "gpt-a")];
    expect(pickLimitBackup({ ...base, preferred: [{ instanceId: "codex", model: "gpt-hidden" }], candidates, blocked: () => false }))
      .toEqual({ instanceId: "codex", model: "gpt-a" });
  });

  it("skips a pay-per-use catalog fallthrough unless the person chose it as a backup (3ed90a037)", () => {
    const candidates = [engine("api", "claudeAgent"), engine("grok", "grokAgent")];
    const config = (id: string) => id === "api" ? { access: "api" as const } : undefined;
    expect(pickLimitBackup({ from: claude, preferred: [], candidates, blocked: () => false, config }))
      .toEqual({ instanceId: "grok", model: "m1" });
    expect(pickLimitBackup({ from: claude, preferred: [{ instanceId: "api" }], candidates, blocked: () => false, config }))
      .toEqual({ instanceId: "api", model: "m1" });
  });
});

describe("LimitFailoverStore", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });
  const at = { now: 1_000_000 };
  const make = (file: string | null = null) => new LimitFailoverStore({ file, now: () => at.now });

  it("blocks an engine per payer until its reset, a later reset winning", () => {
    at.now = 1_000_000;
    const store = make();
    store.block("alice", "claude", at.now + 10_000);
    store.block("alice", "claude", at.now + 5_000);
    expect(store.blockedUntil("alice", "claude")).toBe(at.now + 10_000);
    expect(store.blockedUntil("bob", "claude")).toBeNull();
    at.now += 10_000;
    expect(store.blockedUntil("alice", "claude")).toBeNull();
  });

  it("keeps the engine a thread started on across a second move, and is due after the reset plus the buffer", () => {
    at.now = 1_000_000;
    const store = make();
    const a = { instanceId: "claude", model: "opus" }, b = { instanceId: "codex", model: "gpt" }, c = { instanceId: "grok", model: "grok-4.5" };
    store.record({ botId: "bot", threadId: "t", from: a, to: b, resetsAt: at.now + 1_000, at: at.now });
    const kept = store.record({ botId: "bot", threadId: "t", from: b, to: c, resetsAt: at.now + 500, at: at.now });
    expect(kept).toMatchObject({ from: a, to: c, resetsAt: at.now + 1_000 });
    expect(store.due(kept)).toBe(false);
    at.now += 1_000 + AFTER_RESET_MS;
    expect(store.due(kept)).toBe(true);
    store.forget("t");
    expect(store.failover("bot", "t")).toBeUndefined();
  });

  it("lets a backup take one message over at most MAX_RESENDS times", () => {
    const store = make();
    for (let index = 0; index < MAX_RESENDS; index++) expect(store.takeResend("m")).toBe(true);
    expect(store.takeResend("m")).toBe(false);
  });

  it("starts a message again once per reset, never twice", () => {
    at.now = 1_000_000;
    const store = make();
    const resume = { kind: "message" as const, botId: "bot", threadId: "t", messageId: "m", engine: "claude", at: at.now + 100 };
    expect(store.schedule(resume)).toBe(true);
    expect(store.nextResumeAt()).toBe(at.now + 100);
    expect(store.takeDue()).toEqual([]);
    at.now += 100;
    expect(store.takeDue()).toEqual([resume]);
    expect(store.schedule({ ...resume, at: at.now + 100 })).toBe(false);
    // The one retry of a resume that met a busy thread still goes.
    expect(store.schedule({ ...resume, at: at.now + 100, retry: true })).toBe(true);
  });

  it("waits for a routine's reset at most once in the cooldown", () => {
    at.now = 1_000_000;
    const store = make();
    const resume = { kind: "routine" as const, routineId: "r", engine: "claude", at: at.now };
    expect(store.schedule(resume)).toBe(true);
    expect(store.takeDue()).toHaveLength(1);
    expect(store.schedule({ ...resume, at: at.now + 10 })).toBe(false);
    at.now += ROUTINE_RESUME_COOLDOWN_MS;
    expect(store.schedule({ ...resume, at: at.now + 10 })).toBe(true);
  });

  it("survives a restart through its file, and ignores a broken one", () => {
    dir = mkdtempSync(join(tmpdir(), "limit-failover-"));
    const file = join(dir, "limit-failovers.json");
    at.now = 1_000_000;
    const store = make(file);
    store.block("server", "claude", at.now + 60_000);
    store.record({ botId: "bot", threadId: "t", from: { instanceId: "claude", model: "a" }, to: { instanceId: "codex", model: "b" }, resetsAt: at.now + 60_000, at: at.now });
    store.schedule({ kind: "routine", routineId: "r", engine: "claude", at: at.now + 60_000 });
    const again = make(file);
    expect(again.blockedUntil("server", "claude")).toBe(at.now + 60_000);
    expect(again.failover("bot", "t")?.to.instanceId).toBe("codex");
    expect(again.resumes()).toHaveLength(1);
    const broken = new LimitFailoverStore({ file: join(dir, "missing.json"), now: () => at.now });
    expect(broken.resumes()).toEqual([]);
  });
});
