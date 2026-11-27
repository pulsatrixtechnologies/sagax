// D-20261126-018 (#5351): the app's backup filters (ModelSection keep,
// BotModelsSettings useBackupFilter) drop a backup on a hidden provider
// unless it is the bot's own engine (modelSetting when the conversation is
// on a backup).
import { describe, expect, it } from "vitest";

import { engineHidden, type EngineOfferContext } from "../../shared/offered-engines";

type Backup = { instanceId: string; model: string };

function keepBackup(entry: Backup, botEngine: string, context: EngineOfferContext): boolean {
  if (entry.instanceId !== botEngine && engineHidden(context, entry.instanceId)) return false;
  return true;
}

describe("backup filter for a hidden provider", () => {
  const hidden: EngineOfferContext = { organization: true, allowedEngines: null, hiddenEngines: ["claude"] };

  it("keeps a backup on the bot's own hidden engine", () => {
    expect(keepBackup({ instanceId: "claude", model: "opus" }, "claude", hidden)).toBe(true);
  });

  it("drops a backup on another hidden provider", () => {
    expect(keepBackup({ instanceId: "claude", model: "opus" }, "codex", hidden)).toBe(false);
  });

  it("uses the profile engine when the conversation is on a backup", () => {
    // modelSetting = claude (profile), modelSelection = hold (conversation)
    const botEngine = "claude";
    expect(keepBackup({ instanceId: "claude", model: "opus" }, botEngine, hidden)).toBe(true);
    expect(keepBackup({ instanceId: "claude", model: "opus" }, "hold", hidden)).toBe(false);
  });

  it("keeps a backup on a shown provider", () => {
    expect(keepBackup({ instanceId: "hold", model: "m" }, "claude", hidden)).toBe(true);
  });
});
