import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

// 2026-11-18: an account the person removes or signs out of; its bots take
// the engine their move says, in one save that survives a restart.
beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
const fallbackDefault = () => ({ instanceId: "claude", model: "opus" });

it("moves each bot as planned, drops the account's backups and conversation models, and forgets its cursors on a removal", () => {
  const store = new Store(fallbackDefault);
  const scout = store.createBot({ modelSelection: { instanceId: "claude", model: "sonnet" } }, { seedMessages: false });
  store.patchBot(scout.id, { fallback: [{ instanceId: "claude", model: "haiku" }, { instanceId: "codex", model: "gpt" }] });
  const atlas = store.createBot({ modelSelection: { instanceId: "codex", model: "gpt" } }, { seedMessages: false });
  const side = store.createTask(atlas.id, "Side")!;
  store.patchTask(atlas.id, side.threadId, { modelSelection: { instanceId: "claude", model: "opus" } });
  store.setResumeCursor(scout.id, "claude", "native-1", scout.threadId);
  const lone = store.createBot({ modelSelection: { instanceId: "claude", model: "opus" } }, { seedMessages: false });
  const changed = store.moveAccountUsers(new Set(["claude"]), [
    { botId: scout.id, to: { instanceId: "claude-work", model: "sonnet" }, fallback: [{ instanceId: "codex", model: "gpt" }] },
    { botId: atlas.id, to: { instanceId: "codex", model: "gpt" } },
    { botId: lone.id, to: null },
  ], { driverOf: (id) => id.startsWith("claude") ? "claudeAgent" : "codex", forget: true });
  expect(changed).toBe(2);
  const reloaded = new Store(fallbackDefault);
  expect(reloaded.bot(scout.id)?.modelSelection).toEqual({ instanceId: "claude-work", model: "sonnet" });
  expect(reloaded.bot(scout.id)?.fallback).toEqual([{ instanceId: "codex", model: "gpt" }]);
  expect(reloaded.taskByThread(scout.id, scout.threadId)?.resumeCursors ?? {}).toEqual({});
  expect(reloaded.bot(atlas.id)?.modelSelection).toEqual({ instanceId: "codex", model: "gpt" });
  // the conversation follows its bot again
  expect(reloaded.taskByThread(atlas.id, side.threadId)?.modelSelection).toBeUndefined();
  // no engine left: its old choice stays, so it says it has no engine until the person picks one
  expect(reloaded.bot(lone.id)?.modelSelection).toEqual({ instanceId: "claude", model: "opus" });
  expect(reloaded.moveAccountUsers(new Set(["claude"]), [], { driverOf: () => undefined, forget: true })).toBe(0);
});
