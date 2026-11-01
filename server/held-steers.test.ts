import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import {
  atRestInfoSync,
  noteAtRestWrite,
  readAtRestTextSync,
  registerAtRestRoot,
  resetAtRestState,
  runAtRestMigration,
  setAtRestGrace,
} from "./content-at-rest.ts";
import { WORKSPACE_OWNER } from "./content-keys.ts";
import { closeMessageDb, closeMessageSearch, configureContentEncryption } from "./message-db.ts";
import {
  clearHeldSteers,
  clearHeldSteersForThread,
  heldSteersAtRestFiles,
  heldSteersDir,
  joinHeldSteerTexts,
  listHeldSteers,
  migrateLegacyHeldSteers,
  recordHeldSteer,
  resumePromptWithHeld,
  takeHeldSteersForThread,
  takeRemainingHeldSteers,
} from "./held-steers.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "sagax-held-")); dirs.push(dir); return dir; };

describe("held steers journal", () => {
  it("records at acceptance and takes a thread's rows exactly once", () => {
    const dir = temp();
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m1", text: "first behind", at: 10 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m2", text: "second behind", at: 20 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t2", messageId: "m3", text: "other thread", at: 15 });
    expect(listHeldSteers(dir, "t1")).toEqual([
      { botId: "b1", threadId: "t1", messageId: "m1", text: "first behind", at: 10 },
      { botId: "b1", threadId: "t1", messageId: "m2", text: "second behind", at: 20 },
    ]);
    expect(existsSync(join(heldSteersDir(dir), "t1.json"))).toBe(true);
    expect(takeHeldSteersForThread(dir, "t1")).toEqual([
      { botId: "b1", threadId: "t1", messageId: "m1", text: "first behind", at: 10 },
      { botId: "b1", threadId: "t1", messageId: "m2", text: "second behind", at: 20 },
    ]);
    expect(takeHeldSteersForThread(dir, "t1")).toEqual([]);
    expect(listHeldSteers(dir)).toEqual([
      { botId: "b1", threadId: "t2", messageId: "m3", text: "other thread", at: 15 },
    ]);
  });

  it("replaces a duplicate message id instead of doubling it", () => {
    const dir = temp();
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m1", text: "old", at: 1 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m1", text: "new", at: 2 });
    expect(listHeldSteers(dir)).toEqual([
      { botId: "b1", threadId: "t1", messageId: "m1", text: "new", at: 2 },
    ]);
  });

  it("clears by id and by thread; empty file is removed", () => {
    const dir = temp();
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m1", text: "a", at: 1 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m2", text: "b", at: 2 });
    recordHeldSteer(dir, { botId: "b2", threadId: "t2", messageId: "m3", text: "c", at: 3 });
    clearHeldSteers(dir, ["m1"]);
    expect(listHeldSteers(dir).map((row) => row.messageId)).toEqual(["m2", "m3"]);
    clearHeldSteersForThread(dir, "t1");
    expect(listHeldSteers(dir).map((row) => row.messageId)).toEqual(["m3"]);
    expect(existsSync(join(heldSteersDir(dir), "t1.json"))).toBe(false);
    clearHeldSteersForThread(dir, "t2");
    expect(listHeldSteers(dir)).toEqual([]);
    expect(existsSync(join(heldSteersDir(dir), "t2.json"))).toBe(false);
  });

  it("hands remaining rows to crash recovery once, grouped by thread", () => {
    const dir = temp();
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m2", text: "later", at: 20 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t1", messageId: "m1", text: "earlier", at: 10 });
    recordHeldSteer(dir, { botId: "b1", threadId: "t2", messageId: "m3", text: "other", at: 15 });
    const remaining = takeRemainingHeldSteers(dir);
    expect([...remaining.keys()].sort()).toEqual(["t1", "t2"]);
    expect(remaining.get("t1")?.map((row) => row.messageId)).toEqual(["m1", "m2"]);
    expect(takeRemainingHeldSteers(dir).size).toBe(0);
  });

  it("builds a resume prompt that carries held messages, and joins drain-style texts", () => {
    const held = [
      { botId: "b1", threadId: "t1", messageId: "m1", text: "first behind", at: 1 },
      { botId: "b1", threadId: "t1", messageId: "m2", text: "second behind", at: 2 },
    ];
    expect(joinHeldSteerTexts(held)).toBe("first behind\n\nsecond behind");
    expect(resumePromptWithHeld("Sagax restarted while your previous turn was working.", held))
      .toBe("Sagax restarted while your previous turn was working.\n\nMessages sent while that turn was running:\n\nfirst behind\n\nsecond behind");
    expect(resumePromptWithHeld("base only", [])).toBe("base only");
  });

  it("migrates a legacy DATA_DIR/held-steers.json into per-thread files once", () => {
    const dir = temp();
    writeFileSync(join(dir, "held-steers.json"), JSON.stringify({
      version: 1,
      steers: [
        { botId: "b1", threadId: "t1", messageId: "m1", text: "legacy one", at: 1 },
        { botId: "b1", threadId: "t2", messageId: "m2", text: "legacy two", at: 2 },
        { botId: "b1", threadId: "t1", messageId: "m3", text: "legacy three", at: 3 },
      ],
    }), { mode: 0o600 });
    migrateLegacyHeldSteers(dir);
    expect(existsSync(join(dir, "held-steers.json"))).toBe(false);
    expect(listHeldSteers(dir, "t1").map((row) => row.messageId)).toEqual(["m1", "m3"]);
    expect(listHeldSteers(dir, "t2").map((row) => row.messageId)).toEqual(["m2"]);
    migrateLegacyHeldSteers(dir); // idempotent
    expect(listHeldSteers(dir).map((row) => row.messageId).sort()).toEqual(["m1", "m2", "m3"]);
  });
});

