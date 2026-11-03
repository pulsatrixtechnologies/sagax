// Dream pass: a private fact stays out of company memory, duplicate topics
// merge, a contradicted fact goes to the archive, and undo puts it back.
// A line with no readers mark still loads.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { companyTextForBots } from "./memory-company.ts";
import { memoryAudience, planDream } from "./memory-dream.ts";
import { flushMemoryJournal, readMemoryJournal, resetMemoryJournalState, revertMemoryChange } from "./memory-journal.ts";
import { procedureLine, procedureSignal, recordProcedure, resetProcedureSignals } from "./memory-procedures.ts";
import { readMemoryDoc } from "./memory-store.ts";
import { createMemoryUpkeep, type UpkeepBot } from "./memory-upkeep.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { loadMemory, readMemoryFile, readMemoryTopic, writeMemoryFile, writeMemoryTopic, WORKSPACES_DIR } from "../workspace.ts";

const TODAY = "2026-10-27";
const BOT: UpkeepBot = { id: "bot-dream-pass", name: "Note", memoryUpkeep: true };
const SHIPS = "- 2026-10-01 · The team ships on Tuesdays · readers company";
const PRIVATE = "- 2026-10-01 · readers person · The private note stays with the person";
const DESK = "- 2026-10-04 · The desk faces the window";

