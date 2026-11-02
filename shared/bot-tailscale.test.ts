import { describe, expect, it } from "vitest";

import {
  emptyBotTailscaleView,
  looksLikeAuthKey,
  phaseFromDevice,
  SAGAX_TAILSCALE_TAG,
  secretHint,
  tailscaleHostname,
} from "./bot-tailscale.ts";

describe("bot-tailscale shared helpers", () => {
  it("recognizes auth keys and redacts hints", () => {
    expect(looksLikeAuthKey("tskey-auth-ABCDEFGHxxxx")).toBe(true);
    expect(looksLikeAuthKey("tskey-api-nope")).toBe(false);
    expect(secretHint("tskey-auth-ABCDEFGHxxxx")).toBe("xxxx");
    expect(secretHint("ab")).toBe("saved");
  });

  it("sanitizes hostnames and keeps the Sagax tag constant", () => {
    expect(tailscaleHostname("Ada's Bot!")).toBe("ada-s-bot");
    expect(tailscaleHostname("   ")).toBe("sagax-bot");
    expect(SAGAX_TAILSCALE_TAG).toBe("tag:sagax");
  });

  it("maps device state to phases", () => {
    expect(phaseFromDevice(null, false)).toBe("disconnected");
    expect(phaseFromDevice(null, true)).toBe("ready");
    expect(phaseFromDevice({ name: "a", addresses: [], pendingApproval: true }, true)).toBe("pending_approval");
    expect(phaseFromDevice({ name: "a", addresses: ["100.64.0.1"], pendingApproval: false }, true)).toBe("connected");
    expect(emptyBotTailscaleView().phase).toBe("disconnected");
  });
});