describe("held steers at rest", () => {
  beforeEach(async () => {
    await closeMessageSearch();
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32);
    resetAtRestState();
    setAtRestGrace(0);
    configureContentEncryption({
      mode: "on",
      autoMigrate: false,
      resolveBotOwner: () => WORKSPACE_OWNER,
      resolveOwner: () => ({ owner: WORKSPACE_OWNER, confidential: false }),
    });
    // Temp dirs in the journal suite are outside DATA_DIR; sealed tests use
    // DATA_DIR so the module-registered held-steers root covers the files.
    registerAtRestRoot({
      id: "held-steers",
      dir: heldSteersDir(DATA_DIR),
      context: (relativePath) => `held-steers/${relativePath}`,
      files: () => heldSteersAtRestFiles(DATA_DIR),
    });
  });
  afterEach(async () => {
    resetAtRestState();
    await closeMessageSearch();
    closeMessageDb();
    delete process.env.SAGAX_MCP_OAUTH_KEY;
  });

  it("seals message text under the thread key and opens it through readAtRestTextSync", async () => {
    const secret = "orchid-velvet-harbor-held-steer-secret";
    recordHeldSteer(DATA_DIR, {
      botId: "b1", threadId: "thread-held-1", messageId: "m-secret", text: secret, at: 42,
    });
    const path = join(heldSteersDir(DATA_DIR), "thread-held-1.json");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(secret); // still plain until migration
    noteAtRestWrite(path, { thread: "thread-held-1" });
    await runAtRestMigration({ sliceMs: Infinity });
    expect(atRestInfoSync(path)?.sealed).toBe(true);
    expect(readFileSync(path).toString("latin1")).not.toContain(secret);
    expect(readAtRestTextSync(path)).toContain(secret);
    expect(listHeldSteers(DATA_DIR, "thread-held-1")).toEqual([
      expect.objectContaining({ messageId: "m-secret", text: secret }),
    ]);
  });
});
