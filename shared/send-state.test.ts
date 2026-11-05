import { describe, expect, it } from "vitest";

import { sendBlockFor, type SendStateInput } from "./send-state.ts";

const base: SendStateInput = { auto: false, engine: { instanceId: "claude", name: "Claude" }, accessRefused: false, ownerComputerOffline: null, local: "unknown" };

describe("sendBlockFor", () => {
  it("blocks an engine that is not connected for this person, with the connect action", () => {
    expect(sendBlockFor({ ...base, accessRefused: true })).toMatchObject({
      reason: "engine_not_connected", name: "Claude", action: { kind: "connect", instanceId: "claude", engine: "Claude" },
    });
  });

  it("blocks a computer or a local server that is down, with a retry", () => {
    expect(sendBlockFor({ ...base, local: "computer_offline" })).toMatchObject({ reason: "computer_offline", action: { kind: "retry" } });
    expect(sendBlockFor({ ...base, local: "server_offline" })).toMatchObject({ reason: "local_server_offline", action: { kind: "retry" } });
    expect(sendBlockFor({ ...base, ownerComputerOffline: { ownerName: "Ada" } })).toMatchObject({ reason: "owner_computer_offline", name: "Ada" });
    expect(sendBlockFor({ ...base, ownerComputerOffline: { ownerName: "" } })?.message).toMatch(/^The bot owner's computer/);
  });

  it("never blocks on doubt: Auto, an unknown engine, a local model that is fine or unknown", () => {
    expect(sendBlockFor({ ...base, auto: true, accessRefused: true })).toBeNull();
    expect(sendBlockFor({ ...base, engine: null, local: "computer_offline" })).toBeNull();
    expect(sendBlockFor({ ...base, local: "ok" })).toBeNull();
    expect(sendBlockFor(base)).toBeNull();
  });

  it("says no usage limit and no sign-in in any line", () => {
    for (const input of [{ ...base, accessRefused: true }, { ...base, local: "computer_offline" as const }, { ...base, local: "server_offline" as const }]) {
      expect(sendBlockFor(input)!.message).not.toMatch(/limit|resets?|sign in/i);
    }
  });

  // The maintainer, 2026-11-04: an engine at its limit or out of credit takes no message;
  // the composer says so with the reset, never a red card in the chat.
  it("blocks an engine account at its limit or out of credit, with the switch action and the reset", () => {
    expect(sendBlockFor({ ...base, limited: { cause: "usage_limit", resetsAt: 1_800_000 } })).toMatchObject({
      reason: "engine_limit", name: "Claude", action: { kind: "switch_engine" }, limit: { cause: "usage_limit", resetsAt: 1_800_000 },
    });
    const credits = sendBlockFor({ ...base, limited: { cause: "credits" } });
    expect(credits).toMatchObject({ reason: "engine_limit", limit: { cause: "credits" } });
    expect(credits!.limit).not.toHaveProperty("resetsAt");
    expect(sendBlockFor({ ...base, auto: true, limited: { cause: "usage_limit" } })).toBeNull();
    expect(sendBlockFor({ ...base, limited: null })).toBeNull();
  });
});
