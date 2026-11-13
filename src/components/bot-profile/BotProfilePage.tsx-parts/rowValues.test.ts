// The Appearance row's value (#4147) names what the bot really wears, by the
// same rule as every avatar: a picture crop without a picture is the mascot.
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { appearanceRowValue } from "./rowValues";

describe("appearanceRowValue", () => {
  it("says Picture for a bot with a picture and a picture crop", () => {
    expect(appearanceRowValue({ avatarCrop: "circle", avatarUrl: "/api/attachments/abc-123.png" })).toBe(t("botProfile.v6.value.picture"));
  });

  it("names the mascot for a picture crop whose picture was removed", () => {
    expect(appearanceRowValue({ avatarCrop: "circle" })).toBe(t("floatingBots.mascot.owl"));
  });

  it("names the mascot for the mascot crop even with a picture kept", () => {
    expect(appearanceRowValue({ avatarCrop: "mascot", avatarUrl: "/api/attachments/abc-123.png" })).toBe(t("floatingBots.mascot.owl"));
  });
});