beforeEach(() => {
  closeMessageDb();
  resetMemoryJournalState();
  resetProcedureSignals();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

describe("dream", () => {
  it("keeps an unmarked line visible and refuses a private fact to company memory", () => {
    const plan = planDream({
      today: TODAY,
      memory: `${PRIVATE}\n${DESK}\n`,
      topics: [{ name: "alpha.md", text: `${SHIPS}\n` }],
    });
    expect(plan.memory).toContain(DESK);
    expect(plan.memory).toContain("readers person");
    expect(plan.company).toContain("The team ships on Tuesdays");
    expect(plan.company).not.toContain("The private note stays with the person");
    expect(plan.company).not.toContain("The desk faces the window");
    expect(memoryAudience(DESK)).toBeNull();
    expect(memoryAudience(PRIVATE)).toBe("person");
    expect(memoryAudience(SHIPS)).toBe("company");
  });

  it("merges a duplicate topic, archives a contradiction, promotes the repeated fact, and undo restores", async () => {
    const clock = new Date(2026, 9, 27, 10, 0);
    writeMemoryFile(BOT.id, [
      "- 2026-10-01 · ~~The office is downtown~~ · superseded 2026-10-02",
      "- 2026-10-03 · The office is uptown",
      DESK,
      PRIVATE,
      "",
    ].join("\n"));
    writeMemoryTopic(BOT.id, "alpha.md", `${SHIPS}\n`);
    writeMemoryTopic(BOT.id, "beta.md", `${SHIPS}\n`);
    const upkeep = createMemoryUpkeep({
      bots: () => [BOT],
      bot: (id) => (id === BOT.id ? BOT : undefined),
      engine: () => ({ generateText: async () => "[]" }),
      busy: () => false,
      addToAboutMe: () => 0,
      sourceLabel: () => 'chat "Plans"',
      quietMs: () => 60_000,
      tidyHour: () => 3,
      now: () => clock,
    });
    const report = await upkeep.dream(BOT.id);
    expect(report).toMatchObject({ promoted: 1, merged: 1 });
    expect(report.archived).toBeGreaterThan(0);

    const memory = readMemoryFile(BOT.id).text;
    expect(memory).not.toContain("downtown");
    expect(memory).toContain("The office is uptown");
    expect(memory).toContain("The team ships on Tuesdays");
    const loaded = loadMemory(BOT.id)?.text ?? "";
    expect(loaded).toContain(DESK);
    expect(loaded).toContain("The private note stays with the person");
    expect(readMemoryTopic(BOT.id, "alpha.md")).toContain("The team ships on Tuesdays");
    expect(readMemoryTopic(BOT.id, "beta.md")).toBeNull();
    const company = readMemoryTopic(BOT.id, "company.md") ?? "";
    expect(company).toContain("The team ships on Tuesdays");
    expect(company).not.toContain("The private note stays with the person");
    expect(company).not.toContain("The desk faces the window");
    const archive = readMemoryTopic(BOT.id, "archive.md") ?? "";
    expect(archive).toContain("The office is downtown");
    expect(archive).toContain("· merged 2026-10-27");
    const account = readMemoryDoc(BOT.id, "memory/dreams/2026-10-27.md").text;
    expect(account).toContain("Promoted:");
    expect(account).toContain("Merged:");
    expect(account).toContain("Archived:");

    await flushMemoryJournal(BOT.id);
    const rows = readMemoryJournal(BOT.id, 20).filter((row) => row.via === "dream");
    expect(rows.map((row) => row.path)).toContain("memory/dreams/2026-10-27.md");
    const memoryRow = rows.find((row) => row.path === "MEMORY.md");
    const deleted = rows.find((row) => row.path === "memory/beta.md" && row.kind === "deleted");
    expect(memoryRow?.canRevert).toBe(true);
    expect(deleted?.canRevert).toBe(true);
    expect(revertMemoryChange(BOT.id, memoryRow!.id).ok).toBe(true);
    expect(readMemoryFile(BOT.id).text).toContain("The office is downtown");
    expect(revertMemoryChange(BOT.id, deleted!.id).ok).toBe(true);
    expect(readMemoryTopic(BOT.id, "beta.md")).toContain("The team ships on Tuesdays");
  });
});

describe("company memory is per person", () => {
  it("does not read another member's file", () => {
    const seen: string[] = [];
    const text = companyTextForBots({
      ownerKey: "owner-a",
      bots: [
        { id: "bot-a", ownerKey: "owner-a" },
        { id: "bot-b", ownerKey: "owner-b" },
      ],
      read: (id) => {
        seen.push(id);
        return id === "bot-a" ? "- 2026-10-01 · The team ships on Tuesdays · readers company\n" : "- 2026-10-01 · The other member's private plan\n";
      },
    });
    expect(seen).toEqual(["bot-a"]);
    expect(text).toContain("The team ships on Tuesdays");
    expect(text).not.toContain("other member");
  });
});

describe("procedures", () => {
  it("notes an approval, a finished task and a followed correction, once, and undo removes it", async () => {
    expect(procedureSignal({ type: "request.resolved", behavior: "deny", source: "user", threadId: "t1" })).toBeNull();
    const approval = procedureSignal({ type: "request.resolved", behavior: "allow", source: "user", threadId: "t1" });
    expect(approval).toMatchObject({ kind: "approval" });
    procedureSignal({ type: "item.completed", itemType: "tool", ok: true, threadId: "t1", turnId: "turn-1" });
    expect(procedureSignal({ type: "turn.completed", ok: true, threadId: "t1", turnId: "turn-1" })).toMatchObject({ kind: "task" });
    procedureSignal({ type: "steer.received", threadId: "t1" });
    expect(procedureSignal({ type: "turn.completed", ok: true, threadId: "t1", turnId: "turn-2" })).toMatchObject({ kind: "correction" });
    expect(procedureSignal({ type: "turn.completed", ok: false, threadId: "t1", turnId: "turn-3" })).toBeNull();

    const line = procedureLine({ date: TODAY, source: 'chat "Plans"', kind: "approval", what: approval!.what });
    expect(line).toContain("2026-10-27");
    expect(line).toContain('chat "Plans"');
    expect(recordProcedure(BOT.id, { date: TODAY, source: 'chat "Plans"', kind: "approval", what: approval!.what })).toBe(true);
    expect(recordProcedure(BOT.id, { date: TODAY, source: 'chat "Plans"', kind: "approval", what: approval!.what })).toBe(false);
    expect(readMemoryTopic(BOT.id, "procedures.md")).toContain("approval:");
    await flushMemoryJournal(BOT.id);
    const row = readMemoryJournal(BOT.id, 5).find((entry) => entry.via === "procedure");
    expect(row?.canRevert).toBe(true);
    expect(revertMemoryChange(BOT.id, row!.id).ok).toBe(true);
    expect(readMemoryTopic(BOT.id, "procedures.md")).toBeNull();
  });
});

