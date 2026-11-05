import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "../../config.ts";
import { Store } from "../../store.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { wireCodexSessionLifecycle } from "./lifecycle.ts";

describe("Codex process record invalidation", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
  const fixture = () => {
    const store = new Store(() => ({ instanceId: "codex", model: "fixture-model" }));
    const bot = store.createBot();
    const release = vi.fn();
    const other = vi.fn();
    const instances = [
      { driverKind: "codex", adapter: { releaseWarmSession: release } },
      { driverKind: "claudeAgent", adapter: { releaseWarmSession: other } },
    ] as unknown as ProviderInstance[];
    const stop = wireCodexSessionLifecycle(store, () => instances);
    return { store, bot, release, other, stop };
  };
  it("closes only the changed thread when its engine or model changes", () => {
    const { store, bot, release, other, stop } = fixture();
    const sibling = store.createTask(bot.id, "Wren")!;
    store.switchTaskModel(bot.id, sibling.threadId, { instanceId: "claude", model: "fixture-model" }, false);
    expect(release.mock.calls).toEqual([[sibling.threadId]]);
    release.mockClear();
    store.patchTask(bot.id, bot.threadId, { modelSelection: { instanceId: "codex", model: "other-model" } });
    expect(release.mock.calls).toEqual([[bot.threadId]]);
    expect(other).not.toHaveBeenCalled();
    stop();
  });
  it("closes every deleted bot thread and a deleted task", () => {
    const { store, bot, release, stop } = fixture();
    const sibling = store.createTask(bot.id, "Wren")!;
    store.deleteTask(bot.id, sibling.threadId);
    expect(release).toHaveBeenCalledWith(sibling.threadId);
    release.mockClear();
    store.deleteBot(bot.id);
    expect(release).toHaveBeenCalledWith(bot.threadId);
    stop();
  });
  it("closes on ownership changes and ignores ordinary transcript, activity and name writes", () => {
    const { store, bot, release, stop } = fixture();
    store.patchBot(bot.id, { name: "Osprey", busy: true });
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Fixture" });
    expect(release).not.toHaveBeenCalled();
    store.patchBot(bot.id, { ownerUserId: "wren" });
    expect(release).toHaveBeenCalledWith(bot.threadId);
    stop();
  });
});
