import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleMemoryMirror,
  MEMORY_STORE_INVENTORY,
  isMirroredMemoryPath,
  noteFromBotEntry,
  noteFromMemoryFile,
  noteFromTeamEntry,
  writtenAtIso,
  type MirrorRemote,
} from "./console-memory-mirror.ts";
import type { NotesCallResult } from "./perspicax-memory-notes.ts";

const PRINCIPAL = "pr_alice";

describe("#4461 console memory mirror", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-mirror-"));
    process.env.SAGAX_DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.SAGAX_DATA_DIR;
  });

  it("lists every store of the inventory, with mirrored ones marked", () => {
    const ids = MEMORY_STORE_INVENTORY.map((row) => row.id);
    expect(ids).toEqual([
      "bot-index",
      "bot-topics",
      "team-memory-org",
      "team-memory-solo",
      "group-memory",
      "company",
      "procedures",
      "daily-logs",
      "dreams-archive",
      "journal",
      "console-tiers",
    ]);
    expect(MEMORY_STORE_INVENTORY.filter((row) => row.mirrored).map((row) => row.id)).toEqual([
      "bot-index",
      "bot-topics",
      "team-memory-org",
      "company",
      "procedures",
    ]);
  });

  it("mirrors MEMORY.md, topics, company and procedures paths only", () => {
    expect(isMirroredMemoryPath("MEMORY.md")).toBe(true);
    expect(isMirroredMemoryPath("memory/clients.md")).toBe(true);
    expect(isMirroredMemoryPath("memory/company.md")).toBe(true);
    expect(isMirroredMemoryPath("memory/procedures.md")).toBe(true);
    expect(isMirroredMemoryPath("memory/log/2026-11-16.md")).toBe(false);
    expect(isMirroredMemoryPath("memory/archive.md")).toBe(false);
    expect(isMirroredMemoryPath("memory/dreams/2026-11-16.md")).toBe(false);
  });

  it("builds a console note with bot and written_at for a MEMORY.md entry", () => {
    const note = noteFromBotEntry({ body: "Nimbus is Eve's bot.", date: "2026-10-01" }, "Nimbus", "sagax-bot", Date.parse("2026-11-16T12:00:00Z"));
    expect(note).toEqual({
      scope: "me",
      topic: "sagax-bot",
      title: "Nimbus is Eve's bot.",
      body: "Nimbus is Eve's bot.",
      bot: "Nimbus",
      written_at: "2026-10-01T12:00:00.000Z",
      tags: ["source:sagax", "kind:bot-index"],
    });
    expect(noteFromBotEntry({ body: "   ", date: "2026-10-01" }, "Nimbus")).toBeNull();
  });

  it("builds a team-memory note for scope me with the bot that saved it", () => {
    const note = noteFromTeamEntry(
      {
        kind: "term",
        name: "CW",
        detail: "ConnectWise",
        aliases: ["ConnectWise Manage"],
        updatedAt: Date.parse("2026-10-02T08:30:00Z"),
        source: { botId: "b1", botName: "Nimbus", threadId: "t1", at: Date.parse("2026-10-02T08:30:00Z") },
      },
      undefined,
      "me",
      Date.parse("2026-11-16T12:00:00Z"),
    );
    expect(note).toMatchObject({
      scope: "me",
      topic: "terms",
      title: "CW",
      body: "ConnectWise\n\nAlso: ConnectWise Manage",
      bot: "Nimbus",
      written_at: "2026-10-02T08:30:00.000Z",
    });
  });

  it("never writes a written_at later than now", () => {
    expect(writtenAtIso("2099-01-01", Date.parse("2026-11-16T00:00:00Z"))).toBe("2026-11-16T00:00:00.000Z");
  });

  it("a solo install (disabled) pushes nothing", async () => {
    const call = vi.fn();
    const mirror = new ConsoleMemoryMirror({ client: { call }, enabled: () => false });
    const note = noteFromBotEntry({ body: "secret fact", date: "2026-10-01" }, "Nimbus")!;
    expect(await mirror.push(PRINCIPAL, "bot:b1:MEMORY.md:1", note)).toEqual({ ok: false, error: "disabled" });
    expect(call).not.toHaveBeenCalled();
  });

  it("an entry written by a bot appears in the console for its owner", async () => {
    const store = new Map<string, { title: string; body: string; bot?: string }>();
    const remote: MirrorRemote = {
      async call(_principal, method, path, body) {
        if (method === "POST" && path.endsWith("/entry")) {
          const note = body as { title: string; body: string; bot?: string; scope: string };
          const id = `n${store.size + 1}`;
          store.set(id, { title: note.title, body: note.body, bot: note.bot });
          return { ok: true, status: 201, body: { id, scope: note.scope, state: "active" } };
        }
        return { ok: false, error: "refused", status: 400 };
      },
    };
    const mirror = new ConsoleMemoryMirror({
      client: remote,
      enabled: () => true,
      now: () => Date.parse("2026-11-16T12:00:00Z"),
    });
    const text = `- 2026-10-01 · from chat "Names" · Nimbus is Eve's bot.\n- 2026-10-02 · from chat "Names" · Ember is Eve's other bot.\n`;
    const count = await mirror.bringInMemoryIndex(PRINCIPAL, "bot-nimbus", "Nimbus", text);
    expect(count).toBe(2);
    expect([...store.values()].map((row) => row.body)).toEqual([
      "Nimbus is Eve's bot.",
      "Ember is Eve's other bot.",
    ]);
    expect([...store.values()].every((row) => row.bot === "Nimbus")).toBe(true);
    // second bring-in is idempotent (same hash)
    expect(await mirror.bringInMemoryIndex(PRINCIPAL, "bot-nimbus", "Nimbus", text)).toBe(2);
  });

  it("a console edit and a console delete reach the bot's local keys", async () => {
    const notes = new Map<string, { title: string; body: string; archived?: boolean }>([
      ["n1", { title: "Old", body: "old body" }],
      ["n2", { title: "Gone", body: "will delete" }],
    ]);
    const remote: MirrorRemote = {
      async call(_principal, method, path, body) {
        if (method === "POST") {
          return { ok: true, status: 201, body: { id: "n1", scope: "me", state: "active" } };
        }
        if (method === "GET") {
          const id = new URL(`https://x${path}`).searchParams.get("id") ?? "";
          const row = notes.get(id);
          if (!row) return { ok: false, error: "refused", status: 404 };
          return { ok: true, status: 200, body: { id, scope: "me", topic: "sagax-bot", ...row } };
        }
        return { ok: false, error: "refused", status: 400, body };
      },
    };
    const mirror = new ConsoleMemoryMirror({ client: remote, enabled: () => true });
    await mirror.push(PRINCIPAL, "local:a", {
      scope: "me",
      topic: "sagax-bot",
      title: "Old",
      body: "old body",
      bot: "Nimbus",
    });
    // seed a second map entry as if n2 was mirrored
    const { readMirrorMap, writeMirrorMap } = await import("./console-memory-mirror.ts");
    const map = readMirrorMap(PRINCIPAL);
    map.entries["local:b"] = { scope: "me", id: "n2", hash: "x", local: "local:b" };
    writeMirrorMap(PRINCIPAL, map);

    notes.set("n1", { title: "New", body: "edited in the console" });
    notes.delete("n2");

    const edited: string[] = [];
    const deleted: string[] = [];
    const result = await mirror.pull(PRINCIPAL, {
      applyEdit: (key, body, title) => edited.push(`${key}:${title}:${body}`),
      applyDelete: (key) => deleted.push(key),
    });
    expect(result).toEqual({ edited: 1, deleted: 1 });
    expect(edited).toEqual(["local:a:New:edited in the console"]);
    expect(deleted).toEqual(["local:b"]);
  });

  it("another person's principal never receives the owner's mirrored push", async () => {
    const seen: string[] = [];
    const remote: MirrorRemote = {
      async call(principalId, method) {
        seen.push(`${method}:${principalId}`);
        return { ok: true, status: 201, body: { id: "n1", scope: "me", state: "active" } } satisfies NotesCallResult;
      },
    };
    const mirror = new ConsoleMemoryMirror({ client: remote, enabled: () => true });
    await mirror.push("pr_eve", "k1", noteFromMemoryFile("fact", "Nimbus", "sagax-bot", "fact", Date.parse("2026-10-01T00:00:00Z"))!);
    expect(seen).toEqual(["POST:pr_eve"]);
    expect(seen.some((line) => line.includes("pr_other"))).toBe(false);
  });
});
