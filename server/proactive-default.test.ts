// 0.8.19 / 2026-11-01: every bot is proactive by default (shared/proactive-mode.ts).
// A new bot starts on the default; legacy propose / read-auto / follow-rules
// migrate to proactive; a chosen off stays off.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";
import { PROACTIVE_MODE_DEFAULT, proactiveModeFor } from "../shared/proactive-mode.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const BOTS = () => join(DATA_DIR, "bots.json");

describe("proactive by default", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("creates a new bot proactive, and stores it so", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Fresh" });
    expect(PROACTIVE_MODE_DEFAULT).toBe("proactive");
    expect(bot.proactiveMode).toBe("proactive");
    const saved = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<{ id: string; proactiveMode?: string }>;
    expect(saved.find((row) => row.id === bot.id)?.proactiveMode).toBe("proactive");
  });

  it("migrates absent and legacy modes to proactive, and keeps a chosen off", () => {
    const seed = new Store(selection);
    const untouched = seed.createBot({ name: "Untouched" });
    const proposer = seed.createBot({ name: "Proposer" });
    const reader = seed.createBot({ name: "Reader" });
    const follower = seed.createBot({ name: "Follower" });
    const turnedOff = seed.createBot({ name: "Turned off" });
    const rows = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.id === untouched.id) delete row.proactiveMode;
      if (row.id === proposer.id) row.proactiveMode = "propose";
      if (row.id === reader.id) row.proactiveMode = "read-auto";
      if (row.id === follower.id) row.proactiveMode = "follow-rules";
      if (row.id === turnedOff.id) row.proactiveMode = "off";
    }
    writeFileSync(BOTS(), JSON.stringify(rows));

    const store = new Store(selection);
    expect(store.bot(untouched.id)?.proactiveMode).toBe("proactive");
    expect(store.bot(proposer.id)?.proactiveMode).toBe("proactive");
    expect(store.bot(reader.id)?.proactiveMode).toBe("proactive");
    expect(store.bot(follower.id)?.proactiveMode).toBe("proactive");
    expect(store.bot(turnedOff.id)?.proactiveMode).toBe("off");

    const disk = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<{ id: string; proactiveMode?: string }>;
    expect(disk.find((row) => row.id === untouched.id)?.proactiveMode).toBe("proactive");
    expect(disk.find((row) => row.id === proposer.id)?.proactiveMode).toBe("proactive");
    store.patchBot(untouched.id, { proactiveMode: "off" });
    expect(new Store(selection).bot(untouched.id)?.proactiveMode).toBe("off");
  });

  it("reads the wire the same way on every client: absent is proactive, a chosen off is off", () => {
    expect(proactiveModeFor({})).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: "off" })).toBe("off");
    expect(proactiveModeFor({ proactiveMode: "follow-rules" })).toBe("proactive");
  });
});
