// #4940: the history says who wrote each change: the person in the app or the
// console, an AI client by MCP with its client name, or a bot for its person.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "./auth/request-auth.ts";
import { BOT_ACT_SESSION_LABEL, SessionRegistry, type SessionRecord } from "./auth/sessions.ts";
import { botFolder } from "./bots/bot-folder.ts";
import { historyWriterOf, writerStampForActor } from "./history-writer.ts";
import { flushProfileHistory, readHistory, recordProfileChange } from "./profiles/profile-versions.ts";
import { flushRoutineHistory, readRoutineHistory, recordRoutineChange } from "./routines/routine-history.ts";

const session = (extra: Partial<SessionRecord>): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s1", tokenHash: "0".repeat(64), label: "Ada", scopes: ["client"], createdAt: 0, lastSeenAt: 0, expiresAt: 1, principalId: "pr_ada", ...extra },
});

describe("historyWriterOf (#4940)", () => {
  it("tells the person in the app from an AI client by MCP, with its client name", () => {
    expect(historyWriterOf({ kind: "loopback", scopes: ["admin", "client"] })).toEqual({ kind: "person", via: "app" });
    expect(historyWriterOf(session({}))).toEqual({ kind: "person", via: "app", principalId: "pr_ada" });
    expect(historyWriterOf(session({ ephemeral: true, writer: writerStampForActor("perspicax-mcp", "Claude Code") })))
      .toEqual({ kind: "agent", via: "mcp", principalId: "pr_ada", name: "Ada", client: "Claude Code" });
    expect(historyWriterOf(session({ ephemeral: true, writer: writerStampForActor("console", "ignored") })))
      .toEqual({ kind: "person", via: "console", principalId: "pr_ada", name: "Ada" });
    expect(historyWriterOf(session({ ephemeral: true, label: BOT_ACT_SESSION_LABEL }))).toEqual({ kind: "bot", via: "bot-act", principalId: "pr_ada" });
    expect(historyWriterOf(undefined)).toBeUndefined();
  });

  it("an act-as session the member API opens carries its writer", () => {
    const dir = mkdtempSync(join(tmpdir(), "sgx-writer-"));
    const registry = new SessionRegistry({ file: join(dir, "sessions.json"), now: () => 1_000 });
    const opened = registry.actAs({ principalId: "pr_ada", scopes: ["client"], label: "Ada", writer: writerStampForActor("perspicax-mcp", "Claude Code") });
    const authed = registry.authenticate(opened!.token);
    expect(authed?.writer).toEqual({ kind: "agent", via: "mcp", client: "Claude Code" });
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a profile history row keeps the writer", async () => {
    const botId = `writer-${Date.now()}`;
    mkdirSync(botFolder(botId), { recursive: true, mode: 0o700 });
    const profile = { name: "Marc", title: "", description: "", soul: "a", notifications: true, speakReplies: false };
    recordProfileChange(botId, "user", "api", profile, { ...profile, soul: "b" }, { kind: "agent", via: "mcp", principalId: "pr_ada", client: "Claude Code" });
    await flushProfileHistory(botId);
    const [row] = readHistory(botId);
    expect(row?.writer).toEqual({ kind: "agent", via: "mcp", principalId: "pr_ada", client: "Claude Code" });
    rmSync(botFolder(botId), { recursive: true, force: true });
  });

  it("a routine's changes are recorded with their writer, newest first", async () => {
    const botId = `writer-r-${Date.now()}`;
    mkdirSync(botFolder(botId), { recursive: true, mode: 0o700 });
    recordRoutineChange(botId, "r-1", "create", { name: "x" }, { kind: "person", via: "app", principalId: "pr_ada" }, 1);
    recordRoutineChange(botId, "r-1", "update", { prompt: "y", enabled: true, expected_version: "1" }, { kind: "agent", via: "mcp", client: "Claude Code" }, 2);
    recordRoutineChange(botId, "r-2", "delete", undefined, undefined, 3);
    await flushRoutineHistory(botId);
    const rows = readRoutineHistory(botId, "r-1");
    expect(rows.map((row) => [row.action, row.fields, row.writer?.kind])).toEqual([
      ["update", ["enabled", "prompt"], "agent"],
      ["create", [], "person"],
    ]);
    expect(rows[0]?.writer?.client).toBe("Claude Code");
    rmSync(botFolder(botId), { recursive: true, force: true });
  });
});
