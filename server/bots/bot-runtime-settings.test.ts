import { describe, expect, it } from "vitest";

import {
  botAutomaticRecovery,
  botMaxConcurrentThreads,
  botMaxParallelPerPerson,
  botRecoveryBackups,
  botRuntimeSettingsPatchSchema,
  effectiveBotRuntimeSettings,
  planRuntimeSettingsMigration,
  withoutRemovedBackup,
} from "./bot-runtime-settings.ts";
import { newBotDefaultsSchema } from "./new-bot-defaults.ts";

const backup = { instanceId: "codex", model: "gpt-5" };

describe("per-bot runtime settings: migration (Owner 2026-10-15)", () => {
  it("copies the global values onto every bot that has none, without loss", () => {
    const global = { threads: { maxConcurrentPerBot: 7, maxParallelPerPerson: 2 }, automaticRecovery: { enabled: true, backup } };
    const plan = planRuntimeSettingsMigration([{ id: "a" }, { id: "b" }], global);
    expect(plan).toEqual([
      { botId: "a", patch: { maxConcurrentThreads: 7, maxParallelPerPerson: 2, automaticRecovery: { enabled: true, backup } } },
      { botId: "b", patch: { maxConcurrentThreads: 7, maxParallelPerPerson: 2, automaticRecovery: { enabled: true, backup } } },
    ]);
    // each bot gets its own copy, never a shared object
    expect(plan[0]!.patch.automaticRecovery).not.toBe(plan[1]!.patch.automaticRecovery);
  });

  it("keeps a bot's own value and fills only what is missing", () => {
    const plan = planRuntimeSettingsMigration(
      [{ id: "a", maxConcurrentThreads: 1, automaticRecovery: { enabled: false } }, { id: "b", maxConcurrentThreads: 2, maxParallelPerPerson: 4, automaticRecovery: { enabled: false } }],
      { threads: { maxConcurrentPerBot: 9 } },
    );
    expect(plan).toEqual([{ botId: "a", patch: { maxParallelPerPerson: 3 } }]);
  });

  it("an untouched server copies the built-in defaults; busySend stays each person's own", () => {
    const [entry] = planRuntimeSettingsMigration([{ id: "a" }], {});
    expect(entry!.patch).toEqual({ maxConcurrentThreads: 3, maxParallelPerPerson: 3, automaticRecovery: { enabled: false } });
    expect(entry!.patch).not.toHaveProperty("busySend");
  });
});

describe("per-bot runtime settings: the runtime reads the bot", () => {
  const global = { threads: { maxConcurrentPerBot: 5, maxParallelPerPerson: 4 }, automaticRecovery: { enabled: true, backup } };

  it("the bot's own limits win over the global ones", () => {
    expect(botMaxConcurrentThreads({ maxConcurrentThreads: 1 }, global)).toBe(1);
    expect(botMaxParallelPerPerson({ maxParallelPerPerson: 9 }, global)).toBe(9);
    // a bot made by a path that sets nothing: the server default
    expect(botMaxConcurrentThreads({}, global)).toBe(5);
    expect(botMaxParallelPerPerson(undefined, global)).toBe(4);
    expect(botMaxConcurrentThreads({}, {})).toBe(3);
  });

  it("#1098: parallel tasks per person stay at most 10 on a shared host, up to 16 solo", () => {
    expect(botMaxParallelPerPerson({ maxParallelPerPerson: 16 }, global, false)).toBe(16);
    expect(botMaxParallelPerPerson({ maxParallelPerPerson: 16 }, global, true)).toBe(10);
    expect(botRuntimeSettingsPatchSchema.safeParse({ maxParallelPerPerson: 16 }).success).toBe(true);
    expect(botRuntimeSettingsPatchSchema.safeParse({ maxParallelPerPerson: 17 }).success).toBe(false);
  });

  it("recovery is the bot's: off on the bot means no backup even when the global is on", () => {
    expect(botRecoveryBackups({ automaticRecovery: { enabled: false } }, global)).toEqual([]);
    expect(botRecoveryBackups({ automaticRecovery: { enabled: true, backup: { instanceId: "q", model: "m" } } }, {})).toEqual([{ instanceId: "q", model: "m" }]);
    // its ordered chain wins over its backup
    expect(botRecoveryBackups({ automaticRecovery: { enabled: true, backup }, fallback: [{ instanceId: "x", model: "y" }] }, {})).toEqual([{ instanceId: "x", model: "y" }]);
    expect(botAutomaticRecovery({}, global)).toEqual({ enabled: true, backup });
    expect(botRecoveryBackups({}, {})).toEqual([]);
  });

  it("answers the effective values, busySend null when the bot has none", () => {
    expect(effectiveBotRuntimeSettings({ busySend: "parallel" }, global)).toEqual({
      maxConcurrentThreads: 5, maxParallelPerPerson: 4, busySend: "parallel", automaticRecovery: { enabled: true, backup },
    });
    expect(effectiveBotRuntimeSettings({}, {}).busySend).toBeNull();
  });

  it("turns recovery off when its backup engine is removed", () => {
    expect(withoutRemovedBackup({ enabled: true, backup }, (id) => id === "codex")).toEqual({ enabled: false });
    const kept = { enabled: true, backup };
    expect(withoutRemovedBackup(kept, () => false)).toBe(kept);
    expect(withoutRemovedBackup(undefined, () => true)).toBeUndefined();
  });
});

describe("per-bot runtime settings: validation", () => {
  it("accepts bounded values and refuses the rest", () => {
    expect(botRuntimeSettingsPatchSchema.safeParse({ maxConcurrentThreads: 16, maxParallelPerPerson: 1, busySend: "after" }).success).toBe(true);
    expect(botRuntimeSettingsPatchSchema.safeParse({ maxConcurrentThreads: 17 }).success).toBe(false);
    expect(botRuntimeSettingsPatchSchema.safeParse({ maxParallelPerPerson: 0 }).success).toBe(false);
    expect(botRuntimeSettingsPatchSchema.safeParse({ busySend: "later" }).success).toBe(false);
    expect(botRuntimeSettingsPatchSchema.safeParse({ automaticRecovery: { enabled: true } }).success).toBe(false);
    expect(botRuntimeSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(botRuntimeSettingsPatchSchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it("New bot defaults may carry them, so a new bot starts with the template's values", () => {
    const parsed = newBotDefaultsSchema.parse({ profile: { maxConcurrentThreads: 2, busySend: "steer", automaticRecovery: { enabled: false } } });
    expect(parsed.profile).toMatchObject({ maxConcurrentThreads: 2, busySend: "steer", automaticRecovery: { enabled: false } });
    expect(newBotDefaultsSchema.safeParse({ profile: { maxConcurrentThreads: 0 } }).success).toBe(false);
  });
});
