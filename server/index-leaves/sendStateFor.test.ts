// #3552: a usage limit or used-up credit is no send block. The server holds
// the message for the reset and the conversation's line says so; the message
// box takes the message and draws no bar.
import { describe, expect, it } from "vitest";

import { sendBlockFor } from "../../shared/send-state.ts";
import { createSendStateFor } from "./sendStateFor.ts";

function host(overrides: Record<string, unknown> = {}) {
  return {
    registry: { get: () => ({ instanceId: "claude", enabled: true }) },
    engineDisplayName: () => "Claude",
    ownerModelOfflineRefusal: () => null,
    IDENTITY: { kind: "solo" },
    orgEngineRefusal: () => null,
    speakerTurnSelection: () => null,
    preSendRefusals: { for: () => null },
    desktopLocalModels: { reach: () => "unknown" },
    // what an older server read: the engine account at its limit, no backup
    sendStateLimit: async () => ({ cause: "usage_limit", resetsAt: Date.now() + 3_600_000 }),
    sendBlockFor,
    ...overrides,
  };
}
const bot = { id: "bot", threadId: "t-1", modelSelection: { instanceId: "claude", model: "opus" } };

describe("sendStateFor (#3552)", () => {
  it("is no block when the engine is at its usage limit or out of credit", async () => {
    expect(await createSendStateFor(() => host())(bot, { origin: "person" })).toBeNull();
    const credits = host({ sendStateLimit: async () => ({ cause: "credits" }) });
    expect(await createSendStateFor(() => credits)(bot, { origin: "person" })).toBeNull();
  });

  it("still blocks an engine that is not connected or a computer that is offline", async () => {
    const offline = host({ desktopLocalModels: { reach: () => "computer_offline" } });
    expect(await createSendStateFor(() => offline)(bot, { origin: "person" })).toMatchObject({ reason: "computer_offline" });
    const refused = host({ IDENTITY: { kind: "perspicax" }, orgEngineRefusal: () => ({ reason: "x" }) });
    expect(await createSendStateFor(() => refused)(bot, { origin: "person" })).toMatchObject({ reason: "engine_not_connected", name: "Claude" });
  });
});
