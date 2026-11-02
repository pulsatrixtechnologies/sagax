import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendStep,
  classifyStep,
  flushStepJournal,
  sanitizeStepRow,
  stepFromToolEvent,
  STEP_JOURNAL_RETENTION_DAYS,
} from "./step-journal.ts";

const dirs: string[] = [];

afterEach(async () => {
  await flushStepJournal();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "step-journal-"));
  dirs.push(dir);
  return dir;
}

describe("classifyStep", () => {
  it("marks a successful call as ok", () => {
    expect(classifyStep({ ok: true })).toEqual({ class: "ok" });
  });

  it("maps short motifs onto the validation taxonomy", () => {
    expect(classifyStep({ ok: false, output: "Not applied at once: no quote. Without quote it becomes a card" }).class).toBe("card");
    expect(classifyStep({ ok: false, output: "no such file: SOUL.md" }).class).toBe("missing_file");
    expect(classifyStep({ ok: false, output: "[exit 1] listing" }).class).toBe("shell_exit");
    expect(classifyStep({ ok: false, output: "platform_exfiltration refused" }).class).toBe("policy");
    expect(classifyStep({ ok: false, output: "Connection closed" }).class).toBe("transient");
    expect(classifyStep({ ok: false, output: "upstream_error: API token invalid" }).class).toBe("upstream");
    expect(classifyStep({ ok: false, output: "params_invalid: filter must be an object" }).class).toBe("invalid_args");
    expect(classifyStep({ ok: false, output: "safety_blocked by auto-computer" }).class).toBe("guard");
  });

  it("falls back to error when no motif matches", () => {
    expect(classifyStep({ ok: false, output: "something broke" })).toEqual({ class: "error" });
  });
});

describe("sanitizeStepRow / appendStep", () => {
  it("writes one JSONL line per result with no arguments and no email", async () => {
    const dataDir = scratch();
    const row = stepFromToolEvent({
      botId: "bot-cryptic",
      threadId: "thread-1",
      tool: "workspace_read",
      ok: false,
      output: "no such file: MEMORY.md",
      runId: "run-abc",
      routineName: "hourly-check",
      ms: 42,
      at: new Date("2026-11-01T12:00:00.000Z"),
    });
    expect(row).toMatchObject({
      ts: "2026-11-01T12:00:00.000Z",
      botId: "bot-cryptic",
      threadId: "thread-1",
      tool: "workspace_read",
      ok: false,
      class: "missing_file",
      runId: "run-abc",
      routineName: "hourly-check",
      ms: 42,
    });
    // content-free: never carries args, paths with emails, or result bodies
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/arguments|args|content|body/i);
    expect(serialized).not.toContain("MEMORY.md");

    appendStep(dataDir, row, new Date("2026-11-01T12:00:00.000Z"));
    await flushStepJournal(dataDir);
    const text = readFileSync(join(dataDir, "journal", "steps-2026-11.jsonl"), "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ tool: "workspace_read", class: "missing_file", ok: false });
    expect(text).not.toMatch(/alice@example\.com|password|secret/i);
  });

  it("keeps retention at 14 days", () => {
    expect(STEP_JOURNAL_RETENTION_DAYS).toBe(14);
  });

  it("sanitize drops unknown fields and truncates ids", () => {
    const dirty = {
      ts: "2026-11-01T00:00:00.000Z",
      botId: "b".repeat(200),
      threadId: "t1",
      tool: "call_tool",
      ok: true,
      class: "ok" as const,
      args: { path: "/secret" },
      email: "alice@example.com",
    };
    const clean = sanitizeStepRow(dirty as Parameters<typeof sanitizeStepRow>[0]);
    expect(clean.botId.length).toBe(128);
    expect(JSON.stringify(clean)).not.toContain("alice@");
    expect(JSON.stringify(clean)).not.toContain("/secret");
    expect("args" in clean).toBe(false);
    expect("email" in clean).toBe(false);
  });
});
