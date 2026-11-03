import { describe, expect, it, vi } from "vitest";
import { videoCredential } from "./video-credentials.ts";

const deps = () => ({ organization: true, personal: vi.fn(async () => ({ ok: true as const, key: "synthetic-personal", fingerprint: "fixture" })), solo: vi.fn(async () => "synthetic-solo"), organizationAllowed: vi.fn(() => false), organizationKey: vi.fn(() => "synthetic-org") });
describe("video credentials", () => {
  it("uses the person's own key without an org media grant, and never reads the org key", async () => {
    const d = deps();
    expect(await videoCredential(d)).toEqual({ key: "synthetic-personal", payer: "personal" });
    expect(d.organizationAllowed).not.toHaveBeenCalled(); expect(d.organizationKey).not.toHaveBeenCalled();
  });
  it("uses solo account storage and gives an actionable missing-key receipt", async () => {
    const d = { ...deps(), organization: false };
    expect(await videoCredential(d)).toEqual({ key: "synthetic-solo", payer: "solo" });
    expect(d.personal).not.toHaveBeenCalled();
    await expect(videoCredential({ ...d, solo: async () => undefined })).rejects.toThrow("Settings > Providers");
  });
  it("reads the org key only after an explicit grant and a confirmed absence of a personal key", async () => {
    const d = { ...deps(), personal: vi.fn(async () => ({ ok: false as const, error: "no_key" as const })) };
    await expect(videoCredential(d)).rejects.toMatchObject({ status: 403 });
    expect(d.organizationKey).not.toHaveBeenCalled();
    d.organizationAllowed.mockReturnValue(true);
    expect(await videoCredential(d)).toEqual({ key: "synthetic-org", payer: "organization" });
  });
  it("pins recovery to the original payer through key deletion, outage and new personal keys", async () => {
    const d = { ...deps(), personal: vi.fn(async () => ({ ok: false as const, error: "unreachable" as const })), organizationAllowed: vi.fn(() => true) };
    await expect(videoCredential(d)).rejects.toThrow("will not switch");
    await expect(videoCredential({ ...d, personal: async () => ({ ok: false, error: "no_key" }) }, "personal")).rejects.toThrow("will not switch");
    expect(d.organizationKey).not.toHaveBeenCalled();
    const fresh = deps(); fresh.organizationAllowed.mockReturnValue(true);
    expect(await videoCredential(fresh, "organization")).toEqual({ key: "synthetic-org", payer: "organization" });
    expect(fresh.personal).not.toHaveBeenCalled();
  });
});
