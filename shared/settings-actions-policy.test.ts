import { describe, expect, it } from "vitest";

import { decideSettingEffect } from "./settings-actions-policy.ts";

describe("every setting is an action (sagax_settings policy)", () => {
  const owner = { ownerWork: true, keyProtected: false } as const;

  it("runs the owner's own setting at Approve for me and Full", () => {
    expect(decideSettingEffect({ ...owner, classes: ["own"], mode: "auto" })).toEqual({ effect: "run" });
    expect(decideSettingEffect({ ...owner, classes: ["own"], mode: "full" })).toEqual({ effect: "run" });
  });

  it("asks at Ask and Auto-accept edits", () => {
    expect(decideSettingEffect({ ...owner, classes: ["own"], mode: "ask" })).toEqual({ effect: "hold", reason: "level" });
    expect(decideSettingEffect({ ...owner, classes: ["own"], mode: "edits" })).toEqual({ effect: "hold", reason: "level" });
    expect(decideSettingEffect({ ...owner, classes: ["own"], mode: undefined })).toEqual({ effect: "hold", reason: "level" });
  });

  it("keeps the card for a secret, another person, a bulk change, a deletion and the organization, Full included", () => {
    for (const name of ["secret", "others", "bulk", "delete", "org"] as const) {
      expect(decideSettingEffect({ ...owner, classes: ["own", name], mode: "full" }), name).toEqual({ effect: "hold", reason: "sensitive" });
    }
  });

  it("keeps the card when it is not the owner's own work", () => {
    expect(decideSettingEffect({ classes: ["own"], mode: "full", ownerWork: false, keyProtected: false })).toEqual({ effect: "hold", reason: "not-own" });
  });

  it("asks with the key whenever the person protects a class of the change", () => {
    expect(decideSettingEffect({ ...owner, keyProtected: true, classes: ["own"], mode: "full" })).toEqual({ effect: "hold", reason: "security-key" });
  });

  it("raises an approval level up to the speaking bot's own, never to Full or Custom", () => {
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "auto", approvalTo: "auto" })).toEqual({ effect: "run" });
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "auto", approvalTo: "ask" })).toEqual({ effect: "run" });
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "auto", approvalTo: "full" })).toEqual({ effect: "hold", reason: "above-level" });
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "full", approvalTo: "full" })).toEqual({ effect: "hold", reason: "above-level" });
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "full", approvalTo: "custom" })).toEqual({ effect: "hold", reason: "above-level" });
    // a standing grant with no level to compare
    expect(decideSettingEffect({ ...owner, classes: ["rule-change"], mode: "full" })).toEqual({ effect: "hold", reason: "above-level" });
  });

  it("runs what the person asked their Primary Bot for, at any level, and keeps the rest's card (2026-10-20)", () => {
    const asked = { classes: ["rule-change"] as const, mode: "ask" as const, ownerWork: true, keyProtected: false, personAsked: true };
    expect(decideSettingEffect({ ...asked, classes: ["rule-change"], approvalTo: "auto" })).toEqual({ effect: "run" });
    expect(decideSettingEffect({ ...asked, classes: ["rule-change"], approvalTo: "full" })).toEqual({ effect: "run" });
    // an Always allow rule removed
    expect(decideSettingEffect({ ...asked, classes: ["delete", "rule-change"] })).toEqual({ effect: "run" });
    // a key the person chose, a secret, another person, the organization
    expect(decideSettingEffect({ ...asked, keyProtected: true })).toEqual({ effect: "hold", reason: "security-key" });
    expect(decideSettingEffect({ ...asked, classes: ["secret"] })).toEqual({ effect: "hold", reason: "sensitive" });
    expect(decideSettingEffect({ ...asked, classes: ["org"] })).toEqual({ effect: "hold", reason: "sensitive" });
    expect(decideSettingEffect({ ...asked, ownerWork: false })).toEqual({ effect: "hold", reason: "not-own" });
    // without the person's request: the card, as before
    expect(decideSettingEffect({ ...asked, personAsked: false, approvalTo: "auto" })).toEqual({ effect: "hold", reason: "level" });
  });
});
