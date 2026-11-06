import { describe, expect, it } from "vitest";

import { effectiveBackups } from "./bot-runtime-settings";

const a = { instanceId: "a", model: "m-a" };
const b = { instanceId: "b", model: "m-b" };
const server = { instanceId: "srv", model: "m-srv" };
const config = { automaticRecovery: { enabled: true, backup: server } };

describe("effectiveBackups", () => {
  it("prefers the bot's ordered backups", () => {
    expect(effectiveBackups({ fallback: [a, b] }, config)).toEqual({ chain: [a, b], source: "bot" });
  });

  it("falls back to the bot's single backup", () => {
    expect(effectiveBackups({ fallback: [], automaticRecovery: { enabled: true, backup: b } }, config)).toEqual({ chain: [b], source: "bot" });
  });

  it("shows the server default when the bot has nothing of its own", () => {
    expect(effectiveBackups({}, config)).toEqual({ chain: [server], source: "org" });
  });

  it("keeps the bot's own empty choice over the server default", () => {
    expect(effectiveBackups({ automaticRecovery: { enabled: false } }, config)).toEqual({ chain: [], source: "none" });
  });

  it("drops entries the viewer may not use", () => {
    expect(effectiveBackups({ fallback: [a, b] }, config, (entry) => entry.instanceId !== "a").chain).toEqual([b]);
    expect(effectiveBackups({}, config, () => false)).toEqual({ chain: [], source: "none" });
  });
});
