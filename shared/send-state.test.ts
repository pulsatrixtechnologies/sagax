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
});

describe("sendBlockFor: pre-send refusals (#2013)", () => {
  it("words a configuration conflict as advisory, with the Fix when Sagax can repair it", () => {
    const block = sendBlockFor({ ...base, refused: { kind: "config_conflict", cause: "outside the selected configuration", fix: "codex_native_mcp" } });
    expect(block).toMatchObject({ reason: "engine_refused", advisory: true, action: { kind: "fix", fix: "codex_native_mcp" }, refusal: { kind: "config_conflict" } });
    expect(block!.message).toMatch(/Nothing was sent/);
  });

  it("offers a resend for an engine that was not ready, and a sign-in for an expired one", () => {
    expect(sendBlockFor({ ...base, refused: { kind: "engine_not_ready", cause: "x" } })).toMatchObject({ reason: "engine_refused", advisory: true, action: { kind: "resend" } });
    expect(sendBlockFor({ ...base, refused: { kind: "signed_out", cause: "x" } })).toMatchObject({ reason: "engine_signed_out", advisory: true, action: { kind: "connect", instanceId: "claude" } });
  });

  it("lets a certain block win over a refusal", () => {
    expect(sendBlockFor({ ...base, accessRefused: true, refused: { kind: "engine_not_ready", cause: "x" } })?.reason).toBe("engine_not_connected");
    expect(sendBlockFor({ ...base, local: "computer_offline", refused: { kind: "engine_not_ready", cause: "x" } })?.reason).toBe("computer_offline");
  });
});
