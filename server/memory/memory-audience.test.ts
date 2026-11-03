import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { memoryMayShow, memoryReadersOf, readersToken, withoutWiderAudience } from "./memory-audience.ts";
import { lineFactIdentity, parseMemoryEntries } from "./memory-entries.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { ensureWorkspace, loadMemory, memoryEntry, memorySystemPrompt, updateMemory, WORKSPACES_DIR } from "../workspace/workspace.ts";

const BOT = "bot-memory-audience";

afterEach(() => {
  closeMessageDb();
  rmSync(join(WORKSPACES_DIR, BOT), { recursive: true, force: true });
});

describe("memory audience", () => {
  it("stamps who may read a captured fact, and leaves an unstamped line alone", () => {
    expect(readersToken({ kind: "person" })).toBe("readers person");
    expect(readersToken({ kind: "room", id: "room 1" })).toBe("readers room:room1");
    expect(readersToken({ kind: "group" })).toBe("readers person");
    const line = memoryEntry("The person is vegetarian", { source: 'chat "Plans"', now: new Date(2026, 8, 25), readers: { kind: "person" } });
    expect(line).toBe('- 2026-09-25 · from chat "Plans" · readers person · The person is vegetarian');
    expect(parseMemoryEntries(line)[0]).toMatchObject({ body: "The person is vegetarian" });
    expect(lineFactIdentity(line)).toBe("The person is vegetarian");
    expect(memoryReadersOf(line)).toEqual({ kind: "person" });
    expect(memoryReadersOf("- 2026-09-25 · from chat \"Plans\" · The person is vegetarian")).toBeNull();
  });

  it("refuses a private fact to a group, a room or a public copy, and keeps what had no stamp", () => {
    const text = [
      "- 2026-09-25 · from chat \"Plans\" · readers person · The person is vegetarian",
      "- 2026-09-25 · from room \"Garden\" · readers room:garden · Water on Mondays",
      "- 2026-09-25 · from chat \"Plans\" · Likes short replies",
    ].join("\n");
    expect(memoryMayShow({ kind: "person" }, { kind: "person" })).toBe(true);
    expect(memoryMayShow({ kind: "person" }, { kind: "room", id: "garden" })).toBe(false);
    expect(memoryMayShow({ kind: "person" }, { kind: "group", id: "g1" })).toBe(false);
    expect(memoryMayShow({ kind: "person" }, { kind: "public" })).toBe(false);
    expect(memoryMayShow({ kind: "room", id: "garden" }, { kind: "room", id: "garden" })).toBe(true);
    expect(memoryMayShow({ kind: "room", id: "garden" }, { kind: "room", id: "other" })).toBe(false);
    expect(memoryMayShow({ kind: "room", id: "garden" }, { kind: "group", id: "garden" })).toBe(false);
    expect(memoryMayShow(null, { kind: "public" })).toBe(true);
    const room = withoutWiderAudience(text, { kind: "room", id: "garden" });
    expect(room.held).toBe(1);
    expect(room.text).not.toContain("vegetarian");
    expect(room.text).toContain("Water on Mondays");
    expect(room.text).toContain("Likes short replies");
    const copy = withoutWiderAudience(text, { kind: "public" });
    expect(copy.text).toBe("- 2026-09-25 · from chat \"Plans\" · Likes short replies");
    expect(withoutWiderAudience(text, { kind: "person" }).text).toBe(text);
  });

  it("shows a private capture to the person and holds it back from a room", () => {
    ensureWorkspace(BOT);
    writeFileSync(join(WORKSPACES_DIR, BOT, "MEMORY.md"), [
      "- 2026-09-25 · from chat \"Plans\" · readers person · The person is vegetarian",
      "- 2026-09-25 · from chat \"Plans\" · Likes short replies",
      "",
    ].join("\n"));
    const own = memorySystemPrompt(BOT, { managedWrites: true });
    expect(own).toContain("The person is vegetarian");
    expect(own).toContain("Likes short replies");
    const room = memorySystemPrompt(BOT, { managedWrites: true, audience: { kind: "room", id: "garden" } });
    expect(room).not.toContain("vegetarian");
    expect(room).toContain("Likes short replies");
    expect(updateMemory(BOT, { action: "append", text: "The launch moved to Friday" }, { source: 'chat "Plans"', readers: { kind: "person" }, now: new Date(2026, 8, 26) }).ok).toBe(true);
    expect(loadMemory(BOT)?.text).toContain('readers person · The launch moved to Friday');
  });
});
