import { describe, expect, it } from "vitest";

import { fullAccessNeedsConfirmation, orgFullAccessFor } from "./full-access";

const org = (allowFullAccess?: boolean) => ({ settings: allowFullAccess === undefined ? {} : { allowFullAccess } });

describe("Full access in the menu", () => {
  it("follows the desktop rules on a solo server", () => {
    expect(orgFullAccessFor(null, { ownerUserId: "alice" }, "alice")).toBeUndefined();
  });

  it("is the owner's on an organization server, allowed unless the organization turned it off", () => {
    expect(orgFullAccessFor(org(), { ownerUserId: "Alice" }, "alice")).toBe("allowed");
    expect(orgFullAccessFor(org(true), { ownerUserId: "alice" }, "alice")).toBe("allowed");
    expect(orgFullAccessFor(org(false), { ownerUserId: "alice" }, "alice")).toBe("disabled");
    expect(orgFullAccessFor(org(), { ownerUserId: "alice" }, "bob")).toBe("hidden");
    expect(orgFullAccessFor(org(), {}, "alice")).toBe("hidden");
  });

  it("never asks for a confirmation (omb #2701)", () => {
    expect(fullAccessNeedsConfirmation({}, "alice", true)).toBe(false);
    expect(fullAccessNeedsConfirmation({ fullAccessConsent: { principalId: "alice" } }, "alice", true)).toBe(false);
    expect(fullAccessNeedsConfirmation({ fullAccessConsent: { principalId: "bob" } }, "alice", true)).toBe(false);
    expect(fullAccessNeedsConfirmation({ fullAccessConsent: { principalId: "local" } }, null, false)).toBe(false);
    expect(fullAccessNeedsConfirmation({}, null, false)).toBe(false);
  });
});
